import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { Groups } from '@deal-table/contracts';
import type { TrustedPrincipal } from '@deal-table/application';
import { createPartitionGroupSession, partitionMemberId } from './partition-group-session.ts';
import { preparePartitionMigration } from './partition-migration.ts';
import { partitionMembershipKey } from './partition-membership-contract.ts';
import { createPartitionedGroupRepository, partitionIO, type PartitionTransport, type PartitionMutation, type PartitionKey } from './partitioned-group-repository.ts';

const participant = (subject = 'iris'): TrustedPrincipal => ({ kind: 'participant', subject });
const code = (key: PartitionKey) => `${key.PK}/${key.SK}`;
function fixture() {
  const account = (subject: string, status: Groups.Account['status'] = 'APPROVED'): Groups.Account => ({ subject,
    emailHash: createHash('sha256').update(subject).digest('hex'), displayName: subject.toUpperCase(), status, version: 1 });
  const state: Groups.GroupState = { accounts: [account('iris'), account('omar'), account('luca'), account('pending', 'PENDING')],
    groups: [{ id: 'garden', name: 'Garden', organizer: 'iris', version: 1, members: ['iris', 'omar'], drafts: [],
      decisions: [{ id: 'decision', version: 1 }], invitations: [{ tokenHash: 'e'.repeat(64), recipientHash: 'f'.repeat(64), expiresAt: 500, acceptedBy: null }] }] };
  const plan = preparePartitionMigration(Buffer.from(JSON.stringify(state)), 1, 'a'.repeat(40));
  const rows = new Map<string, unknown>(plan.batches.flat().map(item => [code(item.key), structuredClone(item.next)]));
  const reads: PartitionKey[][] = []; const commits: PartitionMutation[][] = [];
  let beforeRead: (keys: PartitionKey[], count: number) => Promise<void> | void = () => {};
  let beforeCommit: (mutations: PartitionMutation[]) => void = () => {};
  let afterCommit: (mutations: PartitionMutation[]) => void = () => {};
  const get = (key: string) => rows.get(key) as { revision: number; value: Record<string, unknown> };
  const transport: PartitionTransport = {
    read: async key => { reads.push([key]); await beforeRead([key], reads.length); return structuredClone(rows.get(code(key)) ?? null); },
    readMany: async keys => { reads.push(structuredClone(keys)); await beforeRead(keys, reads.length); return keys.map(key => structuredClone(rows.get(code(key)) ?? null)); },
    commit: async changes => {
      commits.push(structuredClone(changes)); beforeCommit(changes);
      if (!changes.every(item => (get(code(item.key))?.revision ?? 0) === item.expected)) return false;
      for (const item of changes) if (item.next) rows.set(code(item.key), structuredClone(item.next));
      afterCommit(changes);
      return true;
    },
  };
  return { rows, reads, commits, transport, get,
    session: (options: Parameters<typeof createPartitionGroupSession>[1] = {}) => createPartitionGroupSession(transport, { now: () => 100, ...options }),
    beforeRead: (work: typeof beforeRead) => { beforeRead = work; }, beforeCommit: (work: typeof beforeCommit) => { beforeCommit = work; },
    afterCommit: (work: typeof afterCommit) => { afterCommit = work; } };
}

it('returns current selected-group allowlists and opaque member ids without private account, invitation or fence data', async () => {
  const f = fixture(); const session = f.session(); const snapshot = await session.snapshot(participant(), 'garden');
  expect(snapshot).toEqual({ id: 'garden', name: 'Garden', version: 1, isOrganizer: true,
    members: [{ id: partitionMemberId('iris'), displayName: 'IRIS', isOrganizer: true }, { id: partitionMemberId('omar'), displayName: 'OMAR', isOrganizer: false }],
    drafts: [], pendingInvitations: 1, decisions: [{ id: 'decision', current: true }] });
  expect(JSON.stringify(snapshot)).not.toMatch(/subject|emailHash|tokenHash|recipientHash|MEMBER#|ACCOUNT#|revision/);
  expect(f.reads.flat().some(key => key.PK === 'ACCOUNT#luca' || key.PK === 'ACCOUNT#pending')).toBe(false);
  expect(await session.status(participant('pending'))).toEqual({ status: 'PENDING', displayName: 'PENDING', version: 1 });
  expect(await session.status(participant('absent'))).toBeNull();
});

it('denies untrusted roles and malformed subject/group/command fields before any storage access', async () => {
  const f = fixture(); const session = f.session();
  for (const who of [null, { kind: 'display', subject: 'iris', roomId: 'decision' }, { kind: 'service', subject: 'iris', roomIds: ['decision'] }, { kind: 'participant', subject: '../iris' }] as (TrustedPrincipal | null)[]) {
    await expect(session.snapshot(who, 'garden')).rejects.toThrow('FORBIDDEN');
  }
  await expect(session.snapshot(participant(), '../garden')).rejects.toThrow('INVALID_COMMAND');
  await expect(session.remove(participant(), 'garden', { memberId: partitionMemberId('omar'), version: 1, subject: 'iris' })).rejects.toThrow('INVALID_COMMAND');
  expect(f.reads).toEqual([]); expect(f.commits).toEqual([]);
});

it('denies pending, disabled and removed actors before hydrating other members, even with an active candidate', async () => {
  for (const who of ['pending', 'disabled', 'luca']) {
    const f = fixture(); if (who === 'disabled') f.rows.set('ACCOUNT#disabled/STATE', { schemaVersion: 1, revision: 1, kind: 'ACCOUNT',
      value: { subject: 'disabled', emailHash: 'd'.repeat(64), displayName: 'Disabled', status: 'DISABLED', version: 1 } });
    f.rows.set(code(partitionMembershipKey(who, 'garden')), { schemaVersion: 1, kind: 'MEMBERSHIP', revision: 1, value: { subject: who, groupId: 'garden', active: true } });
    await expect(f.session().snapshot(participant(who), 'garden')).rejects.toThrow(who === 'luca' ? 'NOT_FOUND' : 'FORBIDDEN');
    expect(f.reads).toHaveLength(1); expect(f.commits).toEqual([]);
  }
});

it('limits private roster construction and versioned removal to the fresh organizer and retains atomic tombstones', async () => {
  const f = fixture(); const session = f.session();
  await expect(session.roster(participant('omar'), 'garden')).rejects.toThrow('FORBIDDEN');
  await expect(session.remove(participant('omar'), 'garden', { memberId: partitionMemberId('iris'), version: 1 })).rejects.toThrow('FORBIDDEN');
  await expect(session.remove(participant(), 'garden', { memberId: partitionMemberId('iris'), version: 1 })).rejects.toThrow('INVALID_COMMAND');
  await expect(session.remove(participant(), 'garden', { memberId: partitionMemberId('omar'), version: 2 })).rejects.toThrow('STALE_CONTEXT');
  const roster = await session.roster(participant(), 'garden'); expect(roster.members.map(member => member.subject)).toEqual(['iris', 'omar']);
  const snapshot = await session.remove(participant(), 'garden', { memberId: partitionMemberId('omar'), version: 1 });
  expect(snapshot.version).toBe(2); expect(snapshot.members).toHaveLength(1);
  expect(f.get('MEMBER#omar/GROUP#garden')).toMatchObject({ revision: 2, value: { active: false } });
  expect(f.commits.at(-1)!.some(item => item.key.PK === 'GROUP#garden' && item.next)).toBe(true);
  expect(f.commits.at(-1)!.some(item => item.key.PK === 'MEMBER#omar' && item.next)).toBe(true);
  await expect(session.snapshot(participant('omar'), 'garden')).rejects.toThrow('NOT_FOUND');
  await expect(session.decisionFence(participant(), 'decision')).rejects.toThrow('STALE_CONTEXT');
});

it('re-resolves a concurrently expanded roster before hydration without widening to unrelated accounts', async () => {
  const f = fixture(); f.beforeRead((_keys, count) => {
    if (count !== 2) return;
    const header = f.get('GROUP#garden/STATE'); header.value.members = ['iris', 'omar', 'luca']; header.value.version = 2; header.revision++;
  });
  const snapshot = await f.session().snapshot(participant(), 'garden'); expect(snapshot.members).toHaveLength(3);
  expect(f.reads.flat().some(key => key.PK === 'ACCOUNT#luca')).toBe(true);
  expect(f.reads.flat().some(key => key.PK === 'ACCOUNT#pending')).toBe(false);
  expect(f.commits).toHaveLength(1);
});

it('rejects removal or disable that occurs after preliminary scope resolution and before atomic publication', async () => {
  const removed = fixture(); removed.beforeRead((_keys, count) => {
    if (count === 2) { const header = removed.get('GROUP#garden/STATE'); header.value.members = ['iris']; header.revision++; }
  });
  await expect(removed.session().snapshot(participant('omar'), 'garden')).rejects.toThrow('NOT_FOUND'); expect(removed.commits).toEqual([]);
  const disabled = fixture(); let first = true; disabled.beforeCommit(() => {
    if (first) { first = false; const account = disabled.get('ACCOUNT#iris/STATE'); account.value.status = 'DISABLED'; account.revision++; }
  });
  await expect(disabled.session().snapshot(participant(), 'garden')).rejects.toThrow('FORBIDDEN'); expect(disabled.commits).toHaveLength(1);
});

it('binds private decision conditions to immutable lookup, fresh membership and exact group version', async () => {
  const f = fixture(); const session = f.session(); const fence = await session.decisionFence(participant('omar'), 'decision');
  expect(fence.mutations.map(item => item.key.PK).sort()).toEqual(['ACCOUNT#iris', 'ACCOUNT#omar', 'GROUP#garden']);
  await fence.assertCurrent(); const repo = createPartitionedGroupRepository(f.transport);
  await repo.transaction({ groupId: 'garden', accountSubjects: ['iris', 'omar'] }, state => { state.groups[0]!.name = 'Changed'; });
  expect(await f.transport.commit(fence.mutations)).toBe(false); await expect(fence.assertCurrent()).rejects.toThrow('STALE_CONTEXT');
  await expect(session.decisionFence(participant(), 'absent')).rejects.toThrow('NOT_FOUND');
  const stale = fixture(); stale.get('GROUP#garden/STATE').value.version = 2;
  await expect(stale.session().decisionFence(participant(), 'decision')).rejects.toThrow('STALE_CONTEXT');
});

it('does not authorize retained directories or archive markers as active bindings or groups', async () => {
  const f = fixture(); f.get('GROUP#garden/STATE').value.decisionIds = [];
  await expect(f.session().decisionFence(participant(), 'decision')).rejects.toThrow('NOT_FOUND');
  f.rows.set('GROUP#garden/STATE', { schemaVersion: 1, revision: 2, kind: 'ARCHIVED_GROUP', groupId: 'garden', organizer: 'iris', groupVersion: 1,
    sourceSha: 'a'.repeat(40), sourceHash: 'b'.repeat(64), manifestHash: 'c'.repeat(64), manifestVersion: 'immutable-v1', archivedAt: '2026-10-07T15:00:00.000Z' });
  await expect(f.session().snapshot(participant(), 'garden')).rejects.toThrow('NOT_FOUND');
});

it('shares request/deadline limits across scope, hydration, callback, commit and later fence verification', async () => {
  const f = fixture(); await expect(f.session({ maxRequests: 3 }).snapshot(participant(), 'garden')).rejects.toThrow('SESSION_REQUEST_LIMIT');
  expect(f.commits).toEqual([]);
  const limited = fixture(); const fence = await limited.session({ maxRequests: 5 }).decisionFence(participant(), 'decision');
  await expect(fence.assertCurrent()).rejects.toThrow('SESSION_REQUEST_LIMIT');
  const timed = fixture(); let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  timed.beforeRead(() => held);
  await expect(timed.session({ timeoutMs: 20 }).snapshot(participant(), 'garden')).rejects.toThrow('SESSION_TIMEOUT');
  release(); await new Promise<void>(resolve => globalThis.setTimeout(resolve, 1)); expect(timed.reads).toHaveLength(1); expect(timed.commits).toEqual([]);
});

it('rejects malformed/foreign authority rows and unsafe clocks while keeping storage details private', async () => {
  for (const change of ['foreign', 'duplicate', 'missing'] as const) {
    const f = fixture(); const row = f.get('GROUP#garden/STATE');
    if (change === 'foreign') row.value.id = 'other';
    if (change === 'duplicate') row.value.members = ['iris', 'iris'];
    if (change === 'missing') f.rows.delete('ACCOUNT#omar/STATE');
    await expect(f.session().snapshot(participant(), 'garden')).rejects.toThrow('SESSION_INVALID'); expect(f.commits).toEqual([]);
  }
  const clock = fixture(); await expect(clock.session({ now: () => NaN }).snapshot(participant(), 'garden')).rejects.toThrow('SESSION_INVALID');
  const f = fixture(); const privateCause = new Error('synthetic confidential diagnostic'); f.beforeRead(() => { throw privateCause; });
  try { await f.session().snapshot(participant(), 'garden'); throw new Error('missing rejection'); }
  catch (error) { expect(error).toMatchObject({ message: 'SESSION_STORAGE_UNAVAILABLE', cause: privateCause }); }
});


it('keeps a supplied operation budget for private roster and decision-fence discovery', async () => {
  for (const method of ['roster', 'decisionFence'] as const) {
    const f = fixture(); const budget = partitionIO({ maxRequests: 3 });
    await expect(f.session()[method](participant(), method === 'roster' ? 'garden' : 'decision', budget)).rejects.toThrow('SESSION_REQUEST_LIMIT');
    expect(budget.signal.aborted).toBe(true); expect(f.commits).toEqual([]);
  }
});

it('creates only the verified organizer partition with atomic account guards and a derived membership edge', async () => {
  const f = fixture(); const snapshot = await f.session().create(participant(), { name: '  Shared garden  ', idempotencyKey: 'new-group' });
  expect(snapshot).toMatchObject({ name: 'Shared garden', version: 1, isOrganizer: true, pendingInvitations: 0, drafts: [], decisions: [] });
  expect(snapshot.members).toEqual([{ id: partitionMemberId('iris'), displayName: 'IRIS', isOrganizer: true }]);
  expect(JSON.stringify(snapshot)).not.toMatch(/subject|emailHash|tokenHash|recipientHash|ACCOUNT#|MEMBER#|revision/);
  expect(f.reads.flat().every(key => ['ACCOUNT#iris', `GROUP#${snapshot.id}`, 'MEMBER#iris'].includes(key.PK))).toBe(true);
  expect(f.commits).toHaveLength(1);
  expect(f.commits[0]).toEqual(expect.arrayContaining([
    expect.objectContaining({ key: { PK: 'ACCOUNT#iris', SK: 'STATE' }, expected: 1, next: null }),
    expect.objectContaining({ key: { PK: `GROUP#${snapshot.id}`, SK: 'STATE' }, expected: 0 }),
    expect.objectContaining({ key: partitionMembershipKey('iris', snapshot.id), expected: 0 })]));
  expect(f.get(code(partitionMembershipKey('iris', snapshot.id)))).toMatchObject({ revision: 1, value: { active: true } });
});

it('binds idempotent creation to the subject and normalized name without overwriting an existing roster', async () => {
  const f = fixture(); const session = f.session(); const raw = { name: 'Garden two', idempotencyKey: 'shared-key' };
  const first = await session.create(participant(), raw);
  const repo = createPartitionedGroupRepository(f.transport);
  await repo.transaction({ groupId: first.id, accountSubjects: ['iris', 'luca'] }, state => { state.groups[0]!.members.push('luca'); state.groups[0]!.version++; });
  const replay = await session.create(participant(), { ...raw, name: ' Garden two ' });
  expect(replay.id).toBe(first.id); expect(replay.version).toBe(2); expect(replay.members).toHaveLength(2);
  expect(f.commits.at(-1)!.every(item => item.next === null)).toBe(true);
  await expect(session.create(participant(), { ...raw, name: 'Other name' })).rejects.toThrow('STALE_CONTEXT');
  const other = await session.create(participant('omar'), raw); expect(other.id).not.toBe(first.id);
  expect(other.members.map(member => member.id)).toEqual([partitionMemberId('omar')]);
});

it('rejects caller-selected identity, malformed creation fields and untrusted roles before storage', async () => {
  const f = fixture(); const session = f.session();
  for (const raw of [{ name: '', idempotencyKey: 'key' }, { name: ' '.repeat(10), idempotencyKey: 'key' },
    { name: 'x'.repeat(81), idempotencyKey: 'key' }, { name: 'Line\nBreak', idempotencyKey: 'key' },
    { name: 'Delete\u007f', idempotencyKey: 'key' }, { name: 'Garden', idempotencyKey: '../key' },
    { name: 'Garden', idempotencyKey: 'key', subject: 'omar' }, { name: 'Garden', idempotencyKey: 'key', members: ['omar'] }]) {
    await expect(session.create(participant(), raw)).rejects.toThrow('INVALID_COMMAND');
  }
  for (const principal of [null, { kind: 'display', subject: 'iris', roomId: 'decision' },
    { kind: 'participant', subject: '../iris' }] as (TrustedPrincipal | null)[]) {
    await expect(session.create(principal, { name: 'Garden', idempotencyKey: 'key' })).rejects.toThrow('FORBIDDEN');
  }
  expect(f.reads).toEqual([]); expect(f.commits).toEqual([]);
});

it('denies pending, disabled, absent and concurrently revoked organizers without creating group or membership rows', async () => {
  for (const who of ['pending', 'absent', 'iris']) {
    const f = fixture(); if (who === 'iris') f.get('ACCOUNT#iris/STATE').value.status = 'DISABLED';
    await expect(f.session().create(participant(who), { name: 'Garden', idempotencyKey: 'key' })).rejects.toThrow('FORBIDDEN');
    expect(f.commits).toEqual([]);
  }
  const f = fixture(); let once = true; f.beforeCommit(() => {
    if (once) { once = false; const account = f.get('ACCOUNT#iris/STATE'); account.value.status = 'DISABLED'; account.revision++; }
  });
  await expect(f.session().create(participant(), { name: 'Garden', idempotencyKey: 'key' })).rejects.toThrow('FORBIDDEN');
  expect(f.commits).toHaveLength(1);
  expect([...f.rows.keys()].filter(key => key.startsWith('GROUP#')).sort()).toEqual(['GROUP#garden/BINDING#decision', 'GROUP#garden/STATE']);
  expect([...f.rows.keys()].filter(key => key.startsWith('MEMBER#'))).toHaveLength(2);
});

it('never revives an archived idempotent group or trusts an unrelated organizer at its retained id', async () => {
  for (const archived of [true, false]) {
    const f = fixture(); const session = f.session(); const raw = { name: 'Garden', idempotencyKey: 'key' };
    const created = await session.create(participant(), raw); const key = `GROUP#${created.id}/STATE`;
    if (archived) f.rows.set(key, { schemaVersion: 1, revision: 2, kind: 'ARCHIVED_GROUP', groupId: created.id, organizer: 'iris', groupVersion: 1,
      sourceSha: 'a'.repeat(40), sourceHash: 'b'.repeat(64), manifestHash: 'c'.repeat(64), manifestVersion: 'immutable-v1', archivedAt: '2026-10-07T15:00:00.000Z' });
    else f.get(key).value.organizer = 'omar';
    const count = f.commits.length; await expect(session.create(participant(), raw)).rejects.toThrow(archived ? 'NOT_FOUND' : 'SESSION_INVALID');
    expect(f.commits).toHaveLength(count);
  }
});

it('converges simultaneous identical creation without a second header or membership mutation', async () => {
  const f = fixture(); const raw = { name: 'Garden', idempotencyKey: 'key' };
  const results = await Promise.all([f.session().create(participant(), raw), f.session().create(participant(), raw)]);
  expect(results[0]).toEqual(results[1]); const key = results[0]!.id;
  expect(f.get(`GROUP#${key}/STATE`).revision).toBe(1); expect(f.get(code(partitionMembershipKey('iris', key))).revision).toBe(1);
});

it('re-resolves a concurrently created and expanded group before publishing its idempotent result', async () => {
  const f = fixture(); const raw = { name: 'Garden', idempotencyKey: 'key' }; let once = true;
  f.beforeRead(async (_keys, count) => {
    if (!once || count !== 2) return; once = false;
    const created = await f.session().create(participant(), raw);
    await createPartitionedGroupRepository(f.transport).transaction({ groupId: created.id, accountSubjects: ['iris', 'luca'] }, state => {
      state.groups[0]!.members.push('luca'); state.groups[0]!.version++;
    });
  });
  const result = await f.session().create(participant(), raw); expect(result.version).toBe(2); expect(result.members).toHaveLength(2);
  expect(f.reads.flat().some(key => key.PK === 'ACCOUNT#luca')).toBe(true);
  expect(f.reads.flat().some(key => key.PK === 'ACCOUNT#omar')).toBe(false);
  expect(f.commits.at(-1)!.every(item => item.next === null)).toBe(true);
});

it('rejects an archive that replaces the header at the actual replay publication boundary', async () => {
  const f = fixture(); const raw = { name: 'Garden', idempotencyKey: 'key' }; const created = await f.session().create(participant(), raw);
  const marker = { schemaVersion: 1, revision: 2, kind: 'ARCHIVED_GROUP', groupId: created.id, organizer: 'iris', groupVersion: 1,
    sourceSha: 'a'.repeat(40), sourceHash: 'b'.repeat(64), manifestHash: 'c'.repeat(64), manifestVersion: 'immutable-v1', archivedAt: '2026-10-07T15:00:00.000Z' };
  let once = true; f.beforeCommit(() => { if (once) { once = false; f.rows.set(`GROUP#${created.id}/STATE`, marker); } });
  const before = f.commits.length;
  await expect(f.session().create(participant(), raw)).rejects.toThrow('SESSION_INVALID'); expect(f.commits).toHaveLength(before + 1);
  expect(f.get(`GROUP#${created.id}/STATE`)).toEqual(marker);
});

it('does not repeat an unknown committed creation and permits explicit deterministic replay', async () => {
  const f = fixture(); let once = true; f.afterCommit(() => { if (once) { once = false; throw new Error('PRIVATE_COMMIT_DIAGNOSTIC'); } });
  const raw = { name: 'Garden', idempotencyKey: 'key' };
  await expect(f.session().create(participant(), raw)).rejects.toThrow('SESSION_STORAGE_UNAVAILABLE');
  expect(f.commits).toHaveLength(1);
  const snapshot = await f.session().create(participant(), raw); expect(f.commits).toHaveLength(2);
  expect(f.commits[1]!.every(item => item.next === null)).toBe(true);
  expect(f.get(`GROUP#${snapshot.id}/STATE`).revision).toBe(1);
});

it('keeps creation and replay within one request/deadline budget with no late mutation after timeout', async () => {
  const f = fixture(); await expect(f.session({ maxRequests: 4 }).create(participant(), { name: 'Garden', idempotencyKey: 'key' })).rejects.toThrow('SESSION_REQUEST_LIMIT');
  expect(f.commits).toEqual([]);
  const timed = fixture(); let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; }); timed.beforeRead(() => held);
  await expect(timed.session({ timeoutMs: 20 }).create(participant(), { name: 'Garden', idempotencyKey: 'key' })).rejects.toThrow('SESSION_TIMEOUT');
  release(); await new Promise<void>(resolve => setTimeout(resolve, 1)); expect(timed.reads).toHaveLength(1); expect(timed.commits).toEqual([]);
});
