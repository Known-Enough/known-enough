import { createHash, createHmac } from 'node:crypto';
import { expect, it } from 'vitest';
import { Groups, KnownEnough as KE } from '@deal-table/contracts';
import { PartitionMembershipError } from './partition-membership.ts';
import type { TrustedPrincipal, DecisionArchitectRequest, DecisionArchitectureDraft } from '@deal-table/application';
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
  const f = fixture(); const accountBefore = structuredClone(f.get('ACCOUNT#iris/STATE'));
  const snapshot = await f.session().create(participant(), { name: '  Shared garden  ', idempotencyKey: 'new-group' });
  expect(snapshot).toMatchObject({ name: 'Shared garden', version: 1, isOrganizer: true, pendingInvitations: 0, drafts: [], decisions: [] });
  expect(snapshot.members).toEqual([{ id: partitionMemberId('iris'), displayName: 'IRIS', isOrganizer: true }]);
  expect(JSON.stringify(snapshot)).not.toMatch(/subject|emailHash|tokenHash|recipientHash|ACCOUNT#|MEMBER#|revision/);
  expect(f.reads.flat().every(key => ['ACCOUNT#iris', `GROUP#${snapshot.id}`, 'MEMBER#iris'].includes(key.PK))).toBe(true);
  expect(f.commits).toHaveLength(1);
  expect(f.commits[0]).toEqual(expect.arrayContaining([
    expect.objectContaining({ key: { PK: 'ACCOUNT#iris', SK: 'STATE' }, expected: accountBefore.revision,
      next: expect.objectContaining({ revision: accountBefore.revision + 1, value: accountBefore.value }) }),
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
  const accountBefore = structuredClone(f.get('ACCOUNT#luca/STATE'));
  const joined = await session.accept(participant('luca'), { token: invitation.token }); expect(joined.version).toBe(2); expect(joined.members).toHaveLength(3);
  expect(f.commits.at(-1)!).toEqual(expect.arrayContaining([
    expect.objectContaining({ key: partitionMembershipKey('luca', 'garden'), expected: 0 }),
    expect.objectContaining({ key: { PK: 'ACCOUNT#luca', SK: 'STATE' }, expected: accountBefore.revision,
      next: expect.objectContaining({ revision: accountBefore.revision + 1, value: accountBefore.value }) }),
    expect.objectContaining({ key: { PK: 'GROUP#garden', SK: 'STATE' }, next: expect.objectContaining({ kind: 'GROUP' }) })]));
  expect(f.get('MEMBER#luca/GROUP#garden')).toMatchObject({ revision: 1, value: { active: true } });
  await expect(session.decisionFence(participant('luca'), 'decision')).rejects.toThrow('STALE_CONTEXT');
  expect(await session.accept(participant('luca'), { token: invitation.token })).toEqual(joined);
  expect(f.commits.at(-1)!.every(item => item.next === null)).toBe(true); expect(f.get('MEMBER#luca/GROUP#garden').revision).toBe(1);
  expect(f.get('ACCOUNT#luca/STATE')).toMatchObject({ revision: accountBefore.revision + 1, value: accountBefore.value });
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


function seedDraft(f: ReturnType<typeof fixture>, overrides: Partial<Groups.GroupDraft> = {}) {
  const participants = ['iris', 'omar'].map(subject => ({ id: partitionMemberId(subject), displayName: subject.toUpperCase(), requiredForApproval: true }));
  const draft = Groups.GroupDraft.parse({ id: 'draft-one', bodyHash: 'b'.repeat(64), revision: 1, groupVersion: 1, createdDecisionId: null,
    clarificationQuestions: ['Confirm the public choices.'], frame: { schemaVersion: KE.KE_SCHEMA_VERSION, decisionId: 'draft-decision', frameVersion: 1,
      semanticVersion: 1, contextToken: 'c'.repeat(64), title: 'Garden task', objective: 'Choose a task', description: '', participants,
      requiredParticipantIds: participants.map(value => value.id), variables: [{ id: 'indoors', type: 'BOOLEAN', label: 'Indoors', required: true, visibility: 'PUBLIC' }], rules: [] }, ...overrides });
  f.rows.set('GROUP#garden/DRAFT#draft-one', { schemaVersion: 1, kind: 'DRAFT', revision: 1, value: structuredClone(draft) });
  f.get('GROUP#garden/STATE').value.draftIds = [draft.id];
  return draft;
}
const edit = (draft: Groups.GroupDraft) => ({ revision: draft.revision, title: 'Revised garden task', objective: draft.frame.objective,
  variables: draft.frame.variables, rules: draft.frame.rules });

it('reads drafts only for an approved current organizer with a conditional privacy-safe result', async () => {
  const f = fixture(); const draft = seedDraft(f); const session = f.session();
  expect(await session.readDraft(participant(), 'garden', draft.id)).toEqual(draft);
  expect(f.commits.at(-1)!.every(value => value.next === null)).toBe(true);
  expect(JSON.stringify(draft)).not.toMatch(/subject|emailHash|recipientHash|ACCOUNT#|MEMBER#/);
  await expect(session.readDraft(participant('omar'), 'garden', draft.id)).rejects.toThrow('FORBIDDEN');
  await expect(session.readDraft(participant('pending'), 'garden', draft.id)).rejects.toThrow('FORBIDDEN');
  await expect(session.readDraft(participant('luca'), 'garden', draft.id)).rejects.toThrow('NOT_FOUND');
  await expect(session.readDraft(participant(), 'garden', 'absent')).rejects.toThrow('NOT_FOUND');
  expect(f.reads.flat().some(value => value.PK === 'ACCOUNT#luca')).toBe(true); // Actor admission only.
  expect(f.reads.flat().some(value => value.PK === 'GROUP#other')).toBe(false);
});

it('edits one draft atomically without changing its roster, decision identity, creation fingerprint or unresolved questions', async () => {
  const f = fixture(); const draft = seedDraft(f); const changed = await f.session().editDraft(participant(), 'garden', draft.id, edit(draft));
  expect(changed).toEqual({ ...draft, revision: 2, frame: { ...draft.frame, title: 'Revised garden task' } });
  changed.frame.title = 'Caller alias';
  expect(f.get('GROUP#garden/DRAFT#draft-one')).toMatchObject({ revision: 2, value: { revision: 2, frame: { title: 'Revised garden task' } } });
  expect(f.get('GROUP#garden/STATE')).toMatchObject({ revision: 2, value: { version: 1, members: ['iris', 'omar'], decisionIds: ['decision'] } });
  const writes = f.commits[0]!.filter(value => value.next);
  expect(writes.map(value => code(value.key)).sort()).toEqual(['GROUP#garden/DRAFT#draft-one', 'GROUP#garden/STATE']);
  expect(f.commits[0]).toEqual(expect.arrayContaining([expect.objectContaining({ key: { PK: 'ACCOUNT#iris', SK: 'STATE' }, expected: 1, next: null })]));
  await expect(f.session().editDraft(participant(), 'garden', draft.id, edit(draft))).rejects.toThrow('STALE_CONTEXT');
  expect(f.commits).toHaveLength(1);
});

it('rejects caller authority, private variables and invalid full-frame relationships without changing the draft', async () => {
  const f = fixture(); const draft = seedDraft(f); const session = f.session();
  for (const request of [{ ...edit(draft), subject: 'iris' }, { ...edit(draft), participants: [] }, { ...edit(draft), revision: Number.MAX_SAFE_INTEGER + 1 },
    { ...edit(draft), variables: [{ ...draft.frame.variables[0]!, visibility: 'CONSENT_REQUIRED' }] },
    { ...edit(draft), variables: [draft.frame.variables[0]!, draft.frame.variables[0]!] },
    { ...edit(draft), rules: [{ id: 'private', visibility: 'TRUSTED_BACKEND', operator: 'COMPARE', variableId: 'indoors', comparison: 'EQ', value: { type: 'BOOLEAN', value: true } }] },
    { ...edit(draft), rules: [{ id: 'unknown', visibility: 'PUBLIC', operator: 'COMPARE', variableId: 'unknown', comparison: 'EQ', value: { type: 'BOOLEAN', value: true } }] }]) {
    await expect(session.editDraft(participant(), 'garden', draft.id, request)).rejects.toThrow('INVALID_COMMAND');
  }
  await expect(session.editDraft(participant('omar'), 'garden', draft.id, edit(draft))).rejects.toThrow('FORBIDDEN');
  await expect(session.readDraft(participant(), 'garden', '../draft')).rejects.toThrow('INVALID_COMMAND');
  expect(f.commits).toEqual([]); expect(f.get('GROUP#garden/DRAFT#draft-one').value).toEqual(draft);
});

it('retains unanswered clarification after catalog edits and never treats an unbounded public number as enumerated', async () => {
  const f = fixture(); const draft = seedDraft(f); const changed = await f.session().editDraft(participant(), 'garden', draft.id, {
    ...edit(draft), variables: [{ id: 'amount', label: 'Amount', required: true, visibility: 'PUBLIC', type: 'NUMBER', unitCode: 'kg', scale: 0 }] });
  expect(changed.clarificationQuestions[0]).toBe(draft.clarificationQuestions[0]); expect(changed.clarificationQuestions).toHaveLength(2);
  const replay = await f.session().editDraft(participant(), 'garden', draft.id, { ...edit(changed), title: 'Another task' });
  expect(replay.clarificationQuestions).toEqual(changed.clarificationQuestions);
});

it('locks created and obsolete-roster drafts and fails closed before unsafe revision overflow', async () => {
  for (const overrides of [{ createdDecisionId: 'decision' }, { groupVersion: 2 }, { revision: Number.MAX_SAFE_INTEGER }]) {
    const f = fixture(); const draft = seedDraft(f, overrides);
    const error = overrides.revision === Number.MAX_SAFE_INTEGER ? 'SESSION_CAPACITY' : 'STALE_CONTEXT';
    await expect(f.session().editDraft(participant(), 'garden', draft.id, edit(draft))).rejects.toThrow(error);
    expect(f.commits).toEqual([]);
  }
  const unsafe = fixture(); const draft = seedDraft(unsafe); unsafe.get('GROUP#garden/DRAFT#draft-one').value.revision = Number.MAX_SAFE_INTEGER + 1;
  await expect(unsafe.session().readDraft(participant(), 'garden', draft.id)).rejects.toThrow('SESSION_INVALID');
  expect(unsafe.commits).toEqual([]);
});

it('rechecks disable, organizer change, roster version and concurrent draft edits at the actual atomic commit', async () => {
  for (const mode of ['disabled', 'organizer', 'roster', 'draft'] as const) {
    const f = fixture(); const draft = seedDraft(f); let once = true;
    f.beforeCommit(() => { if (!once) return; once = false;
      if (mode === 'disabled') { const row = f.get('ACCOUNT#iris/STATE'); row.value.status = 'DISABLED'; row.revision++; }
      if (mode === 'organizer') { const row = f.get('GROUP#garden/STATE'); row.value.organizer = 'omar'; row.revision++; }
      if (mode === 'roster') { const row = f.get('GROUP#garden/STATE'); row.value.version = 2; row.revision++; }
      if (mode === 'draft') { const row = f.get('GROUP#garden/DRAFT#draft-one'); row.value.revision = 2; row.revision++; }
    });
    await expect(f.session().editDraft(participant(), 'garden', draft.id, edit(draft))).rejects.toThrow(['disabled', 'organizer'].includes(mode) ? 'FORBIDDEN' : 'STALE_CONTEXT');
    expect(f.commits).toHaveLength(1); expect((f.get('GROUP#garden/DRAFT#draft-one').value.frame as KE.PublicDecisionFrame).title).toBe(draft.frame.title);
  }
});

it('does not repeat an edit after a lost applied response; a fresh read reconciles the version and stale replay is rejected', async () => {
  const f = fixture(); const draft = seedDraft(f); let once = true;
  f.afterCommit(() => { if (once) { once = false; throw new Error('PRIVATE_APPLIED_DRAFT_DIAGNOSTIC'); } });
  await expect(f.session().editDraft(participant(), 'garden', draft.id, edit(draft))).rejects.toThrow('SESSION_STORAGE_UNAVAILABLE');
  expect(f.commits).toHaveLength(1); expect(f.get('GROUP#garden/DRAFT#draft-one').value.revision).toBe(2);
  const current = await f.session().readDraft(participant(), 'garden', draft.id); expect(current.revision).toBe(2);
  await expect(f.session().editDraft(participant(), 'garden', draft.id, edit(draft))).rejects.toThrow('STALE_CONTEXT');
  expect(f.get('GROUP#garden/DRAFT#draft-one')).toMatchObject({ revision: 2, value: { revision: 2 } });
});

it('keeps a shared budget, deadline and cancellation across draft admission and editing without a late write', async () => {
  const f = fixture(); const draft = seedDraft(f); const budget = partitionIO({ maxRequests: 5 });
  await f.session().readDraft(participant(), 'garden', draft.id, budget);
  await expect(f.session().editDraft(participant(), 'garden', draft.id, edit(draft), budget)).rejects.toThrow('SESSION_REQUEST_LIMIT');
  expect(f.commits.every(values => values.every(value => !value.next))).toBe(true);
  const cancel = fixture(); seedDraft(cancel); const controller = new AbortController(); const io = partitionIO();
  cancel.beforeRead(() => { controller.abort(); });
  await expect(cancel.session().editDraft(participant(), 'garden', draft.id, edit(draft), { ...io, signal: controller.signal })).rejects.toThrow('SESSION_TIMEOUT');
  expect(cancel.commits).toEqual([]);
  const timed = fixture(); seedDraft(timed); let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  timed.beforeRead(() => held);
  await expect(timed.session({ timeoutMs: 20 }).editDraft(participant(), 'garden', draft.id, edit(draft))).rejects.toThrow('SESSION_TIMEOUT');
  release(); await new Promise<void>(resolve => setTimeout(resolve, 1)); expect(timed.commits).toEqual([]);
});


it('guards a draft read against revocation at publication and re-resolves a legitimate concurrent child/header update', async () => {
  const revoked = fixture(); const draft = seedDraft(revoked); let once = true;
  revoked.beforeCommit(() => { if (once) { once = false; const row = revoked.get('ACCOUNT#iris/STATE'); row.value.status = 'DISABLED'; row.revision++; } });
  await expect(revoked.session().readDraft(participant(), 'garden', draft.id)).rejects.toThrow('FORBIDDEN'); expect(revoked.commits).toHaveLength(1);
  const changed = fixture(); seedDraft(changed); let first = true;
  changed.beforeCommit(() => { if (!first) return; first = false;
    const child = changed.get('GROUP#garden/DRAFT#draft-one'); child.revision++; child.value.revision = 2;
    (child.value.frame as KE.PublicDecisionFrame).title = 'Concurrent edit'; changed.get('GROUP#garden/STATE').revision++;
  });
  expect(await changed.session().readDraft(participant(), 'garden', draft.id)).toMatchObject({ revision: 2, frame: { title: 'Concurrent edit' } });
  expect(changed.commits).toHaveLength(2); expect(changed.commits.every(values => values.every(value => value.next === null))).toBe(true);
});


function architecture(input: DecisionArchitectRequest): DecisionArchitectureDraft {
  const participants = input.participants.map(person => ({ ...person, requiredForApproval: true }));
  return { draftId: input.draftId, revision: input.revision, status: 'DEFINING', clarificationQuestions: [], participantInformationRequirements: [],
    frame: KE.PublicDecisionFrame.parse({ schemaVersion: KE.KE_SCHEMA_VERSION, decisionId: 'new-frame', frameVersion: 1, semanticVersion: 1,
      contextToken: 'c'.repeat(64), title: 'Garden task', objective: input.objective, description: '', participants,
      requiredParticipantIds: participants.map(person => person.id), variables: [{ id: 'indoors', type: 'BOOLEAN', label: 'Indoors', required: true, visibility: 'PUBLIC' }], rules: [] }) };
}
const generate = { objective: ' Choose a task ', idempotencyKey: 'generate-one' };

it('generates one fingerprinted draft from the trusted public roster and replays it without invoking the architect again', async () => {
  const f = fixture(); const calls: DecisionArchitectRequest[] = []; const options = { draftArchitect: async (subject: string, input: DecisionArchitectRequest) => {
    expect(subject).toBe('iris'); calls.push(structuredClone(input)); return architecture(input);
  } }; const session = f.session(options); options.draftArchitect = async () => { throw new Error('Caller mutated configuration'); };
  const draft = await session.generateDraft(participant(), 'garden', generate);
  expect(draft).toMatchObject({ revision: 1, groupVersion: 1, createdDecisionId: null, clarificationQuestions: [], frame: { objective: 'Choose a task' } });
  expect(calls).toHaveLength(1); expect(calls[0]).toEqual({ draftId: draft.id, revision: 1, objective: 'Choose a task', allowedOptions: [], generateOptions: true,
    participants: ['iris', 'omar'].map(subject => ({ id: partitionMemberId(subject), displayName: subject.toUpperCase() })) });
  expect(JSON.stringify(calls[0])).not.toMatch(/subject|emailHash|recipientHash|ACCOUNT#|MEMBER#/);
  expect(f.get('GROUP#garden/STATE')).toMatchObject({ revision: 2, value: { version: 1, draftIds: [draft.id], decisionIds: ['decision'] } });
  expect(f.get(`GROUP#garden/DRAFT#${draft.id}`)).toMatchObject({ revision: 1, value: { bodyHash: draft.bodyHash } });
  const replay = await session.generateDraft(participant(), 'garden', { ...generate, objective: 'Choose a task' }); expect(replay).toEqual(draft); expect(calls).toHaveLength(1);
  await expect(session.generateDraft(participant(), 'garden', { ...generate, objective: 'Other task' })).rejects.toThrow('STALE_CONTEXT');
  expect(calls).toHaveLength(1);
});

it('denies invalid commands, roles, non-organizers, missing providers and unapproved roster members before any model call', async () => {
  const f = fixture(); let calls = 0; const session = f.session({ draftArchitect: async (_subject, input) => { calls++; return architecture(input); } });
  for (const raw of [{ ...generate, subject: 'omar' }, { ...generate, participants: [] }, { ...generate, objective: ' ' }, { ...generate, idempotencyKey: '../key' }])
    await expect(session.generateDraft(participant(), 'garden', raw)).rejects.toThrow('INVALID_COMMAND');
  expect(f.reads).toEqual([]);
  await expect(session.generateDraft(participant('omar'), 'garden', generate)).rejects.toThrow('FORBIDDEN');
  await expect(session.generateDraft({ kind: 'service', subject: 'iris', roomIds: [] }, 'garden', generate)).rejects.toThrow('FORBIDDEN');
  await expect(f.session().generateDraft(participant(), 'garden', generate)).rejects.toThrow('SESSION_INVALID');
  f.get('ACCOUNT#omar/STATE').value.status = 'DISABLED';
  await expect(session.generateDraft(participant(), 'garden', generate)).rejects.toThrow('FORBIDDEN'); expect(calls).toBe(0);
  expect(f.commits.every(values => values.every(value => value.next === null))).toBe(true);
});

it('rejects unknown, oversized, private and roster-substituted architect output before persistence', async () => {
  const changes: ((output: DecisionArchitectureDraft) => unknown)[] = [
    output => ({ ...output, subject: 'iris' }), output => ({ ...output, draftId: 'foreign' }), output => ({ ...output, revision: 2 }),
    output => ({ ...output, status: 'NEEDS_CLARIFICATION' }), output => ({ ...output, frame: { ...output.frame, objective: 'Other' } }),
    output => ({ ...output, frame: { ...output.frame, semanticVersion: 2 } }),
    output => ({ ...output, frame: { ...output.frame, participants: output.frame.participants.map(person => ({ ...person, displayName: 'Forged' })) } }),
    output => ({ ...output, frame: { ...output.frame, variables: output.frame.variables.map(value => ({ ...value, visibility: 'CONSENT_REQUIRED' })) } }),
    output => ({ ...output, participantInformationRequirements: [{ participantId: 'foreign', prompt: 'Prompt' }] }),
    () => 'x'.repeat(256 * 1024 + 1), () => '{', () => undefined,
  ];
  for (const change of changes) {
    const f = fixture(); const session = f.session({ draftArchitect: async (_subject, input) => change(architecture(input)) });
    await expect(session.generateDraft(participant(), 'garden', generate)).rejects.toThrow('SESSION_INVALID');
    expect(f.get('GROUP#garden/STATE').value.draftIds).toEqual([]); expect(f.commits).toHaveLength(1);
  }
});

it('preserves model questions and appends only bounded distinct catalog clarification', async () => {
  const f = fixture(); const session = f.session({ draftArchitect: async (_subject, input) => { const output = architecture(input);
    output.status = 'NEEDS_CLARIFICATION'; output.clarificationQuestions = ['Clarify the public amount.'];
    output.frame.variables = [{ id: 'amount', label: 'Amount', required: true, visibility: 'PUBLIC', type: 'NUMBER', unitCode: 'kg', scale: 0 }]; return output;
  } });
  const draft = await session.generateDraft(participant(), 'garden', generate); expect(draft.clarificationQuestions[0]).toBe('Clarify the public amount.');
  expect(draft.clarificationQuestions).toHaveLength(2); expect(draft.clarificationQuestions.every(question => question.length <= 500)).toBe(true);
});

it('rejects approval, roster, display-name or organizer changes while the architect is pending', async () => {
  for (const mode of ['disabled', 'member', 'name', 'version', 'organizer', 'archive'] as const) {
    const f = fixture(); const session = f.session({ draftArchitect: async (_subject, input) => {
      const header = f.get('GROUP#garden/STATE'); const account = f.get(`ACCOUNT#${mode === 'member' ? 'omar' : 'iris'}/STATE`);
      if (mode === 'archive') f.rows.set('GROUP#garden/STATE', { schemaVersion: 1, revision: 2, kind: 'ARCHIVED_GROUP', groupId: 'garden', organizer: 'iris', groupVersion: 1,
        sourceSha: 'a'.repeat(40), sourceHash: 'b'.repeat(64), manifestHash: 'c'.repeat(64), manifestVersion: 'immutable-v1', archivedAt: '2026-10-07T20:00:00.000Z' });
      else if (mode === 'disabled' || mode === 'member') { account.value.status = 'DISABLED'; account.revision++; }
      else if (mode === 'name') { account.value.displayName = 'Changed name'; account.revision++; }
      else { header.value[mode === 'version' ? 'version' : 'organizer'] = mode === 'version' ? 2 : 'omar'; header.revision++; }
      return architecture(input);
    } });
    await expect(session.generateDraft(participant(), 'garden', generate)).rejects.toThrow(mode === 'archive' ? 'NOT_FOUND' : ['disabled', 'member', 'organizer'].includes(mode) ? 'FORBIDDEN' : 'STALE_CONTEXT');
    if (mode !== 'archive') expect(f.get('GROUP#garden/STATE').value.draftIds).toEqual([]);
    expect(f.commits).toHaveLength(1);
  }
});

it('joins fresh account and header conditions to the actual generated draft commit', async () => {
  const f = fixture(); let count = 0; f.beforeCommit(() => { if (++count === 2) {
    const account = f.get('ACCOUNT#iris/STATE'); account.value.status = 'DISABLED'; account.revision++;
  } });
  await expect(f.session({ draftArchitect: async (_subject, input) => architecture(input) }).generateDraft(participant(), 'garden', generate)).rejects.toThrow('FORBIDDEN');
  expect(f.commits).toHaveLength(2); expect(f.get('GROUP#garden/STATE').value.draftIds).toEqual([]);
});

it('converges simultaneous same-key generation without overwriting the first persisted public frame', async () => {
  const f = fixture(); let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; }); let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }); let calls = 0;
  const session = f.session({ draftArchitect: async (_subject, input) => { const index = ++calls; if (index === 1) { entered(); await held; }
    const output = architecture(input); output.frame.title = `Generated ${index}`; return output;
  } });
  const first = session.generateDraft(participant(), 'garden', generate); await started;
  const second = await session.generateDraft(participant(), 'garden', generate); release(); expect(await first).toEqual(second);
  expect(second.frame.title).toBe('Generated 2'); expect(f.get('GROUP#garden/STATE').value.draftIds).toEqual([second.id]);
  expect(f.commits.flat().filter(value => value.next?.kind === 'DRAFT')).toHaveLength(1);
});

it('does not repeat generation after an unknown applied commit and reconciles a fresh explicit replay without a model call', async () => {
  const f = fixture(); let calls = 0; let commits = 0; f.afterCommit(() => { if (++commits === 2) throw new Error('PRIVATE_DRAFT_GENERATION_RESPONSE'); });
  const session = f.session({ draftArchitect: async (_subject, input) => { calls++; return architecture(input); } });
  await expect(session.generateDraft(participant(), 'garden', generate)).rejects.toThrow('SESSION_STORAGE_UNAVAILABLE');
  expect(f.commits).toHaveLength(2); expect(f.get('GROUP#garden/STATE').value.draftIds).toHaveLength(1);
  const replay = await session.generateDraft(participant(), 'garden', generate); expect(replay.revision).toBe(1); expect(calls).toBe(1);
  expect(f.commits.flat().filter(value => value.next?.kind === 'DRAFT')).toHaveLength(1);
});

it('shares request and timeout bounds with the architect and prevents late persistence', async () => {
  const f = fixture(); let calls = 0; const session = f.session({ draftArchitect: async (_subject, input) => { calls++; return architecture(input); } });
  await expect(session.generateDraft(participant(), 'garden', generate, partitionIO({ maxRequests: 5 }))).rejects.toThrow('SESSION_REQUEST_LIMIT');
  expect(calls).toBe(0);
  const timed = fixture(); let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  await expect(timed.session({ timeoutMs: 20, draftArchitect: async (_subject, input) => { await held; return architecture(input); } })
    .generateDraft(participant(), 'garden', generate)).rejects.toThrow('SESSION_TIMEOUT');
  release(); await new Promise<void>(resolve => setTimeout(resolve, 1)); expect(timed.get('GROUP#garden/STATE').value.draftIds).toEqual([]);
  expect(timed.commits).toHaveLength(1);
});

it('retains the eight unresolved architect slots after timeout until their actual provider promises settle', async () => {
  const f = fixture(); let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; }); let entered = 0;
  const session = f.session({ timeoutMs: 60, draftArchitect: async (_subject, input) => { entered++; await held; return architecture(input); } });
  const outcomes = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => session.generateDraft(participant(), 'garden', { ...generate, idempotencyKey: `held-${index}` })));
  expect(outcomes.every(value => value.status === 'rejected')).toBe(true); expect(entered).toBe(8);
  await expect(session.generateDraft(participant(), 'garden', generate)).rejects.toThrow('SESSION_CAPACITY'); expect(entered).toBe(8);
  release(); await new Promise<void>(resolve => setTimeout(resolve, 1)); expect(f.get('GROUP#garden/STATE').value.draftIds).toEqual([]);
  const fresh = await session.generateDraft(participant(), 'garden', generate); expect(fresh.revision).toBe(1); expect(entered).toBe(9);
});


it('checks draft capacity before an architect call and again if another request fills the group while it is pending', async () => {
  function fill(f: ReturnType<typeof fixture>) {
    const draft = seedDraft(f); const ids = Array.from({ length: 64 }, (_, index) => `retained-${index}`);
    for (const id of ids) f.rows.set(`GROUP#garden/DRAFT#${id}`, { schemaVersion: 1, kind: 'DRAFT', revision: 1, value: { ...draft, id } });
    f.get('GROUP#garden/STATE').value.draftIds = ids; f.get('GROUP#garden/STATE').revision++;
  }
  const full = fixture(); fill(full); let calls = 0;
  await expect(full.session({ draftArchitect: async (_subject, input) => { calls++; return architecture(input); } }).generateDraft(participant(), 'garden', generate))
    .rejects.toThrow('SESSION_CAPACITY'); expect(calls).toBe(0); expect(full.commits).toEqual([]);
  const raced = fixture(); await expect(raced.session({ draftArchitect: async (_subject, input) => { fill(raced); return architecture(input); } })
    .generateDraft(participant(), 'garden', generate)).rejects.toThrow('SESSION_CAPACITY');
  expect(raced.get('GROUP#garden/STATE').value.draftIds).toHaveLength(64); expect(raced.commits).toHaveLength(1);
});


it('prepares draft creation without a reservation write and exposes only a server-side atomic bundle', async () => {
  const f = fixture(); const draft = seedDraft(f, { clarificationQuestions: [] });
  const prepared = await f.session().prepareDraftCreation(participant(), 'garden', draft.id, { revision: 1 });
  expect(prepared.created).toBe(false); expect(prepared.definition.decisionId).toMatch(/^groupdecision-[a-f0-9]{40}$/);
  expect(prepared.creationBodyHash).toMatch(/^[a-f0-9]{64}$/);
  expect(prepared.memberships.map(member => member.subject)).toEqual(['iris', 'omar']);
  expect(f.commits).toEqual([]); expect(f.get('GROUP#garden/DRAFT#draft-one').value.createdDecisionId).toBeNull();
  expect(prepared.fence.mutations.filter(item => item.next).map(item => item.next!.kind).sort()).toEqual(['BINDING', 'DIRECTORY', 'DRAFT', 'GROUP']);
  expect(prepared.fence.mutations.filter(item => item.key.PK.startsWith('ACCOUNT#')).every(item => item.next === null)).toBe(true);
  await f.transport.commit(prepared.fence.mutations);
  const replay = await f.session().prepareDraftCreation(participant(), 'garden', draft.id, { revision: 1 });
  expect(replay.created).toBe(true); expect(replay.creationBodyHash).toBe(prepared.creationBodyHash);
  expect(replay.fence.mutations.every(item => item.next === null)).toBe(true);
});

it('rejects untrusted identity and malformed draft-creation commands before storage', async () => {
  const f = fixture(); const session = f.session();
  await expect(session.prepareDraftCreation(null, 'garden', 'draft-one', { revision: 1 })).rejects.toThrow('FORBIDDEN');
  for (const raw of [{ revision: 0 }, { revision: 1, subject: 'iris' }, { revision: Number.MAX_SAFE_INTEGER + 1 }])
    await expect(session.prepareDraftCreation(participant(), 'garden', 'draft-one', raw)).rejects.toThrow('INVALID_COMMAND');
  expect(f.reads).toEqual([]); expect(f.commits).toEqual([]);
});

it('requires current exact draft revision, all approved roster names and an approved organizer', async () => {
  for (const mismatch of ['revision', 'version', 'name', 'participant', 'required', 'disabled', 'organizer'] as const) {
    const f = fixture(); const draft = seedDraft(f, { clarificationQuestions: [] });
    const row = f.get('GROUP#garden/DRAFT#draft-one').value as unknown as Groups.GroupDraft;
    if (mismatch === 'revision') row.revision = 2;
    if (mismatch === 'version') row.groupVersion = 2;
    if (mismatch === 'name') row.frame.participants[0]!.displayName = 'Other';
    if (mismatch === 'participant') row.frame.participants[0]!.id = 'other';
    if (mismatch === 'required') row.frame.requiredParticipantIds = [];
    if (mismatch === 'disabled') f.get('ACCOUNT#omar/STATE').value.status = 'DISABLED';
    await expect(f.session().prepareDraftCreation(participant(mismatch === 'organizer' ? 'omar' : 'iris'), 'garden', draft.id, { revision: 1 }))
      .rejects.toThrow(['disabled', 'organizer'].includes(mismatch) ? 'FORBIDDEN' : ['participant', 'required'].includes(mismatch) ? 'SESSION_INVALID' : 'STALE_CONTEXT');
    expect(f.commits).toEqual([]);
  }
});

it('retains clarification and incomplete public catalog gates before locking a draft', async () => {
  for (const unresolved of [true, false]) {
    const f = fixture(); const draft = seedDraft(f, { clarificationQuestions: unresolved ? ['Confirm choices.'] : [] });
    if (!unresolved) (f.get('GROUP#garden/DRAFT#draft-one').value as unknown as Groups.GroupDraft).frame.variables = [];
    await expect(f.session().prepareDraftCreation(participant(), 'garden', draft.id, { revision: 1 })).rejects.toThrow('NEEDS_CLARIFICATION');
    expect(f.commits).toEqual([]);
  }
});

it('detects account or draft changes against the pending creation fence without an early reservation', async () => {
  for (const target of ['ACCOUNT#omar/STATE', 'GROUP#garden/STATE']) {
    const f = fixture(); const draft = seedDraft(f, { clarificationQuestions: [] });
    const prepared = await f.session().prepareDraftCreation(participant(), 'garden', draft.id, { revision: 1 });
    f.get(target).revision++;
    await expect(prepared.fence.assertCurrent()).rejects.toThrow('STALE_CONTEXT');
    expect(await f.transport.commit(prepared.fence.mutations)).toBe(false);
    expect(f.get('GROUP#garden/DRAFT#draft-one').value.createdDecisionId).toBeNull();
  }
});


it('rejects a full decision binding set and inconsistent retained draft identity without a write', async () => {
  const full = fixture(); const draft = seedDraft(full, { clarificationQuestions: [] });
  const ids = Array.from({ length: 64 }, (_, i) => `bound-${i}`); full.get('GROUP#garden/STATE').value.decisionIds = ids;
  for (const id of ids) full.rows.set(`GROUP#garden/BINDING#${id}`, { schemaVersion: 1, kind: 'BINDING', revision: 1, value: { id, version: 1 } });
  await expect(full.session().prepareDraftCreation(participant(), 'garden', draft.id, { revision: 1 })).rejects.toThrow('SESSION_CAPACITY');
  expect(full.commits).toEqual([]);
  const retained = fixture(); const wrong = seedDraft(retained, { clarificationQuestions: [], createdDecisionId: 'decision' });
  await expect(retained.session().prepareDraftCreation(participant(), 'garden', wrong.id, { revision: 1 })).rejects.toThrow('STALE_CONTEXT');
  expect(retained.commits).toEqual([]);
});

it('prepares explicit organizer roster recovery without admitting a stale binding or committing it early', async () => {
  const f = fixture(); const header = f.get('GROUP#garden/STATE'); header.value.version = 2; header.value.members = ['iris']; header.revision++;
  await expect(f.session().decisionFence(participant(), 'decision')).rejects.toThrow('STALE_CONTEXT');
  const review = await f.session().prepareRoster(participant(), 'garden', 'decision');
  expect(review.version).toBe(2); expect(review.members).toEqual([{ subject: 'iris', participantId: partitionMemberId('iris'), displayName: 'IRIS' }]);
  expect(review.fence.mutations.every(item => item.next === null)).toBe(true);
  const revision = await f.session().prepareRoster(participant(), 'garden', 'decision', 2);
  expect(revision.fence.mutations.filter(item => item.next).map(item => item.next!.kind).sort()).toEqual(['BINDING', 'GROUP']);
  expect(f.get('GROUP#garden/BINDING#decision').value.version).toBe(1); expect(f.commits).toEqual([]);
});

it('requires fresh organizer, exact directory/group and approved current roster for recovery', async () => {
  const f = fixture();
  await expect(f.session().prepareRoster(participant('omar'), 'garden', 'decision')).rejects.toThrow('FORBIDDEN');
  await expect(f.session().prepareRoster(participant(), 'other', 'decision')).rejects.toThrow('NOT_FOUND');
  f.get('ACCOUNT#omar/STATE').value.status = 'DISABLED'; f.get('ACCOUNT#omar/STATE').revision++;
  await expect(f.session().prepareRoster(participant(), 'garden', 'decision')).rejects.toThrow('FORBIDDEN');
  expect(f.commits).toEqual([]);
});

it('checks safe positive roster versions before reads and preserves supplied request accounting', async () => {
  const f = fixture();
  for (const version of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) await expect(f.session().prepareRoster(participant(), 'garden', 'decision', version)).rejects.toThrow('INVALID_COMMAND');
  expect(f.reads).toEqual([]);
  await expect(f.session().prepareRoster(participant(), 'garden', 'decision', 2)).rejects.toThrow('STALE_CONTEXT');
  const io = partitionIO({ maxRequests: 1 });
  await expect(f.session().prepareRoster(participant(), 'garden', 'decision', undefined, io)).rejects.toThrow('SESSION_REQUEST_LIMIT');
  expect(f.commits).toEqual([]);
});

it('rechecks all pending roster revisions on account/header/binding changes without applying the update', async () => {
  for (const key of ['ACCOUNT#iris/STATE', 'GROUP#garden/STATE', 'GROUP#garden/BINDING#decision']) {
    const f = fixture(); const header = f.get('GROUP#garden/STATE'); header.value.version = 2; header.revision++;
    const prepared = await f.session().prepareRoster(participant(), 'garden', 'decision', 2);
    f.get(key).revision++;
    await expect(prepared.fence.assertCurrent()).rejects.toThrow('STALE_CONTEXT');
    expect(f.get('GROUP#garden/BINDING#decision').value.version).toBe(1); expect(f.commits).toEqual([]);
  }
});
