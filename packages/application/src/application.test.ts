import { describe, expect, it } from 'vitest';
import { InMemoryRoomRepository } from '@deal-table/adapters';
import { buildTeamTableFixture } from '@deal-table/test-support';
import type { CommandEnvelope, PublicRoomSnapshot } from '@deal-table/contracts';
import { DealTableApplication, type ApplicationOptions, type TrustedPrincipal } from './index.ts';
import { solveDecision } from '@deal-table/domain';

const participant = (subject: string): TrustedPrincipal => ({ kind: 'participant', subject });
const roomId = 'room-synthetic';
const display: TrustedPrincipal = { kind: 'display', subject: 'display', roomId };
const service: TrustedPrincipal = { kind: 'service', subject: 'worker', roomIds: [roomId] };
const expected = (s: PublicRoomSnapshot) => ({ contextToken: s.contextToken, decisionRevision: s.decisionRevision, controlVersion: s.controlVersion });
async function setup(solver?: ApplicationOptions['solver'], pendingMembers: string[] = []) {
  const fixture = buildTeamTableFixture();
  let sequence = 0;
  let clock = () => fixture.now;
  const repository = new InMemoryRoomRepository();
  const app = new DealTableApplication({ repository, clock: { now: () => clock() }, ids: { next: () => `opaque-${++sequence}` }, ...(solver ? { solver } : {}) });
  await app.createRoom({ roomId, schedule: fixture.schedule, roster: [...fixture.roster], policy: fixture.policy,
    organizerSubject: 'organizer', memberships: fixture.roster.map(p => ({ subject: p.id, memberId: p.id, ...(pendingMembers.includes(p.id) ? { status: 'PENDING' as const } : {}) })) });
  const view = () => app.getPublicSnapshot(display, roomId);
  const owner = (member: string) => app.getOwnerSnapshot(participant(member), roomId);
  async function command(type: CommandEnvelope['type'], payload: unknown) {
    return { schemaVersion: 1, roomId, requestId: `request-${++sequence}`, idempotencyKey: `key-${sequence}`, expected: expected(await view()), type, payload };
  }
  async function send(member: string | TrustedPrincipal, type: CommandEnvelope['type'], payload: unknown) {
    return app.execute(typeof member === 'string' ? participant(member) : member, await command(type, payload));
  }
  async function ok(member: string | TrustedPrincipal, type: CommandEnvelope['type'], payload: unknown) {
    const result = await send(member, type, payload);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    return result;
  }
  async function confirm() {
    for (const record of fixture.owners) {
      const member = record.ownerMemberId;
      await ok(member, 'SUBMIT_INPUT_DRAFT', { expectedOwnerRevision: (await owner(member)).ownerRevision, values: record.confirmedInputs.values });
      const snapshot = await owner(member);
      await ok(member, 'CONFIRM_INPUTS', { expectedOwnerRevision: snapshot.ownerRevision,
        draftId: snapshot.draft!.draftId, draftRevision: snapshot.draft!.draftRevision, reviewedIntervals: record.availabilityReview.intervals });
    }
    for (const member of fixture.roster) await ok(member.id, 'ACCEPT_CONTEXT', { policy: fixture.policy });
  }
  async function run() {
    const job = await app.pendingSolveJob(service, roomId);
    expect(job).not.toBeNull();
    return app.runSolveJob(service, roomId, job!.id);
  }
  async function offer() {
    await confirm(); await ok('maya', 'REQUEST_SOLVE', {}); await run();
    return (await owner('nina')).pendingOffers[0]!;
  }
  async function allow() {
    const candidate = await offer();
    await ok('nina', 'DECIDE_EXCEPTION', { offerId: candidate.id, offerVersion: candidate.version, scope: candidate.scope, decision: 'ALLOW' });
    await run();
    return (await owner('nina')).disclosurePreviews[0]!;
  }
  return { app, repository, fixture, view, owner, command, send, ok, confirm, run, offer, allow,
    setClock: (next: () => string) => { clock = next; } };
}

describe('application finite lifecycle', () => {
  it('issues subject-bound single-use invitations and activates only the mapped pending member', async () => {
    const h = await setup(undefined, ['maya']);
    await expect(h.app.getOwnerSnapshot(participant('maya'), roomId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(h.app.issueRoomInvitation(participant('maya'), roomId, { requestId: 'issue-denied', memberId: 'maya' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(h.app.issueRoomInvitation(participant('organizer'), roomId, { requestId: 'issue-active', memberId: 'leo' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });

    const issued = await h.app.issueRoomInvitation(participant('organizer'), roomId, { requestId: 'issue-maya', memberId: 'maya' });
    expect(issued.expiresAt).toBe('2026-10-02T12:00:00.000Z');
    const before = await h.repository.transaction(roomId, room => room!);
    expect(before.memberships.find(value => value.memberId === 'maya')).toMatchObject({ subject: 'maya', status: 'PENDING' });
    expect(before.invitations).toEqual([{ memberId: 'maya', tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/), expiresAt: issued.expiresAt, redeemedAt: null }]);
    expect(JSON.stringify(before)).not.toContain(issued.token);

    await expect(h.app.redeemRoomInvitation(participant('leo'), roomId, { requestId: 'wrong-subject', token: issued.token }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(h.app.redeemRoomInvitation(participant('organizer'), roomId, { requestId: 'organizer', token: issued.token }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(h.app.redeemRoomInvitation(participant('maya'), 'different-room', { requestId: 'cross-room', token: issued.token }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(await h.app.redeemRoomInvitation(participant('maya'), roomId, { requestId: 'redeem-maya', token: issued.token }))
      .toEqual({ accepted: true });
    await expect(h.app.redeemRoomInvitation(participant('maya'), roomId, { requestId: 'replay', token: issued.token }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await h.repository.transaction(roomId, room => room!)).memberships.find(value => value.memberId === 'maya')?.status)
      .toBe('ACTIVE');
    await expect(h.app.getOwnerSnapshot(participant('maya'), roomId)).resolves.toMatchObject({ ownerMemberId: 'maya' });
  });

  it('rotates expired pending invitations and serializes competing redemptions to one use', async () => {
    const h = await setup(undefined, ['maya']);
    const first = await h.app.issueRoomInvitation(participant('organizer'), roomId, { requestId: 'first', memberId: 'maya' });
    await expect(h.app.issueRoomInvitation(participant('organizer'), roomId, { requestId: 'duplicate-issue', memberId: 'maya' }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    h.setClock(() => '2026-10-02T12:00:00.000Z');
    await expect(h.app.redeemRoomInvitation(participant('maya'), roomId, { requestId: 'expired-token', token: first.token }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    const second = await h.app.issueRoomInvitation(participant('organizer'), roomId, { requestId: 'reissue', memberId: 'maya' });
    expect(second.token).not.toBe(first.token);
    await expect(h.app.redeemRoomInvitation(participant('maya'), roomId, { requestId: 'old-token', token: first.token }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    const results = await Promise.allSettled([
      h.app.redeemRoomInvitation(participant('maya'), roomId, { requestId: 'concurrent-a', token: second.token }),
      h.app.redeemRoomInvitation(participant('maya'), roomId, { requestId: 'concurrent-b', token: second.token }),
    ]);
    expect(results.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(value => value.status === 'rejected')).toHaveLength(1);
    const state = await h.repository.transaction(roomId, room => room!);
    expect(state.invitations).toHaveLength(1);
    expect(state.memberships.find(value => value.memberId === 'maya')?.status).toBe('ACTIVE');
  });

  it('keeps idempotency payloads comparable without retaining command values in replay state', async () => {
    const h = await setup();
    const values = h.fixture.owners[0]!.confirmedInputs.values;
    const command = await h.command('SUBMIT_INPUT_DRAFT', { expectedOwnerRevision: 0, values }) as Extract<CommandEnvelope, { type: 'SUBMIT_INPUT_DRAFT' }>;

    const first = await h.app.execute(participant('maya'), command);
    const duplicate = await h.app.execute(participant('maya'), command);

    expect(first.ok).toBe(true);
    expect(duplicate).toEqual(first);
    const replay = await h.repository.transaction(roomId, room => room!.replays[0]!);
    expect(replay.bodyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(replay)).not.toContain(JSON.stringify(values));

    const changed = { ...command, payload: { ...command.payload, values: { ...values, conditions: values.conditions.slice(1) } } };
    expect(await h.app.execute(participant('maya'), changed)).toMatchObject({
      ok: false, error: { code: 'IDEMPOTENCY_CONFLICT' },
    });
  });

  it('proposes without a concession when all hard conditions already permit the plan', async () => {
    const h = await setup();
    h.fixture.owners[2]!.confirmedInputs.values.conditions.splice(1);
    await h.confirm(); await h.ok('maya', 'REQUEST_SOLVE', {}); await h.run();
    expect((await h.view()).status).toBe('PROPOSED');
    expect((await h.owner('nina')).pendingOffers).toEqual([]);
    expect((await h.owner('nina')).exceptionGrants).toEqual([]);
  });

  it('never offers relaxation of an immutable hard exclusion or uninvited condition', async () => {
    for (const mode of ['hard', 'not-invited']) {
      const h = await setup();
      const nina = h.fixture.owners[2]!;
      if (mode === 'hard') {
        const hard = nina.confirmedInputs.values.conditions[0]!;
        if (hard.kind === 'HARD_AVAILABILITY') hard.availableIntervals = hard.availableIntervals.filter(i => i.startMinute !== 660);
      } else {
        const negotiable = nina.confirmedInputs.values.conditions[1]!;
        if (negotiable.kind === 'NEGOTIABLE_UNAVAILABLE') negotiable.inviteException = false;
      }
      await h.confirm(); await h.ok('maya', 'REQUEST_SOLVE', {}); await h.run();
      expect((await h.view()).status).toBe('NO_AGREEMENT');
      expect((await h.owner('nina')).pendingOffers).toEqual([]);
      expect(await h.send('maya', 'REQUEST_SOLVE', {})).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    }
  });

  it('preserves unknown interval coverage and reports clarification without assuming availability', async () => {
    const h = await setup();
    const review = h.fixture.owners[2]!.availabilityReview;
    Object.assign(review, { intervals: review.intervals.slice(3) });
    await h.confirm(); await h.ok('maya', 'REQUEST_SOLVE', {});
    expect(await h.run()).toBe('NEEDS_CLARIFICATION');
    expect((await h.view()).proposal).toBeNull();
    expect((await h.owner('nina')).availabilityReview!.intervals).toHaveLength(2);
  });

  it('rejects offer ownership substitution and edits to the previewed scope', async () => {
    const h = await setup();
    const offer = await h.offer();
    const payload = { offerId: offer.id, offerVersion: offer.version, scope: offer.scope, decision: 'ALLOW' };
    expect(await h.send('maya', 'DECIDE_EXCEPTION', payload)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await h.send('nina', 'DECIDE_EXCEPTION', { ...payload, scope: { ...offer.scope, expiresAt: '2027-01-01T00:00:00Z' } })).toMatchObject({ ok: false, error: { code: 'STALE_CONTEXT' } });
    expect((await h.owner('nina')).exceptionGrants).toEqual([]);
  });

  it('requires all context acceptances again after a policy change and preserves exact coverage', async () => {
    const h = await setup(); await h.confirm();
    const old = await h.owner('nina');
    await h.ok('organizer', 'REVISE_DECISION', { schedule: h.fixture.schedule,
      roster: h.fixture.roster.map(p => ({ ...p, submitted: false })), policy: 'LOWEST_INCONVENIENCE' });
    expect(await h.send('maya', 'REQUEST_SOLVE', {})).toMatchObject({ ok: false, error: { code: 'NEEDS_CLARIFICATION' } });
    expect((await h.owner('nina')).availabilityReview).toEqual(old.availabilityReview);
    for (const member of ['maya', 'leo', 'nina']) await h.ok(member, 'ACCEPT_CONTEXT', { policy: 'LOWEST_INCONVENIENCE' });
    expect((await h.view()).status).toBe('READY');
    expect((await h.owner('nina')).availabilityReview!.intervals).toEqual(old.availabilityReview!.intervals);
    expect((await h.owner('nina')).availabilityReview!.contextToken).not.toBe(old.availabilityReview!.contextToken);
  });

  it('repairs a stale collecting status when all setup confirmations are present', async () => {
    const h = await setup();
    await h.confirm();
    await h.repository.transaction(roomId, room => { room!.status = 'COLLECTING'; });
    expect((await h.view()).status).toBe('READY');
  });

  it('consumes duplicate solver deliveries once and refuses service cross-room use', async () => {
    const h = await setup(); await h.confirm(); await h.ok('maya', 'REQUEST_SOLVE', {});
    const job = (await h.app.pendingSolveJob(service, roomId))!;
    const results = await Promise.all([h.app.runSolveJob(service, roomId, job.id), h.app.runSolveJob(service, roomId, job.id)]);
    expect(results.sort()).toEqual(['PUBLISHED', 'STALE']);
    expect((await h.owner('nina')).pendingOffers).toHaveLength(1);
    await expect(h.app.pendingSolveJob({ kind: 'service', subject: 'worker', roomIds: ['another-room'] }, roomId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects jobs already superseded before start without invoking the solver', async () => {
    let calls = 0;
    const h = await setup(input => { calls += 1; return solveDecision(input); });
    await h.confirm(); await h.ok('maya', 'REQUEST_SOLVE', {});
    const job = (await h.app.pendingSolveJob(service, roomId))!;
    await h.ok('organizer', 'REVISE_DECISION', { schedule: h.fixture.schedule,
      roster: h.fixture.roster.map(p => ({ ...p, submitted: false })), policy: 'LOWEST_INCONVENIENCE' });
    expect(await h.app.runSolveJob(service, roomId, job.id)).toBe('STALE');
    expect(calls).toBe(0);
  });

  it('cannot finalize if the permission expires while hashing the final approval', async () => {
    const h = await setup(); await h.allow();
    const proposal = (await h.view()).proposal!;
    const target = { proposalId: proposal.id, proposalVersion: proposal.facts.proposalVersion, planHash: proposal.planHash };
    for (const member of ['maya', 'leo']) await h.ok(member, 'ACCEPT_PROPOSAL', target);
    const command = await h.command('ACCEPT_PROPOSAL', target);
    let reads = 0;
    h.setClock(() => ++reads === 1 ? h.fixture.now : proposal.validUntil);
    expect(await h.app.execute(participant('nina'), command)).toMatchObject({ ok: false, error: { code: 'STALE_PROPOSAL' } });
    expect((await h.view()).status).not.toBe('AGREED');
    expect(await h.repository.transaction(roomId, room => room!.agreementHistory)).toEqual([]);
  });

  it('rechecks disclosure expiry after asynchronous hashing immediately before publication', async () => {
    const h = await setup();
    const preview = await h.allow();
    await h.ok('nina', 'DECIDE_DISCLOSURE', { preview, decision: 'ALLOW' });
    const grant = (await h.owner('nina')).disclosureGrants[0]!;
    const command = await h.command('PUBLISH_DISCLOSURE', { grantId: grant.id, grantVersion: grant.version });
    let reads = 0;
    h.setClock(() => ++reads === 1 ? h.fixture.now : preview.expiresAt);
    expect(await h.app.execute(service, command)).toMatchObject({ ok: false, error: { code: 'STALE_CONTEXT' } });
    expect((await h.view()).publishedDisclosures).toEqual([]);
  });

  it('rolls back exception acceptance if the offer expires during disclosure hashing', async () => {
    const h = await setup();
    const offer = await h.offer();
    const command = await h.command('DECIDE_EXCEPTION', { offerId: offer.id, offerVersion: offer.version, scope: offer.scope, decision: 'ALLOW' });
    let reads = 0;
    h.setClock(() => ++reads === 1 ? h.fixture.now : offer.scope.expiresAt);
    expect(await h.app.execute(participant('nina'), command)).toMatchObject({ ok: false, error: { code: 'STALE_CONTEXT' } });
    expect((await h.owner('nina')).exceptionGrants).toEqual([]);
  });
});

describe('in-memory repository transaction contract', () => {
  it('rolls back failed transitions, detaches return values and serializes competing writes', async () => {
    const h = await setup();
    const initial = await h.view();
    await expect(h.repository.transaction(roomId, room => {
      room!.policy = 'LOWEST_INCONVENIENCE';
      throw new Error('abort');
    })).rejects.toThrow('abort');
    expect((await h.view()).policy).toBe(initial.policy);
    const detached = await h.repository.transaction(roomId, room => room!);
    detached.policy = 'LOWEST_INCONVENIENCE';
    expect((await h.view()).policy).toBe(initial.policy);
    await Promise.all(Array.from({ length: 10 }, () => h.repository.transaction(roomId, async room => {
      const prior = room!.controlVersion;
      await Promise.resolve();
      room!.controlVersion = prior + 1;
    })));
    expect((await h.view()).controlVersion).toBe(initial.controlVersion + 10);
  });
});
