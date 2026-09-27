import { describe, expect, it } from 'vitest';
import { KnownEnough as KE } from '@deal-table/contracts';
import { evaluateKnownEnoughCandidate } from './index.ts';
import {
  adaptTeamTableFixture,
  buildChristmasFixture,
  buildHypotheticalContributionFixture,
} from '../../test-support/src/known-enough-fixtures.ts';
import { buildTeamTableFixture } from '../../test-support/src/teamtable-fixture.ts';
import { solveDecision } from './solve.ts';

type KernelCase = {
  definition: ReturnType<typeof KE.DecisionDefinition.parse>;
  candidate: ReturnType<typeof KE.CandidateProposal.parse>;
  publicProposal: ReturnType<typeof KE.PublicCandidateProposal.parse>;
  confirmedConstraints?: ReturnType<typeof KE.ConfirmedConstraint.parse>[];
  frameConfirmations?: ReturnType<typeof KE.FrameConfirmation.parse>[];
  readyParticipantIds?: string[];
  unresolvedConditionIds?: string[];
  negotiationPermissions?: ReturnType<typeof KE.NegotiationPermission.parse>[];
  disclosurePermissions?: ReturnType<typeof KE.DisclosurePermission.parse>[];
  now?: string;
};

const NOW = '2026-10-01T12:00:00.000Z';
const context = (char: string) => char.repeat(64);
const baseCandidateClaim = {
  status: 'VALID' as const,
  checkedRuleIds: [],
  failedRuleIds: [],
  unknownRuleIds: [],
  unsupportedConditionIds: [],
};

async function publicProposalFor(
  definition: ReturnType<typeof KE.DecisionDefinition.parse>,
  candidate: ReturnType<typeof KE.CandidateProposal.parse>,
) {
  const facts = KE.PublicProposalFacts.parse({
    schemaVersion: KE.KE_SCHEMA_VERSION,
    decisionId: definition.decisionId,
    contextToken: definition.contextToken,
    semanticVersion: definition.semanticVersion,
    proposalVersion: candidate.proposalVersion,
    requiredParticipantIds: definition.requiredParticipantIds,
    values: candidate.values.filter(assignment => definition.variables.some(variable =>
      variable.id === assignment.variableId && variable.visibility === 'PUBLIC')),
  });
  return KE.PublicCandidateProposal.parse({
    proposalId: candidate.proposalId,
    facts,
    publicHash: await KE.hashDecisionProposal(facts),
    createdAt: candidate.createdAt,
  });
}

function kernelInput(testCase: KernelCase, overrides: Partial<KernelCase> = {}) {
  const value = { ...testCase, ...overrides };
  const { definition, candidate, publicProposal } = value;
  return {
    definition,
    candidate,
    publicProposal,
    confirmedConstraints: value.confirmedConstraints ?? [],
    frameConfirmations: value.frameConfirmations ?? definition.requiredParticipantIds.map(participantId => ({
      decisionId: definition.decisionId,
      participantId,
      frameVersion: definition.frameVersion,
      semanticVersion: definition.semanticVersion,
      contextToken: definition.contextToken,
      confirmedAt: NOW,
    })),
    readyParticipantIds: value.readyParticipantIds ?? [...definition.requiredParticipantIds],
    unresolvedConditionIds: value.unresolvedConditionIds ?? [],
    negotiationPermissions: value.negotiationPermissions ?? [],
    disclosurePermissions: value.disclosurePermissions ?? [],
    now: value.now ?? NOW,
  };
}

function activeConstraint(
  definition: ReturnType<typeof KE.DecisionDefinition.parse>,
  fields: Record<string, unknown>,
) {
  return KE.ConfirmedConstraint.parse({
    schemaVersion: KE.KE_SCHEMA_VERSION,
    constraintId: 'owner-limit',
    decisionId: definition.decisionId,
    ownerParticipantId: definition.requiredParticipantIds[0],
    kind: 'HARD',
    rule: {
      id: 'owner-limit-rule',
      visibility: 'TRUSTED_BACKEND',
      operator: 'COMPARE',
      variableId: 'maya-contribution',
      comparison: 'LTE',
      value: { type: 'MONEY', amountMinor: 2_400_000, currencyCode: 'USD', minorUnit: 2 },
    },
    constraintVersion: 1,
    ownerVersion: 1,
    semanticVersion: definition.semanticVersion,
    contextToken: definition.contextToken,
    confirmedAt: NOW,
    status: 'ACTIVE',
    sourceSummary: 'Synthetic test condition.',
    ...fields,
  });
}

async function purchaseCase() {
  const fixture = await buildHypotheticalContributionFixture();
  return {
    definition: fixture.definition,
    candidate: fixture.candidate,
    publicProposal: fixture.publicCandidate,
  } satisfies KernelCase;
}

async function christmasCase() {
  const fixture = buildChristmasFixture();
  const values = [
    { variableId: 'destination', value: { type: 'ENUM' as const, optionId: 'cancun' } },
    { variableId: 'trip-start', value: { type: 'DATE' as const, date: '2026-12-24' } },
    { variableId: 'trip-end', value: { type: 'DATE' as const, date: '2026-12-28' } },
    { variableId: 'trip-duration', value: { type: 'DURATION' as const, seconds: 345_600 } },
    { variableId: 'accommodation', value: { type: 'ENUM' as const, optionId: 'quiet-hotel' } },
    { variableId: 'estimated-total', value: { type: 'MONEY' as const, amountMinor: 150_000, currencyCode: 'USD', minorUnit: 2 } },
  ];
  const candidate = KE.CandidateProposal.parse({
    schemaVersion: KE.KE_SCHEMA_VERSION,
    proposalId: 'christmas-proposal-1',
    decisionId: fixture.definition.decisionId,
    semanticVersion: fixture.definition.semanticVersion,
    contextToken: fixture.definition.contextToken,
    proposalVersion: 1,
    values,
    validation: { ...baseCandidateClaim, status: 'NEEDS_CLARIFICATION', unknownRuleIds: ['model-claim'] },
    permissionDependencies: [],
    createdAt: NOW,
  });
  const confirmedConstraints = fixture.drafts.flatMap(draft => draft.proposedConstraints.map(item =>
    KE.ConfirmedConstraint.parse({
      schemaVersion: KE.KE_SCHEMA_VERSION,
      constraintId: item.constraintId,
      decisionId: draft.decisionId,
      ownerParticipantId: draft.ownerParticipantId,
      kind: item.kind,
      ...(item.kind === 'PREFERENCE' ? { preference: item.preference } : { rule: item.rule }),
      constraintVersion: 1,
      ownerVersion: draft.ownerVersion,
      semanticVersion: draft.semanticVersion,
      contextToken: draft.contextToken,
      confirmedAt: draft.createdAt,
      status: 'ACTIVE',
      sourceSummary: draft.sourceSummary,
    })),
  );
  const publicProposal = await publicProposalFor(fixture.definition, candidate);
  return {
    definition: fixture.definition,
    candidate,
    publicProposal,
    confirmedConstraints,
    unresolvedConditionIds: ['ana-proximity-condition'],
  } satisfies KernelCase;
}

async function teamTableCase(withGrant: boolean) {
  const adapted = await adaptTeamTableFixture(withGrant);
  const legacy = buildTeamTableFixture({ withGrant });
  const result = solveDecision(legacy);
  const plan = result.status === 'SOLVED' ? result.selectedPlan : undefined;
  if (withGrant && !plan) throw new Error('Expected the fixture solver to find a compatibility plan');
  const candidateValues = [
    { variableId: 'meeting-slot', value: { type: 'ENUM' as const, optionId: plan?.facts.meeting.id ?? 'meeting-1100' } },
    { variableId: 'lead-assignee', value: { type: 'PARTICIPANT' as const, participantId: plan?.facts.assignments.find(item => item.duty.id === 'lead')!.participantId ?? 'maya' } },
    { variableId: 'followup-assignee', value: { type: 'PARTICIPANT' as const, participantId: plan?.facts.assignments.find(item => item.duty.id === 'followup')!.participantId ?? 'leo' } },
  ];
  const candidate = KE.CandidateProposal.parse({
    schemaVersion: KE.KE_SCHEMA_VERSION,
    proposalId: 'teamtable-kernel-proposal',
    decisionId: adapted.definition.decisionId,
    semanticVersion: adapted.definition.semanticVersion,
    contextToken: adapted.definition.contextToken,
    proposalVersion: 1,
    values: candidateValues,
    validation: baseCandidateClaim,
    permissionDependencies: adapted.negotiationPermissions.map(permission => ({
      permissionId: permission.permissionId,
      permissionVersion: permission.permissionVersion,
      kind: 'NEGOTIATION' as const,
      expiresAt: permission.expiresAt,
    })),
    createdAt: NOW,
  });
  return {
    definition: adapted.definition,
    candidate,
    publicProposal: await publicProposalFor(adapted.definition, candidate),
    confirmedConstraints: adapted.constraints,
    negotiationPermissions: adapted.negotiationPermissions,
  } satisfies KernelCase;
}

function smallNumericCase(left: number, right: number, target: number) {
  const definition = KE.DecisionDefinition.parse({
    schemaVersion: KE.KE_SCHEMA_VERSION,
    decisionId: 'numeric-decision',
    frameVersion: 1,
    semanticVersion: 1,
    contextToken: context('d'),
    title: 'Exact numeric test',
    objective: 'Check exact decimal addition.',
    description: '',
    participants: [{ id: 'maya', displayName: 'Maya', requiredForApproval: true }],
    requiredParticipantIds: ['maya'],
    variables: [
      { id: 'left', type: 'NUMBER', label: 'Left', required: true, visibility: 'PUBLIC', ownerParticipantId: null, unitCode: 'USD', scale: 2 },
      { id: 'right', type: 'NUMBER', label: 'Right', required: true, visibility: 'PUBLIC', ownerParticipantId: null, unitCode: 'USD', scale: 2 },
    ],
    rules: [{
      id: 'exact-sum', visibility: 'PUBLIC', operator: 'SUM_EQUALS', variableIds: ['left', 'right'],
      target: { type: 'NUMBER', coefficient: target, scale: 2, unitCode: 'USD' },
    }],
  });
  return (async () => {
    const candidate = KE.CandidateProposal.parse({
      schemaVersion: KE.KE_SCHEMA_VERSION,
      proposalId: 'numeric-proposal',
      decisionId: definition.decisionId,
      semanticVersion: definition.semanticVersion,
      contextToken: definition.contextToken,
      proposalVersion: 1,
      values: [
        { variableId: 'left', value: { type: 'NUMBER', coefficient: left, scale: 2, unitCode: 'USD' } },
        { variableId: 'right', value: { type: 'NUMBER', coefficient: right, scale: 2, unitCode: 'USD' } },
      ],
      validation: baseCandidateClaim,
      permissionDependencies: [],
      createdAt: NOW,
    });
    return { definition, candidate, publicProposal: await publicProposalFor(definition, candidate) } satisfies KernelCase;
  })();
}

describe('Known Enough deterministic candidate kernel', () => {
  it('recomputes the purchase fixture and ignores candidate validation claims', async () => {
    const value = await purchaseCase();
    const candidate = KE.CandidateProposal.parse({
      ...value.candidate,
      validation: { ...baseCandidateClaim, status: 'NEEDS_CLARIFICATION', unknownRuleIds: ['fabricated-unknown'] },
    });
    const result = await evaluateKnownEnoughCandidate(kernelInput({ ...value, candidate }));
    expect(result.status).toBe('VALID');
    expect(result.publicResult).toEqual({ status: 'VALID' });
    expect(result.checkedRuleIds).toEqual(expect.arrayContaining(value.definition.rules.map(rule => rule.id)));
  });

  it('validates the Christmas typed rules and preserves the unresolved-condition block', async () => {
    const value = await christmasCase();
    const result = await evaluateKnownEnoughCandidate(kernelInput(value));
    expect(result.status).toBe('NEEDS_CLARIFICATION');
    expect(result.diagnostics.map(item => item.code)).toContain('UNRESOLVED_CONDITION');
    expect(result.failedRuleIds).toEqual([]);
  });

  it('passes the TeamTable compatibility bridge with the exact permission dependency', async () => {
    const value = await teamTableCase(true);
    const result = await evaluateKnownEnoughCandidate(kernelInput(value));
    expect(result.status).toBe('VALID');
    expect(result.failedRuleIds).toEqual([]);
  });

  it('blocks the TeamTable compatibility candidate when its Nina exception is absent', async () => {
    const value = await teamTableCase(false);
    const result = await evaluateKnownEnoughCandidate(kernelInput(value));
    expect(result.status).toBe('NEEDS_PERMISSION');
    expect(result.diagnostics.map(item => item.code)).toContain('NEGOTIABLE_PERMISSION_REQUIRED');
  });

  it('requires an active exact grant for a failed negotiable constraint', async () => {
    const value = await purchaseCase();
    const constraint = activeConstraint(value.definition, { kind: 'NEGOTIABLE' });
    const result = await evaluateKnownEnoughCandidate(kernelInput(value, { confirmedConstraints: [constraint] }));
    expect(result.status).toBe('NEEDS_PERMISSION');
    expect(result.diagnostics.map(item => item.code)).toContain('NEGOTIABLE_PERMISSION_REQUIRED');
  });

  it('honors exact permission scope, adjustment, expiry and revocation', async () => {
    const value = await purchaseCase();
    const constraint = activeConstraint(value.definition, { kind: 'NEGOTIABLE' });
    const permission = KE.NegotiationPermission.parse({
      permissionId: 'permission-limit', permissionVersion: 2,
      decisionId: value.definition.decisionId, contextToken: value.definition.contextToken,
      semanticVersion: value.definition.semanticVersion, ownerParticipantId: 'maya',
      questionId: 'question-limit', requestIdentity: context('f'),
      constraintId: constraint.constraintId, constraintVersion: constraint.constraintVersion,
      adjustment: {
        id: 'allow-candidate', visibility: 'TRUSTED_BACKEND', operator: 'COMPARE',
        variableId: 'maya-contribution', comparison: 'GT',
        value: { type: 'MONEY', amountMinor: 2_000_000, currencyCode: 'USD', minorUnit: 2 },
      },
      status: 'ACTIVE', expiresAt: '2026-10-02T12:00:00.000Z',
    });
    const withDependency = KE.CandidateProposal.parse({
      ...value.candidate,
      permissionDependencies: [{
        permissionId: permission.permissionId, permissionVersion: permission.permissionVersion,
        kind: 'NEGOTIATION', expiresAt: permission.expiresAt,
      }],
    });
    const authorized = await evaluateKnownEnoughCandidate(kernelInput({ ...value, candidate: withDependency }, {
      confirmedConstraints: [constraint], negotiationPermissions: [permission],
    }));
    expect(authorized.status).toBe('VALID');

    const revoked = KE.NegotiationPermission.parse({ ...permission, status: 'REVOKED' });
    const denied = await evaluateKnownEnoughCandidate(kernelInput({ ...value, candidate: withDependency }, {
      confirmedConstraints: [constraint], negotiationPermissions: [revoked],
    }));
    expect(denied.status).toBe('NEEDS_PERMISSION');

    const expired = KE.NegotiationPermission.parse({ ...permission, expiresAt: '2026-09-30T12:00:00.000Z' });
    const expiredCandidate = KE.CandidateProposal.parse({
      ...value.candidate,
      permissionDependencies: [{
        permissionId: expired.permissionId, permissionVersion: expired.permissionVersion,
        kind: 'NEGOTIATION', expiresAt: expired.expiresAt,
      }],
    });
    const expiredResult = await evaluateKnownEnoughCandidate(kernelInput({ ...value, candidate: expiredCandidate }, {
      confirmedConstraints: [constraint], negotiationPermissions: [expired],
    }));
    expect(expiredResult.status).toBe('NEEDS_PERMISSION');
  });

  it('never lets a negotiation permission weaken a HARD constraint', async () => {
    const value = await purchaseCase();
    const constraint = activeConstraint(value.definition, { kind: 'HARD' });
    const permission = KE.NegotiationPermission.parse({
      permissionId: 'permission-hard', permissionVersion: 1,
      decisionId: value.definition.decisionId, contextToken: value.definition.contextToken,
      semanticVersion: value.definition.semanticVersion, ownerParticipantId: 'maya',
      questionId: 'question-hard', requestIdentity: context('e'),
      constraintId: constraint.constraintId, constraintVersion: constraint.constraintVersion,
      adjustment: {
        id: 'allow-hard', visibility: 'TRUSTED_BACKEND', operator: 'COMPARE',
        variableId: 'maya-contribution', comparison: 'GT',
        value: { type: 'MONEY', amountMinor: 2_000_000, currencyCode: 'USD', minorUnit: 2 },
      },
      status: 'ACTIVE', expiresAt: '2026-10-02T12:00:00.000Z',
    });
    const candidate = KE.CandidateProposal.parse({
      ...value.candidate,
      permissionDependencies: [{
        permissionId: permission.permissionId, permissionVersion: permission.permissionVersion,
        kind: 'NEGOTIATION', expiresAt: permission.expiresAt,
      }],
    });
    const result = await evaluateKnownEnoughCandidate(kernelInput({ ...value, candidate }, {
      confirmedConstraints: [constraint], negotiationPermissions: [permission],
    }));
    expect(result.status).toBe('INVALID');
    expect(result.failedRuleIds).toContain('owner-limit-rule');
  });

  it('rejects invalid constraint references without leaking their source text', async () => {
    const value = await purchaseCase();
    const base = activeConstraint(value.definition, {});
    if (base.kind === 'PREFERENCE') throw new Error('Expected a rule constraint');
    const constraint = KE.ConfirmedConstraint.parse({
      ...base,
      constraintId: 'broken-reference',
      sourceSummary: 'PRIVATE WORDS MUST NOT APPEAR IN DIAGNOSTICS',
      rule: { ...base.rule, variableId: 'unknown-secret-variable' },
    });
    const result = await evaluateKnownEnoughCandidate(kernelInput(value, { confirmedConstraints: [constraint] }));
    expect(result.status).toBe('INVALID');
    expect(JSON.stringify(result.diagnostics)).not.toContain('PRIVATE WORDS');
    expect(JSON.stringify(result.diagnostics)).toContain('broken-reference');
  });

  it('validates disclosure permission version, audience, variable scope and expiry separately from public facts', async () => {
    const base = await purchaseCase();
    const definition = KE.DecisionDefinition.parse({
      ...base.definition,
      variables: [...base.definition.variables, {
        id: 'maya-shareable-note', type: 'BOOLEAN', label: 'Shareable synthetic flag', required: false,
        visibility: 'CONSENT_REQUIRED', ownerParticipantId: 'maya',
      }],
    });
    const candidate = KE.CandidateProposal.parse({
      ...base.candidate,
      values: [...base.candidate.values, { variableId: 'maya-shareable-note', value: { type: 'BOOLEAN', value: true } }],
    });
    const publicProposal = await publicProposalFor(definition, candidate);
    const permission = KE.DisclosurePermission.parse({
      kind: 'VARIABLE_VALUES', permissionId: 'share-note', permissionVersion: 3,
      decisionId: definition.decisionId, contextToken: definition.contextToken,
      semanticVersion: definition.semanticVersion, ownerParticipantId: 'maya',
      proposalId: candidate.proposalId, proposalVersion: candidate.proposalVersion,
      audienceParticipantIds: ['leo'], status: 'ACTIVE', expiresAt: '2026-10-02T12:00:00.000Z',
      variableIds: ['maya-shareable-note'],
    });
    const withDependency = KE.CandidateProposal.parse({
      ...candidate,
      permissionDependencies: [{
        permissionId: permission.permissionId, permissionVersion: permission.permissionVersion,
        kind: 'DISCLOSURE', expiresAt: permission.expiresAt,
      }],
    });
    const scoped = { definition, candidate: withDependency, publicProposal };
    const scopedResult = await evaluateKnownEnoughCandidate(kernelInput(scoped, { disclosurePermissions: [permission] }));
    expect(scopedResult.status).toBe('VALID');

    const unauthorized = KE.DisclosurePermission.parse({
      ...permission, variableIds: ['maya-contribution'], permissionVersion: 4,
    });
    const unauthorizedCandidate = KE.CandidateProposal.parse({
      ...candidate,
      permissionDependencies: [{
        permissionId: unauthorized.permissionId, permissionVersion: unauthorized.permissionVersion,
        kind: 'DISCLOSURE', expiresAt: unauthorized.expiresAt,
      }],
    });
    const denied = await evaluateKnownEnoughCandidate(kernelInput({
      definition, candidate: unauthorizedCandidate, publicProposal,
    }, { disclosurePermissions: [unauthorized] }));
    expect(denied.status).toBe('NEEDS_PERMISSION');
    expect(denied.diagnostics.map(item => item.code)).toContain('DISCLOSURE_SCOPE_INVALID');
  });

  it('checks exact disclosure text hashes before accepting a dependency', async () => {
    const value = await purchaseCase();
    const permission = KE.DisclosurePermission.parse({
      kind: 'EXACT_TEXT', permissionId: 'share-text', permissionVersion: 1,
      decisionId: value.definition.decisionId, contextToken: value.definition.contextToken,
      semanticVersion: value.definition.semanticVersion, ownerParticipantId: 'maya',
      proposalId: value.candidate.proposalId, proposalVersion: value.candidate.proposalVersion,
      audienceParticipantIds: ['leo'], status: 'ACTIVE', expiresAt: '2026-10-02T12:00:00.000Z',
      text: 'A synthetic approved sentence.', textHash: '0'.repeat(64),
    });
    const candidate = KE.CandidateProposal.parse({
      ...value.candidate,
      permissionDependencies: [{
        permissionId: permission.permissionId, permissionVersion: permission.permissionVersion,
        kind: 'DISCLOSURE', expiresAt: permission.expiresAt,
      }],
    });
    const result = await evaluateKnownEnoughCandidate(kernelInput({ ...value, candidate }, {
      disclosurePermissions: [permission],
    }));
    expect(result.status).toBe('NEEDS_PERMISSION');
    expect(result.diagnostics.map(item => item.code)).toContain('DISCLOSURE_TEXT_HASH_INVALID');
  });

  it('rejects a private owner constraint that reads another participant’s private variable', async () => {
    const value = await purchaseCase();
    const base = activeConstraint(value.definition, {});
    if (base.kind === 'PREFERENCE') throw new Error('Expected a rule constraint');
    const crossOwner = KE.ConfirmedConstraint.parse({
      ...base,
      rule: { ...base.rule, variableId: 'leo-contribution' },
    });
    const result = await evaluateKnownEnoughCandidate(kernelInput(value, { confirmedConstraints: [crossOwner] }));
    expect(result.status).toBe('INVALID');
    expect(result.diagnostics.map(item => item.code)).toContain('INVALID_RULE');
  });

  it('uses exact integer arithmetic for generated decimal sums and safe-integer boundaries', async () => {
    for (let left = 1; left <= 40; left += 1) {
      const right = 10_000 - left * 7;
      const valid = await smallNumericCase(left * 7, right, 10_000);
      expect((await evaluateKnownEnoughCandidate(kernelInput(valid))).status).toBe('VALID');
      const invalid = await smallNumericCase(left * 7, right + 1, 10_000);
      expect((await evaluateKnownEnoughCandidate(kernelInput(invalid))).status).toBe('INVALID');
    }
    const beyondSafeSum = await smallNumericCase(Number.MAX_SAFE_INTEGER, 1, Number.MAX_SAFE_INTEGER);
    expect((await evaluateKnownEnoughCandidate(kernelInput(beyondSafeSum))).status).toBe('INVALID');
  });

  it('validates mutually exclusive assignment counts', async () => {
    const definition = KE.DecisionDefinition.parse({
      schemaVersion: KE.KE_SCHEMA_VERSION,
      decisionId: 'mutex-decision', frameVersion: 1, semanticVersion: 1, contextToken: context('a'),
      title: 'Mutually exclusive test', objective: 'Select at most one.', description: '',
      participants: [{ id: 'maya', displayName: 'Maya', requiredForApproval: true }],
      requiredParticipantIds: ['maya'],
      variables: ['left', 'right'].map(id => ({
        id, type: 'BOOLEAN', label: id, required: true, visibility: 'PUBLIC', ownerParticipantId: null,
      })),
      rules: [{ id: 'only-one', visibility: 'PUBLIC', operator: 'MUTUALLY_EXCLUSIVE', variableIds: ['left', 'right'], maximumSelected: 1 }],
    });
    const candidate = KE.CandidateProposal.parse({
      schemaVersion: KE.KE_SCHEMA_VERSION, proposalId: 'mutex-proposal', decisionId: definition.decisionId,
      semanticVersion: definition.semanticVersion, contextToken: definition.contextToken, proposalVersion: 1,
      values: ['left', 'right'].map(variableId => ({ variableId, value: { type: 'BOOLEAN' as const, value: true } })),
      validation: baseCandidateClaim, permissionDependencies: [], createdAt: NOW,
    });
    const value = { definition, candidate, publicProposal: await publicProposalFor(definition, candidate) };
    const result = await evaluateKnownEnoughCandidate(kernelInput(value));
    expect(result.status).toBe('INVALID');
    expect(result.failedRuleIds).toContain('only-one');
  });

  it('fails closed on byte and active-constraint bounds', async () => {
    const value = await purchaseCase();
    const input = kernelInput(value) as Record<string, unknown>;
    expect((await evaluateKnownEnoughCandidate({ ...input, padding: 'x'.repeat(360 * 1024) })).status)
      .toBe('NEEDS_CLARIFICATION');
    const tooMany = Array.from({ length: 65 }, (_, index) => activeConstraint(value.definition, {
      constraintId: `bounded-${index}`,
    }));
    expect((await evaluateKnownEnoughCandidate(kernelInput(value, { confirmedConstraints: tooMany }))).status)
      .toBe('NEEDS_CLARIFICATION');
  });

  it('returns only the coarse status in the public projection', async () => {
    const result = await evaluateKnownEnoughCandidate(kernelInput(await purchaseCase()));
    expect(result.publicResult).toEqual({ status: 'VALID' });
    expect(Object.keys(result.publicResult)).toEqual(['status']);
  });
});
