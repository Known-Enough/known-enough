import { describe, expect, it } from 'vitest';
import { InMemoryRoomRepository } from '@deal-table/adapters';
import { encodeDecisionStateItem, decodeDecisionStateItem } from '../../adapters/src/dynamodb-codec.ts';
import { KnownEnough as KE } from '@deal-table/contracts';
import { buildChristmasFixture } from '../../test-support/src/known-enough-fixtures.ts';
import { KnownEnoughApplication, type TrustedPrincipal } from './index.ts';

const decisionId = 'christmas-decision';
const participant = (subject: string): TrustedPrincipal => ({ kind: 'participant', subject });
const service: TrustedPrincipal = { kind: 'service', subject: 'worker', roomIds: [decisionId] };

async function setup(optionalMember = false) {
  const fixture = buildChristmasFixture();
  if (optionalMember) {
    fixture.definition.requiredParticipantIds = fixture.definition.requiredParticipantIds.filter(id => id !== 'raul');
    fixture.definition.participants.find(person => person.id === 'raul')!.requiredForApproval = false;
  }
  let sequence = 0;
  let now = '2026-10-01T12:00:00.000Z';
  const repository = new InMemoryRoomRepository();
  const app = new KnownEnoughApplication({
    repository,
    clock: { now: () => now },
    ids: { next: () => `ke03-id-${++sequence}` },
  });
  await app.createDecision({
    definition: fixture.definition,
    creatorSubject: 'subject-maya',
    memberships: fixture.definition.participants.map(item => ({
      subject: `subject-${item.id}`, participantId: item.id, active: true,
    })),
  });
  const byMember = (participantId: string) => participant(`subject-${participantId}`);
  async function command(
    participantId: string,
    type: 'CONFIRM_FRAME' | 'CONFIRM_CONSTRAINTS' | 'ANSWER_NEGOTIATION' | 'DECIDE_DISCLOSURE' | 'APPROVE_PROPOSAL' | 'WITHDRAW_APPROVAL' | 'REVOKE_NEGOTIATION' | 'REVOKE_DISCLOSURE',
    payload: unknown,
    idempotencyKey = `idem-${participantId}-${type}`,
  ) {
    const owner = await app.getOwnerSnapshot(byMember(participantId), decisionId);
    return {
      schemaVersion: KE.KE_SCHEMA_VERSION,
      type,
      requestId: `req-${participantId}-${type}`,
      decisionId,
      idempotencyKey,
      expected: {
        contextToken: owner.publicSnapshot.contextToken,
        semanticVersion: owner.publicSnapshot.semanticVersion,
        controlVersion: owner.controlVersion,
        ownerVersion: owner.ownerVersion,
      },
      payload,
    };
  }
  return { app, fixture, byMember, command, repository, setNow: (value: string) => { now = value; } };
}

async function makeReady(h: Awaited<ReturnType<typeof setup>>, negotiable = false) {
  for (const participantId of h.fixture.definition.requiredParticipantIds) {
    const confirm = await h.command(participantId, 'CONFIRM_FRAME', { frameVersion: h.fixture.definition.frameVersion });
    expect((await h.app.execute(h.byMember(participantId), confirm)).ok).toBe(true);
  }
  for (const participantId of h.fixture.definition.requiredParticipantIds) {
    const owner = await h.app.getOwnerSnapshot(h.byMember(participantId), decisionId);
    const source = negotiable && participantId === 'nina'
      ? h.fixture.drafts.find(item => item.ownerParticipantId === participantId)!
      : null;
    const draft = KE.AIConstraintDraft.parse(source ? {
      ...source, draftId: `draft-${participantId}`, draftVersion: 1, ownerVersion: owner.ownerVersion,
      contextToken: owner.publicSnapshot.contextToken, semanticVersion: owner.publicSnapshot.semanticVersion,
      createdAt: '2026-10-01T12:00:00.000Z',
    } : {
      schemaVersion: KE.KE_SCHEMA_VERSION, draftId: `draft-${participantId}`, draftVersion: 1,
      decisionId, ownerParticipantId: participantId, ownerVersion: owner.ownerVersion,
      semanticVersion: owner.publicSnapshot.semanticVersion, contextToken: owner.publicSnapshot.contextToken,
      sourceSummary: 'No additional private constraints were proposed.',
      proposedConstraints: [], unsupportedConditions: [], createdAt: '2026-10-01T12:00:00.000Z',
    });
    await h.app.storeConstraintDraft(service, draft);
    const command = await h.command(participantId, 'CONFIRM_CONSTRAINTS', {
      draftId: draft.draftId, draftVersion: draft.draftVersion,
      constraintIds: source ? ['nina-destination-flexibility'] : [],
    });
    expect((await h.app.execute(h.byMember(participantId), command)).ok).toBe(true);
  }
}

async function christmasCandidate(
  h: Awaited<ReturnType<typeof setup>>,
  permissionDependencies: unknown[] = [],
  destination = 'cancun',
  proposalVersion = 1,
) {
  const snapshot = await h.app.getPublicSnapshot(h.byMember('maya'), decisionId);
  return KE.CandidateProposal.parse({
    schemaVersion: KE.KE_SCHEMA_VERSION,
    proposalId: 'christmas-proposal', decisionId,
    semanticVersion: snapshot.semanticVersion,
    contextToken: snapshot.contextToken,
    proposalVersion,
    values: [
      { variableId: 'destination', value: { type: 'ENUM', optionId: destination } },
      { variableId: 'trip-start', value: { type: 'DATE', date: '2026-12-24' } },
      { variableId: 'trip-end', value: { type: 'DATE', date: '2026-12-29' } },
      { variableId: 'trip-duration', value: { type: 'DURATION', seconds: 604_800 } },
      { variableId: 'accommodation', value: { type: 'ENUM', optionId: 'quiet-hotel' } },
      { variableId: 'estimated-total', value: { type: 'MONEY', amountMinor: 1_000_000, currencyCode: 'USD', minorUnit: 2 } },
    ],
    validation: { status: 'VALID', checkedRuleIds: [], failedRuleIds: [], unknownRuleIds: [], unsupportedConditionIds: [] },
    permissionDependencies,
    createdAt: '2026-10-01T12:00:00.000Z',
  });
}

describe('Known Enough application lifecycle', () => {
  it('stores a five-person decision and returns strict public and owner-scoped projections', async () => {
    const h = await setup();
    const publicView = await h.app.getPublicSnapshot({ kind: 'display', subject: 'display', roomId: decisionId }, decisionId);
    expect(publicView.frame.participants).toHaveLength(5);
    expect(publicView.status).toBe('COLLECTING_FRAME_CONFIRMATION');
    expect(publicView.frame.variables.some(variable => h.fixture.definition.variables.some(privateVariable =>
      privateVariable.id === variable.id && privateVariable.visibility === 'OWNER_PRIVATE'))).toBe(false);
    expect(JSON.stringify(publicView)).not.toContain('Maya private');

    const maya = await h.app.getOwnerSnapshot(h.byMember('maya'), decisionId);
    expect(maya.privateVariables.every(variable => variable.ownerParticipantId === 'maya')).toBe(true);
    expect(maya.privateVariables.some(variable => variable.ownerParticipantId === 'leo')).toBe(false);
    await expect(h.app.getOwnerSnapshot(participant('outsider'), decisionId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(h.app.getPublicSnapshot({ kind: 'display', subject: 'display', roomId: 'other-decision' }, decisionId))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(h.app.startReasoning({ kind: 'service', subject: 'wrong-worker', roomIds: ['other-decision'] }, decisionId))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('confirms the current frame, handles exact idempotent replay, and rejects key reuse', async () => {
    const h = await setup();
    const command = await h.command('maya', 'CONFIRM_FRAME', { frameVersion: h.fixture.definition.frameVersion }, 'same-key');
    const first = await h.app.execute(h.byMember('maya'), command);
    expect(first).toMatchObject({ ok: true, controlVersion: 1, ownerVersion: 1 });
    expect(await h.app.execute(h.byMember('maya'), command)).toEqual(first);

    const reused = { ...command, payload: { frameVersion: h.fixture.definition.frameVersion + 1 } };
    expect(await h.app.execute(h.byMember('maya'), reused)).toMatchObject({
      ok: false, error: { code: 'IDEMPOTENCY_CONFLICT', httpStatus: 409 },
    });
    expect((await h.app.getOwnerSnapshot(h.byMember('maya'), decisionId)).controlVersion).toBe(1);
  });

  it('requires every current required participant to confirm before private inputs become ready', async () => {
    const h = await setup();
    for (const person of h.fixture.definition.requiredParticipantIds.slice(0, -1)) {
      const command = await h.command(person, 'CONFIRM_FRAME', { frameVersion: h.fixture.definition.frameVersion });
      expect((await h.app.execute(h.byMember(person), command)).ok).toBe(true);
    }
    expect((await h.app.getPublicSnapshot(h.byMember('maya'), decisionId)).status)
      .toBe('COLLECTING_FRAME_CONFIRMATION');
    const last = h.fixture.definition.requiredParticipantIds.at(-1)!;
    const command = await h.command(last, 'CONFIRM_FRAME', { frameVersion: h.fixture.definition.frameVersion });
    expect((await h.app.execute(h.byMember(last), command)).ok).toBe(true);
    expect((await h.app.getPublicSnapshot(h.byMember('maya'), decisionId)).status).toBe('COLLECTING_PRIVATE_INPUT');
  });

  it('binds trusted drafts to the exact owner/context and confirms selected constraints privately', async () => {
    const h = await setup();
    for (const person of h.fixture.definition.requiredParticipantIds) {
      const command = await h.command(person, 'CONFIRM_FRAME', { frameVersion: h.fixture.definition.frameVersion });
      expect((await h.app.execute(h.byMember(person), command)).ok).toBe(true);
    }
    const owner = await h.app.getOwnerSnapshot(h.byMember('maya'), decisionId);
    const sourceDraft = h.fixture.drafts.find(item => item.ownerParticipantId === 'maya')!;
    const draft = KE.AIConstraintDraft.parse({
      ...sourceDraft,
      contextToken: owner.publicSnapshot.contextToken,
      ownerVersion: owner.ownerVersion,
      draftVersion: 1,
    });
    await h.app.storeConstraintDraft(service, draft);
    const afterDraft = await h.app.getOwnerSnapshot(h.byMember('maya'), decisionId);
    const command = await h.command('maya', 'CONFIRM_CONSTRAINTS', {
      draftId: draft.draftId, draftVersion: draft.draftVersion,
      constraintIds: [draft.proposedConstraints[0]!.constraintId],
    });
    expect(await h.app.execute(h.byMember('maya'), command)).toMatchObject({ ok: true, ownerVersion: 2 });
    const confirmed = await h.app.getOwnerSnapshot(h.byMember('maya'), decisionId);
    expect(confirmed.confirmedConstraints).toHaveLength(1);
    expect(confirmed.confirmedConstraints[0]).toMatchObject({ ownerParticipantId: 'maya', status: 'ACTIVE' });
    expect(confirmed.ownInputReadiness).toBe('READY');
    expect(afterDraft.controlVersion).toBeGreaterThan(owner.controlVersion);
  });

  it('rejects local display/mock identities from participant commands', async () => {
    const h = await setup();
    const command = await h.command('maya', 'CONFIRM_FRAME', { frameVersion: h.fixture.definition.frameVersion });
    const result = await h.app.execute({ kind: 'display', subject: 'display', roomId: decisionId }, command);
    expect(result).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('serializes competing approvals and revision, then clears current approval authority on revision', async () => {
    const h = await setup();
    await makeReady(h);
    const job = await h.app.startReasoning(service, decisionId);
    const candidate = await christmasCandidate(h);
    expect(await h.app.completeReasoning(service, decisionId, job.id, candidate)).toBe('APPLIED');
    const proposal = (await h.app.getPublicSnapshot(h.byMember('maya'), decisionId)).currentProposal!;

    const competing = await Promise.all(['maya', 'leo'].map(async person => {
      const command = await h.command(person, 'APPROVE_PROPOSAL', {
        proposalId: proposal.proposalId, proposalVersion: proposal.facts.proposalVersion, publicHash: proposal.publicHash,
      }, `approve-race-${person}`);
      return h.app.execute(h.byMember(person), command);
    }));
    expect(competing.filter(result => result.ok)).toHaveLength(1);
    expect(competing.filter(result => !result.ok && result.error.code === 'STALE_CONTEXT')).toHaveLength(1);

    for (const person of h.fixture.definition.requiredParticipantIds) {
      const owner = await h.app.getOwnerSnapshot(h.byMember(person), decisionId);
      if (owner.ownApproval) continue;
      const command = await h.command(person, 'APPROVE_PROPOSAL', {
        proposalId: proposal.proposalId, proposalVersion: proposal.facts.proposalVersion, publicHash: proposal.publicHash,
      }, `approve-final-${person}`);
      expect((await h.app.execute(h.byMember(person), command)).ok).toBe(true);
    }
    expect((await h.app.getPublicSnapshot(h.byMember('maya'), decisionId)).status).toBe('AGREED');

    const withdraw = await h.command('maya', 'WITHDRAW_APPROVAL', {
      proposalId: proposal.proposalId, proposalVersion: proposal.facts.proposalVersion, publicHash: proposal.publicHash,
    }, 'withdraw-vs-revise');
    const nextDefinition = KE.DecisionDefinition.parse({
      ...h.fixture.definition, frameVersion: 2, semanticVersion: 2,
      title: 'Family Christmas trip revised',
    });
    const currentOwner = await h.app.getOwnerSnapshot(h.byMember('maya'), decisionId);
    const revisionInput = {
      decisionId, expectedControlVersion: currentOwner.controlVersion, definition: nextDefinition,
      memberships: h.fixture.definition.participants.map(person => ({
        subject: `subject-${person.id}`, participantId: person.id, active: true,
      })),
    };
    const [withdrawResult, revisionApplied] = await Promise.all([
      h.app.execute(h.byMember('maya'), withdraw).then(result => result.ok),
      h.app.reviseDecision(service, revisionInput).then(() => true, () => false),
    ]);
    expect(Number(withdrawResult) + Number(revisionApplied)).toBe(1);

    const latestOwner = await h.app.getOwnerSnapshot(h.byMember('maya'), decisionId);
    if (!revisionApplied) await h.app.reviseDecision(service, { ...revisionInput, expectedControlVersion: latestOwner.controlVersion });
    const revised = await h.app.getPublicSnapshot(h.byMember('maya'), decisionId);
    expect(revised.status).toBe('COLLECTING_FRAME_CONFIRMATION');
    expect(revised.currentProposal).toBeNull();
    expect(revised.approvedParticipantIds).toEqual([]);
    const ownerAfter = await h.app.getOwnerSnapshot(h.byMember('maya'), decisionId);
    expect(ownerAfter.ownApproval).toBeNull();
  });

  it('rejects a worker result after a material context revision changes its job epoch', async () => {
    const h = await setup();
    await makeReady(h);
    const job = await h.app.startReasoning(service, decisionId);
    const staleCandidate = await christmasCandidate(h);
    const owner = await h.app.getOwnerSnapshot(h.byMember('maya'), decisionId);
    const nextDefinition = KE.DecisionDefinition.parse({
      ...h.fixture.definition, frameVersion: 2, semanticVersion: 2,
      title: 'Family Christmas trip revised',
    });
    await h.app.reviseDecision(service, {
      decisionId, expectedControlVersion: owner.controlVersion, definition: nextDefinition,
      memberships: h.fixture.definition.participants.map(person => ({
        subject: `subject-${person.id}`, participantId: person.id, active: true,
      })),
    });
    expect(await h.app.completeReasoning(service, decisionId, job.id, staleCandidate)).toBe('STALE');
    const revised = await h.app.getPublicSnapshot(h.byMember('maya'), decisionId);
    expect(revised.status).toBe('COLLECTING_FRAME_CONFIRMATION');
    expect(revised.currentProposal).toBeNull();
    expect(revised.contextToken).not.toBe(staleCandidate.contextToken);
  });

  it('keeps optional disclosure refusal independent from an agreed public proposal', async () => {
    const h = await setup();
    await makeReady(h);
    const job = await h.app.startReasoning(service, decisionId);
    expect(await h.app.completeReasoning(service, decisionId, job.id, await christmasCandidate(h))).toBe('APPLIED');
    const proposal = (await h.app.getPublicSnapshot(h.byMember('maya'), decisionId)).currentProposal!;
    const text = 'Maya approves sharing this synthetic note with Leo.';
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    const textHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    await h.app.requestDisclosure(service, {
      kind: 'EXACT_TEXT', permissionId: 'maya-note', permissionVersion: 1, decisionId,
      contextToken: proposal.facts.contextToken, semanticVersion: proposal.facts.semanticVersion,
      ownerParticipantId: 'maya', proposalId: proposal.proposalId,
      proposalVersion: proposal.facts.proposalVersion, audienceParticipantIds: ['leo'],
      status: 'PENDING', expiresAt: '2026-10-02T12:00:00.000Z', text, textHash,
    });
    for (const person of h.fixture.definition.requiredParticipantIds) {
      const approval = await h.command(person, 'APPROVE_PROPOSAL', {
        proposalId: proposal.proposalId, proposalVersion: proposal.facts.proposalVersion, publicHash: proposal.publicHash,
      }, `approve-with-pending-disclosure-${person}`);
      expect((await h.app.execute(h.byMember(person), approval)).ok).toBe(true);
    }
    const refusal = await h.command('maya', 'DECIDE_DISCLOSURE', {
      permissionId: 'maya-note', permissionVersion: 1, decision: 'DECLINE',
    }, 'decline-optional-note');
    expect((await h.app.execute(h.byMember('maya'), refusal)).ok).toBe(true);
    const snapshot = await h.app.getPublicSnapshot(h.byMember('leo'), decisionId);
    expect(snapshot.status).toBe('AGREED');
    expect(snapshot.currentProposal?.proposalId).toBe(proposal.proposalId);
    expect(snapshot.publishedDisclosures).toEqual([]);
    expect(JSON.stringify(snapshot)).not.toContain(text);
    expect((await h.app.getOwnerSnapshot(h.byMember('maya'), decisionId)).disclosurePermissions[0]?.status).toBe('DECLINED');
  });

  it('invalidates an approved proposal when an exact negotiation dependency is revoked', async () => {
    const h = await setup();
    const originalCondition = h.fixture.drafts.find(item => item.ownerParticipantId === 'nina')!.proposedConstraints[0]!;
    if (originalCondition.kind === 'NEGOTIABLE' && originalCondition.rule.operator === 'IN')
      originalCondition.rule.values = [{ type: 'ENUM', optionId: 'cancun' }];
    await makeReady(h, true);
    const nina = await h.app.getOwnerSnapshot(h.byMember('nina'), decisionId);
    const constraint = nina.confirmedConstraints.find(item => item.constraintId === 'nina-destination-flexibility')!;
    const question = await h.app.askNegotiation(service, {
      decisionId, participantId: 'nina', contextToken: nina.publicSnapshot.contextToken,
      semanticVersion: nina.publicSnapshot.semanticVersion, constraintId: constraint.constraintId,
      constraintVersion: constraint.constraintVersion,
      adjustment: {
        id: 'allow-mazatlan-and-oaxaca', visibility: 'TRUSTED_BACKEND', operator: 'IN', variableId: 'destination',
        values: [{ type: 'ENUM', optionId: 'mazatlan' }, { type: 'ENUM', optionId: 'oaxaca' }],
      },
      expiresAt: '2026-10-02T12:00:00.000Z',
    });
    expect(question).not.toBeNull();
    const answer = await h.command('nina', 'ANSWER_NEGOTIATION', {
      questionId: question!.questionId, constraintVersion: question!.constraintVersion,
      requestIdentity: question!.requestIdentity, answer: 'ALLOW',
    }, 'allow-nina-negotiation');
    expect((await h.app.execute(h.byMember('nina'), answer)).ok).toBe(true);
    const granted = await h.app.getOwnerSnapshot(h.byMember('nina'), decisionId);
    const permission = granted.negotiationPermissions[0]!;
    const job = await h.app.startReasoning(service, decisionId);
    const candidate = await christmasCandidate(h, [{
      permissionId: permission.permissionId, permissionVersion: permission.permissionVersion,
      kind: 'NEGOTIATION', expiresAt: permission.expiresAt,
    }], 'mazatlan');
    expect(await h.app.completeReasoning(service, decisionId, job.id, candidate)).toBe('APPLIED');

    const proposal = (await h.app.getPublicSnapshot(h.byMember('maya'), decisionId)).currentProposal!;
    const approve = await h.command('nina', 'APPROVE_PROPOSAL', {
      proposalId: proposal.proposalId, proposalVersion: proposal.facts.proposalVersion, publicHash: proposal.publicHash,
    }, 'approve-racing-revoke');
    const revoke = await h.command('nina', 'REVOKE_NEGOTIATION', {
      permissionId: permission.permissionId, permissionVersion: permission.permissionVersion,
    }, 'revoke-racing-approval');
    const [approvalRace, revokeRace] = await Promise.all([
      h.app.execute(h.byMember('nina'), approve), h.app.execute(h.byMember('nina'), revoke),
    ]);
    expect(Number(approvalRace.ok) + Number(revokeRace.ok)).toBe(1);
    if (!revokeRace.ok) {
      const retryRevoke = await h.command('nina', 'REVOKE_NEGOTIATION', {
        permissionId: permission.permissionId, permissionVersion: permission.permissionVersion,
      }, 'revoke-current-negotiation-after-race');
      expect((await h.app.execute(h.byMember('nina'), retryRevoke)).ok).toBe(true);
    }
    const after = await h.app.getPublicSnapshot(h.byMember('maya'), decisionId);
    expect(after.status).toBe('SUPERSEDED');
    expect(after.currentProposal).toBeNull();
    expect(after.approvedParticipantIds).toEqual([]);
    expect((await h.app.getOwnerSnapshot(h.byMember('nina'), decisionId)).ownApproval).toBeNull();
    const resumed = await h.app.startReasoning(service, decisionId);
    expect(resumed.semanticVersion).toBe(1);
    expect(resumed.epoch).toBeGreaterThan(1);
    expect(await h.app.completeReasoning(service, decisionId, resumed.id,
      await christmasCandidate(h, [], 'mazatlan', 2))).toBe('NEEDS_PERMISSION');

    const renewedQuestion = await h.app.askNegotiation(service, {
      decisionId, participantId: 'nina', contextToken: nina.publicSnapshot.contextToken,
      semanticVersion: nina.publicSnapshot.semanticVersion, constraintId: constraint.constraintId,
      constraintVersion: constraint.constraintVersion,
      adjustment: {
        id: 'allow-mazatlan', visibility: 'TRUSTED_BACKEND', operator: 'COMPARE', variableId: 'destination',
        comparison: 'EQ', value: { type: 'ENUM', optionId: 'mazatlan' },
      },
      expiresAt: '2026-10-02T12:00:00.000Z',
    });
    expect(renewedQuestion).not.toBeNull();
    const renewedAnswer = await h.command('nina', 'ANSWER_NEGOTIATION', {
      questionId: renewedQuestion!.questionId, constraintVersion: renewedQuestion!.constraintVersion,
      requestIdentity: renewedQuestion!.requestIdentity, answer: 'ALLOW',
    }, 'allow-nina-negotiation-again');
    expect((await h.app.execute(h.byMember('nina'), renewedAnswer)).ok).toBe(true);
    const renewedPermission = (await h.app.getOwnerSnapshot(h.byMember('nina'), decisionId)).negotiationPermissions.at(-1)!;
    const retryJob = await h.app.startReasoning(service, decisionId);
    expect(await h.app.completeReasoning(service, decisionId, retryJob.id,
      await christmasCandidate(h, [{
        permissionId: renewedPermission.permissionId, permissionVersion: renewedPermission.permissionVersion,
        kind: 'NEGOTIATION', expiresAt: renewedPermission.expiresAt,
      }], 'mazatlan', 2))).toBe('APPLIED');
    h.setNow('2026-10-02T12:00:00.000Z');
    expect((await h.app.getPublicSnapshot(h.byMember('maya'), decisionId)).status).toBe('SUPERSEDED');
  });
});

async function publishCorrectionNote(h: Awaited<ReturnType<typeof setup>>, audienceParticipantIds = ['leo']) {
  const proposal = (await h.app.getPublicSnapshot(h.byMember('maya'), decisionId)).currentProposal!;
  const text = 'Synthetic exact authorized note.';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const textHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  await h.app.requestDisclosure(service, { kind: 'EXACT_TEXT', permissionId: 'correction-note', permissionVersion: 1,
    decisionId, contextToken: proposal.facts.contextToken, semanticVersion: proposal.facts.semanticVersion,
    ownerParticipantId: 'maya', proposalId: proposal.proposalId, proposalVersion: proposal.facts.proposalVersion,
    audienceParticipantIds, status: 'PENDING', expiresAt: '2026-10-03T12:00:00.000Z', text, textHash });
  const allow = await h.command('maya', 'DECIDE_DISCLOSURE', { permissionId: 'correction-note', permissionVersion: 1, decision: 'ALLOW' });
  expect((await h.app.execute(h.byMember('maya'), allow)).ok).toBe(true);
  await h.app.publishDisclosure(service, decisionId, 'maya', 'correction-note', 1);
}

describe('KE09 disclosure lifecycle corrections', () => {
  it.each(['close', 'frame revision', 'constraint revision'] as const)('R3 keeps authorized reads valid after %s', async transition => {
    const h = await setup();
    await makeReady(h);
    const job = await h.app.startReasoning(service, decisionId);
    expect(await h.app.completeReasoning(service, decisionId, job.id, await christmasCandidate(h))).toBe('APPLIED');
    await publishCorrectionNote(h);
    expect((await h.app.getPublicSnapshot(h.byMember('leo'), decisionId)).publishedDisclosures).toHaveLength(1);
    expect((await h.app.getPublicSnapshot(h.byMember('nina'), decisionId)).publishedDisclosures).toEqual([]);
    const owner = await h.app.getOwnerSnapshot(h.byMember('maya'), decisionId);
    if (transition === 'close') await h.app.closeDecision(h.byMember('maya'), decisionId, owner.controlVersion);
    if (transition === 'frame revision') await h.app.reviseDecision(service, { decisionId,
      expectedControlVersion: owner.controlVersion,
      definition: { ...h.fixture.definition, frameVersion: 2, semanticVersion: 2 },
      memberships: h.fixture.definition.participants.map(person => ({ subject: `subject-${person.id}`, participantId: person.id, active: true })),
    });
    if (transition === 'constraint revision') {
      await h.app.storeConstraintDraft(service, { schemaVersion: KE.KE_SCHEMA_VERSION, draftId: 'changed-maya', draftVersion: 1,
        decisionId, ownerParticipantId: 'maya', ownerVersion: owner.ownerVersion, contextToken: owner.publicSnapshot.contextToken,
        semanticVersion: owner.publicSnapshot.semanticVersion, sourceSummary: 'Confirm changed conditions.',
        proposedConstraints: [], unsupportedConditions: [], createdAt: '2026-10-01T12:00:00.000Z' });
      expect((await h.app.execute(h.byMember('maya'), await h.command('maya', 'CONFIRM_CONSTRAINTS', {
        draftId: 'changed-maya', draftVersion: 1, constraintIds: [],
      }, 'changed-maya-confirm'))).ok).toBe(true);
    }
    for (const person of h.fixture.definition.requiredParticipantIds) {
      const snapshot = await h.app.getOwnerSnapshot(h.byMember(person), decisionId);
      expect(snapshot.publicSnapshot.publishedDisclosures).toEqual([]);
    }
    const stored = await h.repository.transactionDecision(decisionId, record => record);
    expect(stored?.publishedDisclosures).toHaveLength(1);
    expect(stored?.publishedDisclosures[0]?.audienceParticipantIds).toEqual(['leo']);
    expect(decodeDecisionStateItem(encodeDecisionStateItem(stored!), decisionId).publishedDisclosures).toEqual(stored!.publishedDisclosures);
  });

  it.each(['revoke', 'expire'] as const)('R3 excludes historical disclosures after %s and same-ID proposal replacement', async action => {
    const h = await setup();
    await makeReady(h, true);
    const nina = await h.app.getOwnerSnapshot(h.byMember('nina'), decisionId);
    const constraint = nina.confirmedConstraints[0]!;
    const question = await h.app.askNegotiation(service, { decisionId, participantId: 'nina',
      contextToken: nina.publicSnapshot.contextToken, semanticVersion: nina.publicSnapshot.semanticVersion,
      constraintId: constraint.constraintId, constraintVersion: constraint.constraintVersion,
      adjustment: { id: 'public-move', visibility: 'TRUSTED_BACKEND', operator: 'COMPARE', variableId: 'destination', comparison: 'EQ',
        value: { type: 'ENUM', optionId: 'mazatlan' } }, expiresAt: '2026-10-02T12:00:00.000Z' });
    expect((await h.app.execute(h.byMember('nina'), await h.command('nina', 'ANSWER_NEGOTIATION', {
      questionId: question!.questionId, constraintVersion: question!.constraintVersion,
      requestIdentity: question!.requestIdentity, answer: 'ALLOW',
    }))).ok).toBe(true);
    const permission = (await h.app.getOwnerSnapshot(h.byMember('nina'), decisionId)).negotiationPermissions[0]!;
    const job = await h.app.startReasoning(service, decisionId);
    expect(await h.app.completeReasoning(service, decisionId, job.id, await christmasCandidate(h, [{
      permissionId: permission.permissionId, permissionVersion: permission.permissionVersion,
      kind: 'NEGOTIATION', expiresAt: permission.expiresAt,
    }], 'mazatlan'))).toBe('APPLIED');
    await publishCorrectionNote(h);
    if (action === 'expire') h.setNow('2026-10-02T12:00:00.000Z');
    else expect((await h.app.execute(h.byMember('nina'), await h.command('nina', 'REVOKE_NEGOTIATION', {
      permissionId: permission.permissionId, permissionVersion: permission.permissionVersion,
    }))).ok).toBe(true);
    const expired = await h.app.getPublicSnapshot(h.byMember('leo'), decisionId);
    expect(expired.status).toBe('SUPERSEDED');
    expect(expired.publishedDisclosures).toEqual([]);
    const replacementJob = await h.app.startReasoning(service, decisionId);
    expect(await h.app.completeReasoning(service, decisionId, replacementJob.id, await christmasCandidate(h, [], 'cancun', 2))).toBe('APPLIED');
    const replaced = await h.app.getPublicSnapshot(h.byMember('leo'), decisionId);
    expect(replaced.currentProposal?.proposalId).toBe('christmas-proposal');
    expect(replaced.currentProposal?.facts.proposalVersion).toBe(2);
    expect(replaced.publishedDisclosures).toEqual([]);
  });

  it('R3 excludes required-only audiences from an unscoped view with an optional participant', async () => {
    const h = await setup(true);
    await makeReady(h);
    const job = await h.app.startReasoning(service, decisionId);
    expect(await h.app.completeReasoning(service, decisionId, job.id, await christmasCandidate(h))).toBe('APPLIED');
    await publishCorrectionNote(h, h.fixture.definition.requiredParticipantIds);
    expect((await h.app.getPublicSnapshot(h.byMember('leo'), decisionId)).publishedDisclosures).toHaveLength(1);
    expect((await h.app.getPublicSnapshot(h.byMember('raul'), decisionId)).publishedDisclosures).toEqual([]);
    expect((await h.app.getPublicSnapshot(service, decisionId)).publishedDisclosures).toEqual([]);
    await h.repository.transactionDecision(decisionId, record => { delete record!.publishedDisclosures[0]!.proposalVersion; });
    const legacy = await h.repository.transactionDecision(decisionId, record => record!);
    expect(decodeDecisionStateItem(encodeDecisionStateItem(legacy), decisionId).publishedDisclosures[0]?.proposalVersion).toBeUndefined();
    expect((await h.app.getPublicSnapshot(h.byMember('leo'), decisionId)).publishedDisclosures).toEqual([]);
  });
});
