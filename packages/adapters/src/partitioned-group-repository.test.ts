import { expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { DynamoDBClient, GetItemCommand, BatchGetItemCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { Groups, KnownEnough as KE } from '@deal-table/contracts';
import { MemoryGroupRepository } from './group-repository.ts';
import { partitionMembershipKey } from './partition-membership-contract.ts';
import {
  createPartitionedGroupRepository, createDynamoPartitionTransport, partitionAccountKey, partitionGroupKey, partitionDynamoWrites, partitionIO, partitionCall,
  type PartitionKey, type PartitionMutation, type PartitionRow, type PartitionTransport,
} from './partitioned-group-repository.ts';

const keyOf = (key: PartitionKey) => `${key.PK}/${key.SK}`;
function storage() {
  const rows = new Map<string, PartitionRow>(); let collisions = 0; let commits = 0;
  const transport: PartitionTransport = {
    read: async key => structuredClone(rows.get(keyOf(key)) ?? null),
    readMany: async keys => keys.map(key => structuredClone(rows.get(keyOf(key)) ?? null)),
    commit: async mutations => {
      commits++;
      if (mutations.some(item => (rows.get(keyOf(item.key))?.revision ?? 0) !== item.expected)) { collisions++; return false; }
      for (const mutation of mutations) if (mutation.next) rows.set(keyOf(mutation.key), structuredClone(mutation.next));
      return true;
    },
  };
  return { rows, transport, get collisions() { return collisions; }, get commits() { return commits; } };
}
const account = (subject: string): Groups.Account => ({ subject, emailHash: createHash('sha256').update(subject).digest('hex'), displayName: subject, status: 'APPROVED', version: 1 });
const group = (id: string, members = ['iris']): Groups.Group => ({ id, name: id, organizer: members[0]!, version: 1, members, drafts: [], decisions: [], invitations: [] });
const scope = (groupId = 'garden', accountSubjects = ['iris']) => ({ groupId, accountSubjects });
const approved = (state: Groups.GroupState, who = 'iris') => {
  if (state.accounts.find(item => item.subject === who)?.status !== 'APPROVED') throw new Error('FORBIDDEN');
};
const draft = (id: string): Groups.GroupDraft => ({ id, bodyHash: 'b'.repeat(64), revision: 1, groupVersion: 1,
  frame: KE.PublicDecisionFrame.parse({ schemaVersion: KE.KE_SCHEMA_VERSION, decisionId: id, frameVersion: 1, semanticVersion: 1,
    contextToken: 'c'.repeat(64), title: 'Garden gathering', objective: 'x'.repeat(2000), description: 'x'.repeat(4000),
    participants: [{ id: 'iris', displayName: 'Iris', requiredForApproval: true }], requiredParticipantIds: ['iris'], variables: [], rules: [] }),
  clarificationQuestions: Array.from({ length: 12 }, () => 'q'.repeat(500)), createdDecisionId: null });
async function seed(store: ReturnType<typeof storage>, groupId = 'garden', members = ['iris']) {
  const repo = createPartitionedGroupRepository(store.transport);
  await repo.transaction(scope(groupId, members), state => {
    for (const who of members) if (!state.accounts.some(item => item.subject === who)) state.accounts.push(account(who));
    state.groups.push(group(groupId, members));
  });
  return repo;
}

it('persists a realistic collection larger than the old shared-row limit as individually bounded drafts', async () => {
  const store = storage(); const repo = await seed(store);
  const drafts = Array.from({ length: 32 }, (_, index) => draft(`draft-${index}`));
  const legacy = new MemoryGroupRepository();
  await expect(legacy.transaction(state => { state.accounts.push(account('iris')); state.groups.push({ ...group('garden'), drafts }); })).rejects.toThrow('GROUP_CAPACITY_EXCEEDED');
  await repo.transaction(scope(), state => { state.groups[0]!.drafts = drafts; });
  expect(store.rows.size).toBe(36); // Account, email claim, header, membership,32 separate drafts.
  expect(Math.max(...[...store.rows.values()].map(row => Buffer.byteLength(JSON.stringify(row))))).toBeLessThan(352 * 1024);
  expect(await createPartitionedGroupRepository(store.transport).transaction(scope(), state => state.groups[0]!.drafts)).toEqual(drafts);
});

it('commits concurrent unrelated groups without a shared account write or retry', async () => {
  const store = storage(); const repo = await seed(store); await seed(store, 'art');
  const initialAccountRevision = store.rows.get(keyOf(partitionAccountKey('iris')))!.revision;
  let arrived = 0; let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
  await Promise.all(['garden', 'art'].map(groupId => repo.transaction(scope(groupId), async state => {
    approved(state); state.groups[0]!.name += '-changed';
    if (++arrived === 2) release(); await barrier;
  })));
  expect(store.collisions).toBe(0); expect(store.rows.get(keyOf(partitionAccountKey('iris')))!.revision).toBe(initialAccountRevision);
  expect(await repo.transaction(scope('art'), state => state.groups[0]!.name)).toBe('art-changed');
});

it('retries a same-group collision from fresh state without losing either update', async () => {
  const store = storage(); const repo = await seed(store);
  await Promise.all(['one', 'two'].map(id => repo.transaction(scope(), state => { state.groups[0]!.decisions.push({ id, version: 1 }); })));
  expect(store.collisions).toBe(1);
  expect(await repo.transaction(scope(), state => state.groups[0]!.decisions.map(item => item.id).sort())).toEqual(['one', 'two']);
});

it('denies stale account authority at commit and does not publish its pending group change', async () => {
  const store = storage(); const repo = await seed(store);
  let first = true;
  await expect(repo.transaction(scope(), async state => {
    approved(state); state.groups[0]!.name = 'Denied write';
    if (first) { first = false; await repo.transaction({ accountSubjects: ['iris'] }, state => { state.accounts[0]!.status = 'DISABLED'; state.accounts[0]!.version++; }); }
  })).rejects.toThrow('FORBIDDEN');
  expect(store.collisions).toBe(1);
  expect(store.rows.get(keyOf(partitionGroupKey('garden')))!.value).toHaveProperty('name', 'garden');
});

it('keeps account disable and roster removal inside the pending decision commit conditions', async () => {
  const store = storage(); const repo = await seed(store, 'garden', ['iris', 'omar']);
  const beforeRemoval = await repo.fence(scope('garden', ['iris', 'omar']), state => { approved(state, 'omar'); expect(state.groups[0]!.members).toContain('omar'); });
  await repo.transaction(scope('garden', ['iris', 'omar']), state => { state.groups[0]!.members = ['iris']; state.groups[0]!.version++; });
  expect(await store.transport.commit(beforeRemoval.mutations)).toBe(false);
  await expect(beforeRemoval.assertCurrent()).rejects.toThrow('PARTITION_STALE');
  const beforeDisable = await repo.fence(scope('garden', ['iris', 'omar']), state => approved(state));
  await repo.transaction({ accountSubjects: ['iris'] }, state => { state.accounts[0]!.status = 'DISABLED'; state.accounts[0]!.version++; });
  expect(await store.transport.commit(beforeDisable.mutations)).toBe(false);
  await expect(beforeDisable.assertCurrent()).rejects.toThrow('PARTITION_STALE');
});

it('advances the group guard on a draft edit even without a roster version change', async () => {
  const store = storage(); const repo = await seed(store);
  await repo.transaction(scope(), state => { state.groups[0]!.drafts.push(draft('draft')); });
  const pending = await repo.fence(scope(), () => {});
  await repo.transaction(scope(), state => { state.groups[0]!.drafts[0]!.frame.title = 'Updated'; state.groups[0]!.drafts[0]!.revision++; });
  expect(await store.transport.commit(pending.mutations)).toBe(false);
});

it('cannot delete a reserved draft or clear its decision binding to resurrect creation', async () => {
  const store = storage(); const repo = await seed(store);
  await repo.transaction(scope(), state => { state.groups[0]!.drafts.push({ ...draft('draft'), createdDecisionId: 'decision' }); state.groups[0]!.decisions.push({ id: 'decision', version: 1 }); });
  const commits = store.commits;
  await expect(repo.transaction(scope(), state => { state.groups[0]!.drafts = []; })).rejects.toThrow('PARTITION_INVALID');
  await expect(repo.transaction(scope(), state => { state.groups[0]!.drafts[0]!.createdDecisionId = null; })).rejects.toThrow('PARTITION_INVALID');
  await expect(repo.transaction(scope(), state => { state.groups[0]!.decisions = []; })).rejects.toThrow('PARTITION_INVALID');
  expect(store.commits).toBe(commits);
});

it('rejects undeclared account writes, corrupt keys, duplicate IDs and exhausted revisions before committing', async () => {
  const store = storage(); const repo = await seed(store); const commits = store.commits;
  await expect(repo.transaction(scope(), state => { state.accounts.push(account('foreign')); })).rejects.toThrow('PARTITION_INVALID');
  await expect(repo.transaction(scope(), state => { state.groups[0]!.decisions = [{ id: 'one', version: 1 }, { id: 'one', version: 1 }]; })).rejects.toThrow('PARTITION_INVALID');
  store.rows.get(keyOf(partitionGroupKey('garden')))!.revision = Number.MAX_SAFE_INTEGER;
  await expect(repo.transaction(scope(), state => { state.groups[0]!.name = 'Overflow'; })).rejects.toThrow('PARTITION_CAPACITY');
  expect(store.commits).toBe(commits);
  store.rows.set(keyOf(partitionAccountKey('iris')), { schemaVersion: 1, revision: 1, kind: 'ACCOUNT', value: account('foreign') });
  await expect(repo.transaction(scope(), () => {})).rejects.toThrow('PARTITION_INVALID');
});

it('does not retry validation/service failures or persist anything after callback rejection', async () => {
  const store = storage(); const repo = await seed(store); const commits = store.commits;
  await expect(repo.transaction(scope(), () => { throw new Error('Denied'); })).rejects.toThrow('Denied');
  expect(store.commits).toBe(commits);
  const unavailable = createPartitionedGroupRepository({ ...store.transport, commit: async () => { throw new Error('Synthetic unavailable'); } });
  await expect(unavailable.transaction(scope(), state => { state.groups[0]!.name = 'Changed'; })).rejects.toThrow('Synthetic unavailable');
  expect(store.rows.get(keyOf(partitionGroupKey('garden')))!.value).toHaveProperty('name', 'garden');
});

it('emits exact conditional Dynamo writes and rejects duplicate/foreign keys and mismatched revisions', () => {
  const condition: PartitionMutation = { key: partitionAccountKey('iris'), expected: 4, next: null };
  const put: PartitionMutation = { key: partitionAccountKey('omar'), expected: 0, next: { schemaVersion: 1, revision: 1, kind: 'ACCOUNT', value: account('omar') } };
  const writes = partitionDynamoWrites('KnownEnoughPartitions', [condition, put]);
  expect(writes[0]!.ConditionCheck).toMatchObject({ TableName: 'KnownEnoughPartitions', ConditionExpression: '#r=:r', ExpressionAttributeValues: { ':r': { N: '4' } } });
  expect(writes[1]!.Put).toMatchObject({ ConditionExpression: 'attribute_not_exists(PK)', Item: { PK: { S: 'ACCOUNT#omar' } } });
  expect(() => partitionDynamoWrites('KnownEnoughPartitions', [condition, condition])).toThrow('PARTITION_INVALID');
  expect(() => partitionDynamoWrites('KnownEnoughPartitions', [{ ...condition, key: { PK: 'ROOM#private', SK: 'STATE' } }])).toThrow('PARTITION_INVALID');
  expect(() => partitionDynamoWrites('KnownEnoughPartitions', [{ ...put, expected: 7 }])).toThrow('PARTITION_INVALID');
  expect(() => partitionDynamoWrites('ForeignTable', [condition])).toThrow('PARTITION_INVALID');
  expect(() => createDynamoPartitionTransport('KnownEnoughPartitions', 'us-west-2')).toThrow('PARTITION_INVALID');
});

it('uses consistent SDK reads and atomic conditional writes, with sanitized service failure and corruption handling', async () => {
  const row: PartitionRow = { schemaVersion: 1, revision: 1, kind: 'ACCOUNT', value: account('iris') };
  const mutation: PartitionMutation = { key: partitionAccountKey('iris'), expected: 0, next: row };
  const send = vi.spyOn(DynamoDBClient.prototype, 'send');
  try {
    send.mockResolvedValueOnce({ Item: { revision: { N: '1' }, payload: { S: JSON.stringify(row) } } } as never);
    const transport = createDynamoPartitionTransport('KnownEnoughPartitions', 'us-east-1');
    expect(await transport.read(mutation.key)).toEqual(row);
    expect(send.mock.calls[0]![0]).toBeInstanceOf(GetItemCommand);
    expect((send.mock.calls[0]![0] as GetItemCommand).input).toMatchObject({ ConsistentRead: true, Key: { PK: { S: 'ACCOUNT#iris' } } });
    send.mockResolvedValueOnce({} as never); expect(await transport.commit([mutation])).toBe(true);
    expect(send.mock.calls[1]![0]).toBeInstanceOf(TransactWriteItemsCommand);
    const collision = Object.assign(new Error('Private transport detail'), { name: 'TransactionCanceledException', CancellationReasons: [{ Code: 'ConditionalCheckFailed' }] });
    send.mockRejectedValueOnce(collision); expect(await transport.commit([mutation])).toBe(false);
    send.mockRejectedValueOnce(Object.assign(new Error('Private account detail'), { name: 'AccessDeniedException' }));
    await expect(transport.commit([mutation])).rejects.toThrow(/^PARTITION_STORAGE_UNAVAILABLE$/);
    send.mockResolvedValueOnce({ Item: { revision: { N: '9' }, payload: { S: JSON.stringify(row) } } } as never);
    await expect(transport.read(mutation.key)).rejects.toThrow('PARTITION_INVALID');
    send.mockRejectedValueOnce(new Error('Private transport detail'));
    await expect(transport.read(mutation.key)).rejects.toThrow(/^PARTITION_STORAGE_UNAVAILABLE$/);
  } finally { send.mockRestore(); }
});

it('rejects a missing referenced child and a too-large individual draft before writes', async () => {
  const store = storage(); const repo = await seed(store);
  const huge = draft('huge');
  huge.frame.variables = Array.from({ length: 64 }, (_, index) => ({ id: `variable-${index}`, label: 'v',
    required: false, visibility: 'PUBLIC' as const, type: 'ENUM' as const,
    options: Array.from({ length: KE.MAX_OPTIONS_PER_VARIABLE }, (_, option) => ({ id: `option-${option}`, label: '🟢'.repeat(50) })) }));
  const commits = store.commits;
  await expect(repo.transaction(scope(), state => { state.groups[0]!.drafts.push(huge); })).rejects.toThrow('PARTITION_CAPACITY');
  expect(store.commits).toBe(commits);
  await repo.transaction(scope(), state => { state.groups[0]!.drafts.push(draft('one')); });
  store.rows.delete('GROUP#garden/DRAFT#one');
  await expect(repo.transaction(scope(), () => {})).rejects.toThrow('PARTITION_INVALID');
});

it('reconstructs a coherent snapshot after a child changes during the batched read', async () => {
  const store = storage(); const repo = await seed(store);
  await repo.transaction(scope(), state => { state.groups[0]!.drafts.push(draft('one')); });
  let raced = false;
  const racing = createPartitionedGroupRepository({ ...store.transport, readMany: async keys => {
    if (!raced && keys.some(key => key.SK === 'DRAFT#one')) {
      raced = true;
      await repo.transaction(scope(), state => { state.groups[0]!.drafts[0]!.frame.title = 'Fresh title'; state.groups[0]!.drafts[0]!.revision++; });
    }
    return store.transport.readMany!(keys);
  } });
  expect(await racing.transaction(scope(), state => state.groups[0]!.drafts[0]!.frame.title)).toBe('Fresh title');
  expect(store.collisions).toBe(0);
});

it('rejects an unserializable callback result before its mutation can commit', async () => {
  const store = storage(); const repo = await seed(store); const commits = store.commits;
  await expect(repo.transaction(scope(), state => { state.groups[0]!.name = 'Should not commit'; return () => {}; })).rejects.toThrow();
  expect(store.commits).toBe(commits);
  expect(store.rows.get(keyOf(partitionGroupKey('garden')))!.value).toHaveProperty('name', 'garden');
});

it('cannot reserve a created draft with no retained matching decision binding', async () => {
  const store = storage(); const repo = await seed(store); const commits = store.commits;
  await expect(repo.transaction(scope(), state => { state.groups[0]!.drafts.push({ ...draft('one'), createdDecisionId: 'missing' }); })).rejects.toThrow('PARTITION_INVALID');
  expect(store.commits).toBe(commits);
});

it('rejects an over-wide atomic creation, then retains all children through bounded forward batches', async () => {
  const store = storage(); const repo = await seed(store); const commits = store.commits;
  const drafts = Array.from({ length: 64 }, (_, index) => draft(`draft-${index}`));
  const bindings = Array.from({ length: 64 }, (_, index) => ({ id: `decision-${index}`, version: 1 }));
  await expect(repo.transaction(scope(), state => { state.groups[0]!.drafts = drafts; state.groups[0]!.decisions = bindings; })).rejects.toThrow('PARTITION_CAPACITY');
  expect(store.commits).toBe(commits);
  await repo.transaction(scope(), state => { state.groups[0]!.drafts = drafts; });
  await repo.transaction(scope(), state => { state.groups[0]!.decisions = bindings.slice(0, 32); });
  await repo.transaction(scope(), state => { state.groups[0]!.decisions.push(...bindings.slice(32)); });
  const restored = await createPartitionedGroupRepository(store.transport).transaction(scope(), state => state.groups[0]!);
  expect(restored.drafts).toEqual(drafts); expect(restored.decisions).toEqual(bindings);
});

const dynamoItem = (subject: string) => ({ PK: { S: `ACCOUNT#${subject}` }, SK: { S: 'STATE' }, revision: { N: '1' },
  payload: { S: JSON.stringify({ schemaVersion: 1, revision: 1, kind: 'ACCOUNT', value: account(subject) }) } });
it('retrieves a128-row snapshot in100-key chunks and restores input order despite unordered responses', async () => {
  const subjects = Array.from({ length: 128 }, (_, index) => `user-${index}`);
  const send = vi.spyOn(DynamoDBClient.prototype, 'send');
  try {
    send.mockResolvedValueOnce({ Responses: { KnownEnoughPartitions: subjects.slice(0, 100).reverse().map(dynamoItem) } } as never);
    send.mockResolvedValueOnce({ Responses: { KnownEnoughPartitions: subjects.slice(100).reverse().map(dynamoItem) } } as never);
    const rows = await createDynamoPartitionTransport('KnownEnoughPartitions', 'us-east-1').readMany!(subjects.map(partitionAccountKey));
    expect(rows.map(row => (row as { value: { subject: string } }).value.subject)).toEqual(subjects);
    expect(send).toHaveBeenCalledTimes(2);
    const commands = send.mock.calls.map(call => call[0] as BatchGetItemCommand);
    expect(commands.every(command => command instanceof BatchGetItemCommand)).toBe(true);
    expect(commands.map(command => command.input.RequestItems!.KnownEnoughPartitions!.Keys!.length)).toEqual([100, 28]);
    expect(commands.every(command => command.input.RequestItems!.KnownEnoughPartitions!.ConsistentRead)).toBe(true);
  } finally { send.mockRestore(); }
});

it('resumes only unprocessed batch keys and treats an explicitly processed missing row as absent', async () => {
  const send = vi.spyOn(DynamoDBClient.prototype, 'send');
  try {
    send.mockResolvedValueOnce({ Responses: { KnownEnoughPartitions: [dynamoItem('iris')] },
      UnprocessedKeys: { KnownEnoughPartitions: { Keys: [{ PK: { S: 'ACCOUNT#omar' }, SK: { S: 'STATE' } }], ConsistentRead: false } } } as never);
    send.mockResolvedValueOnce({ Responses: { KnownEnoughPartitions: [] } } as never);
    const rows = await createDynamoPartitionTransport('KnownEnoughPartitions', 'us-east-1').readMany!(['iris', 'omar'].map(partitionAccountKey));
    expect(rows[0]).toHaveProperty('value.subject', 'iris'); expect(rows[1]).toBeNull();
    const command = send.mock.calls[1]![0] as BatchGetItemCommand;
    expect(command.input.RequestItems!.KnownEnoughPartitions).toEqual({ Keys: [{ PK: { S: 'ACCOUNT#omar' }, SK: { S: 'STATE' } }], ConsistentRead: true });
    expect(send.mock.calls[0]![1]).toEqual(send.mock.calls[1]![1]);
  } finally { send.mockRestore(); }
});

it('fails closed on foreign or duplicate batch results and contradictory unprocessed responses', async () => {
  const send = vi.spyOn(DynamoDBClient.prototype, 'send');
  try {
    const transport = createDynamoPartitionTransport('KnownEnoughPartitions', 'us-east-1');
    for (const response of [
      { Responses: { ForeignTable: [] } },
      { Responses: { KnownEnoughPartitions: [dynamoItem('foreign')] } },
      { Responses: { KnownEnoughPartitions: [dynamoItem('iris'), dynamoItem('iris')] } },
      { Responses: { KnownEnoughPartitions: [dynamoItem('iris')] }, UnprocessedKeys: { KnownEnoughPartitions: { Keys: [{ PK: { S: 'ACCOUNT#iris' }, SK: { S: 'STATE' } }] } } },
    ]) {
      send.mockResolvedValueOnce(response as never);
      await expect(transport.readMany!([partitionAccountKey('iris')])).rejects.toThrow('PARTITION_INVALID');
    }
    expect(send).toHaveBeenCalledTimes(4);
  } finally { send.mockRestore(); }
});

it('enforces one shared underlying-request budget through repeated unprocessed SDK responses', async () => {
  const send = vi.spyOn(DynamoDBClient.prototype, 'send');
  try {
    const key = { PK: `EMAIL#${account('iris').emailHash}`, SK: 'CLAIM' };
    send.mockResolvedValue({ Responses: {}, UnprocessedKeys: { KnownEnoughPartitions: {
      Keys: [{ PK: { S: key.PK }, SK: { S: key.SK } }],
    } } } as never);
    const repo = createPartitionedGroupRepository(createDynamoPartitionTransport('KnownEnoughPartitions', 'us-east-1'), { maxRequests: 3 });
    await expect(repo.lookup({ type: 'EMAIL', emailHash: account('iris').emailHash })).rejects.toThrow('PARTITION_REQUEST_LIMIT');
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls.every(call => call[0] instanceof BatchGetItemCommand)).toBe(true);
  } finally { send.mockRestore(); }
});

it('aborts a delayed callback before persistence and discards its eventual completion', async () => {
  const store = storage(); await seed(store); const commits = store.commits;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const repo = createPartitionedGroupRepository(store.transport, { timeoutMs: 10 });
  await expect(repo.transaction(scope(), async state => { state.groups[0]!.name = 'Late'; await held; })).rejects.toThrow('PARTITION_TIMEOUT');
  release(); await Promise.resolve(); await Promise.resolve();
  expect(store.commits).toBe(commits);
  expect(store.rows.get(keyOf(partitionGroupKey('garden')))!.value).toHaveProperty('name', 'garden');
});

it('shares the request budget across CAS retries and stops before an unguarded commit', async () => {
  const store = storage(); await seed(store); let commits = 0;
  const repo = createPartitionedGroupRepository({ ...store.transport, commit: async () => { commits++; return false; } }, { maxRequests: 4 });
  await expect(repo.transaction(scope(), state => { state.groups[0]!.name = 'Contended'; })).rejects.toThrow('PARTITION_REQUEST_LIMIT');
  expect(commits).toBe(1);
  expect(store.rows.get(keyOf(partitionGroupKey('garden')))!.value).toHaveProperty('name', 'garden');
});

it('limits a non-batch fallback to eight concurrent reads while retaining the group snapshot', async () => {
  const store = storage(); const repo = await seed(store);
  await repo.transaction(scope(), state => { state.groups[0]!.drafts = Array.from({ length: 32 }, (_, index) => draft(`draft-${index}`)); });
  let active = 0; let maximum = 0;
  const fallback = createPartitionedGroupRepository({ commit: store.transport.commit, read: async key => {
    active++; maximum = Math.max(maximum, active);
    await new Promise<void>(resolve => globalThis.setTimeout(resolve, 1));
    try { return await store.transport.read(key); } finally { active--; }
  } });
  expect(await fallback.transaction(scope(), state => state.groups[0]!.drafts.length)).toBe(32);
  expect(maximum).toBe(8); expect(active).toBe(0);
});

it('atomically creates, removes and rejoins discovery edges while retaining conditioned tombstones', async () => {
  const store = storage(); const repo = await seed(store);
  const edge = (who: string) => store.rows.get(keyOf(partitionMembershipKey(who, 'garden')))!;
  expect(edge('iris')).toMatchObject({ kind: 'MEMBERSHIP', revision: 1, value: { subject: 'iris', groupId: 'garden', active: true } });
  const commits: PartitionMutation[][] = []; const original = store.transport.commit;
  store.transport.commit = async changes => { commits.push(structuredClone(changes)); return original(changes); };
  await repo.transaction(scope('garden', ['iris', 'omar']), state => { state.accounts.push(account('omar')); state.groups[0]!.members.push('omar'); state.groups[0]!.version++; });
  const membership = (changes: PartitionMutation[]) => changes.filter(item => item.key.PK.startsWith('MEMBER#'));
  expect(membership(commits[0]!)).toHaveLength(1);
  expect(commits[0]!.filter(item => item.key.PK === 'ACCOUNT#omar' || item.key.PK === 'GROUP#garden')).toHaveLength(2);
  expect(edge('omar')).toMatchObject({ revision: 1, value: { active: true } });
  await repo.transaction(scope('garden', ['iris', 'omar']), state => { state.groups[0]!.members = ['iris']; state.groups[0]!.version++; });
  expect(membership(commits[1]!)[0]).toMatchObject({ expected: 1, next: { revision: 2, value: { active: false } } });
  await createPartitionedGroupRepository(store.transport).transaction(scope('garden', ['iris', 'omar']), state => { state.groups[0]!.members.push('omar'); state.groups[0]!.version++; });
  expect(membership(commits[2]!)[0]).toMatchObject({ expected: 2, next: { revision: 3, value: { active: true } } });
  expect(edge('iris').revision).toBe(1);
  await repo.transaction(scope('garden', ['iris', 'omar']), state => { state.groups[0]!.name = 'Changed'; });
  expect(membership(commits[3]!)).toEqual([]);
});

it('rolls back candidate creation when fresh account authority rejects the joined group write', async () => {
  const store = storage(); const repo = await seed(store);
  await repo.transaction({ accountSubjects: ['omar'] }, state => { state.accounts.push(account('omar')); });
  let first = true; const original = store.transport.commit;
  store.transport.commit = async changes => {
    if (first && changes.some(item => item.key.PK === 'MEMBER#omar')) {
      first = false;
      const key = keyOf(partitionAccountKey('omar')); const prior = store.rows.get(key)!;
      if (prior.kind !== 'ACCOUNT') throw new Error('invalid test fixture');
      store.rows.set(key, { ...prior, revision: prior.revision + 1, value: { ...prior.value, status: 'DISABLED', version: 2 } });
    }
    return original(changes);
  };
  await expect(repo.transaction(scope('garden', ['iris', 'omar']), state => {
    approved(state, 'omar'); state.groups[0]!.members.push('omar'); state.groups[0]!.version++;
  })).rejects.toThrow('FORBIDDEN');
  expect(store.rows.has(keyOf(partitionMembershipKey('omar', 'garden')))).toBe(false);
  expect(store.rows.get(keyOf(partitionGroupKey('garden')))!.value).toHaveProperty('members', ['iris']);
});

it('retries a contested tombstone revision before publishing a rejoin, without a partial header write', async () => {
  const store = storage(); const repo = await seed(store, 'garden', ['iris', 'omar']);
  await repo.transaction(scope('garden', ['iris', 'omar']), state => { state.groups[0]!.members = ['iris']; });
  const edgeKey = keyOf(partitionMembershipKey('omar', 'garden')); let first = true; const original = store.transport.commit;
  store.transport.commit = async changes => {
    if (first && changes.some(item => item.key.PK === 'MEMBER#omar')) {
      first = false; const prior = store.rows.get(edgeKey)!;
      if (prior.kind !== 'MEMBERSHIP') throw new Error('invalid test fixture');
      store.rows.set(edgeKey, { ...prior, revision: prior.revision + 1 });
    }
    return original(changes);
  };
  await repo.transaction(scope('garden', ['iris', 'omar']), state => { state.groups[0]!.members.push('omar'); });
  expect(store.collisions).toBe(1);
  expect(store.rows.get(edgeKey)).toMatchObject({ revision: 4, value: { active: true } });
  expect(store.rows.get(keyOf(partitionGroupKey('garden')))!.revision).toBe(3);
});

it('rejects missing, active-orphan, foreign and exhausted edges before writing any roster mutation', async () => {
  for (const change of ['missing', 'inactive', 'foreign', 'exhausted'] as const) {
    const store = storage(); const repo = await seed(store, 'garden', ['iris', 'omar']);
    const key = keyOf(partitionMembershipKey('omar', 'garden')); const row = store.rows.get(key)!;
    if (row.kind !== 'MEMBERSHIP') throw new Error('invalid test fixture');
    if (change === 'missing') store.rows.delete(key);
    if (change === 'inactive') store.rows.set(key, { ...row, value: { ...row.value, active: false } });
    if (change === 'foreign') store.rows.set(key, { ...row, value: { ...row.value, groupId: 'art' } });
    if (change === 'exhausted') store.rows.set(key, { ...row, revision: Number.MAX_SAFE_INTEGER });
    const prior = structuredClone([...store.rows]); const commits = store.commits;
    await expect(repo.transaction(scope('garden', ['iris', 'omar']), state => { state.groups[0]!.members = ['iris']; }))
      .rejects.toThrow(change === 'exhausted' ? 'PARTITION_CAPACITY' : 'PARTITION_INVALID');
    expect(store.commits).toBe(commits); expect([...store.rows]).toEqual(prior);
  }
  const store = storage(); const repo = await seed(store);
  const key = partitionMembershipKey('omar', 'garden');
  store.rows.set(keyOf(key), { schemaVersion: 1, kind: 'MEMBERSHIP', revision: 1, value: { subject: 'omar', groupId: 'garden', active: true } });
  await expect(repo.transaction(scope('garden', ['iris', 'omar']), state => { state.accounts.push(account('omar')); state.groups[0]!.members.push('omar'); })).rejects.toThrow('PARTITION_INVALID');
  expect(store.rows.has(keyOf(partitionAccountKey('omar')))).toBe(false);
});

it('enforces exact membership keys and the shared budget before an index write can be sent', async () => {
  const row: PartitionRow = { schemaVersion: 1, kind: 'MEMBERSHIP', revision: 2, value: { subject: 'iris', groupId: 'garden', active: false } };
  const key = partitionMembershipKey('iris', 'garden');
  expect(partitionDynamoWrites('KnownEnoughPartitions', [{ key, expected: 1, next: row }])[0]!.Put).toMatchObject({
    ConditionExpression: '#r=:r', ExpressionAttributeValues: { ':r': { N: '1' } }, Item: { PK: { S: key.PK }, SK: { S: key.SK } },
  });
  for (const bad of [{ PK: 'MEMBER#iris', SK: 'STATE' }, { PK: 'GROUP#garden', SK: 'GROUP#garden' }, partitionMembershipKey('other', 'garden')]) {
    expect(() => partitionDynamoWrites('KnownEnoughPartitions', [{ key: bad, expected: 1, next: row }])).toThrow('PARTITION_INVALID');
  }
  const store = storage(); const repo = await seed(store); const commits = store.commits;
  await expect(createPartitionedGroupRepository(store.transport, { maxRequests: 2 }).transaction(scope('garden', ['iris', 'omar']), state => {
    state.accounts.push(account('omar')); state.groups[0]!.members.push('omar');
  })).rejects.toThrow('PARTITION_REQUEST_LIMIT');
  expect(store.commits).toBe(commits); expect(store.rows.has(keyOf(partitionMembershipKey('omar', 'garden')))).toBe(false);
  expect(await repo.transaction(scope(), state => state.groups[0]!.members)).toEqual(['iris']);
});

it('counts membership puts against the100-item transaction limit and commits nothing on overflow', async () => {
  const store = storage(); const repo = await seed(store); const commits = store.commits;
  await expect(repo.transaction(scope('garden', ['iris', 'omar']), state => {
    state.accounts.push(account('omar')); state.groups[0]!.members.push('omar');
    // 96 children/directory writes +two accounts/header/email =100; the edge makes101.
    state.groups[0]!.drafts = Array.from({ length: 32 }, (_, index) => draft(`draft-${index}`));
    state.groups[0]!.decisions = Array.from({ length: 32 }, (_, index) => ({ id: `decision-${index}`, version: 1 }));
  })).rejects.toThrow('PARTITION_CAPACITY');
  expect(store.commits).toBe(commits); expect(store.rows.has(keyOf(partitionMembershipKey('omar', 'garden')))).toBe(false);
});


it('does not start queued storage work after an operation aborts before its microtask', async () => {
  const controller = new globalThis.AbortController(); const request = vi.fn(); const work = vi.fn(async () => true);
  const pending = partitionCall({ signal: controller.signal, request }, work);
  controller.abort(); await expect(pending).rejects.toThrow('PARTITION_TIMEOUT');
  expect(request).toHaveBeenCalledTimes(1); expect(work).not.toHaveBeenCalled();
});

it('retains a supplied request budget through lookup, transaction and subsequent fence assertions', async () => {
  const store = storage(); const repo = await seed(store); const before = store.commits;
  const shared = partitionIO({ maxRequests: 3 });
  expect(await repo.lookup({ type: 'DECISION', decisionId: 'missing' }, shared)).toBeNull();
  await expect(repo.transaction({ accountSubjects: ['iris'] }, state => state.accounts[0]!.displayName, shared))
    .rejects.toThrow('PARTITION_REQUEST_LIMIT');
  expect(store.commits).toBe(before);
  const retained = partitionIO({ maxRequests: 3 }); const fence = await repo.fence(scope(), state => approved(state), retained);
  await fence.assertCurrent(); await expect(fence.assertCurrent()).rejects.toThrow('PARTITION_REQUEST_LIMIT');
  expect(store.commits).toBe(before);
});
