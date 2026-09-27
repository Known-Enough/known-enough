import { describe, expect, it, vi } from 'vitest';
import { InMemoryRoomRepository } from '@deal-table/adapters';
import { KnownEnough as KE } from '@deal-table/contracts';
import { buildChristmasFixture } from '../../test-support/src/known-enough-fixtures.ts';
import { DecisionNegotiator, DecisionNegotiatorError, KnownEnoughApplication } from './index.ts';
import type { DecisionNegotiationModel, DecisionNegotiationModelInput } from './index.ts';
import type { TrustedPrincipal } from './types.ts';

const decisionId = 'christmas-decision';
const service: TrustedPrincipal = { kind: 'service', subject: 'test-worker', roomIds: [decisionId] };
const participant = (id: string): TrustedPrincipal => ({ kind: 'participant', subject: `subject-${id}` });
const now = '2026-10-01T12:00:00.000Z';

async function setup() {
  let sequence = 0;
  const fixture = buildChristmasFixture();
  const application = new KnownEnoughApplication({
    repository: new InMemoryRoomRepository(), clock: { now: () => now },
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
  return { application, fixture };
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
    application, model, clock: { now: () => now }, ids: { next: () => `model-proposal-${++sequence}` },
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
    const result = await negotiator.generate(participant('maya'), decisionId);
    expect(result.outcome).toBe('INVALID');
    expect(result.publicSnapshot.currentProposal).toBeNull();
    expect(result.ownQuestions).toEqual([]);
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
      application: h.application,
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
