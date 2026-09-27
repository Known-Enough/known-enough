import { describe, expect, it } from 'vitest';
import { KnownEnough } from './index';
import { buildChristmasFixture, buildHypotheticalContributionFixture } from '../../test-support/src/known-enough-fixtures.ts';

const KE = KnownEnough;
const clone = <T>(value: T): T => structuredClone(value);

describe('Known Enough v2 generic contracts', () => {
  it('parses the five-person Christmas frame and keeps owner interpretations private', () => {
    const fixture = buildChristmasFixture();
    expect(KE.DecisionDefinition.parse(fixture.definition)).toEqual(fixture.definition);
    expect(fixture.definition.participants).toHaveLength(5);
    expect(fixture.publicSnapshot.frame.participants).toHaveLength(5);
    expect(fixture.drafts).toHaveLength(5);
    const ana = fixture.drafts.find(draft => draft.ownerParticipantId === 'ana')!;
    expect(ana.unsupportedConditions).toHaveLength(1);
    expect(fixture.publicSnapshot.status).toBe('NEEDS_CLARIFICATION');
    expect(JSON.stringify(fixture.publicSnapshot)).not.toContain('maya-budget-limit');
    expect(JSON.stringify(fixture.publicSnapshot)).not.toContain('older relative');
    expect(KE.PublicDecisionSnapshot.parse(fixture.publicSnapshot)).toEqual(fixture.publicSnapshot);
    expect(fixture.publicSnapshot).not.toHaveProperty('inputReadiness');
    const unknownViewer = { ...fixture.publicSnapshot, viewerParticipantId: 'outsider' };
    expect(KE.PublicDecisionSnapshot.safeParse(unknownViewer).success).toBe(false);
  });

  it('rejects unknown fields recursively, malformed values, duplicate IDs, and cross-reference errors', () => {
    const definition = buildChristmasFixture().definition;
    expect(KE.DecisionDefinition.safeParse({ ...definition, privateInputs: [] }).success).toBe(false);
    const withNestedLeak = clone(definition);
    Object.assign(withNestedLeak.variables[0]!, { ownerBudget: 1 });
    expect(KE.DecisionDefinition.safeParse(withNestedLeak).success).toBe(false);

    const duplicateParticipants = { ...definition, participants: [definition.participants[0], ...definition.participants] };
    expect(KE.DecisionDefinition.safeParse(duplicateParticipants).success).toBe(false);
    const unknownRule = {
      id: 'arbitrary-expression',
      visibility: 'PUBLIC',
      operator: 'EVAL',
      source: 'return true',
    };
    expect(KE.DecisionDefinition.safeParse({ ...definition, rules: [...definition.rules, unknownRule] }).success).toBe(false);

    const danglingRule = {
      ...definition.rules[0]!,
      variableId: 'not-a-variable',
    };
    expect(KE.DecisionDefinition.safeParse({ ...definition, rules: [danglingRule] }).success).toBe(false);

    expect(KE.DecisionValue.safeParse({ type: 'MONEY', amountMinor: 1.5, currencyCode: 'USD', minorUnit: 2 }).success).toBe(false);
    expect(KE.DecisionValue.safeParse({ type: 'MONEY', amountMinor: 10, currencyCode: 'usd', minorUnit: 2 }).success).toBe(false);
    expect(KE.DecisionValue.safeParse({ type: 'DATE', date: '2026-02-30' }).success).toBe(false);
    expect(KE.DecisionValue.safeParse({ type: 'DATETIME', instant: '2026-10-08T10:00:00-06:00', displayTimeZone: 'America/Mexico_City' }).success).toBe(false);
    expect(KE.DecisionValue.safeParse({ type: 'DATETIME', instant: '2026-10-08T16:00:00.000Z', displayTimeZone: 'Mars/Olympus' }).success).toBe(false);
    expect(KE.DecisionValue.safeParse({ type: 'PERCENTAGE', basisPoints: 10_001 }).success).toBe(false);
    expect(KE.DecisionValue.safeParse({ type: 'DURATION', seconds: 1.25 }).success).toBe(false);
    expect(KE.DecisionValue.safeParse({ type: 'ENUM', optionId: 'cancun', arbitrary: 'private' }).success).toBe(false);
  });

  it('treats unsupported qualitative conditions as clarification, never as a valid confirmed rule', () => {
    const anaDraft = buildChristmasFixture().drafts.find(draft => draft.ownerParticipantId === 'ana')!;
    expect(KE.AIConstraintDraft.parse(anaDraft).unsupportedConditions).toHaveLength(1);
    expect(KE.CandidateEvaluation.safeParse({
      status: 'VALID',
      checkedRuleIds: [],
      failedRuleIds: [],
      unknownRuleIds: [],
      unsupportedConditionIds: ['ana-proximity-condition'],
    }).success).toBe(false);
    expect(KE.CandidateEvaluation.safeParse({
      status: 'INVALID',
      checkedRuleIds: [],
      failedRuleIds: ['failed-rule'],
      unknownRuleIds: [],
      unsupportedConditionIds: [],
    }).success).toBe(false);
    expect(KE.CandidateEvaluation.safeParse({
      status: 'NEEDS_CLARIFICATION',
      checkedRuleIds: [],
      failedRuleIds: [],
      unknownRuleIds: [],
      unsupportedConditionIds: ['ana-proximity-condition'],
    }).success).toBe(true);
    expect(KE.ConfirmedConstraint.safeParse({
      schemaVersion: KE.KE_SCHEMA_VERSION,
      constraintId: 'qualitative',
      decisionId: 'christmas-decision',
      ownerParticipantId: 'ana',
      kind: 'HARD',
      rule: { id: 'unknown', visibility: 'TRUSTED_BACKEND', operator: 'NEAR_RELATIVE' },
      constraintVersion: 1,
      ownerVersion: 2,
      semanticVersion: 1,
      contextToken: 'a'.repeat(64),
      confirmedAt: '2026-10-01T12:00:00.000Z',
      status: 'ACTIVE',
      sourceSummary: 'Synthetic unsupported qualitative condition.',
    }).success).toBe(false);
  });

  it('checks required values and typed references in an internal candidate', async () => {
    const fixture = await buildHypotheticalContributionFixture();
    expect(KE.CandidateForDecision.parse({ definition: fixture.definition, candidate: fixture.candidate })).toBeDefined();

    const missing = clone(fixture.candidate);
    missing.values = missing.values.filter(value => value.variableId !== 'maya-contribution');
    expect(KE.CandidateForDecision.safeParse({ definition: fixture.definition, candidate: missing }).success).toBe(false);

    const badReference = clone(fixture.candidate);
    badReference.values[0]!.variableId = 'other-owner-private-value';
    expect(KE.CandidateForDecision.safeParse({ definition: fixture.definition, candidate: badReference }).success).toBe(false);

    const wrongUnit = clone(fixture.candidate);
    wrongUnit.values[0]!.value = { type: 'MONEY', amountMinor: 2_500_000, currencyCode: 'MXN', minorUnit: 2 };
    expect(KE.CandidateForDecision.safeParse({ definition: fixture.definition, candidate: wrongUnit }).success).toBe(false);
  });

  it('keeps the public proposal allowlist and owner-only proposal fields separate', async () => {
    const fixture = await buildHypotheticalContributionFixture();
    const publicIds = fixture.publicSnapshot.currentProposal!.facts.values.map(value => value.variableId);
    expect(publicIds).toEqual(['maya-ownership', 'leo-ownership', 'nina-ownership']);
    expect(fixture.ownerSnapshot.ownInputReadiness).toBe('READY');
    expect(JSON.stringify(fixture.publicSnapshot)).not.toContain('maya-contribution');
    expect(JSON.stringify(fixture.publicSnapshot)).not.toContain('2500000');

    const leaked = clone(fixture.publicSnapshot);
    leaked.currentProposal!.facts.values.push({
      variableId: 'maya-contribution',
      value: { type: 'MONEY', amountMinor: 2_500_000, currencyCode: 'USD', minorUnit: 2 },
    });
    expect(KE.PublicDecisionSnapshot.safeParse(leaked).success).toBe(false);

    const unknownPublicField = { ...fixture.publicSnapshot, refusalReasons: ['owner declined'] };
    expect(KE.PublicDecisionSnapshot.safeParse(unknownPublicField).success).toBe(false);

    const foreignPrivateField = fixture.definition.variables.find(variable => variable.id === 'leo-contribution')!;
    const ownerLeak = {
      ...fixture.ownerSnapshot,
      privateVariables: [...fixture.ownerSnapshot.privateVariables, foreignPrivateField],
    };
    expect(KE.OwnerDecisionSnapshot.safeParse(ownerLeak).success).toBe(false);
    expect(KE.OwnerDecisionSnapshot.safeParse({ ...fixture.ownerSnapshot, publicSnapshot: { ...fixture.ownerSnapshot.publicSnapshot, viewerParticipantId: 'nina' } }).success).toBe(false);

    const approvalMismatch = clone(fixture.ownerSnapshot);
    approvalMismatch.ownApproval = {
      decisionId: 'purchase-decision', proposalId: 'purchase-proposal-1', proposalVersion: 1,
      publicHash: 'f'.repeat(64), semanticVersion: 1, contextToken: 'b'.repeat(64),
      participantId: 'maya', ownerVersion: 2, approvedAt: '2026-10-01T12:00:00.000Z',
    };
    expect(KE.OwnerDecisionSnapshot.safeParse(approvalMismatch).success).toBe(false);
  });

  it('does not include a narrow-audience disclosure in an unscoped public projection', async () => {
    const fixture = await buildHypotheticalContributionFixture();
    const optionalMember = clone(fixture.publicSnapshot);
    optionalMember.viewerParticipantId = null;
    optionalMember.frame.requiredParticipantIds = ['maya', 'leo'];
    optionalMember.frame.participants.find(person => person.id === 'nina')!.requiredForApproval = false;
    optionalMember.currentProposal!.facts.requiredParticipantIds = ['maya', 'leo'];
    optionalMember.publishedDisclosures = [{
      kind: 'EXACT_TEXT', decisionId: 'purchase-decision', contextToken: 'b'.repeat(64),
      semanticVersion: 1, proposalId: 'purchase-proposal-1', text: 'Approved illustrative note.',
      audienceParticipantIds: ['maya', 'leo'], publishedAt: '2026-10-01T12:00:00.000Z',
    }];
    expect(KE.PublicDecisionSnapshot.safeParse(optionalMember).success).toBe(false);

    const scopedToOwner = { ...optionalMember, viewerParticipantId: 'maya' };
    expect(KE.PublicDecisionSnapshot.safeParse(scopedToOwner).success).toBe(true);
  });

  it('requires all current frame confirmations and readiness before proposal states', () => {
    const christmas = buildChristmasFixture();
    const readyWithoutAllFrames = {
      ...christmas.publicSnapshot,
      status: 'READY' as const,
      frameConfirmations: christmas.publicSnapshot.frameConfirmations.slice(1),
    };
    expect(KE.PublicDecisionSnapshot.safeParse(readyWithoutAllFrames).success).toBe(false);

    const anaDraft = christmas.drafts.find(draft => draft.ownerParticipantId === 'ana')!;
    const anaOwnerSnapshot = {
      schemaVersion: KE.KE_SCHEMA_VERSION,
      publicSnapshot: KE.PublicDecisionSnapshot.parse({ ...christmas.publicSnapshot, viewerParticipantId: 'ana' }),
      ownerParticipantId: 'ana', ownInputReadiness: 'NEEDS_CLARIFICATION' as const,
      privateVariables: [], privateProposalValues: null, controlVersion: 1, ownerVersion: 2,
      draftVersion: anaDraft.draftVersion, draft: anaDraft, confirmedConstraints: [],
      pendingQuestions: [], refusedRequests: [], negotiationPermissions: [],
      disclosurePermissions: [], ownApproval: null,
    };
    expect(KE.OwnerDecisionSnapshot.safeParse(anaOwnerSnapshot).success).toBe(true);
    expect(KE.OwnerDecisionSnapshot.safeParse({ ...anaOwnerSnapshot, ownInputReadiness: 'READY' }).success).toBe(false);

    const staleConfirmation = clone(christmas.publicSnapshot);
    staleConfirmation.frameConfirmations[0]!.contextToken = 'd'.repeat(64);
    expect(KE.PublicDecisionSnapshot.safeParse(staleConfirmation).success).toBe(false);
  });

  it('canonicalizes only specified sets and produces a stable public hash vector', async () => {
    const fixture = await buildHypotheticalContributionFixture();
    const original = clone(fixture.publicFacts);
    const reordered = clone(fixture.publicFacts);
    reordered.requiredParticipantIds.reverse();
    reordered.values.reverse();
    expect(KE.serializeDecisionProposal(reordered)).toBe(KE.serializeDecisionProposal(original));
    expect(reordered).not.toEqual(original);
    expect(await KE.hashDecisionProposal(original)).toBe('e2a512773ad769e1b97f54a6ee4123ca03ce5859cd8de2a37ed03544393ce4d1');

    const changedContext = { ...original, contextToken: 'd'.repeat(64) };
    expect(await KE.hashDecisionProposal(changedContext)).not.toBe(await KE.hashDecisionProposal(original));
    await expect(KE.hashDecisionProposal({ ...original, privateInputHash: 'secret' })).rejects.toThrow();
  });

  it('identifies semantically equivalent private negotiation requests despite generated IDs and wording changes', async () => {
    const base = {
      decisionId: 'christmas-decision',
      contextToken: 'a'.repeat(64),
      semanticVersion: 1,
      targetParticipantId: 'nina',
      constraintId: 'nina-destination-flexibility',
      constraintVersion: 2,
      adjustment: {
        id: 'generated-rule-a',
        visibility: 'TRUSTED_BACKEND' as const,
        operator: 'IN' as const,
        variableId: 'destination',
        values: [{ type: 'ENUM' as const, optionId: 'cancun' }, { type: 'ENUM' as const, optionId: 'oaxaca' }],
      },
    };
    const paraphrased = {
      ...base,
      adjustment: { ...base.adjustment, id: 'generated-rule-b', values: base.adjustment.values.slice().reverse() },
    };
    const firstIdentity = await KE.hashNegotiationRequestIdentity(base);
    expect(await KE.hashNegotiationRequestIdentity(paraphrased)).toBe(firstIdentity);
    expect(await KE.hashNegotiationRequestIdentity({ ...base, semanticVersion: 2 })).not.toBe(firstIdentity);
    expect(await KE.hashNegotiationRequestIdentity({ ...base, targetParticipantId: 'maya' })).not.toBe(firstIdentity);

    const setValueBase = { ...base, adjustment: { ...base.adjustment, values: [
      { type: 'ENUM_SET' as const, optionIds: ['cancun', 'oaxaca'] },
    ] } };
    const reorderedSetValue = { ...setValueBase, adjustment: { ...setValueBase.adjustment, values: [
      { type: 'ENUM_SET' as const, optionIds: ['oaxaca', 'cancun'] },
    ] } };
    expect(await KE.hashNegotiationRequestIdentity(setValueBase)).toBe(await KE.hashNegotiationRequestIdentity(reorderedSetValue));
  });

  it('validates strict commands and makes stale/concurrent versions explicit without trusting caller identity', () => {
    const command = {
      schemaVersion: KE.KE_SCHEMA_VERSION,
      type: 'CONFIRM_FRAME',
      requestId: 'request-1',
      decisionId: 'christmas-decision',
      idempotencyKey: 'retry-key',
      expected: {
        contextToken: 'a'.repeat(64),
        semanticVersion: 1,
        controlVersion: 4,
        ownerVersion: 3,
      },
      payload: { frameVersion: 1 },
    };
    expect(KE.DecisionCommand.parse(command)).toEqual(command);
    expect(KE.DecisionCommand.safeParse({ ...command, ownerParticipantId: 'maya' }).success).toBe(false);
    expect(KE.DecisionCommand.safeParse({
      ...command,
      payload: { ...command.payload, ownerParticipantId: 'maya' },
    }).success).toBe(false);
    expect(KE.DecisionCommand.safeParse({
      ...command,
      expected: { ...command.expected, controlVersion: -1 },
    }).success).toBe(false);

    expect(KE.DecisionCommandResult.parse({
      ok: false,
      requestId: 'request-1',
      error: { code: 'STALE_CONTEXT', httpStatus: 409 },
    })).toMatchObject({ ok: false });
    expect(KE.DecisionCommandResult.safeParse({
      ok: false,
      requestId: 'request-1',
      error: { code: 'STALE_CONTEXT', httpStatus: 422 },
    }).success).toBe(false);
  });

  it('enforces configured payload and collection bounds', () => {
    const definition = buildChristmasFixture().definition;
    expect(KE.parseDecisionDefinition(definition)).toEqual(definition);
    expect(() => KE.parseDecisionDefinition({ ...definition, description: 'x'.repeat(70_000) })).toThrow(RangeError);
    expect(KE.DecisionVariable.safeParse({
      id: 'large-enum',
      type: 'ENUM',
      label: 'Too many options',
      required: true,
      visibility: 'PUBLIC',
      ownerParticipantId: null,
      options: Array.from({ length: 65 }, (_, index) => ({ id: 'option-' + index, label: 'Option ' + index })),
    }).success).toBe(false);
  });
});
