import { describe, expect, it } from 'vitest';
import { DealTableApplication, type TrustedPrincipal } from '@deal-table/application';
import { InMemoryRoomRepository } from '@deal-table/adapters';
import { CommandResult, OwnerSnapshot, PublicRoomSnapshot, hashPublicProposal, type CommandEnvelope } from '@deal-table/contracts';
import { solveDecision, type SolveDecisionInput, type SolveDecisionResult } from '@deal-table/domain';
import { buildTeamTableFixture } from '@deal-table/test-support';

const actor = (subject: string): TrustedPrincipal => ({ kind: 'participant', subject });
const roomId = 'room-synthetic';
const service: TrustedPrincipal = { kind: 'service', subject: 'local-worker', roomIds: [roomId] };
const display: TrustedPrincipal = { kind: 'display', subject: 'local-display', roomId };
const version = (snapshot: PublicRoomSnapshot) => ({ contextToken: snapshot.contextToken, decisionRevision: snapshot.decisionRevision, controlVersion: snapshot.controlVersion });

async function harness(solver?: (input: SolveDecisionInput) => SolveDecisionResult | Promise<SolveDecisionResult>) {
  const fixture = buildTeamTableFixture();
  let time = fixture.now;
  let sequence = 0;
  const repository = new InMemoryRoomRepository();
  const app = new DealTableApplication({ repository, clock: { now: () => time }, ids: { next: () => `test-id-${++sequence}` }, ...(solver ? { solver } : {}) });
  await app.createRoom({ roomId, schedule: fixture.schedule, roster: fixture.roster.map(member => ({ ...member, submitted: false })), policy: fixture.policy, organizerSubject: 'organizer', memberships: fixture.roster.map(member => ({ subject: member.id, memberId: member.id })) });
  const publicView = () => app.getPublicSnapshot(display, roomId);
  const owner = (member: string) => app.getOwnerSnapshot(actor(member), roomId);
  async function envelope(type: CommandEnvelope['type'], payload: unknown): Promise<unknown> {
    return { schemaVersion: 1, requestId: `request-${++sequence}`, idempotencyKey: `key-${sequence}`, roomId, expected: version(await publicView()), type, payload };
  }
  async function send(member: string | TrustedPrincipal, type: CommandEnvelope['type'], payload: unknown) {
    const result = await app.execute(typeof member === 'string' ? actor(member) : member, await envelope(type, payload));
    expect(CommandResult.safeParse(result).success).toBe(true);
    return result;
  }
  async function applied(member: string | TrustedPrincipal, type: CommandEnvelope['type'], payload: unknown) {
    const result = await send(member, type, payload);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    return result;
  }
  async function confirmAll() {
    for (const input of fixture.owners) {
      const member = input.ownerMemberId;
      await applied(member, 'SUBMIT_INPUT_DRAFT', { expectedOwnerRevision: (await owner(member)).ownerRevision, values: input.confirmedInputs.values });
      const snapshot = await owner(member);
      await applied(member, 'CONFIRM_INPUTS', { draftId: snapshot.draft!.draftId, draftRevision: snapshot.draft!.draftRevision, expectedOwnerRevision: snapshot.ownerRevision, reviewedIntervals: input.availabilityReview.intervals });
    }
    for (const member of fixture.roster) await applied(member.id, 'ACCEPT_CONTEXT', { policy: fixture.policy });
  }
  async function runJob() {
    const job = await app.pendingSolveJob(service, roomId);
    expect(job).not.toBeNull();
    return app.runSolveJob(service, roomId, job!.id);
  }
  async function offer() {
    await confirmAll();
    await applied('maya', 'REQUEST_SOLVE', {});
    await runJob();
    expect((await publicView()).status).toBe('PRIVATE_REVIEW');
    const offers = (await owner('nina')).pendingOffers;
    expect(offers).toHaveLength(1);
    return offers[0]!;
  }
  async function propose() {
    const candidate = await offer();
    await applied('nina', 'DECIDE_EXCEPTION', { offerId: candidate.id, offerVersion: candidate.version, scope: candidate.scope, decision: 'ALLOW' });
    await runJob();
    const proposal = (await publicView()).proposal;
    expect(proposal).not.toBeNull();
    return { proposalId: proposal!.id, proposalVersion: proposal!.facts.proposalVersion, planHash: proposal!.planHash };
  }
  return { app, fixture, repository, publicView, owner, envelope, send, applied, confirmAll, runJob, offer, propose, setTime: (value: string) => { time = value; } };
}

describe('B02 integrated application boundaries and consent', () => {
  it('completes the actual solver negotiation with independent disclosure refusal and three exact approvals', async () => {
    const h = await harness();
    const target = await h.propose();
    const nina = await h.owner('nina');
    expect(nina.disclosurePreviews).toHaveLength(1);
    await h.applied('nina', 'DECIDE_DISCLOSURE', { preview: nina.disclosurePreviews[0], decision: 'DECLINE' });
    expect((await h.owner('nina')).exceptionGrants[0]!.status).toBe('ACTIVE');
    for (const member of ['maya', 'leo']) await h.applied(member, 'ACCEPT_PROPOSAL', target);
    expect((await h.publicView()).status).toBe('APPROVING');
    await h.applied('nina', 'ACCEPT_PROPOSAL', target);
    const view = PublicRoomSnapshot.parse(await h.publicView());
    expect(view.status).toBe('AGREED');
    expect(view.proposal!.planHash).toBe(await hashPublicProposal(view.proposal!.facts));
    expect(view.proposal!.facts.plan.assignments.map(a => [a.duty.id, a.participantId]).sort()).toEqual([['followup', 'leo'], ['lead', 'maya']]);
    expect(view.publishedDisclosures).toEqual([]);
    expect(JSON.stringify(view)).not.toMatch(/nina-thursday|maya-available|dutyCosts|requiredGrants|DECLINED|ranking|textHash/);
    expect(OwnerSnapshot.safeParse(await h.owner('maya')).success).toBe(true);
    expect((await h.owner('maya')).exceptionGrants).toEqual([]);
  });

  it('isolates owner reads and rejects organizer impersonation, display writes and cross-room scopes', async () => {
    const h = await harness();
    await expect(h.app.getOwnerSnapshot(actor('organizer'), roomId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(h.app.getOwnerSnapshot(display, roomId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(h.app.getPublicSnapshot({ ...display, roomId: 'different-room' }, roomId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const command = await h.envelope('ACCEPT_CONTEXT', { policy: h.fixture.policy });
    expect(await h.app.execute(null, command)).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
    await expect(h.app.getPublicSnapshot(actor('outsider'), 'absent-room')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await h.app.execute(display, command)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await h.app.execute(actor('outsider'), { invalid: true, roomId })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await h.send('maya', 'ACCEPT_CONTEXT', { policy: h.fixture.policy, ownerMemberId: 'nina' })).toMatchObject({ ok: false, error: { code: 'INVALID_COMMAND' } });
  });

  it('replays identical authorized commands but rejects same-key changed bodies and lost membership', async () => {
    const h = await harness();
    const command = await h.envelope('SUBMIT_INPUT_DRAFT', { expectedOwnerRevision: 0, values: h.fixture.owners[0]!.confirmedInputs.values }) as Record<string, unknown>;
    const first = await h.app.execute(actor('maya'), command);
    expect(first.ok).toBe(true);
    const receipts = await h.repository.transaction(roomId, room => room!.replays);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ keyHash: expect.stringMatching(/^[a-f0-9]{64}$/), bodyHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(receipts[0]).not.toHaveProperty('key');
    expect(receipts[0]).not.toHaveProperty('body');
    expect(JSON.stringify(receipts)).not.toContain('maya');
    expect(await h.app.execute(actor('maya'), { ...command, requestId: 'retry-correlation' })).toEqual(first);
    expect(await h.app.execute(actor('maya'), { ...command, payload: { expectedOwnerRevision: 99, values: h.fixture.owners[0]!.confirmedInputs.values } })).toMatchObject({ ok: false, error: { code: 'IDEMPOTENCY_CONFLICT' } });
    const roster = h.fixture.roster.map(member => ({ ...member, submitted: false as const, id: member.id === 'maya' ? 'new-member' : member.id }));
    const schedule = structuredClone(h.fixture.schedule);
    for (const duty of schedule.duties) duty.qualifiedMemberIds = duty.qualifiedMemberIds.map(id => id === 'maya' ? 'new-member' : id);
    await h.applied('organizer', 'REVISE_DECISION', { schedule, roster, policy: h.fixture.policy });
    expect(await h.app.execute(actor('maya'), command)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('caps private grant history without disabling revocation at the cap', async () => {
    const h = await harness();
    const offer = await h.offer();
    await h.repository.transaction(roomId, room => {
      const owner = room!.owners.find(value => value.memberId === 'nina')!;
      owner.exceptions = Array.from({ length: 32 }, (_, index) => ({
        id: `history-grant-${index}`, version: 1, scope: structuredClone(offer.scope),
        status: index === 31 ? 'ACTIVE' as const : 'DECLINED' as const,
      }));
    });
    const decision = await h.envelope('DECIDE_EXCEPTION', {
      offerId: offer.id, offerVersion: offer.version, decision: 'ALLOW', scope: offer.scope,
    });
    expect(await h.app.execute(actor('nina'), decision)).toMatchObject({
      ok: false, error: { code: 'ROOM_CAPACITY_REACHED', httpStatus: 409 },
    });
    expect((await h.owner('nina')).pendingOffers).toHaveLength(1);

    const revoke = await h.envelope('REVOKE_EXCEPTION', { grantId: 'history-grant-31', grantVersion: 1 });
    expect(await h.app.execute(actor('nina'), revoke)).toMatchObject({ ok: true });
    expect((await h.owner('nina')).exceptionGrants.find(grant => grant.id === 'history-grant-31')?.status).toBe('REVOKED');
  });

  it('caps immutable agreement receipts without partially recording another final approval', async () => {
    const h = await harness();
    const target = await h.propose();
    const proposal = (await h.publicView()).proposal!;
    await h.repository.transaction(roomId, room => {
      room!.agreementHistory = Array.from({ length: 64 }, () => ({
        proposal: structuredClone(proposal), approvals: [], agreedAt: h.fixture.now,
      }));
    });
    await h.applied('maya', 'ACCEPT_PROPOSAL', target);
    await h.applied('leo', 'ACCEPT_PROPOSAL', target);
    expect(await h.send('nina', 'ACCEPT_PROPOSAL', target)).toMatchObject({
      ok: false, error: { code: 'ROOM_CAPACITY_REACHED', httpStatus: 409 },
    });
    expect((await h.publicView()).status).toBe('APPROVING');
    expect((await h.owner('nina')).ownApproval).toBeNull();
    expect(await h.repository.transaction(roomId, room => room!.agreementHistory)).toHaveLength(64);
  });

  it('requires fresh context consent without broadening explicitly reviewed intervals', async () => {
    const h = await harness();
    await h.confirmAll();
    const maya = await h.owner('maya');
    expect(maya.availabilityReview!.intervals).toEqual(h.fixture.owners[0]!.availabilityReview.intervals);
    expect(maya.confirmedInputs!.contextToken).toBe((await h.publicView()).contextToken);
    const stale = await h.envelope('REQUEST_SOLVE', {});
    await h.applied('leo', 'SUBMIT_INPUT_DRAFT', { expectedOwnerRevision: (await h.owner('leo')).ownerRevision, values: h.fixture.owners[1]!.confirmedInputs.values });
    expect(await h.app.execute(actor('maya'), stale)).toMatchObject({ ok: false, error: { code: 'STALE_CONTEXT' } });
  });

  it('keeps authenticated rejected-command retries bound to their original body', async () => {
    const h = await harness();
    const command = await h.envelope('SUBMIT_INPUT_DRAFT', { expectedOwnerRevision: 99, values: h.fixture.owners[0]!.confirmedInputs.values }) as Record<string, unknown>;
    const original = await h.app.execute(actor('maya'), command);
    expect(original).toMatchObject({ ok: false, error: { code: 'STALE_CONTEXT' } });
    expect(await h.app.execute(actor('maya'), { ...command, requestId: 'rejected-retry' })).toEqual(original);
    expect(await h.app.execute(actor('maya'), { ...command, payload: { expectedOwnerRevision: 0, values: h.fixture.owners[0]!.confirmedInputs.values } })).toMatchObject({ ok: false, error: { code: 'IDEMPOTENCY_CONFLICT' } });
    expect((await h.owner('maya')).draft).toBeNull();
  });

  it('allows a private decline without repeated exception requests or public refusal details', async () => {
    const h = await harness();
    const offer = await h.offer();
    await h.applied('nina', 'DECIDE_EXCEPTION', { offerId: offer.id, offerVersion: offer.version, scope: offer.scope, decision: 'DECLINE' });
    const retry = await h.send('maya', 'REQUEST_SOLVE', {});
    if (retry.ok) await h.runJob();
    expect((await h.owner('nina')).pendingOffers).toEqual([]);
    expect((await h.publicView()).status).toBe('NO_AGREEMENT');
    expect(JSON.stringify(await h.publicView())).not.toContain('DECLINED');
  });

  it('binds publication to exact owner consent and retains an already published receipt after revocation', async () => {
    const h = await harness();
    await h.propose();
    const preview = (await h.owner('nina')).disclosurePreviews[0]!;
    expect(await h.send('nina', 'DECIDE_DISCLOSURE', { preview: { ...preview, text: 'A different sentence.' }, decision: 'ALLOW' })).toMatchObject({ ok: false });
    await h.applied('nina', 'DECIDE_DISCLOSURE', { preview, decision: 'ALLOW' });
    const grant = (await h.owner('nina')).disclosureGrants[0]!;
    const target = { grantId: grant.id, grantVersion: grant.version };
    expect(await h.send('organizer', 'PUBLISH_DISCLOSURE', target)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    await h.applied(service, 'PUBLISH_DISCLOSURE', target);
    const receipt = (await h.publicView()).publishedDisclosures;
    expect(receipt).toHaveLength(1);
    expect((await h.app.getPublicSnapshot(actor('organizer'), roomId)).publishedDisclosures).toEqual([]);
    expect((await h.app.getPublicSnapshot(actor('maya'), roomId)).publishedDisclosures).toEqual(receipt);
    const current = (await h.owner('nina')).disclosureGrants[0]!;
    await h.applied('nina', 'REVOKE_DISCLOSURE', { grantId: current.id, grantVersion: current.version });
    expect((await h.publicView()).publishedDisclosures).toEqual(receipt);
    expect((await h.publicView()).proposal).not.toBeNull();
    expect(await h.send(service, 'PUBLISH_DISCLOSURE', target)).toMatchObject({ ok: false });
  });

  it('rejects mismatched plan acceptance and supersedes an agreement when approval is withdrawn', async () => {
    const h = await harness();
    const target = await h.propose();
    expect(await h.send('maya', 'ACCEPT_PROPOSAL', { ...target, planHash: '0'.repeat(64) })).toMatchObject({ ok: false, error: { code: 'STALE_PROPOSAL' } });
    for (const member of ['maya', 'leo', 'nina']) await h.applied(member, 'ACCEPT_PROPOSAL', target);
    await h.applied('maya', 'WITHDRAW_APPROVAL', target);
    const view = await h.publicView();
    expect(view.status).toBe('SUPERSEDED');
    expect(view.proposal).toBeNull();
    expect(view.approvedMemberIds).toEqual([]);
  });

  it('does not republish old disclosure text to a display with a changed audience', async () => {
    const h = await harness();
    await h.propose();
    const preview = (await h.owner('nina')).disclosurePreviews[0]!;
    await h.applied('nina', 'DECIDE_DISCLOSURE', { preview, decision: 'ALLOW' });
    const grant = (await h.owner('nina')).disclosureGrants[0]!;
    await h.applied(service, 'PUBLISH_DISCLOSURE', { grantId: grant.id, grantVersion: grant.version });
    expect((await h.publicView()).publishedDisclosures).toHaveLength(1);
    const roster = h.fixture.roster.map(member => ({ ...member, submitted: false, id: member.id === 'maya' ? 'new-member' : member.id }));
    const schedule = structuredClone(h.fixture.schedule);
    for (const duty of schedule.duties) duty.qualifiedMemberIds = duty.qualifiedMemberIds.map(id => id === 'maya' ? 'new-member' : id);
    await h.applied('organizer', 'REVISE_DECISION', { schedule, roster, policy: h.fixture.policy });
    expect((await h.publicView()).publishedDisclosures).toEqual([]);
  });

  it('expires scoped permission and active proposals using the injected clock', async () => {
    const h = await harness();
    const target = await h.propose();
    h.setTime((await h.owner('nina')).exceptionGrants[0]!.scope.expiresAt);
    expect((await h.publicView()).proposal).toBeNull();
    expect((await h.owner('nina')).exceptionGrants[0]!.status).toBe('EXPIRED');
    expect(await h.send('maya', 'ACCEPT_PROPOSAL', target)).toMatchObject({ ok: false });
  });

  it.each(['revoke-first', 'accept-first'])('orders final approval and revocation atomically: %s', async order => {
    const h = await harness();
    const target = await h.propose();
    for (const member of ['maya', 'leo']) await h.applied(member, 'ACCEPT_PROPOSAL', target);
    const grant = (await h.owner('nina')).exceptionGrants[0]!;
    const revoke = await h.envelope('REVOKE_EXCEPTION', { grantId: grant.id, grantVersion: grant.version });
    const accept = await h.envelope('ACCEPT_PROPOSAL', target);
    const actions = order === 'revoke-first' ? [revoke, accept] : [accept, revoke];
    const results = await Promise.all(actions.map(command => h.app.execute(actor('nina'), command)));
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.filter(result => !result.ok)).toHaveLength(1);
    if (order === 'accept-first') {
      expect((await h.publicView()).status).toBe('AGREED');
      await h.applied('nina', 'REVOKE_EXCEPTION', { grantId: grant.id, grantVersion: grant.version });
    }
    expect((await h.publicView()).proposal).toBeNull();
  });

  it('invalidates consent on duration change and refuses silent coverage reuse', async () => {
    const h = await harness();
    const target = await h.propose();
    const schedule = structuredClone(h.fixture.schedule);
    for (const slot of schedule.slots) slot.interval.endMinute += 30;
    await h.applied('organizer', 'REVISE_DECISION', { schedule, roster: h.fixture.roster.map(member => ({ ...member, submitted: false })), policy: h.fixture.policy });
    expect((await h.publicView()).proposal).toBeNull();
    expect((await h.owner('nina')).exceptionGrants.every(grant => grant.status !== 'ACTIVE')).toBe(true);
    expect((await h.owner('maya')).availabilityReview).toBeNull();
    expect(await h.send('maya', 'ACCEPT_PROPOSAL', target)).toMatchObject({ ok: false });
    expect(await h.send('maya', 'REQUEST_SOLVE', {})).toMatchObject({ ok: false });
  });

  it('cannot publish a solver result after its semantic context changes in flight', async () => {
    let started!: () => void;
    let resume!: () => void;
    const running = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { resume = resolve; });
    const h = await harness(async input => { started(); await gate; return solveDecision(input); });
    await h.confirmAll();
    await h.applied('maya', 'REQUEST_SOLVE', {});
    const job = await h.app.pendingSolveJob(service, roomId);
    const completion = h.app.runSolveJob(service, roomId, job!.id);
    await running;
    await h.applied('organizer', 'REVISE_DECISION', { schedule: h.fixture.schedule, roster: h.fixture.roster.map(member => ({ ...member, submitted: false })), policy: 'LOWEST_INCONVENIENCE' });
    resume();
    expect(await completion).toBe('STALE');
    expect((await h.publicView()).proposal).toBeNull();
    expect((await h.owner('nina')).pendingOffers).toEqual([]);
  });

  it('closes the room under the same version guard and prevents further approval', async () => {
    const h = await harness();
    const target = await h.propose();
    await h.app.closeRoom(actor('organizer'), roomId, version(await h.publicView()));
    expect((await h.publicView()).status).toBe('CLOSED');
    expect(await h.send('maya', 'ACCEPT_PROPOSAL', target)).toMatchObject({ ok: false });
    expect(await h.send('maya', 'REQUEST_SOLVE', {})).toMatchObject({ ok: false });
  });
});
