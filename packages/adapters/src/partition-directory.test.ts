import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createPartitionedGroupRepository, partitionAccountKey, partitionGroupKey,
  type PartitionKey, type PartitionRow, type PartitionTransport } from './partitioned-group-repository.ts';
import { partitionDirectoryKey } from './partition-directory.ts';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const encoded = (key: PartitionKey) => `${key.PK}/${key.SK}`;
function fixture() {
  const rows = new Map<string, PartitionRow>(); let commits = 0;
  const transport: PartitionTransport = {
    read: async key => structuredClone(rows.get(encoded(key)) ?? null),
    readMany: async keys => keys.map(key => structuredClone(rows.get(encoded(key)) ?? null)),
    commit: async mutations => {
      if (mutations.some(item => (rows.get(encoded(item.key))?.revision ?? 0) !== item.expected)) return false;
      commits++;
      mutations.forEach(item => { if (item.next) rows.set(encoded(item.key), structuredClone(item.next)); });
      return true;
    },
  };
  const repo = createPartitionedGroupRepository(transport);
  const register = (subject: string, emailHash = hash(subject)) => repo.transaction({ accountSubjects: [subject] }, state => {
    if (!state.accounts.length) state.accounts.push({ subject, emailHash, displayName: subject, status: 'APPROVED', version: 1 });
    return state.accounts[0]!;
  });
  const scope = (groupId: string) => ({ groupId, accountSubjects: ['iris'] });
  const group = (groupId: string) => repo.transaction(scope(groupId), state => {
    state.groups.push({ id: groupId, name: groupId, organizer: 'iris', members: ['iris'], version: 1, invitations: [], drafts: [], decisions: [] });
  });
  return { rows, transport, repo, register, group, scope, get commits() { return commits; } };
}
const invitation = { tokenHash: hash('token'), recipientHash: hash('recipient'), expiresAt: 2_000_000_000_000, acceptedBy: null };

it('atomically admits one owner for a shared email hash, preserving the losing account as absent', async () => {
  const f = fixture(); const emailHash = hash('shared-email');
  const results = await Promise.allSettled(['iris', 'omar'].map(subject => f.register(subject, emailHash)));
  expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1);
  const failure = results.find(item => item.status === 'rejected') as PromiseRejectedResult;
  expect(failure.reason.message).toBe('PARTITION_IDENTITY_CONFLICT');
  expect(f.rows.size).toBe(2);
  const owner = await createPartitionedGroupRepository(f.transport).lookup({ type: 'EMAIL', emailHash });
  expect(owner).toMatchObject({ type: 'EMAIL', subject: 'iris' });
  expect(f.rows.has(encoded(partitionAccountKey('omar')))).toBe(false);
});

it('keeps disabled accounts and immutable email ownership from being replaced or reused', async () => {
  const f = fixture(); await f.register('iris');
  await f.repo.transaction({ accountSubjects: ['iris'] }, state => { state.accounts[0]!.status = 'DISABLED'; state.accounts[0]!.version++; });
  await expect(f.register('omar', hash('iris'))).rejects.toThrow('PARTITION_IDENTITY_CONFLICT');
  const commits = f.commits;
  await expect(f.repo.transaction({ accountSubjects: ['iris'] }, state => { state.accounts[0]!.emailHash = hash('changed'); })).rejects.toThrow('PARTITION_IDENTITY_CONFLICT');
  expect(f.commits).toBe(commits);
  expect(await f.repo.lookup({ type: 'EMAIL', emailHash: hash('iris') })).toHaveProperty('subject', 'iris');
});

it('claims a token for exactly one group and retains its recipient/lifetime facts', async () => {
  const f = fixture(); await f.register('iris'); await f.group('garden'); await f.group('art');
  const results = await Promise.allSettled(['garden', 'art'].map(groupId => f.repo.transaction(f.scope(groupId), state => { state.groups[0]!.invitations.push(invitation); })));
  expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1);
  expect((results.find(item => item.status === 'rejected') as PromiseRejectedResult).reason.message).toBe('PARTITION_IDENTITY_CONFLICT');
  const claim = await f.repo.lookup({ type: 'INVITATION', tokenHash: invitation.tokenHash });
  expect(claim).toMatchObject({ groupId: 'garden', recipientHash: invitation.recipientHash, expiresAt: invitation.expiresAt });
  const losing = f.rows.get(encoded(partitionGroupKey('art')))!;
  expect(losing.value).toHaveProperty('invitations', []);
  for (const field of ['recipientHash', 'expiresAt'] as const) {
    await expect(f.repo.transaction(f.scope('garden'), state => {
      const current = state.groups[0]!.invitations[0]!;
      if (field === 'recipientHash') current.recipientHash = hash('other'); else current.expiresAt++;
    })).rejects.toThrow('PARTITION_IDENTITY_CONFLICT');
  }
});

it('never resurrects a removed token or clears its prior acceptance during a retry', async () => {
  const f = fixture(); await f.register('iris'); await f.group('garden');
  await f.repo.transaction(f.scope('garden'), state => { state.groups[0]!.invitations.push(invitation); });
  await f.repo.transaction(f.scope('garden'), state => { state.groups[0]!.invitations[0]!.acceptedBy = 'iris'; });
  await expect(f.repo.transaction(f.scope('garden'), state => { state.groups[0]!.invitations[0]!.acceptedBy = null; })).rejects.toThrow('PARTITION_IDENTITY_CONFLICT');
  await f.repo.transaction(f.scope('garden'), state => { state.groups[0]!.invitations = []; });
  await expect(f.repo.transaction(f.scope('garden'), state => { state.groups[0]!.invitations.push(invitation); })).rejects.toThrow('PARTITION_IDENTITY_CONFLICT');
  expect(await f.repo.lookup({ type: 'INVITATION', tokenHash: invitation.tokenHash })).toHaveProperty('groupId', 'garden');
});

it('claims a decision binding for one group without partially adding it to a competing group', async () => {
  const f = fixture(); await f.register('iris'); await f.group('garden'); await f.group('art');
  const results = await Promise.allSettled(['garden', 'art'].map(groupId => f.repo.transaction(f.scope(groupId), state => { state.groups[0]!.decisions.push({ id: 'decision', version: 1 }); })));
  expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1);
  expect((results.find(item => item.status === 'rejected') as PromiseRejectedResult).reason.message).toBe('PARTITION_IDENTITY_CONFLICT');
  expect(await f.repo.lookup({ type: 'DECISION', decisionId: 'decision' })).toEqual({ type: 'DECISION', decisionId: 'decision', groupId: 'garden' });
  expect(f.rows.has('GROUP#art/BINDING#decision')).toBe(false);
});

it('reconstructs the same owner after a lost atomic acknowledgement without duplicating registration', async () => {
  const f = fixture(); let lose = true;
  const repo = createPartitionedGroupRepository({ ...f.transport, commit: async mutations => {
    const result = await f.transport.commit(mutations);
    if (lose) { lose = false; throw new Error('Synthetic lost acknowledgement'); }
    return result;
  } });
  const create = () => repo.transaction({ accountSubjects: ['iris'] }, state => {
    if (!state.accounts.length) state.accounts.push({ subject: 'iris', emailHash: hash('iris'), displayName: 'Iris', status: 'PENDING', version: 1 });
    return state.accounts[0];
  });
  await expect(create()).rejects.toThrow('Synthetic lost acknowledgement');
  expect(await create()).toHaveProperty('subject', 'iris'); expect(f.rows.size).toBe(2);
  expect(await createPartitionedGroupRepository(f.transport).lookup({ type: 'EMAIL', emailHash: hash('iris') })).toHaveProperty('subject', 'iris');
});

it('rejects private fields in a stored directory record with no private diagnostics', async () => {
  const f = fixture(); await f.register('iris');
  const key = partitionDirectoryKey({ type: 'EMAIL', emailHash: hash('iris') });
  const row = f.rows.get(encoded(key))!;
  f.rows.set(encoded(key), { ...row, value: { ...row.value, privateNotes: 'PRIVATE_CANARY' } } as never);
  await expect(f.repo.lookup({ type: 'EMAIL', emailHash: hash('iris') })).rejects.toThrow(/^PARTITION_INVALID$/);
});

it('rejects ambiguous duplicate invitation tokens in persisted group state before any callback or commit', async () => {
  const f = fixture(); await f.register('iris'); await f.group('garden');
  const key = encoded(partitionGroupKey('garden')); const row = f.rows.get(key)!;
  if (row.kind !== 'GROUP') throw new Error('Expected group fixture');
  row.value.invitations = [invitation, { ...invitation, recipientHash: hash('other') }];
  const commits = f.commits; let invoked = false;
  await expect(f.repo.transaction(f.scope('garden'), () => { invoked = true; })).rejects.toThrow('PARTITION_INVALID');
  expect(invoked).toBe(false); expect(f.commits).toBe(commits);
});
