import { describe, expect, it, vi } from 'vitest';
import { InMemoryRoomRepository } from '@deal-table/adapters';
import { encodeDecisionStateItem, decodeDecisionStateItem } from '../../adapters/src/dynamodb-codec.ts';
import { KnownEnough as KE } from '@deal-table/contracts';
import { buildChristmasFixture, buildChristmasPublicCandidates } from '../../test-support/src/known-enough-fixtures.ts';
import { DecisionNegotiator, DecisionNegotiatorError, KnownEnoughApplication } from './index.ts';
import type { DecisionNegotiationModel, DecisionNegotiationModelInput } from './index.ts';
import type { TrustedPrincipal } from './types.ts';

const decisionId = 'christmas-decision';
const service: TrustedPrincipal = { kind: 'service', subject: 'test-worker', roomIds: [decisionId] };
const participant = (id: string): TrustedPrincipal => ({ kind: 'participant', subject: `subject-${id}` });
const now = '2026-10-01T12:00:00.000Z';

async function setup(configure?: (fixture: ReturnType<typeof buildChristmasFixture>) => void) {
  let sequence = 0;
  const fixture = buildChristmasFixture();
  configure?.(fixture);
  const repository = new InMemoryRoomRepository();
  const application = new KnownEnoughApplication({
    repository, clock: { now: () => now },
    ids: { next: () => `negotiator-test-${++sequence}` },
  });
  await application.createDecision({
    definition: fixture.definition, creatorSubject: 'subject-maya',
    memberships: fixture.definition.participants.map(item => ({ subject: `subject-${item.id}`, participantId: item.id, active: true })),
  });
  for (const person of fixture.definition.requiredParticipantIds) {
    const owner = await application.getOwnerSnapshot(participant(person), decisionId);
    const result = await application.execute(participant(person), {
      schemaVersion: KE.KE_SCHEMA_VERSION, type: 'CONFIRM_FRAME', requestId: `frame-${person}`,
      decisionId, idempotencyKey: `frame-${person}`,
      expected: { contextToken: owner.publicSnapshot.contextToken, semanticVersion: owner.publicSnapshot.semanticVersion,
        controlVersion: owner.controlVersion, ownerVersion: owner.ownerVersion },
      payload: { frameVersion: fixture.definition.frameVersion },
    });
    expect(result.ok).toBe(true);
  }
  for (const person of fixture.definition.requiredParticipantIds) {
    const owner = await application.getOwnerSnapshot(participant(person), decisionId);
    const source = person === 'ana' ? null : fixture.drafts.find(item => item.ownerParticipantId === person) ?? null;
    const draft = KE.AIConstraintDraft.parse(source ? {
      ...source, draftId: `demo-${person}-draft`, draftVersion: 1,
      contextToken: owner.publicSnapshot.contextToken, semanticVersion: owner.publicSnapshot.semanticVersion,
      ownerVersion: owner.ownerVersion, sourceSummary: 'Synthetic condition; raw statement omitted.', createdAt: now,
    } : {
      schemaVersion: KE.KE_SCHEMA_VERSION, draftId: `demo-${person}-draft`, draftVersion: 1,
      decisionId, ownerParticipantId: person, ownerVersion: owner.ownerVersion,
      semanticVersion: owner.publicSnapshot.semanticVersion, contextToken: owner.publicSnapshot.contextToken,
      sourceSummary: 'Synthetic condition; raw statement omitted.', proposedConstraints: [], unsupportedConditions: [], createdAt: now,
    });
    await application.storeConstraintDraft(service, draft);
    const result = await application.execute(participant(person), {
      schemaVersion: KE.KE_SCHEMA_VERSION, type: 'CONFIRM_CONSTRAINTS', requestId: `inputs-${person}`,
      decisionId, idempotencyKey: `inputs-${person}`,
      expected: { contextToken: owner.publicSnapshot.contextToken, semanticVersion: owner.publicSnapshot.semanticVersion,
        controlVersion: owner.controlVersion + 1, ownerVersion: owner.ownerVersion },
      payload: { draftId: draft.draftId, draftVersion: draft.draftVersion,
        constraintIds: draft.proposedConstraints.map(item => item.constraintId) },
    });
    expect(result.ok).toBe(true);
  }
  return { application, fixture, repository };
}

function generated(input: DecisionNegotiationModelInput, destination: 'mazatlan' | 'cancun' | 'invented-destination' = 'mazatlan', total = 160_000) {
  const ninaConstraint = input.context.confirmedConstraints.find(item => item.ownerParticipantId === 'nina'
    && item.constraintId === 'nina-destination-flexibility')!;
  return {
    values: [
      { variableId: 'destination', value: { type: 'ENUM', optionId: destination } },
      { variableId: 'trip-start', value: { type: 'DATE', date: '2026-12-24' } },
      { variableId: 'trip-end', value: { type: 'DATE', date: '2026-12-29' } },
      { variableId: 'trip-duration', value: { type: 'DURATION', seconds: 432_000 } },
      { variableId: 'accommodation', value: { type: 'ENUM', optionId: 'quiet-hotel' } },
      { variableId: 'estimated-total', value: { type: 'MONEY', amountMinor: total, currencyCode: 'USD', minorUnit: 2 } },
    ],
    permissionDependencies: input.context.activeNegotiationPermissions.map(permission => ({
      permissionId: permission.permissionId, permissionVersion: permission.permissionVersion,
      kind: 'NEGOTIATION', expiresAt: permission.expiresAt,
    })),
    questionIntents: input.context.activeNegotiationPermissions.length ? [] : [{
      ownerParticipantId: 'nina', constraintId: ninaConstraint.constraintId,
      constraintVersion: ninaConstraint.constraintVersion,
      adjustment: { id: 'allow-mazatlan', visibility: 'TRUSTED_BACKEND', operator: 'COMPARE',
        variableId: 'destination', comparison: 'EQ', value: { type: 'ENUM', optionId: 'mazatlan' } },
    }],
    explanationDraft: {
      variableIds: ['destination', 'trip-start', 'trip-end', 'trip-duration', 'accommodation', 'estimated-total'],
      ruleIds: ['positive-duration', 'bounded-synthetic-estimate'],
    },
  };
}

function createNegotiator(application: KnownEnoughApplication, model: DecisionNegotiationModel) {
  let sequence = 0;
  return new DecisionNegotiator({
    application, model, publicCandidates: buildChristmasPublicCandidates, clock: { now: () => now }, ids: { next: () => `model-proposal-${++sequence}` },
  });
}

describe('DecisionNegotiator', () => {
  it('kernel-checks candidates, asks only the affected owner, and applies only after an exact grant', async () => {
    const h = await setup();
    const contexts: unknown[] = [];
    const negotiator = createNegotiator(h.application, async input => {
      contexts.push(input.context);
      return generated(input);
    });

    const initial = await negotiator.generate(participant('maya'), decisionId);
    expect(initial.outcome).toBe('NEEDS_PERMISSION');
    expect(initial.publicSnapshot.status).toBe('PRIVATE_NEGOTIATION');
    expect(initial.publicSnapshot.currentProposal).toBeNull();
    expect(initial.ownQuestions).toEqual([]);
    expect(JSON.stringify(initial)).not.toContain('nina-destination-flexibility');
    expect(JSON.stringify(contexts[0])).not.toContain('sourceSummary');
    expect(contexts[0]).toMatchObject({
      publicSnapshot: { frame: { title: 'Family Christmas trip' } },
      confirmedConstraints: expect.arrayContaining([expect.objectContaining({ ownerParticipantId: 'maya', kind: 'HARD' })]),
    });

    const nina = await h.application.getOwnerSnapshot(participant('nina'), decisionId);
    const question = nina.pendingQuestions.find(item => item.status === 'PENDING')!;
    expect(question).toMatchObject({ targetParticipantId: 'nina', constraintId: 'nina-destination-flexibility' });
    const answered = await h.application.execute(participant('nina'), {
      schemaVersion: KE.KE_SCHEMA_VERSION, type: 'ANSWER_NEGOTIATION', requestId: 'allow-exact-move',
      decisionId, idempotencyKey: 'allow-exact-mazatlan',
      expected: { contextToken: nina.publicSnapshot.contextToken, semanticVersion: nina.publicSnapshot.semanticVersion,
        controlVersion: nina.controlVersion, ownerVersion: nina.ownerVersion },
      payload: { questionId: question.questionId, constraintVersion: question.constraintVersion,
        requestIdentity: question.requestIdentity, answer: 'ALLOW' },
    });
    expect(answered.ok).toBe(true);

    const applied = await negotiator.generate(participant('maya'), decisionId);
    expect(applied.outcome).toBe('APPLIED');
    expect(applied.publicSnapshot.status).toBe('PROPOSED');
    expect(applied.publicSnapshot.currentProposal?.facts.values).toContainEqual({
      variableId: 'destination', value: { type: 'ENUM', optionId: 'mazatlan' },
    });
    expect(applied.explanation?.kind).toBe('VALIDATED_PUBLIC_VALUES');
    expect(applied.explanation?.values.map(item => item.label)).not.toContain('Nina private');
    expect(JSON.stringify(applied)).not.toContain('maya-budget-limit');
    expect(JSON.stringify(applied)).not.toContain('nina-destination-flexibility');
    expect(contexts[1]).toMatchObject({ activeNegotiationPermissions: [expect.objectContaining({ ownerParticipantId: 'nina' })] });
  });

  it('does not ask for a negotiable override when another hard constraint invalidates the candidate', async () => {
    const h = await setup();
    const negotiator = createNegotiator(h.application, async input => generated(input, 'mazatlan', 170_000));
    const result = await negotiator.generate(participant('maya'), decisionId);
    expect(result.outcome).toBe('INVALID');
    expect(result.publicSnapshot.currentProposal).toBeNull();
    expect(result.publicSnapshot.status).toBe('NO_AGREEMENT');
    expect(result.ownQuestions).toEqual([]);
  });

  it('rejects an invented option through the application kernel', async () => {
    const h = await setup();
    const negotiator = createNegotiator(h.application, async input => generated(input, 'invented-destination'));
    await expect(negotiator.generate(participant('maya'), decisionId)).rejects.toMatchObject({ code: 'INVALID_MODEL_OUTPUT' });
    expect((await h.application.getPublicSnapshot(participant('maya'), decisionId)).currentProposal).toBeNull();
  });

  it('respects a refusal and does not issue the same private question again', async () => {
    const h = await setup();
    const negotiator = createNegotiator(h.application, async input => generated(input));
    await negotiator.generate(participant('maya'), decisionId);
    const nina = await h.application.getOwnerSnapshot(participant('nina'), decisionId);
    const question = nina.pendingQuestions.find(item => item.status === 'PENDING')!;
    const refusal = await h.application.execute(participant('nina'), {
      schemaVersion: KE.KE_SCHEMA_VERSION, type: 'ANSWER_NEGOTIATION', requestId: 'decline-exact-move',
      decisionId, idempotencyKey: 'decline-exact-mazatlan',
      expected: { contextToken: nina.publicSnapshot.contextToken, semanticVersion: nina.publicSnapshot.semanticVersion,
        controlVersion: nina.controlVersion, ownerVersion: nina.ownerVersion },
      payload: { questionId: question.questionId, constraintVersion: question.constraintVersion,
        requestIdentity: question.requestIdentity, answer: 'DECLINE' },
    });
    expect(refusal.ok).toBe(true);

    const retry = await negotiator.generate(participant('maya'), decisionId);
    const ninaAfter = await h.application.getOwnerSnapshot(participant('nina'), decisionId);
    expect(retry.outcome).toBe('NEEDS_PERMISSION');
    expect(ninaAfter.pendingQuestions).toHaveLength(1);
    expect(ninaAfter.pendingQuestions[0]?.status).toBe('DECLINED');
    expect(ninaAfter.negotiationPermissions).toEqual([]);
  });

  it('applies a candidate that meets every condition without asking for a concession', async () => {
    const h = await setup();
    const negotiator = createNegotiator(h.application, async input => generated(input, 'cancun'));
    const result = await negotiator.generate(participant('maya'), decisionId);
    expect(result.outcome).toBe('APPLIED');
    expect(result.publicSnapshot.currentProposal).not.toBeNull();
    expect(result.ownQuestions).toEqual([]);
  });

  it('retries malformed model output once, then cancels the exact job without publishing', async () => {
    const h = await setup();
    let calls = 0;
    const model = vi.fn(async () => { calls += 1; return { privateExplanation: 'must not be accepted' }; });
    const negotiator = createNegotiator(h.application, model);
    await expect(negotiator.generate(participant('maya'), decisionId)).rejects.toBeInstanceOf(DecisionNegotiatorError);
    expect(calls).toBe(2);
    const snapshot = await h.application.getPublicSnapshot(participant('maya'), decisionId);
    expect(snapshot.status).toBe('READY');
    expect(snapshot.currentProposal).toBeNull();
  });

  it('aborts a provider that exceeds the configured time limit and releases the job', async () => {
    const h = await setup();
    let aborted = false;
    const negotiator = new DecisionNegotiator({
      application: h.application, publicCandidates: buildChristmasPublicCandidates,
      model: async input => new Promise((_resolve, reject) => {
        input.signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }, { once: true });
      }),
      clock: { now: () => now }, ids: { next: () => 'timed-model-proposal' }, timeoutMs: 100,
    });
    await expect(negotiator.generate(participant('maya'), decisionId)).rejects.toMatchObject({ code: 'MODEL_FAILED' });
    expect(aborted).toBe(true);
    expect((await h.application.getPublicSnapshot(participant('maya'), decisionId)).status).toBe('READY');
  });

  it('rejects invented owner targets instead of asking or publishing them', async () => {
    const h = await setup();
    const negotiator = createNegotiator(h.application, async input => ({
      ...generated(input), questionIntents: [{ ownerParticipantId: 'invented-owner', constraintId: 'secret',
        constraintVersion: 1, adjustment: { id: 'fake', visibility: 'TRUSTED_BACKEND', operator: 'ALL_DIFFERENT', variableIds: ['destination', 'trip-start'] } }],
    }));
    await expect(negotiator.generate(participant('maya'), decisionId)).rejects.toMatchObject({ code: 'INVALID_MODEL_OUTPUT' });
    expect((await h.application.getPublicSnapshot(participant('maya'), decisionId)).status).toBe('READY');
  });
});

// Fresh command envelopes let the regressions exercise actual transaction/version checks.
let correctionRequest = 0;
async function correctionCommand(h: Awaited<ReturnType<typeof setup>>, person: string, type: KE.DecisionCommand['type'], payload: unknown) {
  const owner = await h.application.getOwnerSnapshot(participant(person), decisionId);
  const requestId = `correction-${++correctionRequest}`;
  const result = await h.application.execute(participant(person), {
    schemaVersion: KE.KE_SCHEMA_VERSION, type, decisionId, requestId, idempotencyKey: requestId,
    expected: { contextToken: owner.publicSnapshot.contextToken, semanticVersion: owner.publicSnapshot.semanticVersion,
      controlVersion: owner.controlVersion, ownerVersion: owner.ownerVersion }, payload,
  });
  expect(result.ok).toBe(true);
  return result;
}
async function answerCorrection(h: Awaited<ReturnType<typeof setup>>, answer: 'ALLOW' | 'DECLINE') {
  const owner = await h.application.getOwnerSnapshot(participant('nina'), decisionId);
  const question = owner.pendingQuestions.find(item => item.status === 'PENDING')!;
  await correctionCommand(h, 'nina', 'ANSWER_NEGOTIATION', { questionId: question.questionId,
    constraintVersion: question.constraintVersion, requestIdentity: question.requestIdentity, answer });
  return question;
}

describe('KE09 negotiation corrections', () => {
  it('R1 rejects a copied cross-owner private bound even though its variable is public', async () => {
    const h = await setup();
    const negotiator = createNegotiator(h.application, async input => {
      const privateConstraint = input.context.confirmedConstraints.find(item => item.ownerParticipantId === 'maya' && item.kind === 'HARD');
      if (!privateConstraint || privateConstraint.kind !== 'HARD') throw new Error('Missing fixture');
      const output = generated(input);
      return { ...output, questionIntents: [{ ...output.questionIntents[0], adjustment: privateConstraint.rule }] };
    });
    expect((await negotiator.generate(participant('maya'), decisionId)).outcome).toBe('NEEDS_PERMISSION');
    const nina = await h.application.getOwnerSnapshot(participant('nina'), decisionId);
    expect(nina.pendingQuestions).toEqual([]);
    expect(JSON.stringify(nina)).not.toContain('maya-budget-rule');
  });

  it('R1 replaces poisoned adjustment IDs and permits only the target public enum choices', async () => {
    const h = await setup();
    const negotiator = createNegotiator(h.application, async input => {
      const output = generated(input);
      output.questionIntents[0]!.adjustment.id = 'MAYA_PRIVATE_CANARY_160000';
      return output;
    });
    await negotiator.generate(participant('maya'), decisionId);
    const nina = await h.application.getOwnerSnapshot(participant('nina'), decisionId);
    expect(nina.pendingQuestions[0]?.adjustment).toEqual({ id: 'owner-choice-adjustment', visibility: 'TRUSTED_BACKEND',
      operator: 'IN', variableId: 'destination', values: [{ type: 'ENUM', optionId: 'mazatlan' }] });
    expect(JSON.stringify(nina)).not.toContain('MAYA_PRIVATE_CANARY');
  });

  it('R1 rejects private-derived public values outside a predeclared catalog and a missing catalog', async () => {
    const h = await setup();
    const poisoned = createNegotiator(h.application, async input => generated(input, 'cancun', 159_937));
    await expect(poisoned.generate(participant('maya'), decisionId)).rejects.toMatchObject({ code: 'INVALID_MODEL_OUTPUT' });
    const missing = new DecisionNegotiator({ application: h.application, model: async input => generated(input, 'cancun'),
      clock: { now: () => now }, ids: { next: () => 'uncatalogued-candidate' } });
    await expect(missing.generate(participant('maya'), decisionId)).rejects.toMatchObject({ code: 'INVALID_MODEL_OUTPUT' });
    expect((await h.application.getPublicSnapshot(participant('maya'), decisionId)).status).toBe('READY');
  });

  it.each(['membership', 'baseline', 'legacy-hash'])('R4 suppresses equivalent requests after refusal: %s', async mode => {
    const h = await setup();
    let repeat = false;
    const negotiator = createNegotiator(h.application, async input => {
      const output = generated(input);
      return repeat ? { ...output, questionIntents: [{ ...output.questionIntents[0], adjustment: {
        id: 'renamed-request', visibility: 'TRUSTED_BACKEND', operator: 'IN', variableId: 'destination',
        values: (mode === 'baseline' ? ['cancun', 'mazatlan'] : ['mazatlan']).map(optionId => ({ type: 'ENUM', optionId })),
      } }] } : output;
    });
    await negotiator.generate(participant('maya'), decisionId);
    await answerCorrection(h, 'DECLINE');
    if (mode === 'legacy-hash') await h.repository.transactionDecision(decisionId, record => {
      const owner = record!.owners.find(item => item.participantId === 'nina')!;
      owner.pendingQuestions[0]!.requestIdentity = 'f'.repeat(64);
      owner.pendingQuestions[0]!.adjustment = { id: 'legacy-adjustment', visibility: 'TRUSTED_BACKEND',
        operator: 'COMPARE', variableId: 'destination', comparison: 'EQ', value: { type: 'ENUM', optionId: 'mazatlan' } };
      owner.refusedRequests[0]!.requestIdentity = 'f'.repeat(64);
    });
    repeat = true;
    await negotiator.generate(participant('maya'), decisionId);
    const nina = await h.application.getOwnerSnapshot(participant('nina'), decisionId);
    expect(nina.pendingQuestions).toHaveLength(1);
    expect(nina.pendingQuestions[0]?.status).toBe('DECLINED');
  });

  it('R2/R5 keeps same-ID history readable and requires new frame, inputs and consent after revision', async () => {
    const h = await setup();
    const negotiator = createNegotiator(h.application, async input => generated(input));
    await negotiator.generate(participant('maya'), decisionId);
    const oldQuestion = await answerCorrection(h, 'ALLOW');
    const firstProposal = (await negotiator.generate(participant('maya'), decisionId)).publicSnapshot.currentProposal!;
    await correctionCommand(h, 'maya', 'APPROVE_PROPOSAL', { proposalId: firstProposal.proposalId,
      proposalVersion: firstProposal.facts.proposalVersion, publicHash: firstProposal.publicHash });
    const before = await h.application.getOwnerSnapshot(participant('maya'), decisionId);
    const source = h.fixture.drafts.find(item => item.ownerParticipantId === 'maya')!;
    const draft = KE.AIConstraintDraft.parse({ ...source, draftId: 'maya-revision', draftVersion: 1,
      contextToken: before.publicSnapshot.contextToken, semanticVersion: before.publicSnapshot.semanticVersion,
      ownerVersion: before.ownerVersion, createdAt: now,
      proposedConstraints: source.proposedConstraints.map(item => item.kind === 'HARD' && item.rule.operator === 'COMPARE'
        ? { ...item, rule: { ...item.rule, value: { type: 'MONEY', amountMinor: 170_000, currencyCode: 'USD', minorUnit: 2 } } } : item),
    });
    await h.application.storeConstraintDraft(service, draft);
    await correctionCommand(h, 'maya', 'CONFIRM_CONSTRAINTS', { draftId: draft.draftId, draftVersion: 1,
      constraintIds: draft.proposedConstraints.map(item => item.constraintId) });
    const revised = await h.application.getOwnerSnapshot(participant('maya'), decisionId);
    expect(revised.publicSnapshot.contextToken).not.toBe(before.publicSnapshot.contextToken);
    expect(revised.publicSnapshot.semanticVersion).toBe(before.publicSnapshot.semanticVersion + 1);
    expect(revised.publicSnapshot.status).toBe('COLLECTING_FRAME_CONFIRMATION');
    expect(revised.publicSnapshot.currentProposal).toBeNull();
    expect(revised.ownApproval).toBeNull();
    expect(revised.publicSnapshot.approvedParticipantIds).toEqual([]);
    expect(revised.confirmedConstraints.filter(item => item.constraintId === 'maya-budget-limit')).toHaveLength(2);
    expect(revised.confirmedConstraints.every(item => item.status === 'SUPERSEDED')).toBe(true);
    const nina = await h.application.getOwnerSnapshot(participant('nina'), decisionId);
    expect(nina.negotiationPermissions).toEqual([]);
    expect(nina.pendingQuestions).toEqual([]);
    const stored = await h.repository.transactionDecision(decisionId, record => record);
    expect(stored?.retiredPermissions.find(item => item.participantId === 'nina')?.negotiationPermissions[0]?.status).toBe('SUPERSEDED');
    const decoded = decodeDecisionStateItem(encodeDecisionStateItem(stored!), decisionId);
    expect(decoded.owners.find(item => item.participantId === 'maya')?.confirmedConstraints).toEqual(revised.confirmedConstraints);
    expect(decoded.retiredPermissions).toEqual(stored!.retiredPermissions);
    for (const person of h.fixture.definition.requiredParticipantIds) {
      await correctionCommand(h, person, 'CONFIRM_FRAME', { frameVersion: revised.publicSnapshot.frame.frameVersion });
    }
    for (const person of h.fixture.definition.requiredParticipantIds) {
      const owner = await h.application.getOwnerSnapshot(participant(person), decisionId);
      await correctionCommand(h, person, 'CONFIRM_CONSTRAINTS', { draftId: owner.draft!.draftId,
        draftVersion: owner.draft!.draftVersion, constraintIds: owner.draft!.proposedConstraints.map(item => item.constraintId) });
    }
    expect((await negotiator.generate(participant('maya'), decisionId)).outcome).toBe('NEEDS_PERMISSION');
    const after = await h.application.getOwnerSnapshot(participant('nina'), decisionId);
    expect(after.pendingQuestions[0]?.contextToken).not.toBe(oldQuestion.contextToken);
    expect(after.negotiationPermissions).toEqual([]);
    await answerCorrection(h, 'ALLOW');
    expect((await negotiator.generate(participant('maya'), decisionId)).outcome).toBe('APPLIED');
    await expect(h.application.askNegotiation(service, { decisionId, participantId: 'nina',
      contextToken: oldQuestion.contextToken, semanticVersion: oldQuestion.semanticVersion,
      constraintId: oldQuestion.constraintId, constraintVersion: oldQuestion.constraintVersion,
      adjustment: oldQuestion.adjustment, expiresAt: oldQuestion.expiresAt })).rejects.toMatchObject({ code: 'STALE_CONTEXT' });
  });

  it('R6 accepts valid rule ID collisions across scopes', async () => {
    const h = await setup(fixture => {
      const condition = fixture.drafts.find(item => item.ownerParticipantId === 'maya')!.proposedConstraints[0]!;
      if (condition.kind === 'HARD') condition.rule.id = fixture.definition.rules[0]!.id;
    });
    const negotiator = createNegotiator(h.application, async input => generated(input, 'cancun'));
    expect((await negotiator.generate(participant('maya'), decisionId)).outcome).toBe('APPLIED');
    const stored = await h.repository.transactionDecision(decisionId, record => record);
    expect(new Set(stored!.candidate!.validation.checkedRuleIds).size).toBe(stored!.candidate!.validation.checkedRuleIds.length);
  });

  it('R6 accepts the full 128 definition plus 64 private rule receipt', async () => {
    const h = await setup(fixture => {
      const publicRule = fixture.definition.rules[0]!;
      fixture.definition.rules = Array.from({ length: 128 }, (_, index) => ({ ...publicRule, id: `public-${index}` }));
      for (const draft of fixture.drafts) draft.proposedConstraints = [];
      fixture.drafts.find(item => item.ownerParticipantId === 'maya')!.proposedConstraints = Array.from({ length: 64 }, (_, index) => ({
        constraintId: `private-${index}`, kind: 'HARD', rule: { ...publicRule, id: `private-rule-${index}`, visibility: 'TRUSTED_BACKEND' },
      }));
    });
    const negotiator = createNegotiator(h.application, async input => ({ values: input.publicCandidates[0],
      permissionDependencies: [], questionIntents: [], explanationDraft: { variableIds: [], ruleIds: [] } }));
    expect((await negotiator.generate(participant('maya'), decisionId)).outcome).toBe('APPLIED');
    const stored = await h.repository.transactionDecision(decisionId, record => record);
    expect(stored!.candidate!.validation.checkedRuleIds).toHaveLength(192);
  });

  it('R6 releases a failed completion job and leaves a newer job untouched', async () => {
    const h = await setup();
    const negotiator = createNegotiator(h.application, async input => generated(input, 'cancun'));
    const original = h.application.completeReasoning.bind(h.application);
    const spy = vi.spyOn(h.application, 'completeReasoning').mockRejectedValueOnce(new Error('synthetic write failure'));
    await expect(negotiator.generate(participant('maya'), decisionId)).rejects.toThrow('synthetic write failure');
    expect((await h.application.getPublicSnapshot(participant('maya'), decisionId)).status).toBe('READY');
    let newerId = '';
    spy.mockImplementationOnce(async (principal, id, jobId) => {
      await h.application.cancelReasoning(principal, id, jobId);
      newerId = (await h.application.startReasoning(principal, id)).id;
      throw new Error('late old failure');
    });
    await expect(negotiator.generate(participant('maya'), decisionId)).rejects.toThrow('late old failure');
    expect((await h.application.getReasoningContext(service, decisionId, newerId)).job.id).toBe(newerId);
    await h.application.cancelReasoning(service, decisionId, newerId);
    spy.mockImplementation(original);
    expect((await negotiator.generate(participant('maya'), decisionId)).outcome).toBe('APPLIED');
  });
});

it('R1 gives the catalog only public frame facts and rejects generated owner-private values', async () => {
  const h = await setup(fixture => {
    fixture.definition.variables.push({ id: 'nina-private-amount', type: 'MONEY', label: 'Nina private amount',
      visibility: 'OWNER_PRIVATE', ownerParticipantId: 'nina', required: false, currencyCode: 'USD', minorUnit: 2 });
  });
  const catalog = vi.fn((frame: KE.PublicDecisionFrame) => {
    expect(frame.variables.some(item => item.id === 'nina-private-amount')).toBe(false);
    expect(JSON.stringify(frame)).not.toMatch(/maya-budget-rule|confirmedConstraints|negotiationPermissions/);
    return buildChristmasPublicCandidates();
  });
  const negotiator = new DecisionNegotiator({ application: h.application, publicCandidates: catalog,
    clock: { now: () => now }, ids: { next: () => 'private-value-proposal' },
    model: async input => ({ ...generated(input, 'cancun'), values: [...input.publicCandidates[0]!,
      { variableId: 'nina-private-amount', value: { type: 'MONEY', amountMinor: 160_000, currencyCode: 'USD', minorUnit: 2 } }],
    }),
  });
  await expect(negotiator.generate(participant('maya'), decisionId)).rejects.toMatchObject({ code: 'INVALID_MODEL_OUTPUT' });
  expect(catalog).toHaveBeenCalledTimes(1);
  expect((await h.application.getOwnerSnapshot(participant('nina'), decisionId)).privateProposalValues).toBeNull();
});

it('R1 publishes the catalog representation instead of model-controlled assignment ordering', async () => {
  const h = await setup();
  const negotiator = createNegotiator(h.application, async input => {
    const output = generated(input, 'cancun', 150_000);
    output.values.reverse();
    return output;
  });
  const result = await negotiator.generate(participant('maya'), decisionId);
  expect(result.outcome).toBe('APPLIED');
  expect(result.publicSnapshot.currentProposal?.facts.values).toEqual(buildChristmasPublicCandidates()[0]);
});
