import { createServer, request as httpRequest, type Server } from 'node:http';
import { createHash, createHmac } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { TransactGetItemsCommand, type TransactWriteItem, type AttributeValue } from '@aws-sdk/client-dynamodb';
import { Groups, KnownEnough as KE } from '@deal-table/contracts';
import { KnownEnoughApplication, type TrustedPrincipal, type DecisionArchitectRequest, type DecisionArchitectureDraft } from '@deal-table/application';
import { InMemoryRoomRepository } from '@deal-table/adapters';
import { preparePartitionMigration } from '../../../packages/adapters/src/partition-migration.ts';
import { partitionMemberId } from '../../../packages/adapters/src/partition-group-session.ts';
import { createPartitionDecisionRepository, PARTITION_DECISION_TARGET, type PartitionDecisionTransport } from '@deal-table/adapters/partition-request';
import type { PartitionTransport } from '@deal-table/adapters/partition-request';
import { decodeDecisionStateItem } from '../../../packages/adapters/src/dynamodb-codec.ts';
import { createPartitionParticipantApiHandler, type PartitionParticipantApiOptions } from './partition-http.ts';

type Item = Record<string, AttributeValue>;
const actor = (subject = 'iris'): TrustedPrincipal => ({ kind: 'participant', subject });
const target = PARTITION_DECISION_TARGET;
const where = (table: string, key: Item) => `${table}/${key.PK!.S}/${key.SK!.S}`;
const cancellation = () => Object.assign(new Error('synthetic cancellation'), { name: 'TransactionCanceledException', CancellationReasons: [{ Code: 'ConditionalCheckFailed' }] });

const syntheticEmailKey = 'q'.repeat(64);
async function fixture(emailKey?: string) {
  const account = (subject: string): Groups.Account => ({ subject, displayName: subject.toUpperCase(), status: 'APPROVED', version: 1,
    emailHash: emailKey ? createHmac('sha256', emailKey).update(`${subject}@example.invalid`).digest('hex') : createHash('sha256').update(subject).digest('hex') });
  const group: Groups.Group = { id: 'garden', name: 'Garden', organizer: 'iris', members: ['iris', 'omar'], version: 1,
    drafts: [], invitations: [], decisions: [{ id: 'decision', version: 1 }] };
  const plan = preparePartitionMigration(Buffer.from(JSON.stringify({ accounts: ['iris', 'omar', ...(emailKey ? ['luca'] : [])].map(account), groups: [group] })), 1, 'a'.repeat(40));
  const cells = new Map<string, Item>();
  for (const item of plan.batches.flat()) if (item.next) {
    const key = { PK: { S: item.key.PK }, SK: { S: item.key.SK } };
    cells.set(where(target.partitionArn, key), { ...key, revision: { N: String(item.next.revision) }, payload: { S: JSON.stringify(item.next) } });
  }
  const groupKey = { PK: { S: 'GROUP#garden' }, SK: { S: 'STATE' } };
  const groupLocation = where(target.partitionArn, groupKey);
  let beforeGroupCommit: () => void = () => {}; let afterGroupCommit: () => void = () => {};
  const groupCommits: unknown[][] = [];
  const stateKey = { PK: { S: 'ROOM#decision' }, SK: { S: 'STATE' } };
  const stateLocation = where(target.decisionArn, stateKey);
  function change(pk: string, update: (value: Record<string, unknown>) => void) {
    const key = { PK: { S: pk }, SK: { S: 'STATE' } }; const location = where(target.partitionArn, key); const cell = cells.get(location)!;
    const row = JSON.parse(cell.payload!.S!) as { revision: number; value: Record<string, unknown> };
    update(row.value); row.revision++; cells.set(location, { ...cell, revision: { N: String(row.revision) }, payload: { S: JSON.stringify(row) } });
  }
  const groups: PartitionTransport = {
    read: async key => { const cell = cells.get(`${target.partitionArn}/${key.PK}/${key.SK}`); return cell ? JSON.parse(cell.payload!.S!) : null; },
    readMany: async keys => keys.map(key => { const cell = cells.get(`${target.partitionArn}/${key.PK}/${key.SK}`); return cell ? JSON.parse(cell.payload!.S!) : null; }),
    commit: async changes => {
      groupCommits.push(structuredClone(changes)); beforeGroupCommit();
      if (!changes.every(item => Number(cells.get(`${target.partitionArn}/${item.key.PK}/${item.key.SK}`)?.revision?.N ?? 0) === item.expected)) return false;
      for (const item of changes) if (item.next) {
        const key = { PK: { S: item.key.PK }, SK: { S: item.key.SK } };
        cells.set(where(target.partitionArn, key), { ...key, revision: { N: String(item.next.revision) }, payload: { S: JSON.stringify(item.next) } });
      }
      afterGroupCommit();
      return true;
    },
  };
  const writes: TransactWriteItem[][] = []; const reads: TransactGetItemsCommand[] = []; let beforeWrite: () => void = () => {};
  let afterWrite: () => void = () => {}; let beforeRead: () => Promise<void> | void = () => {};
  function matches(entry: TransactWriteItem) {
    const value = entry.ConditionCheck ?? entry.Put ?? entry.Update!; const key = 'Item' in value ? value.Item! : value.Key!;
    const old = cells.get(where(value.TableName!, key)); const condition = value.ConditionExpression;
    if (condition?.startsWith('attribute_not_exists')) return !old;
    if (condition?.startsWith('attribute_exists')) return !!old;
    return (condition?.split(' AND ') ?? []).every(expression => {
      const [left, right] = expression.split('=').map(part => part.trim()); const field = value.ExpressionAttributeNames?.[left!] ?? left!;
      return JSON.stringify(old?.[field]) === JSON.stringify(value.ExpressionAttributeValues?.[right!]);
    });
  }
  const transport: PartitionDecisionTransport = { send: async (command, context) => {
    expect(context.signal).toBeDefined();
    if (command instanceof TransactGetItemsCommand) { reads.push(command); await beforeRead();
      return { Responses: command.input.TransactItems!.map(entry => ({ Item: structuredClone(cells.get(where(entry.Get!.TableName!, entry.Get!.Key!))) })) };
    }
    const items = command.input.TransactItems!; writes.push(structuredClone(items)); beforeWrite();
    if (!items.every(matches)) throw cancellation();
    for (const entry of items) {
      if (entry.Put) cells.set(where(entry.Put.TableName!, entry.Put.Item!), structuredClone(entry.Put.Item!));
      if (entry.Update) {
        const update = entry.Update; const location = where(update.TableName!, update.Key!); const cell = structuredClone(cells.get(location)!);
        for (const expression of update.UpdateExpression!.slice(4).split(',')) {
          const [name, value] = expression.split('=').map(part => part.trim()); cell[update.ExpressionAttributeNames![name!]!] = structuredClone(update.ExpressionAttributeValues![value!]!);
        }
        cells.set(location, cell);
      }
    }
    afterWrite(); return {};
  } };
  const memory = new InMemoryRoomRepository(); const participants = ['iris', 'omar'].map(subject => ({ id: partitionMemberId(subject), displayName: subject.toUpperCase(), requiredForApproval: true }));
  const definition = KE.DecisionDefinition.parse({ schemaVersion: KE.KE_SCHEMA_VERSION, decisionId: 'decision', frameVersion: 1, semanticVersion: 1,
    contextToken: 'c'.repeat(64), title: 'Garden gathering', objective: 'Choose together', description: '', participants,
    requiredParticipantIds: participants.map(person => person.id), variables: [], rules: [] });
  const application = new KnownEnoughApplication({ repository: memory, clock: { now: () => '2026-10-07T15:00:00Z' }, ids: { next: () => 'synthetic' } });
  await application.createDecision({ definition, creatorSubject: 'iris', memberships: ['iris', 'omar'].map(subject => ({ subject, participantId: partitionMemberId(subject), active: true })) });
  const initial = await memory.transactionDecision('decision', value => structuredClone(value!));
  const factory = (options: Partial<Parameters<typeof createPartitionDecisionRepository>[0]> = {}) => createPartitionDecisionRepository({ ...target, groups, transport, ...options });
  const current = () => decodeDecisionStateItem(cells.get(stateLocation), 'decision');
  return { emailKey, groups, transport, cells, writes, reads, initial, factory, current, groupLocation, stateLocation, change, groupCommits,
    beforeGroupCommit: (work: typeof beforeGroupCommit) => { beforeGroupCommit = work; }, afterGroupCommit: (work: typeof afterGroupCommit) => { afterGroupCommit = work; },
    beforeWrite: (work: typeof beforeWrite) => { beforeWrite = work; }, afterWrite: (work: typeof afterWrite) => { afterWrite = work; }, beforeRead: (work: typeof beforeRead) => { beforeRead = work; } };
}


const servers: Server[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }))); });
async function api(f: Awaited<ReturnType<typeof fixture>>, overrides: Partial<PartitionParticipantApiOptions> = {}) {
  const options: PartitionParticipantApiOptions = { ...target, groups: f.groups, decisions: f.transport,
    ...(f.emailKey === undefined ? {} : { emailKey: f.emailKey }),
    authenticate: async request => request.headers.authorization === 'Bearer iris' ? actor('iris')
      : request.headers.authorization === 'Bearer omar' ? actor('omar') : f.emailKey && request.headers.authorization === 'Bearer luca' ? actor('luca') : null,
    clock: { now: () => '2026-10-07T15:00:00Z' }, ids: { next: () => 'synthetic' },
    allowedOrigins: ['https://known.example.invalid'], ...overrides };
  const server = createServer(createPartitionParticipantApiHandler(options)); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Expected ephemeral TCP address');
  const base = `http://127.0.0.1:${address.port}`;
  const get = (path: string, subject = 'iris', headers: Record<string, string> = {}) => fetch(base + path, { headers: { authorization: `Bearer ${subject}`, ...headers } });
  const post = (path: string, value: unknown, subject = 'iris', headers: Record<string, string> = {}) => fetch(base + path, {
    method: 'POST', headers: { authorization: `Bearer ${subject}`, 'content-type': 'application/json', ...headers }, body: JSON.stringify(value) });
  return { base, options, get, post };
}
async function seed(f: Awaited<ReturnType<typeof fixture>>) { await f.factory().forParticipant(actor()).createDecision(f.initial); f.writes.length = 0; f.reads.length = 0; }
function command(owner: KE.OwnerDecisionSnapshot, id = 'frame-iris'): KE.DecisionCommand {
  return { schemaVersion: KE.KE_SCHEMA_VERSION, type: 'CONFIRM_FRAME', requestId: id, decisionId: 'decision', idempotencyKey: id,
    expected: { contextToken: owner.publicSnapshot.contextToken, semanticVersion: owner.publicSnapshot.semanticVersion,
      controlVersion: owner.controlVersion, ownerVersion: owner.ownerVersion }, payload: { frameVersion: owner.publicSnapshot.frame.frameVersion } };
}

it('creates and replays a group through the trusted participant HTTP boundary with strict public fields', async () => {
  const f = await fixture(); const a = await api(f); const raw = { name: '  Garden two  ', idempotencyKey: 'create-garden' };
  const response = await a.post('/groups', raw); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  const value = (await response.json()).group;
  expect(value).toMatchObject({ name: 'Garden two', version: 1, isOrganizer: true, drafts: [], decisions: [], pendingInvitations: 0 });
  expect(value.members).toEqual([{ id: partitionMemberId('iris'), displayName: 'IRIS', isOrganizer: true }]);
  expect(JSON.stringify(value)).not.toMatch(/subject|emailHash|tokenHash|ACCOUNT#|MEMBER#|revision/);
  const replay = await a.post('/groups', raw); expect(replay.status).toBe(200); expect(await replay.json()).toEqual({ group: value });
  expect((await a.post('/groups', { ...raw, name: 'Changed' })).status).toBe(409);
  const other = await a.post('/groups', raw, 'omar'); expect(other.status).toBe(200); expect((await other.json()).group.id).not.toBe(value.id);
  expect(f.writes).toEqual([]); expect(f.reads).toEqual([]);
});

it('rejects creation impersonation and malformed bodies, and rechecks account approval at the actual group commit', async () => {
  const f = await fixture(); const a = await api(f); const raw = { name: 'Garden', idempotencyKey: 'create' };
  const originalKeys = [...f.cells.keys()].sort();
  expect((await a.post('/groups', raw, 'unknown', { 'x-subject': 'iris' })).status).toBe(401);
  expect((await a.post('/groups', { ...raw, organizer: 'omar' })).status).toBe(422);
  expect(f.groupCommits).toEqual([]);
  let once = true; f.beforeGroupCommit(() => { if (once) { once = false; f.change('ACCOUNT#iris', value => { value.status = 'DISABLED'; }); } });
  const response = await a.post('/groups', raw); expect(response.status).toBe(403); expect(f.groupCommits).toHaveLength(1);
  expect([...f.cells.keys()].sort()).toEqual(originalKeys);
  expect(f.writes).toEqual([]);
});

it('returns a sanitized unknown creation result without retry and allows explicit HTTP replay of its committed group', async () => {
  const f = await fixture(); const a = await api(f); let once = true;
  f.afterGroupCommit(() => { if (once) { once = false; throw new Error('PRIVATE_GROUP_COMMIT_DIAGNOSTIC'); } });
  const raw = { name: 'Garden', idempotencyKey: 'create' }; const response = await a.post('/groups', raw);
  expect(response.status).toBe(503); expect(await response.text()).not.toContain('PRIVATE'); expect(f.groupCommits).toHaveLength(1);
  const replay = await a.post('/groups', raw); expect(replay.status).toBe(200); const value = (await replay.json()).group;
  expect(f.groupCommits).toHaveLength(2);
  const location = `${target.partitionArn}/GROUP#${value.id}/STATE`; expect(f.cells.get(location)?.revision?.N).toBe('1');
});

it('registers only the trusted verified subject profile and never upgrades pending admission on replay', async () => {
  const f = await fixture(syntheticEmailKey); const a = await api(f, { authenticate: async () => actor('new'),
    registrationProfile: async () => ({ subject: 'new', email: ' NEW@example.invalid ', verified: true }) });
  const response = await a.post('/account/register', { displayName: ' New owner ' }); expect(response.status).toBe(200);
  const value = await response.json(); expect(value).toEqual({ account: { status: 'PENDING', displayName: 'New owner', version: 1 } });
  expect(JSON.stringify(value)).not.toMatch(/subject|email|hash|revision/);
  expect(await (await a.post('/account/register', { displayName: 'Other' })).json()).toEqual(value);
  expect((await a.post('/groups', { name: 'Garden', idempotencyKey: 'create' })).status).toBe(403);
  expect(response.headers.get('cache-control')).toBe('no-store');
});

it('fails closed on missing, mismatched, unverified and failed profile providers and rejects caller profile/approval fields', async () => {
  const f = await fixture(syntheticEmailKey); const reads = vi.spyOn(f.groups, 'readMany');
  const absent = await api(f); expect((await absent.post('/account/register', { displayName: 'New', email: 'iris@example.invalid' })).status).toBe(403);
  for (const profile of [null, { subject: 'other', email: 'iris@example.invalid', verified: true }, { subject: 'iris', email: 'iris@example.invalid', verified: false }]) {
    const a = await api(f, { registrationProfile: async () => profile }); expect((await a.post('/account/register', { displayName: 'New' })).status).toBe(403);
  }
  const throwing = await api(f, { registrationProfile: async () => { throw new Error('PRIVATE_PROFILE_DIAGNOSTIC'); } });
  const failed = await throwing.post('/account/register', { displayName: 'New' }); expect(failed.status).toBe(403); expect(await failed.text()).not.toContain('PRIVATE');
  const valid = await api(f, { registrationProfile: async () => ({ subject: 'iris', email: 'iris@example.invalid', verified: true }) });
  expect((await valid.post('/account/register', { displayName: 'New', status: 'APPROVED', subject: 'other' })).status).toBe(422);
  expect(reads).not.toHaveBeenCalled(); expect(f.groupCommits).toEqual([]);
});

it('keeps unresolved registration providers within the shared authentication limit and performs no late storage after timeout', async () => {
  const f = await fixture(syntheticEmailKey); const reads = vi.spyOn(f.groups, 'readMany');
  let release!: (profile: { subject: string; email: string; verified: boolean }) => void;
  const held = new Promise<{ subject: string; email: string; verified: boolean }>(resolve => { release = resolve; });
  const provider = vi.fn(async () => held); const a = await api(f, { authTimeoutMs: 20, maxConcurrentRequests: 1, registrationProfile: provider });
  const response = await a.post('/account/register', { displayName: 'New' }); expect(response.status).toBe(503); expect(provider).toHaveBeenCalledTimes(1);
  expect((await a.get('/account')).status).toBe(503); expect(reads).not.toHaveBeenCalled(); expect(f.groupCommits).toEqual([]);
  release({ subject: 'iris', email: 'iris@example.invalid', verified: true }); await new Promise<void>(resolve => setTimeout(resolve, 1));
  expect(reads).not.toHaveBeenCalled(); expect(f.groupCommits).toEqual([]); expect((await a.get('/account')).status).toBe(200);
});

it('returns invitation secrets only to the organizer and binds HTTP acceptance/replay/removal to the intended current account', async () => {
  const f = await fixture(syntheticEmailKey); const a = await api(f, { invitationToken: () => 'a'.repeat(43) });
  expect((await a.post('/groups/garden/invite', { email: 'luca@example.invalid', replace: false }, 'omar')).status).toBe(403);
  const response = await a.post('/groups/garden/invite', { email: 'luca@example.invalid', replace: false }); expect(response.status).toBe(200);
  const invitation = (await response.json()).invitation; expect(invitation.delivery).toBe('COPY_LINK'); expect(invitation.token).toBe('a'.repeat(43));
  expect(await (await a.get('/groups/garden')).text()).not.toMatch(/a{43}|tokenHash|recipientHash|emailHash/);
  expect((await a.post('/groups/accept', { token: invitation.token }, 'omar')).status).toBe(404);
  const joined = await a.post('/groups/accept', { token: invitation.token }, 'luca'); expect(joined.status).toBe(200); const group = (await joined.json()).group;
  expect(group.version).toBe(2); expect(group.members).toHaveLength(3);
  expect(await (await a.post('/groups/accept', { token: invitation.token }, 'luca')).json()).toEqual({ group });
  expect((await a.post('/groups/garden/remove', { memberId: partitionMemberId('luca'), version: 2 })).status).toBe(200);
  expect((await a.post('/groups/accept', { token: invitation.token }, 'luca')).status).toBe(404);
  expect((await a.get('/decisions/decision/public')).status).toBe(409);
});

it('rechecks recipient disable at the actual HTTP join and sanitizes an unknown applied join without automatic retry', async () => {
  for (const change of ['disabled', 'unknown'] as const) {
    const f = await fixture(syntheticEmailKey); const a = await api(f, { invitationToken: () => 'a'.repeat(43) });
    const invitation = (await (await a.post('/groups/garden/invite', { email: 'luca@example.invalid', replace: false })).json()).invitation;
    let once = true;
    if (change === 'disabled') f.beforeGroupCommit(() => { if (once) { once = false; f.change('ACCOUNT#luca', value => { value.status = 'DISABLED'; }); } });
    else f.afterGroupCommit(() => { if (once) { once = false; throw new Error('PRIVATE_JOIN_DIAGNOSTIC'); } });
    const before = f.groupCommits.length; const response = await a.post('/groups/accept', { token: invitation.token }, 'luca');
    expect(response.status).toBe(change === 'disabled' ? 403 : 503); expect(await response.text()).not.toContain('PRIVATE'); expect(f.groupCommits).toHaveLength(before + 1);
    if (change === 'disabled') expect([...f.cells.keys()].some(key => key.endsWith('/MEMBER#luca/GROUP#garden'))).toBe(false);
    else { const retry = await a.post('/groups/accept', { token: invitation.token }, 'luca'); expect(retry.status).toBe(200); expect((await retry.json()).group.version).toBe(2); }
  }
});

it('rejects malformed invitation/acceptance envelopes and missing HMAC configuration without revealing provider or directory data', async () => {
  const f = await fixture(syntheticEmailKey); const a = await api(f);
  expect((await a.post('/groups/garden/invite', { email: 'bad', replace: false })).status).toBe(422);
  expect((await a.post('/groups/garden/invite', { email: 'luca@example.invalid', replace: false, organizer: 'iris' })).status).toBe(422);
  expect((await a.post('/groups/accept', { token: 'short' }, 'luca')).status).toBe(422);
  expect(f.groupCommits).toEqual([]);
  const noKey = await api(await fixture()); const response = await noKey.post('/groups/garden/invite', { email: 'luca@example.invalid', replace: false });
  expect(response.status).toBe(503); expect(await response.text()).not.toMatch(/email|INVITATION#|recipientHash/);
});

it('uses only the injected verified participant resolver and rejects wire impersonation before any storage', async () => {
  const f = await fixture(); const read = vi.spyOn(f.groups, 'readMany'); const a = await api(f);
  const unauthenticated = await a.get('/account', 'unknown', { 'x-deal-table-test-identity': 'NON_PRODUCTION iris', 'x-subject': 'iris' });
  expect(unauthenticated.status).toBe(401); expect(await unauthenticated.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
  expect(read).not.toHaveBeenCalled(); expect(f.reads).toEqual([]);
  for (const principal of [{ kind: 'display', subject: 'iris', roomId: 'decision' }, { kind: 'service', subject: 'iris', roomIds: ['decision'] },
    { kind: 'participant', subject: '../iris' }] as TrustedPrincipal[]) {
    const denied = await api(f, { authenticate: async () => principal }); expect((await denied.get('/account')).status).toBe(403);
  }
  const throwing = await api(f, { authenticate: async () => { throw new Error('PRIVATE_AUTH_DIAGNOSTIC'); } });
  const result = await throwing.get('/account'); expect(result.status).toBe(401); expect(await result.text()).not.toContain('PRIVATE'); expect(read).not.toHaveBeenCalled();
});

it('returns strict public group/account snapshots and keeps organizer removal versioned and atomic', async () => {
  const f = await fixture(); const a = await api(f);
  const account = await a.get('/account'); expect(await account.json()).toEqual({ account: { status: 'APPROVED', displayName: 'IRIS', version: 1 } });
  const groupResponse = await a.get('/groups/garden'); const group = (await groupResponse.json()).group;
  expect(group.members.map((member: { id: string }) => member.id)).toEqual([partitionMemberId('iris'), partitionMemberId('omar')]);
  expect(JSON.stringify(group)).not.toMatch(/subject|emailHash|ACCOUNT#|GROUP#|revision/);
  const body = { memberId: partitionMemberId('omar'), version: 1 };
  expect((await a.post('/groups/garden/remove', body, 'omar')).status).toBe(403);
  expect((await a.post('/groups/garden/remove', { ...body, version: 2 })).status).toBe(409);
  expect((await a.post('/groups/garden/remove', body)).status).toBe(200);
  expect((await a.get('/groups/garden', 'omar')).status).toBe(404);
  const edge = f.cells.get(`${target.partitionArn}/MEMBER#omar/GROUP#garden`)!;
  expect(JSON.parse(edge.payload!.S!)).toMatchObject({ value: { active: false } });
});

it('serves authenticated owner views concurrently without cross-request subject substitution or public private drafts', async () => {
  const f = await fixture(); await seed(f); const applications = ['iris', 'omar'].map(subject => new KnownEnoughApplication({
    repository: f.factory().forParticipant(actor(subject)), clock: { now: () => '2026-10-07T15:00:00Z' }, ids: { next: () => 'synthetic' } }));
  for (const [index, subject] of ['iris', 'omar'].entries()) {
    const application = applications[index]!; const owner = await application.getOwnerSnapshot(actor(subject), 'decision');
    expect((await application.execute(actor(subject), command(owner, `frame-${subject}`))).ok).toBe(true);
    const confirmed = await application.getOwnerSnapshot(actor(subject), 'decision');
    await application.storeConstraintDraft({ kind: 'service', subject: 'synthetic-worker', roomIds: ['decision'] }, {
      schemaVersion: KE.KE_SCHEMA_VERSION, draftId: `private-${subject}`, draftVersion: 1, decisionId: 'decision',
      ownerParticipantId: partitionMemberId(subject), ownerVersion: confirmed.ownerVersion, semanticVersion: confirmed.publicSnapshot.semanticVersion,
      contextToken: confirmed.publicSnapshot.contextToken, sourceSummary: `PRIVATE_${subject.toUpperCase()}`, proposedConstraints: [], unsupportedConditions: [],
      createdAt: '2026-10-07T15:00:00.000Z' });
  }
  const a = await api(f); const [iris, omar] = await Promise.all([a.get('/decisions/decision/me'), a.get('/decisions/decision/me', 'omar')]);
  expect(iris.status).toBe(200); expect(omar.status).toBe(200);
  const first = await iris.json(); const second = await omar.json();
  expect(first.ownerParticipantId).toBe(partitionMemberId('iris')); expect(first.draft.sourceSummary).toBe('PRIVATE_IRIS');
  expect(second.ownerParticipantId).toBe(partitionMemberId('omar')); expect(second.draft.sourceSummary).toBe('PRIVATE_OMAR');
  expect(JSON.stringify(first)).not.toContain('PRIVATE_OMAR'); expect(JSON.stringify(second)).not.toContain('PRIVATE_IRIS');
  const publicResponse = await a.get('/decisions/decision/public'); expect(publicResponse.status).toBe(200);
  expect(await publicResponse.text()).not.toMatch(/PRIVATE_(IRIS|OMAR)|emailHash|tokenHash|creatorSubject|ACCOUNT#|GROUP#/);
});

it('preserves the actual command envelope, stale checks and replay across independently reconstructed requests', async () => {
  const f = await fixture(); await seed(f); const a = await api(f);
  const owner = await (await a.get('/decisions/decision/me')).json(); const request = command(owner);
  const first = await a.post('/decisions/decision/commands', request); expect(first.status).toBe(200); const receipt = await first.json(); expect(receipt.ok).toBe(true);
  const current = structuredClone(f.current()); const replay = await a.post('/decisions/decision/commands', request);
  expect(await replay.json()).toEqual(receipt); expect(f.current()).toEqual(current);
  const stale = await a.post('/decisions/decision/commands', { ...request, requestId: 'new-frame', idempotencyKey: 'new-frame' });
  expect(stale.status).toBe(409); expect(await stale.json()).toMatchObject({ error: { code: 'STALE_CONTEXT' } });
  expect(f.current().frameConfirmations).toHaveLength(1);
});

it('denies disable/removal at the actual decision transaction and never commits a confirmation after revocation', async () => {
  for (const revoke of ['disable', 'remove']) {
    const f = await fixture(); await seed(f); const a = await api(f); const owner = await (await a.get('/decisions/decision/me')).json();
    let once = true; let mutatingAttempts = 0;
    f.beforeWrite(() => { if (!f.writes.at(-1)!.some(item => item.Put || item.Update)) return;
      mutatingAttempts++; if (!once) return; once = false;
      if (revoke === 'disable') f.change('ACCOUNT#iris', value => { value.status = 'DISABLED'; });
      else f.change('GROUP#garden', value => { value.members = ['omar']; value.organizer = 'omar'; });
    });
    const result = await a.post('/decisions/decision/commands', command(owner)); expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ error: { code: 'STALE_CONTEXT' } }); expect(f.current().frameConfirmations).toEqual([]);
    expect(mutatingAttempts).toBe(1);
  }
});

it('rejects mismatched IDs, private/unknown command fields, unsupported methods and malformed bodies', async () => {
  const f = await fixture(); await seed(f); const a = await api(f); const owner = await (await a.get('/decisions/decision/me')).json();
  for (const value of [{ ...command(owner), decisionId: 'other' }, { ...command(owner), subject: 'omar' }, { ...command(owner), principal: actor('omar') }, null])
    expect((await a.post('/decisions/decision/commands', value)).status).toBe(422);
  expect(await (await a.post('/decisions/decision/commands', { ...command(owner), decisionId: 'other' })).json())
    .toMatchObject({ requestId: 'frame-iris', error: { code: 'INVALID_COMMAND' } });
  expect((await a.get('/decisions/decision/me?subject=omar')).status).toBe(422);
  expect((await a.get('/groups/garden/roster')).status).toBe(404); expect((await a.post('/groups', { name: 'x' })).status).toBe(422);
  const invalid = await fetch(a.base + '/groups/garden/remove', { method: 'POST', headers: { authorization: 'Bearer iris', 'content-type': 'application/json' }, body: '{' }); expect(invalid.status).toBe(422);
  const method = await fetch(a.base + '/decisions/decision/me', { method: 'DELETE', headers: { authorization: 'Bearer iris' } }); expect(method.status).toBe(404);
  expect(f.current().frameConfirmations).toEqual([]);
});

it('bounds body bytes and CORS, rejects caller overrides and keeps every response uncached', async () => {
  const f = await fixture(); const a = await api(f, { maxBodyBytes: 64 });
  const oversized = await a.post('/groups/garden/remove', { padding: 'x'.repeat(100) }); expect(oversized.status).toBe(422);
  const type = await a.post('/groups/garden/remove', {}, 'iris', { 'content-type': 'text/plain' }); expect(type.status).toBe(422);
  const forbidden = await a.get('/account', 'iris', { origin: 'https://foreign.example.invalid' }); expect(forbidden.status).toBe(403);
  const allowed = await a.get('/account', 'iris', { origin: 'https://known.example.invalid' }); expect(allowed.status).toBe(200);
  expect(allowed.headers.get('access-control-allow-origin')).toBe('https://known.example.invalid'); expect(allowed.headers.get('cache-control')).toBe('no-store');
  const preflight = await fetch(a.base + '/account', { method: 'OPTIONS', headers: { origin: 'https://known.example.invalid' } }); expect(preflight.status).toBe(204);
  expect(preflight.headers.get('access-control-allow-headers')).not.toContain('Identity');
  expect((await a.post('/groups/garden/remove', { memberId: partitionMemberId('omar'), version: 1, subject: 'iris' })).status).toBe(422);
});

it('bounds authentication/concurrency and prevents delayed authentication from starting storage after timeout', async () => {
  const f = await fixture(); const read = vi.spyOn(f.groups, 'readMany'); let resolve: (principal: TrustedPrincipal) => void = () => {};
  let entered: () => void = () => {}; const started = new Promise<void>(done => { entered = done; });
  const a = await api(f, { authTimeoutMs: 100, maxConcurrentRequests: 1, authenticate: async (_request, signal) => {
    expect(signal.aborted).toBe(false); entered(); return new Promise(done => { resolve = done; });
  } });
  const pending = a.get('/account'); await started; const excess = await a.get('/account'); expect(excess.status).toBe(503);
  expect((await pending).status).toBe(503); resolve(actor()); await new Promise(done => setTimeout(done, 0)); expect(read).not.toHaveBeenCalled();
  a.options.authenticate = async () => actor(); // Constructor captured the resolver, so caller mutation cannot reset it.
  expect((await a.get('/account')).status).toBe(503); expect(read).not.toHaveBeenCalled();
});

it('times out partial/chunked bodies before a group mutation and cleans the request slot', async () => {
  const f = await fixture(); const a = await api(f, { bodyTimeoutMs: 50, maxConcurrentRequests: 1 });
  const result = await new Promise<{ status: number; text: string }>((resolve, fail) => {
    const request = httpRequest(a.base + '/groups/garden/remove', { method: 'POST', headers: { authorization: 'Bearer iris', 'content-type': 'application/json' } }, response => {
      let text = ''; response.on('data', chunk => { text += chunk; }); response.on('end', () => { request.end(); resolve({ status: response.statusCode!, text }); });
    }); request.on('error', fail); request.write('{');
  });
  expect(result.status).toBe(503); expect(result.text).not.toMatch(/subject|ACCOUNT#|GROUP#/); expect((await a.get('/groups/garden')).status).toBe(200);
  expect(JSON.parse(f.cells.get(`${target.partitionArn}/GROUP#garden/STATE`)!.payload!.S!).value.members).toHaveLength(2);
});

it('maps unknown storage diagnostics to a fixed retryable body and validates all constructor bounds before I/O', async () => {
  const f = await fixture(); await seed(f); const a = await api(f, { decisions: { send: async () => { throw new Error('PRIVATE_PROVIDER_EMAIL@example.invalid/ACCOUNT#iris'); } } });
  const result = await a.get('/decisions/decision/me'); expect(result.status).toBe(503); const text = await result.text(); expect(text).not.toMatch(/PRIVATE|example.invalid|ACCOUNT#/);
  for (const invalid of [{ maxConcurrentRequests: 9 }, { authTimeoutMs: 0 }, { maxBodyBytes: 65_537 }, { bodyTimeoutMs: 5_001 }, { partitionArn: 'wrong' }, { allowedOrigins: ['*'] }])
    expect(() => createPartitionParticipantApiHandler({ ...a.options, ...invalid })).toThrow();
});

it('captures a trusted identity before storage awaits so resolver object aliases cannot select another owner', async () => {
  const f = await fixture(); await seed(f); const principal = { kind: 'participant' as const, subject: 'iris' };
  const a = await api(f, { authenticate: async () => principal });
  f.beforeRead(() => { principal.subject = 'omar'; });
  const response = await a.get('/decisions/decision/me'); expect(response.status).toBe(200);
  expect((await response.json()).ownerParticipantId).toBe(partitionMemberId('iris'));
});

it('reports an unknown committed response without repeating its write and permits explicit receipt reconciliation', async () => {
  const f = await fixture(); await seed(f); const a = await api(f); const owner = await (await a.get('/decisions/decision/me')).json();
  const request = command(owner, 'lost-response'); let once = true;
  f.afterWrite(() => { if (once && f.current().frameConfirmations.length) { once = false; throw new Error('PRIVATE_UNKNOWN_COMMIT'); } });
  const response = await a.post('/decisions/decision/commands', request); expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('PRIVATE_UNKNOWN_COMMIT'); expect(f.current().frameConfirmations).toHaveLength(1);
  expect(f.writes.filter(items => items.some(item => item.Put || item.Update))).toHaveLength(1);
  const result = await a.post('/decisions/decision/commands', request); expect(result.status).toBe(200); expect((await result.json()).ok).toBe(true);
  expect(f.current().frameConfirmations).toHaveLength(1); expect(f.writes.filter(items => items.some(item => item.Put || item.Update))).toHaveLength(1);
});

it('aborts disconnected authentication and releases its concurrency slot without starting late storage', async () => {
  const f = await fixture(); const read = vi.spyOn(f.groups, 'readMany'); let entered: () => void = () => {};
  const started = new Promise<void>(resolve => { entered = resolve; }); let resolve: (principal: TrustedPrincipal) => void = () => {};
  let observed: AbortSignal | undefined;
  const a = await api(f, { maxConcurrentRequests: 1, authenticate: async (request, signal) => {
    if (request.headers.authorization === 'Bearer iris') return actor();
    observed = signal; entered(); return new Promise(done => { resolve = done; });
  } });
  const disconnected = httpRequest(a.base + '/account', { headers: { authorization: 'Bearer delayed' } });
  disconnected.on('error', () => {}); disconnected.end(); await started;
  const closed = new Promise<void>(done => observed!.addEventListener('abort', () => done(), { once: true }));
  disconnected.destroy(); await closed; resolve(actor('omar')); await new Promise(done => setTimeout(done, 0));
  expect(read).not.toHaveBeenCalled(); expect((await a.get('/account')).status).toBe(200);
});

it('counts chunked body bytes and rejects overflow before any group mutation', async () => {
  const f = await fixture(); const a = await api(f, { maxBodyBytes: 64 });
  const result = await new Promise<number>((resolve, fail) => {
    const request = httpRequest(a.base + '/groups/garden/remove', { method: 'POST', headers: { authorization: 'Bearer iris', 'content-type': 'application/json' } }, response => {
      response.resume(); response.once('end', () => resolve(response.statusCode!));
    }); request.on('error', fail); request.write('{"padding":"'); request.end('x'.repeat(300) + '"}');
  });
  expect(result).toBe(422); expect(JSON.parse(f.cells.get(`${target.partitionArn}/GROUP#garden/STATE`)!.payload!.S!).value.members).toHaveLength(2);
});

it('keeps unresolved authentication inside the concurrency bound even when a resolver ignores cancellation', async () => {
  const f = await fixture(); let resolve: (principal: TrustedPrincipal) => void = () => {};
  const authenticate = vi.fn(async () => new Promise<TrustedPrincipal>(done => { resolve = done; }));
  const a = await api(f, { authTimeoutMs: 20, maxConcurrentRequests: 1, authenticate });
  expect((await a.get('/account')).status).toBe(503);
  expect((await a.get('/account')).status).toBe(503);
  expect((await a.get('/account')).status).toBe(503);
  expect(authenticate).toHaveBeenCalledTimes(1);
  resolve(actor());
});

const listCandidate = () => ({ id: 'garden', name: 'Ignored discovery label', version: 99, isOrganizer: true });
const listCursor = 'x'.repeat(80);
it('lists a verified participants current public groups with strict opaque pagination and copied configuration', async () => {
  const f = await fixture(); const queries: unknown[] = [];
  const a = await api(f, { membershipDiscovery: async (raw, io) => { queries.push(structuredClone(raw)); expect(io.signal).toBeDefined();
    return { groups: [listCandidate()], cursor: listCursor }; } });
  a.options.membershipDiscovery = async () => { throw new Error('wrong late configuration'); };
  const response = await a.get(`/groups?limit=1&cursor=${listCursor}`, 'omar', { 'x-subject': 'iris' });
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  const value = await response.json(); expect(value.cursor).toBe(listCursor); expect(value.groups[0]).toMatchObject({ id: 'garden', name: 'Garden', version: 1, isOrganizer: false });
  expect(queries).toEqual([{ subject: 'omar', limit: 1, cursor: listCursor }]);
  expect(JSON.stringify(value.groups)).not.toMatch(/subject|emailHash|tokenHash|recipientHash|ACCOUNT#|MEMBER#|revision|Ignored/);
  expect(f.writes).toEqual([]); expect(f.groupCommits).toHaveLength(1);
});

it('rejects group-list query substitution, duplication and bad bounds before discovery or group IO', async () => {
  const f = await fixture(); const discovery = vi.fn(async () => ({ groups: [], cursor: null })); const a = await api(f, { membershipDiscovery: discovery });
  const read = vi.spyOn(f.groups, 'readMany');
  for (const path of ['/groups?subject=omar', '/groups?limit=01', '/groups?limit=0', '/groups?limit=21', '/groups?limit=1&limit=2',
    '/groups?cursor=', '/groups?cursor=unsafe', `/groups?cursor=${listCursor}&cursor=${listCursor}`, '/account?limit=1', '/groups/garden?limit=1']) {
    expect((await a.get(path)).status).toBe(422);
  }
  expect(read).not.toHaveBeenCalled(); expect(discovery).not.toHaveBeenCalled(); expect(f.groupCommits).toEqual([]);
});

it('keeps group-list authentication and server discovery configuration fail-closed', async () => {
  const f = await fixture(); const missing = await api(f); expect((await missing.get('/groups')).status).toBe(503);
  const discovery = vi.fn(async () => ({ groups: [], cursor: null })); const a = await api(f, { membershipDiscovery: discovery });
  expect((await a.get('/groups', 'unknown')).status).toBe(401);
  f.change('ACCOUNT#iris', value => { value.status = 'DISABLED'; }); expect((await a.get('/groups')).status).toBe(403);
  expect(discovery).not.toHaveBeenCalled(); expect(f.groupCommits).toEqual([]);
});

it('denies a whole group-list page when an included roster changes at actual publication', async () => {
  const f = await fixture(); const a = await api(f, { membershipDiscovery: async () => ({ groups: [listCandidate()], cursor: null }) });
  f.beforeGroupCommit(() => { f.change('GROUP#garden', value => { value.members = ['iris']; value.version = 2; }); });
  const response = await a.get('/groups', 'omar'); expect(response.status).toBe(409);
  const value = await response.json(); expect(value.error.code).toBe('STALE_CONTEXT'); expect(value.groups).toBeUndefined();
  expect(JSON.stringify(value)).not.toMatch(/Garden|IRIS|OMAR|subject|emailHash|roster/); expect(f.groupCommits).toHaveLength(1);
});

it('cancels held discovery without late hydration and retains its unresolved provider slot until settlement', async () => {
  const f = await fixture(); let release: (() => void) | undefined; let reached: (() => void) | undefined;
  const ready = new Promise<void>(resolve => { reached = resolve; }); let first = true;
  const discovery = vi.fn(async () => { if (first) { first = false; reached?.(); await new Promise<void>(resolve => { release = resolve; }); }
    return { groups: [listCandidate()], cursor: null }; });
  const a = await api(f, { membershipDiscovery: discovery, maxConcurrentRequests: 1 }); const reads = vi.spyOn(f.groups, 'readMany');
  const controller = new AbortController();
  const pending = fetch(a.base + '/groups', { headers: { authorization: 'Bearer iris' }, signal: controller.signal }).catch(error => error);
  await ready; controller.abort(); await pending; await new Promise(resolve => setTimeout(resolve, 20));
  const before = reads.mock.calls.length; expect((await a.get('/groups')).status).toBe(503); expect(discovery).toHaveBeenCalledTimes(1);
  release?.(); await new Promise(resolve => setTimeout(resolve, 20)); expect(reads.mock.calls).toHaveLength(before); expect(f.groupCommits).toEqual([]);
  expect((await a.get('/groups')).status).toBe(200); expect(discovery).toHaveBeenCalledTimes(2);
});


function seedHttpDraft(f: Awaited<ReturnType<typeof fixture>>) {
  const participants = ['iris', 'omar'].map(subject => ({ id: partitionMemberId(subject), displayName: subject.toUpperCase(), requiredForApproval: true }));
  const draft = Groups.GroupDraft.parse({ id: 'draft-one', bodyHash: 'b'.repeat(64), revision: 1, groupVersion: 1, createdDecisionId: null,
    clarificationQuestions: ['Confirm the public choices.'], frame: { schemaVersion: KE.KE_SCHEMA_VERSION, decisionId: 'draft-decision', frameVersion: 1,
      semanticVersion: 1, contextToken: 'c'.repeat(64), title: 'Garden task', objective: 'Choose a task', description: '', participants,
      requiredParticipantIds: participants.map(value => value.id), variables: [{ id: 'indoors', type: 'BOOLEAN', label: 'Indoors', required: true, visibility: 'PUBLIC' }], rules: [] } });
  const key = { PK: { S: 'GROUP#garden' }, SK: { S: 'DRAFT#draft-one' } };
  f.cells.set(where(target.partitionArn, key), { ...key, revision: { N: '1' }, payload: { S: JSON.stringify({ schemaVersion: 1, kind: 'DRAFT', revision: 1, value: draft }) } });
  f.change('GROUP#garden', value => { value.draftIds = [draft.id]; }); return draft;
}
const httpEdit = (draft: Groups.GroupDraft) => ({ revision: draft.revision, title: 'Revised task', objective: draft.frame.objective,
  variables: draft.frame.variables, rules: draft.frame.rules });
const draftPath = '/groups/garden/drafts/draft-one';

it('reads and edits drafts only through the approved organizer boundary without publishing storage authority', async () => {
  const f = await fixture(); const draft = seedHttpDraft(f); const a = await api(f);
  const read = await a.get(draftPath); expect(read.status).toBe(200); expect(read.headers.get('cache-control')).toBe('no-store');
  expect(await read.json()).toEqual({ draft });
  expect((await a.get(draftPath, 'unknown', { 'x-subject': 'iris' })).status).toBe(401);
  expect((await a.get(draftPath, 'omar')).status).toBe(403);
  const edited = await a.post(draftPath, httpEdit(draft)); expect(edited.status).toBe(200); const result = (await edited.json()).draft;
  expect(result).toMatchObject({ revision: 2, bodyHash: draft.bodyHash, groupVersion: 1, createdDecisionId: null, frame: { title: 'Revised task' } });
  expect(JSON.stringify(result)).not.toMatch(/subject|emailHash|recipientHash|ACCOUNT#|MEMBER#|PARTITION#/);
  expect((await a.post(draftPath, httpEdit(draft))).status).toBe(409);
  expect((await a.post(draftPath, { ...httpEdit(result), subject: 'omar' })).status).toBe(422);
  expect((await a.post(draftPath + '/create', {})).status).toBe(404);
  expect(f.writes).toEqual([]); expect(f.reads).toEqual([]);
});

it('denies an unauthorized organizer edit before waiting for its body and enforces bounded partial bodies for an admitted editor', async () => {
  const f = await fixture(); const draft = seedHttpDraft(f); const a = await api(f, { bodyTimeoutMs: 40, maxConcurrentRequests: 1 });
  async function partial(subject: string) {
    return new Promise<number>((resolve, fail) => {
      const request = httpRequest(a.base + draftPath, { method: 'POST', headers: { authorization: `Bearer ${subject}`, 'content-type': 'application/json' } }, response => {
        response.resume(); response.on('end', () => { request.end(); resolve(response.statusCode!); });
      }); request.on('error', fail); request.write('{');
    });
  }
  expect(await partial('omar')).toBe(403); expect(f.groupCommits).toEqual([]);
  expect(await partial('iris')).toBe(503); expect(f.groupCommits.every(values => values.every(value => !(value as { next: unknown }).next))).toBe(true);
  expect((await a.get(draftPath)).status).toBe(200);
  expect(JSON.parse(f.cells.get(`${target.partitionArn}/GROUP#garden/DRAFT#draft-one`)!.payload!.S!).value).toEqual(draft);
});

it('rechecks organizer admission after body admission and returns fixed errors for concurrent disable or roster revision', async () => {
  for (const mode of ['disabled', 'roster'] as const) {
    const f = await fixture(); const draft = seedHttpDraft(f); const a = await api(f); let commits = 0;
    f.beforeGroupCommit(() => { if (++commits !== 2) return;
      f.change(mode === 'disabled' ? 'ACCOUNT#iris' : 'GROUP#garden', value => { if (mode === 'disabled') value.status = 'DISABLED'; else value.version = 2; });
    });
    const response = await a.post(draftPath, httpEdit(draft)); expect(response.status).toBe(mode === 'disabled' ? 403 : 409);
    expect(await response.text()).not.toMatch(/ACCOUNT#|GROUP#|email|subject/);
    expect(f.groupCommits).toHaveLength(2);
    expect(JSON.parse(f.cells.get(`${target.partitionArn}/GROUP#garden/DRAFT#draft-one`)!.payload!.S!).value).toEqual(draft);
  }
});

it('reconciles an unknown applied draft response through a fresh read without repeating the edit', async () => {
  const f = await fixture(); const draft = seedHttpDraft(f); const a = await api(f);
  f.afterGroupCommit(() => { const cell = f.cells.get(`${target.partitionArn}/GROUP#garden/DRAFT#draft-one`)!;
    if (cell.revision!.N === '2') throw new Error('PRIVATE_APPLIED_DRAFT_DIAGNOSTIC'); });
  const response = await a.post(draftPath, httpEdit(draft)); expect(response.status).toBe(503); expect(await response.text()).not.toContain('PRIVATE');
  expect(f.groupCommits).toHaveLength(2); f.afterGroupCommit(() => {});
  const read = await a.get(draftPath); expect(read.status).toBe(200); expect((await read.json()).draft.revision).toBe(2);
  expect((await a.post(draftPath, httpEdit(draft))).status).toBe(409);
  expect(f.cells.get(`${target.partitionArn}/GROUP#garden/DRAFT#draft-one`)!.revision!.N).toBe('2');
});


function httpArchitecture(input: DecisionArchitectRequest): DecisionArchitectureDraft {
  const participants = input.participants.map(person => ({ ...person, requiredForApproval: true }));
  return { draftId: input.draftId, revision: input.revision, status: 'DEFINING', clarificationQuestions: [], participantInformationRequirements: [],
    frame: KE.PublicDecisionFrame.parse({ schemaVersion: KE.KE_SCHEMA_VERSION, decisionId: 'new-frame', frameVersion: 1, semanticVersion: 1,
      contextToken: 'c'.repeat(64), title: 'Garden task', objective: input.objective, description: '', participants,
      requiredParticipantIds: participants.map(person => person.id), variables: [{ id: 'indoors', type: 'BOOLEAN', label: 'Indoors', required: true, visibility: 'PUBLIC' }], rules: [] }) };
}
const generationPath = '/groups/garden/drafts';
const generation = { objective: ' Choose a task ', idempotencyKey: 'generation-one' };

it('generates and replays a draft through trusted HTTP without caller identity or another model invocation', async () => {
  const f = await fixture(); let calls = 0; const a = await api(f, { draftArchitect: async (subject, input, context) => {
    expect(subject).toBe('iris'); expect(context.signal).toBeDefined(); calls++; return httpArchitecture(input);
  } });
  a.options.draftArchitect = async () => { throw new Error('Caller configuration alias'); };
  const response = await a.post(generationPath, generation); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  const value = (await response.json()).draft; expect(value).toMatchObject({ revision: 1, groupVersion: 1, frame: { objective: 'Choose a task' } });
  expect(JSON.stringify(value)).not.toMatch(/subject|emailHash|recipientHash|ACCOUNT#|MEMBER#/);
  const replay = await a.post(generationPath, generation); expect(replay.status).toBe(200); expect(await replay.json()).toEqual({ draft: value }); expect(calls).toBe(1);
  expect((await a.post(generationPath, { ...generation, objective: 'Other' })).status).toBe(409); expect(calls).toBe(1);
  expect((await a.get(generationPath + '/' + value.id)).status).toBe(200);
  expect((await a.get(generationPath)).status).toBe(404); expect(f.writes).toEqual([]); expect(f.reads).toEqual([]);
});

it('rejects non-organizers before reading a generation body and malformed authority before any architect invocation', async () => {
  const f = await fixture(); const architect = vi.fn(async (_subject: string, input: DecisionArchitectRequest) => httpArchitecture(input));
  const a = await api(f, { draftArchitect: architect, bodyTimeoutMs: 40 });
  const denied = await new Promise<number>((resolve, fail) => {
    const request = httpRequest(a.base + generationPath, { method: 'POST', headers: { authorization: 'Bearer omar', 'content-type': 'application/json' } }, response => {
      response.resume(); response.on('end', () => { request.end(); resolve(response.statusCode!); });
    }); request.on('error', fail); request.write('{');
  }); expect(denied).toBe(403); expect(f.groupCommits).toEqual([]);
  expect((await a.post(generationPath, { ...generation, subject: 'iris' })).status).toBe(422);
  expect((await a.post(generationPath, generation, 'unknown', { 'x-subject': 'iris' })).status).toBe(401);
  expect(architect).not.toHaveBeenCalled(); expect(f.groupCommits.every(values => values.every(value => !(value as { next: unknown }).next))).toBe(true);
});

it('fails closed on missing, foreign and privately malformed generation providers without leaking their diagnostics', async () => {
  const f = await fixture(); const missing = await api(f); expect((await missing.post(generationPath, generation)).status).toBe(503);
  for (const draftArchitect of [async () => { throw new Error('PRIVATE_GENERATION_DIAGNOSTIC'); },
    async (_subject: string, input: DecisionArchitectRequest) => ({ ...httpArchitecture(input), draftId: 'foreign' }),
    async (_subject: string, input: DecisionArchitectRequest) => ({ ...httpArchitecture(input), private: 'PRIVATE_GENERATION_FIELD' })]) {
    const a = await api(f, { draftArchitect }); const response = await a.post(generationPath, generation);
    expect(response.status).toBe(503); expect(await response.text()).not.toMatch(/PRIVATE|ACCOUNT#|MEMBER#/);
  }
  expect(JSON.parse(f.cells.get(f.groupLocation)!.payload!.S!).value.draftIds).toEqual([]);
});

it('rechecks pending-provider admission and roster versions before HTTP generation persistence', async () => {
  for (const mode of ['disabled', 'version', 'name'] as const) {
    const f = await fixture(); const a = await api(f, { draftArchitect: async (_subject, input) => {
      f.change(mode === 'version' ? 'GROUP#garden' : 'ACCOUNT#iris', value => {
        if (mode === 'version') value.version = 2; else if (mode === 'disabled') value.status = 'DISABLED'; else value.displayName = 'Changed name';
      }); return httpArchitecture(input);
    } });
    const response = await a.post(generationPath, generation); expect(response.status).toBe(mode === 'disabled' ? 403 : 409);
    expect(JSON.parse(f.cells.get(f.groupLocation)!.payload!.S!).value.draftIds).toEqual([]); expect(f.writes).toEqual([]);
  }
});

it('reconciles an unknown generated commit through explicit HTTP replay while preserving exactly one draft write', async () => {
  const f = await fixture(); let calls = 0; const a = await api(f, { draftArchitect: async (_subject, input) => { calls++; return httpArchitecture(input); } });
  f.afterGroupCommit(() => { const header = JSON.parse(f.cells.get(f.groupLocation)!.payload!.S!);
    if (header.value.draftIds.length) throw new Error('PRIVATE_GENERATED_COMMIT_RESPONSE');
  });
  const response = await a.post(generationPath, generation); expect(response.status).toBe(503); expect(await response.text()).not.toContain('PRIVATE');
  expect(f.groupCommits).toHaveLength(3); f.afterGroupCommit(() => {});
  const replay = await a.post(generationPath, generation); expect(replay.status).toBe(200); expect((await replay.json()).draft.revision).toBe(1); expect(calls).toBe(1);
  const writes = f.groupCommits.flat() as { next: { kind: string } | null }[]; expect(writes.filter(value => value.next?.kind === 'DRAFT')).toHaveLength(1);
});

it('charges architect work to the existing HTTP operation budget instead of giving persistence a fresh request allowance', async () => {
  let returned = false; const f = await fixture(); const a = await api(f, { draftArchitect: async (_subject, input, context) => {
    for (let index = 0; index < 49; index++) context.request(); returned = true; return httpArchitecture(input);
  } });
  const response = await a.post(generationPath, generation); expect(response.status).toBe(503); expect(returned).toBe(true);
  expect(JSON.parse(f.cells.get(f.groupLocation)!.payload!.S!).value.draftIds).toEqual([]);
  expect(f.groupCommits.every(values => values.every(value => !(value as { next: unknown }).next))).toBe(true);
});

it('cancels disconnected generation without a late write and retains unresolved architect slots until actual settlement', async () => {
  const f = await fixture(); let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; }); let calls = 0;
  const a = await api(f, { maxConcurrentRequests: 1, draftArchitect: async (_subject, input) => { calls++; entered(); await held; return httpArchitecture(input); } });
  const request = httpRequest(a.base + generationPath, { method: 'POST', headers: { authorization: 'Bearer iris', 'content-type': 'application/json' } });
  request.on('error', () => {}); request.end(JSON.stringify(generation)); await started; request.destroy();
  await new Promise<void>(resolve => setTimeout(resolve, 10)); expect((await a.get('/account')).status).toBe(503); expect(calls).toBe(1);
  release(); await new Promise<void>(resolve => setTimeout(resolve, 10)); expect((await a.get('/account')).status).toBe(200);
  expect(JSON.parse(f.cells.get(f.groupLocation)!.payload!.S!).value.draftIds).toEqual([]);
  expect(f.groupCommits.every(values => values.every(value => !(value as { next: unknown }).next))).toBe(true);
});
