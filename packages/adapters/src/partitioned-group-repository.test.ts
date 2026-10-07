import { expect, it, vi } from 'vitest';
import { DynamoDBClient, GetItemCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { Groups, KnownEnough as KE } from '@deal-table/contracts';
import { MemoryGroupRepository } from './group-repository.ts';
import {
  createPartitionedGroupRepository, createDynamoPartitionTransport, partitionAccountKey, partitionGroupKey, partitionDynamoWrites,
  type PartitionKey, type PartitionMutation, type PartitionRow, type PartitionTransport,
} from './partitioned-group-repository.ts';

const keyOf = (key: PartitionKey) => `${key.PK}/${key.SK}`;
function storage() {
  const rows = new Map<string, PartitionRow>(); let collisions = 0; let commits = 0;
  const transport: PartitionTransport = {
    read: async key => structuredClone(rows.get(keyOf(key)) ?? null),
    commit: async mutations => {
      commits++;
      if (mutations.some(item => (rows.get(keyOf(item.key))?.revision ?? 0) !== item.expected)) { collisions++; return false; }
      for (const mutation of mutations) if (mutation.next) rows.set(keyOf(mutation.key), structuredClone(mutation.next));
      return true;
    },
  };
  return { rows, transport, get collisions() { return collisions; }, get commits() { return commits; } };
}
const account = (subject: string): Groups.Account => ({ subject, emailHash: 'a'.repeat(64), displayName: subject, status: 'APPROVED', version: 1 });
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
  expect(store.rows.size).toBe(34);
  expect(Math.max(...[...store.rows.values()].map(row => Buffer.byteLength(JSON.stringify(row))))).toBeLessThan(352 * 1024);
  expect(await createPartitionedGroupRepository(store.transport).transaction(scope(), state => state.groups[0]!.drafts)).toEqual(drafts);
});

it('commits concurrent unrelated groups without a shared account write or retry', async () => {
  const store = storage(); const repo = await seed(store); await seed(store, 'art');
  let arrived = 0; let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
  await Promise.all(['garden', 'art'].map(groupId => repo.transaction(scope(groupId), async state => {
    approved(state); state.groups[0]!.name += '-changed';
    if (++arrived === 2) release(); await barrier;
  })));
  expect(store.collisions).toBe(0); expect(store.rows.get(keyOf(partitionAccountKey('iris')))!.revision).toBe(1);
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

it('reconstructs a coherent snapshot after a child changes during the sequential read', async () => {
  const store = storage(); const repo = await seed(store);
  await repo.transaction(scope(), state => { state.groups[0]!.drafts.push(draft('one')); });
  let raced = false;
  const racing = createPartitionedGroupRepository({ ...store.transport, read: async key => {
    if (!raced && key.SK === 'DRAFT#one') {
      raced = true;
      await repo.transaction(scope(), state => { state.groups[0]!.drafts[0]!.frame.title = 'Fresh title'; state.groups[0]!.drafts[0]!.revision++; });
    }
    return store.transport.read(key);
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
  await repo.transaction(scope(), state => { state.groups[0]!.decisions = bindings; });
  const restored = await createPartitionedGroupRepository(store.transport).transaction(scope(), state => state.groups[0]!);
  expect(restored.drafts).toEqual(drafts); expect(restored.decisions).toEqual(bindings);
});
