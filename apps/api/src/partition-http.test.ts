import { createServer, request as httpRequest, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { TransactGetItemsCommand, type TransactWriteItem, type AttributeValue } from '@aws-sdk/client-dynamodb';
import { Groups, KnownEnough as KE } from '@deal-table/contracts';
import { KnownEnoughApplication, type TrustedPrincipal } from '@deal-table/application';
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

async function fixture() {
  const account = (subject: string): Groups.Account => ({ subject, displayName: subject.toUpperCase(), status: 'APPROVED', version: 1,
    emailHash: createHash('sha256').update(subject).digest('hex') });
  const group: Groups.Group = { id: 'garden', name: 'Garden', organizer: 'iris', members: ['iris', 'omar'], version: 1,
    drafts: [], invitations: [], decisions: [{ id: 'decision', version: 1 }] };
  const plan = preparePartitionMigration(Buffer.from(JSON.stringify({ accounts: [account('iris'), account('omar')], groups: [group] })), 1, 'a'.repeat(40));
  const cells = new Map<string, Item>();
  for (const item of plan.batches.flat()) if (item.next) {
    const key = { PK: { S: item.key.PK }, SK: { S: item.key.SK } };
    cells.set(where(target.partitionArn, key), { ...key, revision: { N: String(item.next.revision) }, payload: { S: JSON.stringify(item.next) } });
  }
  const groupKey = { PK: { S: 'GROUP#garden' }, SK: { S: 'STATE' } };
  const groupLocation = where(target.partitionArn, groupKey);
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
      if (!changes.every(item => Number(cells.get(`${target.partitionArn}/${item.key.PK}/${item.key.SK}`)?.revision?.N ?? 0) === item.expected)) return false;
      for (const item of changes) if (item.next) {
        const key = { PK: { S: item.key.PK }, SK: { S: item.key.SK } };
        cells.set(where(target.partitionArn, key), { ...key, revision: { N: String(item.next.revision) }, payload: { S: JSON.stringify(item.next) } });
      }
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
  return { groups, transport, cells, writes, reads, initial, factory, current, groupLocation, stateLocation, change,
    beforeWrite: (work: typeof beforeWrite) => { beforeWrite = work; }, afterWrite: (work: typeof afterWrite) => { afterWrite = work; }, beforeRead: (work: typeof beforeRead) => { beforeRead = work; } };
}


const servers: Server[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }))); });
async function api(f: Awaited<ReturnType<typeof fixture>>, overrides: Partial<PartitionParticipantApiOptions> = {}) {
  const options: PartitionParticipantApiOptions = { ...target, groups: f.groups, decisions: f.transport,
    authenticate: async request => request.headers.authorization === 'Bearer iris' ? actor('iris')
      : request.headers.authorization === 'Bearer omar' ? actor('omar') : null,
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
  expect((await a.get('/groups/garden/roster')).status).toBe(404); expect((await a.post('/groups', { name: 'x' })).status).toBe(404);
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
