import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DealTableApplication, type TrustedPrincipal } from '@deal-table/application';
import { InMemoryRoomRepository } from '@deal-table/adapters';
import { CommandResult, OwnerSnapshot, PublicRoomSnapshot, type CommandEnvelope } from '@deal-table/contracts';
import { buildTeamTableFixture } from '@deal-table/test-support';
import { createLocalApiHandler, createNonProductionIdentities, type LocalApiOptions } from '../../apps/api/src/http.ts';

const roomId = 'room-synthetic';
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  })));
});
async function harness(identities?: LocalApiOptions['identities'], debug = false) {
  const fixture = buildTeamTableFixture();
  let sequence = 0;
  const repository = new InMemoryRoomRepository();
  const application = new DealTableApplication({ repository, clock: { now: () => fixture.now }, ids: { next: () => `http-id-${++sequence}` } });
  const seed = { roomId, schedule: fixture.schedule, roster: fixture.roster.map(member => ({ ...member, submitted: false })), policy: fixture.policy, organizerSubject: 'organizer', memberships: fixture.roster.map(member => ({ subject: member.id, memberId: member.id })) };
  await application.createRoom(seed);
  await application.createRoom({ ...seed, roomId: 'other-room', organizerSubject: 'other-organizer', memberships: fixture.roster.map(member => ({ subject: `other-${member.id}`, memberId: member.id })) });
  const server = createServer(createLocalApiHandler({ application, debug, ...(identities ? { identities } : {}) }));
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test listener');
  const base = `http://127.0.0.1:${address.port}`;
  async function request(path: string, identity: string | null = 'maya', body?: unknown, raw = false) {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(identity === null ? {} : { 'X-Deal-Table-Test-Identity': `NON_PRODUCTION ${identity}` }), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: raw ? String(body) : JSON.stringify(body) }),
    });
    const data: unknown = await response.json();
    return { status: response.status, data, headers: response.headers };
  }
  const publicView = async () => PublicRoomSnapshot.parse((await request(`/rooms/${roomId}/public`, 'display')).data);
  const owner = async (member: string) => OwnerSnapshot.parse((await request(`/rooms/${roomId}/me`, member)).data);
  async function envelope(type: CommandEnvelope['type'], payload: unknown) {
    const snapshot = await publicView();
    return { schemaVersion: 1, requestId: `http-request-${++sequence}`, idempotencyKey: `http-key-${sequence}`, roomId, expected: { contextToken: snapshot.contextToken, decisionRevision: snapshot.decisionRevision, controlVersion: snapshot.controlVersion }, type, payload };
  }
  const post = (identity: string | null, body: unknown) => request(`/rooms/${roomId}/commands`, identity, body);
  const send = async (identity: string, type: CommandEnvelope['type'], payload: unknown) => post(identity, await envelope(type, payload));
  async function applied(identity: string, type: CommandEnvelope['type'], payload: unknown) {
    const result = await send(identity, type, payload);
    expect(result.status).toBeGreaterThanOrEqual(200);
    expect(result.status).toBeLessThan(300);
    expect(CommandResult.parse(result.data).ok).toBe(true);
    return result;
  }
  async function offer() {
    for (const input of fixture.owners) {
      const member = input.ownerMemberId;
      await applied(member, 'SUBMIT_INPUT_DRAFT', { expectedOwnerRevision: 0, values: input.confirmedInputs.values });
      const snapshot = await owner(member);
      await applied(member, 'CONFIRM_INPUTS', { draftId: snapshot.draft!.draftId, draftRevision: snapshot.draft!.draftRevision, expectedOwnerRevision: snapshot.ownerRevision, reviewedIntervals: input.availabilityReview.intervals });
    }
    for (const member of fixture.roster) await applied(member.id, 'ACCEPT_CONTEXT', { policy: fixture.policy });
    await applied('maya', 'REQUEST_SOLVE', {});
    expect((await publicView()).status).toBe('PRIVATE_REVIEW');
    return (await owner('nina')).pendingOffers[0]!;
  }
  return { base, application, fixture, repository, request, owner, publicView, envelope, post, send, applied, offer };
}
function error(result: { status: number; data: unknown }, code: string, status: number) {
  expect(result.status).toBe(status);
  const parsed = CommandResult.parse(result.data);
  expect(parsed).toMatchObject({ ok: false, error: { code, httpStatus: status } });
  expect(Object.keys(parsed).sort()).toEqual(['error', 'ok', 'requestId']);
}

describe('B03 real local HTTP boundary (non-production test identities)', () => {
  it('logs only validated command names when local diagnostics are enabled', async () => {
    const h = await harness(undefined, true);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const body = await h.envelope('ACCEPT_CONTEXT', { policy: h.fixture.policy });
      error(await h.post('maya', { ...body, type: 'private-diagnostic-canary' }), 'INVALID_COMMAND', 422);
      const output = log.mock.calls.map(args => args.join(' ')).join('\n');
      expect(output).not.toContain('private-diagnostic-canary');
      expect(output).toContain('INVALID_COMMAND');
    } finally { log.mockRestore(); }
  });

  it('requires an allowlisted identity before exposing malformed-body diagnostics', async () => {
    const h = await harness();
    for (const identity of [null, 'unknown', 'service', 'participant:nina', 'display:other-room']) {
      error(await h.request(`/rooms/${roomId}/commands`, identity, '{private malformed', true), 'UNAUTHENTICATED', 401);
    }
    error(await h.request(`/rooms/${roomId}/public`, null), 'UNAUTHENTICATED', 401);
  });

  it('snapshots identity configuration so later map or principal mutation cannot elevate HTTP scope', async () => {
    const identities = new Map(createNonProductionIdentities(roomId));
    const maya = identities.get('NON_PRODUCTION maya')!;
    const h = await harness(identities);
    maya.subject = 'nina';
    expect((await h.owner('maya')).ownerMemberId).toBe('maya');
    const writable = identities as Map<string, TrustedPrincipal>;
    writable.set('NON_PRODUCTION injected', { kind: 'service', subject: 'worker', roomIds: [roomId] });
    error(await h.send('injected', 'PUBLISH_DISCLOSURE', { grantId: 'anything', grantVersion: 1 }), 'UNAUTHENTICATED', 401);
  });

  it('uses identical non-enumerating errors for missing and out-of-scope rooms', async () => {
    const h = await harness();
    for (const identity of ['maya', 'display']) for (const room of ['absent-room', 'other-room']) {
      error(await h.request(`/rooms/${room}/public`, identity), 'NOT_FOUND', 404);
      error(await h.request(`/rooms/${room}/commands`, identity, '{', true), 'NOT_FOUND', 404);
    }
  });

  it('rejects display writes, organizer private access and service escalation', async () => {
    const h = await harness();
    error(await h.post('display', await h.envelope('ACCEPT_CONTEXT', { policy: h.fixture.policy })), 'FORBIDDEN', 403);
    error(await h.request(`/rooms/${roomId}/me`, 'display'), 'FORBIDDEN', 403);
    error(await h.request(`/rooms/${roomId}/me`, 'organizer'), 'FORBIDDEN', 403);
    error(await h.send('organizer', 'PUBLISH_DISCLOSURE', { grantId: 'absent', grantVersion: 1 }), 'FORBIDDEN', 403);
    error(await h.send('maya', 'REVISE_DECISION', { schedule: h.fixture.schedule, roster: h.fixture.roster.map(m => ({ ...m, submitted: false })), policy: h.fixture.policy }), 'FORBIDDEN', 403);
  });

  it('rejects malformed JSON, unknown keys, owner substitution and route/body mismatch', async () => {
    const h = await harness();
    error(await h.request(`/rooms/${roomId}/commands`, 'maya', '{', true), 'INVALID_COMMAND', 422);
    const command = await h.envelope('ACCEPT_CONTEXT', { policy: h.fixture.policy });
    for (const body of [null, [], { ...command, extra: true }, { ...command, payload: { ...command.payload as object, ownerMemberId: 'nina' } }, { ...command, roomId: 'other-room' }]) {
      error(await h.post('maya', body), 'INVALID_COMMAND', 422);
    }
    const result = await h.post('maya', { ...command, requestId: '<private\ntext>' });
    error(result, 'INVALID_COMMAND', 422);
    expect(JSON.stringify(result.data)).not.toContain('private');
    expect((await h.owner('nina')).ownerRevision).toBe(0);
  });

  it('bounds bodies, rejects non-JSON media and keeps responses out of caches', async () => {
    const h = await harness();
    error(await h.request(`/rooms/${roomId}/commands`, 'maya', ' '.repeat(65536) + '{}', true), 'INVALID_COMMAND', 422);
    error(await h.request(`/rooms/${roomId}/commands`, 'display', '{', true), 'FORBIDDEN', 403);
    const response = await fetch(`${h.base}/rooms/${roomId}/commands`, {
      method: 'POST', headers: { 'X-Deal-Table-Test-Identity': 'NON_PRODUCTION maya', 'Content-Type': 'text/plain' }, body: '{}',
    });
    error({ status: response.status, data: await response.json() }, 'INVALID_COMMAND', 422);
    const owner = await h.request(`/rooms/${roomId}/me`);
    expect(owner.headers.get('cache-control')).toBe('no-store');
  });

  it('permits only configured local browser origins and rejects production startup', async () => {
    const h = await harness();
    for (const origin of ['http://127.0.0.1:5173', 'https://untrusted.example']) {
      const response = await fetch(`${h.base}/rooms/${roomId}/commands`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' } });
      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBe(origin.startsWith('http://127.') ? origin : null);
    }
    const previous = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      expect(() => createLocalApiHandler({ application: h.application })).toThrow(/non-production/);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it('maps clarification, stale context, stale proposal and idempotency conflict to documented codes', async () => {
    const h = await harness();
    error(await h.send('maya', 'REQUEST_SOLVE', {}), 'NEEDS_CLARIFICATION', 422);
    const body = await h.envelope('SUBMIT_INPUT_DRAFT', { expectedOwnerRevision: 0, values: h.fixture.owners[0]!.confirmedInputs.values });
    const first = await h.post('maya', body);
    expect(CommandResult.parse(first.data).ok).toBe(true);
    expect((await h.post('maya', { ...body, requestId: 'transport-retry' })).data).toEqual(first.data);
    error(await h.post('maya', { ...body, payload: { ...body.payload as object, expectedOwnerRevision: 1 } }), 'IDEMPOTENCY_CONFLICT', 409);
    error(await h.post('maya', { ...body, idempotencyKey: 'fresh-key' }), 'STALE_CONTEXT', 409);
    error(await h.send('maya', 'ACCEPT_PROPOSAL', { proposalId: 'missing-proposal', proposalVersion: 1, planHash: '0'.repeat(64) }), 'STALE_PROPOSAL', 409);
  });

  it('checks current authorization before returning an earlier cached command result', async () => {
    const h = await harness();
    const body = await h.envelope('SUBMIT_INPUT_DRAFT', { expectedOwnerRevision: 0, values: h.fixture.owners[0]!.confirmedInputs.values });
    expect(CommandResult.parse((await h.post('maya', body)).data).ok).toBe(true);
    await h.repository.transaction(roomId, room => { room!.memberships = room!.memberships.filter(m => m.subject !== 'maya'); });
    error(await h.post('maya', body), 'NOT_FOUND', 404);
  });

  it('never returns another owner’s private offer or grant even to the organizer', async () => {
    const h = await harness();
    const offer = await h.offer();
    const payload = { offerId: offer.id, offerVersion: offer.version, scope: offer.scope, decision: 'ALLOW' };
    const other = await h.send('maya', 'DECIDE_EXCEPTION', payload);
    const absent = await h.send('maya', 'DECIDE_EXCEPTION', { ...payload, offerId: 'absent-offer' });
    error(other, 'NOT_FOUND', 404);
    error(absent, 'NOT_FOUND', 404);
    error(await h.send('organizer', 'DECIDE_EXCEPTION', payload), 'FORBIDDEN', 403);
    expect((await h.owner('maya')).pendingOffers).toEqual([]);
    const view = await h.publicView();
    expect(JSON.stringify(view)).not.toMatch(/nina-thursday|dutyCosts|pendingOffers|grantId|DECLINED/);
  });

  it('runs negotiation entirely over HTTP, retains independent disclosure refusal and invalidates a duration edit', async () => {
    const h = await harness();
    const offer = await h.offer();
    await h.applied('nina', 'DECIDE_EXCEPTION', { offerId: offer.id, offerVersion: offer.version, scope: offer.scope, decision: 'ALLOW' });
    const nina = await h.owner('nina');
    await h.applied('nina', 'DECIDE_DISCLOSURE', { preview: nina.disclosurePreviews[0], decision: 'DECLINE' });
    expect((await h.owner('nina')).exceptionGrants[0]!.status).toBe('ACTIVE');
    const proposal = (await h.publicView()).proposal!;
    const target = { proposalId: proposal.id, proposalVersion: proposal.facts.proposalVersion, planHash: proposal.planHash };
    for (const member of ['maya', 'leo', 'nina']) await h.applied(member, 'ACCEPT_PROPOSAL', target);
    const agreed = await h.publicView();
    expect(agreed.status).toBe('AGREED');
    expect(agreed.publishedDisclosures).toEqual([]);
    expect(agreed.proposal!.facts.plan.assignments.map(a => [a.duty.id, a.participantId]).sort()).toEqual([['followup', 'leo'], ['lead', 'maya']]);
    const schedule = structuredClone(h.fixture.schedule);
    for (const slot of schedule.slots) slot.interval.endMinute += 30;
    await h.applied('organizer', 'REVISE_DECISION', { schedule, roster: h.fixture.roster.map(member => ({ ...member, submitted: false })), policy: h.fixture.policy });
    expect((await h.publicView()).proposal).toBeNull();
    expect((await h.publicView()).approvedMemberIds).toEqual([]);
    expect((await h.owner('nina')).exceptionGrants.every(grant => grant.status !== 'ACTIVE')).toBe(true);
    expect((await h.owner('maya')).availabilityReview).toBeNull();
  });

  it('retains a private refusal without disclosing its owner or explanation', async () => {
    const h = await harness();
    const offer = await h.offer();
    await h.applied('nina', 'DECIDE_EXCEPTION', { offerId: offer.id, offerVersion: offer.version, scope: offer.scope, decision: 'DECLINE' });
    const view = await h.publicView();
    expect(view.status).toBe('NO_AGREEMENT');
    expect(JSON.stringify(view)).not.toMatch(/DECLINED|offerId|conditionId|refusal/);
  });
});
