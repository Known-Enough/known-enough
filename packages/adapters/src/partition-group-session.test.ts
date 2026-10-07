import { createHash, createHmac } from 'node:crypto';
import { expect, it } from 'vitest';
import { Groups } from '@deal-table/contracts';
import { PartitionMembershipError } from './partition-membership.ts';
import type { TrustedPrincipal } from '@deal-table/application';
import { createPartitionGroupSession, partitionMemberId } from './partition-group-session.ts';
import { preparePartitionMigration } from './partition-migration.ts';
import { partitionMembershipKey } from './partition-membership-contract.ts';
import { createPartitionedGroupRepository, partitionIO, type PartitionTransport, type PartitionMutation, type PartitionKey } from './partitioned-group-repository.ts';

const participant = (subject = 'iris'): TrustedPrincipal => ({ kind: 'participant', subject });
const code = (key: PartitionKey) => `${key.PK}/${key.SK}`;
const syntheticKey = 'q'.repeat(64);
function fixture(emailKey?: string) {
  const account = (subject: string, status: Groups.Account['status'] = 'APPROVED'): Groups.Account => ({ subject,
    emailHash: emailKey ? createHmac('sha256', emailKey).update(`${subject}@example.invalid`).digest('hex')
      : createHash('sha256').update(subject).digest('hex'), displayName: subject.toUpperCase(), status, version: 1 });
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
    session: (options: Parameters<typeof createPartitionGroupSession>[1] = {}) => createPartitionGroupSession(transport, { now: () => 100, ...(emailKey ? { emailKey } : {}), ...options }),
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

const verifiedProfile = (subject: string, email = `${subject}@example.invalid`) => ({ subject, email, verified: true });
it('registers a pending account and immutable email claim atomically and preserves existing admission on replay', async () => {
  const f = fixture(syntheticKey); const session = f.session();
  const result = await session.register(participant('new'), verifiedProfile('new', ' NEW@example.invalid '), { displayName: ' New owner ' });
  expect(result).toEqual({ status: 'PENDING', displayName: 'New owner', version: 1 });
  expect(f.commits[0]!.filter(item => item.next?.kind === 'ACCOUNT')).toHaveLength(1);
  expect(f.commits[0]!.filter(item => item.next?.kind === 'DIRECTORY')).toHaveLength(1);
  expect(f.reads.flat().every(key => key.PK === 'ACCOUNT#new' || key.PK.startsWith('EMAIL#'))).toBe(true);
  expect(JSON.stringify(result)).not.toMatch(/subject|email|hash|revision/);
  expect(await session.register(participant('new'), verifiedProfile('new'), { displayName: 'Different' })).toEqual(result);
  expect(f.commits.at(-1)!.every(item => item.next === null)).toBe(true);
  f.get('ACCOUNT#new/STATE').value.status = 'DISABLED'; f.get('ACCOUNT#new/STATE').revision++;
  expect((await session.register(participant('new'), verifiedProfile('new'), { displayName: 'Other' })).status).toBe('DISABLED');
  expect(f.get('ACCOUNT#new/STATE').value.displayName).toBe('New owner');
  await expect(session.register(participant('new'), verifiedProfile('new', 'other@example.invalid'), { displayName: 'Other' })).rejects.toThrow('FORBIDDEN');
});

it('keeps verified registration subject and email ownership strict under concurrent different-subject claims', async () => {
  const f = fixture(syntheticKey); const results = await Promise.allSettled(['new1', 'new2'].map(subject =>
    f.session().register(participant(subject), verifiedProfile(subject, 'same@example.invalid'), { displayName: 'New' })));
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { message: 'FORBIDDEN' } });
  expect([...f.rows.keys()].filter(key => key.startsWith('ACCOUNT#new'))).toHaveLength(1);
  const bad = fixture(syntheticKey);
  for (const profile of [verifiedProfile('other'), { ...verifiedProfile('new'), verified: false }, { ...verifiedProfile('new'), email: 'invalid' },
    { ...verifiedProfile('new'), status: 'APPROVED' }]) {
    await expect(bad.session().register(participant('new'), profile, { displayName: 'New' })).rejects.toThrow('FORBIDDEN');
  }
  await expect(bad.session().register(participant('new'), verifiedProfile('new'), { displayName: 'New', subject: 'other' })).rejects.toThrow('INVALID_COMMAND');
  expect(bad.reads).toEqual([]);
});

it('fails closed on missing HMAC configuration, corrupt retained ownership, request exhaustion and unknown registration commits', async () => {
  const absent = fixture(); await expect(absent.session().register(participant('new'), verifiedProfile('new'), { displayName: 'New' })).rejects.toThrow('SESSION_INVALID'); expect(absent.reads).toEqual([]);
  expect(() => absent.session({ emailKey: 'short' })).toThrow('SESSION_INVALID');
  const limited = fixture(syntheticKey); await expect(limited.session({ maxRequests: 3 }).register(participant('new'), verifiedProfile('new'), { displayName: 'New' })).rejects.toThrow('SESSION_REQUEST_LIMIT'); expect(limited.commits).toEqual([]);
  const f = fixture(syntheticKey); let once = true; f.afterCommit(() => { if (once) { once = false; throw new Error('PRIVATE_REGISTRATION_DIAGNOSTIC'); } });
  await expect(f.session().register(participant('new'), verifiedProfile('new'), { displayName: 'New' })).rejects.toThrow('SESSION_STORAGE_UNAVAILABLE'); expect(f.commits).toHaveLength(1);
  expect((await f.session().register(participant('new'), verifiedProfile('new'), { displayName: 'New' })).status).toBe('PENDING');
  const hash = createHmac('sha256', syntheticKey).update('new@example.invalid').digest('hex'); f.rows.delete(`EMAIL#${hash}/CLAIM`);
  await expect(f.session().register(participant('new'), verifiedProfile('new'), { displayName: 'New' })).rejects.toThrow('FORBIDDEN');
});

it('issues organizer-private links with retained immutable lookup, strict recipient/body checks and safe replacement', async () => {
  const f = fixture(syntheticKey); let count = 0; const session = f.session({ token: () => (++count === 1 ? 'a' : 'b').repeat(43) });
  const link = await session.invite(participant(), 'garden', { email: ' LUCA@example.invalid ', replace: false });
  expect(link).toEqual({ token: 'a'.repeat(43), expiresAt: 86_400_100, delivery: 'COPY_LINK' });
  const hash = createHash('sha256').update(link.token).digest('hex'); expect(f.get(`INVITATION#${hash}/TARGET`)).toMatchObject({ revision: 1, value: { groupId: 'garden' } });
  expect(JSON.stringify(await session.snapshot(participant(), 'garden'))).not.toMatch(/tokenHash|recipientHash|emailHash|INVITATION#|a{43}/);
  await expect(session.invite(participant('omar'), 'garden', { email: 'luca@example.invalid', replace: true })).rejects.toThrow('FORBIDDEN');
  await expect(session.invite(participant(), 'garden', { email: 'omar@example.invalid', replace: false })).rejects.toThrow('INVALID_COMMAND');
  await expect(session.invite(participant(), 'garden', { email: 'luca@example.invalid', replace: false })).rejects.toThrow('STALE_CONTEXT');
  const next = await session.invite(participant(), 'garden', { email: 'luca@example.invalid', replace: true }); expect(next.token).not.toBe(link.token);
  expect(f.get(`INVITATION#${hash}/TARGET`).revision).toBe(1);
  await expect(session.accept(participant('luca'), { token: link.token })).rejects.toThrow('NOT_FOUND');
  await expect(session.invite(participant(), 'garden', { email: 'luca@example.invalid', replace: true, subject: 'omar' })).rejects.toThrow('INVALID_COMMAND');
});

it('joins only the approved intended recipient atomically, stales prior bindings and makes explicit acceptance replay read-only', async () => {
  const f = fixture(syntheticKey); const session = f.session({ token: () => 'a'.repeat(43) });
  const invitation = await session.invite(participant(), 'garden', { email: 'luca@example.invalid', replace: false });
  await expect(session.accept(participant('omar'), { token: invitation.token })).rejects.toThrow('NOT_FOUND');
  const joined = await session.accept(participant('luca'), { token: invitation.token }); expect(joined.version).toBe(2); expect(joined.members).toHaveLength(3);
  expect(f.commits.at(-1)!).toEqual(expect.arrayContaining([
    expect.objectContaining({ key: partitionMembershipKey('luca', 'garden'), expected: 0 }),
    expect.objectContaining({ key: { PK: 'ACCOUNT#luca', SK: 'STATE' }, next: null }),
    expect.objectContaining({ key: { PK: 'GROUP#garden', SK: 'STATE' }, next: expect.objectContaining({ kind: 'GROUP' }) })]));
  expect(f.get('MEMBER#luca/GROUP#garden')).toMatchObject({ revision: 1, value: { active: true } });
  await expect(session.decisionFence(participant('luca'), 'decision')).rejects.toThrow('STALE_CONTEXT');
  expect(await session.accept(participant('luca'), { token: invitation.token })).toEqual(joined);
  expect(f.commits.at(-1)!.every(item => item.next === null)).toBe(true); expect(f.get('MEMBER#luca/GROUP#garden').revision).toBe(1);
});

it('never reuses an accepted link to restore a removed member but allows a fresh intended invitation without restoring old decision consent', async () => {
  const f = fixture(syntheticKey); let count = 0; const session = f.session({ token: () => (++count === 1 ? 'a' : 'b').repeat(43) });
  const first = await session.invite(participant(), 'garden', { email: 'luca@example.invalid', replace: false });
  await session.accept(participant('luca'), { token: first.token });
  await session.remove(participant(), 'garden', { memberId: partitionMemberId('luca'), version: 2 });
  const writes = f.commits.length; await expect(session.accept(participant('luca'), { token: first.token })).rejects.toThrow('NOT_FOUND'); expect(f.commits).toHaveLength(writes);
  expect(f.get('MEMBER#luca/GROUP#garden')).toMatchObject({ revision: 2, value: { active: false } });
  const next = await session.invite(participant(), 'garden', { email: 'luca@example.invalid', replace: true });
  const joined = await session.accept(participant('luca'), { token: next.token }); expect(joined.version).toBe(4);
  expect(f.get('MEMBER#luca/GROUP#garden')).toMatchObject({ revision: 3, value: { active: true } });
  await expect(session.decisionFence(participant('luca'), 'decision')).rejects.toThrow('STALE_CONTEXT');
});

it('denies expired, unknown, archived and disabled recipient or organizer invitations', async () => {
  for (const change of ['expired', 'unknown', 'archived', 'recipient', 'organizer'] as const) {
    const f = fixture(syntheticKey); const session = f.session({ token: () => 'a'.repeat(43) });
    const invitation = await session.invite(participant(), 'garden', { email: 'luca@example.invalid', replace: false });
    if (change === 'archived') f.rows.set('GROUP#garden/STATE', { schemaVersion: 1, revision: 3, kind: 'ARCHIVED_GROUP', groupId: 'garden', organizer: 'iris', groupVersion: 1,
      sourceSha: 'a'.repeat(40), sourceHash: 'b'.repeat(64), manifestHash: 'c'.repeat(64), manifestVersion: 'immutable-v1', archivedAt: '2026-10-07T15:00:00.000Z' });
    if (change === 'recipient' || change === 'organizer') f.get(`ACCOUNT#${change === 'recipient' ? 'luca' : 'iris'}/STATE`).value.status = 'DISABLED';
    const count = f.commits.length; const acceptor = change === 'expired' ? f.session({ now: () => invitation.expiresAt }) : session;
    await expect(acceptor.accept(participant('luca'), { token: change === 'unknown' ? 'z'.repeat(43) : invitation.token })).rejects.toThrow(change === 'recipient' || change === 'organizer' ? 'FORBIDDEN' : 'NOT_FOUND');
    expect(f.commits).toHaveLength(count);
  }
});

it('conditions actual invitation acceptance against concurrent organizer disable and invitation replacement', async () => {
  for (const change of ['disabled', 'replaced'] as const) {
    const f = fixture(syntheticKey); const session = f.session({ token: () => 'a'.repeat(43) });
    const invitation = await session.invite(participant(), 'garden', { email: 'luca@example.invalid', replace: false }); let once = true;
    f.beforeCommit(() => {
      if (!once) return; once = false;
      const row = f.get(change === 'disabled' ? 'ACCOUNT#iris/STATE' : 'GROUP#garden/STATE');
      if (change === 'disabled') row.value.status = 'DISABLED'; else row.value.invitations = [];
      row.revision++;
    });
    const before = f.commits.length; await expect(session.accept(participant('luca'), { token: invitation.token })).rejects.toThrow(change === 'disabled' ? 'FORBIDDEN' : 'NOT_FOUND');
    expect(f.commits).toHaveLength(before + 1); expect(f.rows.has('MEMBER#luca/GROUP#garden')).toBe(false);
  }
});

it('converges duplicate acceptance and preserves explicit retry after an unknown applied join', async () => {
  const f = fixture(syntheticKey); const session = f.session({ token: () => 'a'.repeat(43) }); const invitation = await session.invite(participant(), 'garden', { email: 'luca@example.invalid', replace: false });
  const joined = await Promise.all([session.accept(participant('luca'), { token: invitation.token }), session.accept(participant('luca'), { token: invitation.token })]);
  expect(joined[0]).toEqual(joined[1]); expect(joined[0]!.version).toBe(2); expect(f.get('MEMBER#luca/GROUP#garden').revision).toBe(1);
  const unknown = fixture(syntheticKey); const next = await unknown.session({ token: () => 'a'.repeat(43) }).invite(participant(), 'garden', { email: 'luca@example.invalid', replace: false }); let once = true;
  unknown.afterCommit(() => { if (once) { once = false; throw new Error('PRIVATE_JOIN_DIAGNOSTIC'); } }); const before = unknown.commits.length;
  await expect(unknown.session().accept(participant('luca'), { token: next.token })).rejects.toThrow('SESSION_STORAGE_UNAVAILABLE'); expect(unknown.commits).toHaveLength(before + 1);
  expect((await unknown.session().accept(participant('luca'), { token: next.token })).version).toBe(2); expect(unknown.get('MEMBER#luca/GROUP#garden').revision).toBe(1);
});

it('bounds invitation entropy configuration, lifetime, retained collisions and one shared acceptance request/deadline budget', async () => {
  const f = fixture(syntheticKey);
  await expect(f.session({ token: () => 'bad' }).invite(participant(), 'garden', { email: 'luca@example.invalid', replace: false })).rejects.toThrow('SESSION_INVALID'); expect(f.reads).toEqual([]);
  await expect(f.session({ now: () => Number.MAX_SAFE_INTEGER }).invite(participant(), 'garden', { email: 'luca@example.invalid', replace: false })).rejects.toThrow('SESSION_CAPACITY');
  const invitation = await f.session({ token: () => 'a'.repeat(43) }).invite(participant(), 'garden', { email: 'luca@example.invalid', replace: false });
  const before = f.commits.length; await expect(f.session({ token: () => 'a'.repeat(43) }).invite(participant(), 'garden', { email: 'luca@example.invalid', replace: true })).rejects.toThrow('SESSION_INVALID'); expect(f.commits).toHaveLength(before);
  await expect(f.session({ maxRequests: 3 }).accept(participant('luca'), { token: invitation.token })).rejects.toThrow('SESSION_REQUEST_LIMIT'); expect(f.commits).toHaveLength(before);
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; }); f.beforeRead(() => held);
  await expect(f.session({ timeoutMs: 20 }).accept(participant('luca'), { token: invitation.token })).rejects.toThrow('SESSION_TIMEOUT'); release();
  await new Promise<void>(resolve => setTimeout(resolve, 1)); expect(f.commits).toHaveLength(before);
});

it('enforces the sixteen-member limit before hydrating an oversized invited roster', async () => {
  const f = fixture(syntheticKey); const members = ['iris', 'omar', ...Array.from({ length: 14 }, (_, index) => `m${index}`)];
  const state: Groups.GroupState = { accounts: [...members, 'luca'].map(subject => ({ subject, displayName: subject, status: 'APPROVED', version: 1,
    emailHash: createHmac('sha256', syntheticKey).update(`${subject}@example.invalid`).digest('hex') })), groups: [{ id: 'garden', name: 'Garden', organizer: 'iris', members, version: 1,
      drafts: [], decisions: [], invitations: [{ tokenHash: createHash('sha256').update('a'.repeat(43)).digest('hex'),
        recipientHash: createHmac('sha256', syntheticKey).update('luca@example.invalid').digest('hex'), expiresAt: 500, acceptedBy: null }] }] };
  const plan = preparePartitionMigration(Buffer.from(JSON.stringify(state)), 1, 'a'.repeat(40)); f.rows.clear();
  for (const item of plan.batches.flat()) f.rows.set(code(item.key), structuredClone(item.next));
  await expect(f.session().accept(participant('luca'), { token: 'a'.repeat(43) })).rejects.toThrow('SESSION_CAPACITY');
  expect(f.reads).toHaveLength(2); expect(f.reads.flat().some(key => key.PK.startsWith('ACCOUNT#m'))).toBe(false); expect(f.commits).toEqual([]);
});

it('enforces pending-link capacity and safe group-version arithmetic before acceptance mutation', async () => {
  const f = fixture(syntheticKey); f.get('GROUP#garden/STATE').value.invitations = Array.from({ length: 64 }, (_, index) => ({
    tokenHash: createHash('sha256').update(`link-${index}`).digest('hex'), recipientHash: createHash('sha256').update(`recipient-${index}`).digest('hex'), expiresAt: 500, acceptedBy: null }));
  await expect(f.session({ token: () => 'a'.repeat(43) }).invite(participant(), 'garden', { email: 'luca@example.invalid', replace: false })).rejects.toThrow('SESSION_CAPACITY'); expect(f.commits).toEqual([]);
  const exhausted = fixture(syntheticKey); const invitation = await exhausted.session({ token: () => 'a'.repeat(43) }).invite(participant(), 'garden', { email: 'luca@example.invalid', replace: false });
  exhausted.get('GROUP#garden/STATE').value.version = Number.MAX_SAFE_INTEGER; const count = exhausted.commits.length;
  await expect(exhausted.session().accept(participant('luca'), { token: invitation.token })).rejects.toThrow('SESSION_CAPACITY');
  expect(exhausted.commits).toHaveLength(count); expect(exhausted.rows.has('MEMBER#luca/GROUP#garden')).toBe(false);
});

it('never retries an unknown invitation issue automatically and requires explicit fresh replacement to recover a copy link', async () => {
  const f = fixture(syntheticKey); let count = 0; let once = true; const session = f.session({ token: () => (++count === 1 ? 'a' : 'b').repeat(43) });
  f.afterCommit(() => { if (once) { once = false; throw new Error('PRIVATE_ISSUE_DIAGNOSTIC'); } });
  const request = { email: 'luca@example.invalid', replace: false };
  await expect(session.invite(participant(), 'garden', request)).rejects.toThrow('SESSION_STORAGE_UNAVAILABLE'); expect(f.commits).toHaveLength(1); expect(count).toBe(1);
  await expect(session.invite(participant(), 'garden', request)).rejects.toThrow('STALE_CONTEXT'); expect(f.commits).toHaveLength(1);
  const next = await session.invite(participant(), 'garden', { ...request, replace: true }); expect(next.token).toBe('b'.repeat(43));
  await expect(session.accept(participant('luca'), { token: 'a'.repeat(43) })).rejects.toThrow('NOT_FOUND');
  expect((await session.accept(participant('luca'), { token: next.token })).version).toBe(2);
});

const pageCandidate = (id = 'garden') => ({ id, name: 'Untrusted candidate label', version: 99, isOrganizer: false });
const pageCursor = 'x'.repeat(80);
it('lists fresh complete public snapshots, ignoring discovery labels and retaining opaque pagination', async () => {
  const f = fixture(); const requests: unknown[] = [];
  const session = f.session({ discovery: async (raw, io) => { requests.push(structuredClone(raw)); expect(io.signal).toBeDefined();
    return { groups: [pageCandidate()], cursor: pageCursor }; } });
  const result = await session.list(participant(), { limit: 1, cursor: pageCursor });
  expect(requests).toEqual([{ subject: 'iris', limit: 1, cursor: pageCursor }]);
  expect(result.groups).toEqual([await f.session().snapshot(participant(), 'garden')]); expect(result.cursor).toBe(pageCursor);
  expect(JSON.stringify(result.groups)).not.toMatch(/subject|emailHash|tokenHash|recipientHash|MEMBER#|ACCOUNT#|revision|Untrusted/);
  expect(f.commits[0]!.every(change => change.next === null)).toBe(true);
});

it('ignores stale discovery edges for absent, archived and removed groups without granting scope', async () => {
  const f = fixture(); const base = structuredClone(f.get('GROUP#garden/STATE'));
  f.rows.set('GROUP#removed/STATE', { ...base, value: { ...base.value, id: 'removed', organizer: 'omar', members: ['omar'] } });
  f.rows.set('GROUP#archived/STATE', { schemaVersion: 1, revision: 2, kind: 'ARCHIVED_GROUP', groupId: 'archived', organizer: 'iris', groupVersion: 1,
    sourceSha: 'a'.repeat(40), sourceHash: 'f'.repeat(64), manifestHash: 'e'.repeat(64), manifestVersion: 'saved-v1',
    archivedAt: '2026-10-07T14:00:00Z' });
  const result = await f.session({ discovery: async () => ({ groups: ['absent', 'removed', 'archived', 'garden'].map(pageCandidate), cursor: null }) }).list(participant());
  expect(result.groups.map(group => group.id)).toEqual(['garden']); expect(f.commits).toHaveLength(1);
  expect(f.commits[0]!.some(change => change.key.PK === 'GROUP#removed' || change.key.PK === 'GROUP#archived')).toBe(false);
});

it('denies invalid identity, pagination and unavailable discovery before storage, and approval before discovery', async () => {
  const f = fixture(); let calls = 0; const discovery = async () => { calls++; return { groups: [], cursor: null }; };
  const session = f.session({ discovery });
  for (const who of [null, { kind: 'service', subject: 'iris', roomIds: [] }, { kind: 'participant', subject: '../iris' }] as (TrustedPrincipal | null)[]) {
    await expect(session.list(who)).rejects.toThrow('FORBIDDEN');
  }
  for (const raw of [{ subject: 'omar' }, { limit: 0 }, { limit: 21 }, { limit: '1' }, { cursor: '' }, { cursor: '../private' }]) {
    await expect(session.list(participant(), raw)).rejects.toThrow('INVALID_COMMAND');
  }
  await expect(f.session().list(participant())).rejects.toThrow('SESSION_INVALID'); expect(f.reads).toEqual([]);
  for (const who of ['pending', 'absent']) await expect(session.list(participant(who))).rejects.toThrow('FORBIDDEN');
  expect(calls).toBe(0); expect(f.commits).toEqual([]);
});

it('guards the complete page against disable, removal, archive or header replacement at final publication', async () => {
  for (const change of ['disable', 'remove', 'archive', 'rename']) {
    const f = fixture();
    f.beforeCommit(changes => { expect(changes.every(item => item.next === null)).toBe(true);
      if (change === 'disable') { const row = f.get('ACCOUNT#iris/STATE'); row.value.status = 'DISABLED'; row.revision++; }
      else if (change === 'archive') f.rows.delete('GROUP#garden/STATE');
      else { const row = f.get('GROUP#garden/STATE'); if (change === 'remove') row.value.members = ['omar']; else row.value.name = 'Changed'; row.revision++; }
    });
    await expect(f.session({ discovery: async () => ({ groups: [pageCandidate()], cursor: null }) }).list(participant())).rejects.toThrow('STALE_CONTEXT');
    expect(f.commits).toHaveLength(1);
  }
});

it('does not publish an earlier group changed while a later candidate is hydrated', async () => {
  const f = fixture(); const base = structuredClone(f.get('GROUP#garden/STATE'));
  f.rows.set('GROUP#second/STATE', { ...base, value: { ...base.value, id: 'second', decisionIds: [] } });
  let changed = false;
  f.beforeRead(keys => { if (!changed && keys.some(key => key.PK === 'GROUP#second')) {
    changed = true; const row = f.get('GROUP#garden/STATE'); row.value.name = 'Changed during page'; row.revision++;
  } });
  await expect(f.session({ discovery: async () => ({ groups: [pageCandidate(), pageCandidate('second')], cursor: null }) }).list(participant())).rejects.toThrow('STALE_CONTEXT');
  expect(f.commits).toHaveLength(1);
});

it('rejects malformed, duplicate, oversized and limit-exceeding discovery pages before publication', async () => {
  for (const groups of [[pageCandidate(), pageCandidate()], [pageCandidate(), pageCandidate('second')],
    [{ ...pageCandidate(), subject: 'iris' }], Array.from({ length: 21 }, (_, index) => pageCandidate(`group-${index}`))]) {
    const f = fixture(); await expect(f.session({ discovery: async () => ({ groups, cursor: null }) }).list(participant(), { limit: 1 })).rejects.toThrow('SESSION_INVALID');
    expect(f.commits).toEqual([]);
  }
  const f = fixture(); await expect(f.session({ discovery: async () => ({ groups: [], cursor: 'unsafe?' }) }).list(participant())).rejects.toThrow('SESSION_INVALID');
});

it('shares the operation ceiling and deadline with discovery and prevents late hydration', async () => {
  const f = fixture(); let calls = 0;
  const session = f.session({ discovery: async () => { calls++; return { groups: [], cursor: null }; } });
  await expect(session.list(participant(), {}, partitionIO({ maxRequests: 1 }))).rejects.toThrow('SESSION_REQUEST_LIMIT'); expect(calls).toBe(0);
  let release: (() => void) | undefined;
  const held = f.session({ discovery: async () => { await new Promise<void>(resolve => { release = resolve; }); return { groups: [pageCandidate()], cursor: null }; } });
  await expect(held.list(participant(), {}, partitionIO({ timeoutMs: 20 }))).rejects.toThrow('SESSION_TIMEOUT');
  const reads = f.reads.length; release?.(); await new Promise(resolve => setTimeout(resolve, 20)); expect(f.reads).toHaveLength(reads); expect(f.commits).toEqual([]);
});

it('caps combined page authority at one hundred unique guards before a physical commit', async () => {
  const f = fixture(); const candidates: ReturnType<typeof pageCandidate>[] = [];
  for (let index = 0; index < 7; index++) {
    const members = ['iris', ...Array.from({ length: 15 }, (_, member) => `person-${index}-${member}`)];
    for (const subject of members.slice(1)) f.rows.set(`ACCOUNT#${subject}/STATE`, { schemaVersion: 1, kind: 'ACCOUNT', revision: 1,
      value: { subject, emailHash: createHash('sha256').update(subject).digest('hex'), displayName: subject, status: 'APPROVED', version: 1 } });
    const id = `group-${index}`; candidates.push(pageCandidate(id));
    f.rows.set(`GROUP#${id}/STATE`, { schemaVersion: 1, kind: 'GROUP', revision: 1, value: { id, name: id, organizer: 'iris', version: 1,
      members, draftIds: [], decisionIds: [], invitations: [] } });
  }
  await expect(f.session({ discovery: async () => ({ groups: candidates, cursor: null }) }).list(participant())).rejects.toThrow('SESSION_CAPACITY');
  expect(f.commits).toEqual([]);
});

it('guards empty pages and never automatically repeats an unknown publication outcome', async () => {
  const empty = fixture(); empty.beforeCommit(() => { const row = empty.get('ACCOUNT#iris/STATE'); row.value.status = 'DISABLED'; row.revision++; });
  await expect(empty.session({ discovery: async () => ({ groups: [], cursor: null }) }).list(participant())).rejects.toThrow('STALE_CONTEXT');
  const f = fixture(); f.afterCommit(() => { throw new Error('private lost response'); });
  const session = f.session({ discovery: async () => ({ groups: [pageCandidate()], cursor: null }) });
  await expect(session.list(participant())).rejects.toThrow('SESSION_STORAGE_UNAVAILABLE'); expect(f.commits).toHaveLength(1);
  expect(f.commits[0]!.every(item => item.next === null)).toBe(true); f.afterCommit(() => {});
  expect((await session.list(participant())).groups[0]!.id).toBe('garden'); expect(f.commits).toHaveLength(2);
});

it('copies the authenticated subject and captures discovery configuration across async work', async () => {
  const f = fixture(); const who = participant(); const options: NonNullable<Parameters<typeof createPartitionGroupSession>[1]> = {
    discovery: async raw => { expect(raw.subject).toBe('iris'); who.subject = 'luca'; options.discovery = async () => ({ groups: [], cursor: null });
      return { groups: [pageCandidate()], cursor: null }; } };
  const session = f.session(options); const result = await session.list(who);
  expect(result.groups[0]!.isOrganizer).toBe(true); expect(result.groups[0]!.id).toBe('garden');
  expect(f.commits[0]!.some(change => change.key.PK === 'ACCOUNT#luca')).toBe(false);
});

it('preserves denial, stale and bounded discovery errors without exposing provider causes', async () => {
  for (const [input, output] of [['MEMBERSHIP_DENIED', 'FORBIDDEN'], ['MEMBERSHIP_STALE', 'STALE_CONTEXT'],
    ['MEMBERSHIP_INVALID', 'SESSION_INVALID'], ['MEMBERSHIP_TIMEOUT', 'SESSION_TIMEOUT'],
    ['MEMBERSHIP_REQUEST_LIMIT', 'SESSION_REQUEST_LIMIT'], ['MEMBERSHIP_STORAGE_UNAVAILABLE', 'SESSION_STORAGE_UNAVAILABLE']] as const) {
    const f = fixture(); await expect(f.session({ discovery: async () => { throw new PartitionMembershipError(input); } }).list(participant())).rejects.toThrow(output);
    expect(f.commits).toEqual([]);
  }
});
