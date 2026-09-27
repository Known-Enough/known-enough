import { KnownEnough } from '@deal-table/contracts';
import { buildTeamTableFixture } from './teamtable-fixture.ts';

const KE = KnownEnough;
const CHRISTMAS_CONTEXT = 'a'.repeat(64);
const PURCHASE_CONTEXT = 'b'.repeat(64);
const FIXTURE_NOW = '2026-10-01T12:00:00.000Z';

const christmasParticipants = [
  { id: 'maya', displayName: 'Maya', requiredForApproval: true },
  { id: 'leo', displayName: 'Leo', requiredForApproval: true },
  { id: 'nina', displayName: 'Nina', requiredForApproval: true },
  { id: 'ana', displayName: 'Ana', requiredForApproval: true },
  { id: 'raul', displayName: 'Raul', requiredForApproval: true },
];

const moneyValue = (amountMinor: number) => ({
  type: 'MONEY' as const, amountMinor, currencyCode: 'USD', minorUnit: 2,
});
const enumValue = (optionId: string) => ({ type: 'ENUM' as const, optionId });
const participantValue = (participantId: string) => ({ type: 'PARTICIPANT' as const, participantId });
const ruleBase = (id: string, visibility: 'PUBLIC' | 'TRUSTED_BACKEND') => ({ id, visibility });

export function buildChristmasFixture() {
  const definition = KE.DecisionDefinition.parse({
    schemaVersion: KE.KE_SCHEMA_VERSION,
    decisionId: 'christmas-decision',
    frameVersion: 1,
    semanticVersion: 1,
    contextToken: CHRISTMAS_CONTEXT,
    title: 'Family Christmas trip',
    objective: 'Choose a destination, dates, accommodation and duration together.',
    description: 'All prices and availability are synthetic examples, not travel offers.',
    participants: christmasParticipants,
    requiredParticipantIds: christmasParticipants.map(person => person.id),
    variables: [
      {
        id: 'destination', type: 'ENUM', label: 'Destination', required: true, visibility: 'PUBLIC', ownerParticipantId: null,
        options: [{ id: 'cancun', label: 'Cancún' }, { id: 'oaxaca', label: 'Oaxaca' }, { id: 'mazatlan', label: 'Mazatlán' }],
      },
      {
        id: 'trip-start', type: 'DATE', label: 'Trip start', required: true, visibility: 'PUBLIC', ownerParticipantId: null,
      },
      {
        id: 'trip-end', type: 'DATE', label: 'Trip end', required: true, visibility: 'PUBLIC', ownerParticipantId: null,
      },
      {
        id: 'trip-duration', type: 'DURATION', unit: 'SECONDS', label: 'Trip duration', required: true,
        visibility: 'PUBLIC', ownerParticipantId: null,
      },
      {
        id: 'accommodation', type: 'ENUM', label: 'Accommodation', required: true, visibility: 'PUBLIC', ownerParticipantId: null,
        options: [{ id: 'shared-villa', label: 'Shared villa' }, { id: 'quiet-hotel', label: 'Quiet hotel' }],
      },
      {
        id: 'estimated-total', type: 'MONEY', label: 'Synthetic estimated trip total', required: true,
        visibility: 'PUBLIC', ownerParticipantId: null, currencyCode: 'USD', minorUnit: 2,
      },
    ],
    rules: [
      {
        ...ruleBase('positive-duration', 'PUBLIC'),
        operator: 'COMPARE', variableId: 'trip-duration', comparison: 'GT',
        value: { type: 'DURATION', seconds: 0 },
      },
      {
        ...ruleBase('bounded-synthetic-estimate', 'PUBLIC'),
        operator: 'RANGE', variableId: 'estimated-total',
        minimum: moneyValue(0), maximum: moneyValue(2_000_000), includeMinimum: true, includeMaximum: true,
      },
    ],
  });

  const publicFrame = KE.PublicDecisionFrame.parse({
    ...definition,
    variables: definition.variables.filter(variable => variable.visibility === 'PUBLIC')
      .map(variable => Object.fromEntries(Object.entries(variable).filter(([key]) => key !== 'ownerParticipantId'))),
    rules: definition.rules.filter(rule => rule.visibility === 'PUBLIC'),
  });

  const publicSnapshot = KE.PublicDecisionSnapshot.parse({
    schemaVersion: KE.KE_SCHEMA_VERSION,
    frame: publicFrame,
    viewerParticipantId: 'maya',
    semanticVersion: definition.semanticVersion,
    contextToken: definition.contextToken,
    publicRevision: 1,
    status: 'NEEDS_CLARIFICATION',
    frameConfirmations: christmasParticipants.map(person => ({
      decisionId: definition.decisionId,
      participantId: person.id,
      frameVersion: definition.frameVersion,
      semanticVersion: definition.semanticVersion,
      contextToken: definition.contextToken,
      confirmedAt: FIXTURE_NOW,
    })),
    currentProposal: null,
    approvedParticipantIds: [],
    publishedDisclosures: [],
  });

  const draft = (
    draftId: string,
    ownerParticipantId: string,
    ownerVersion: number,
    proposedConstraints: unknown[],
    unsupportedConditions: unknown[] = [],
  ) => KE.AIConstraintDraft.parse({
    schemaVersion: KE.KE_SCHEMA_VERSION,
    draftId,
    draftVersion: 1,
    decisionId: definition.decisionId,
    ownerParticipantId,
    ownerVersion,
    semanticVersion: definition.semanticVersion,
    contextToken: definition.contextToken,
    sourceSummary: 'Synthetic private input for the Christmas contract fixture.',
    proposedConstraints,
    unsupportedConditions,
    createdAt: FIXTURE_NOW,
  });

  const drafts = [
    draft('maya-draft', 'maya', 2, [{
      constraintId: 'maya-budget-limit',
      kind: 'HARD',
      rule: {
        ...ruleBase('maya-budget-rule', 'TRUSTED_BACKEND'),
        operator: 'COMPARE',
        variableId: 'estimated-total',
        comparison: 'LTE',
        value: moneyValue(160_000),
      },
    }]),
    draft('leo-draft', 'leo', 2, [{
      constraintId: 'leo-date-window',
      kind: 'HARD',
      rule: {
        ...ruleBase('leo-date-rule', 'TRUSTED_BACKEND'),
        operator: 'IN',
        variableId: 'trip-start',
        values: [
          { type: 'DATE', date: '2026-12-23' },
          { type: 'DATE', date: '2026-12-24' },
          { type: 'DATE', date: '2026-12-26' },
          { type: 'DATE', date: '2026-12-27' },
        ],
      },
    }]),
    draft('nina-draft', 'nina', 2, [{
      constraintId: 'nina-destination-flexibility',
      kind: 'NEGOTIABLE',
      rule: {
        ...ruleBase('nina-destination-rule', 'TRUSTED_BACKEND'),
        operator: 'IN',
        variableId: 'destination',
        values: [enumValue('cancun'), enumValue('oaxaca')],
      },
    }]),
    draft('ana-draft', 'ana', 2, [{
      constraintId: 'ana-quiet-accommodation',
      kind: 'HARD',
      rule: {
        ...ruleBase('ana-accommodation-rule', 'TRUSTED_BACKEND'),
        operator: 'IN',
        variableId: 'accommodation',
        values: [enumValue('quiet-hotel')],
      },
    }], [{
      id: 'ana-proximity-condition',
      sourceSummary: 'Needs the lodging to be close to an older relative.',
      clarificationQuestion: 'What distance or travel time counts as close?',
    }]),
    draft('raul-draft', 'raul', 2, [{
      constraintId: 'raul-duration-limit',
      kind: 'HARD',
      rule: {
        ...ruleBase('raul-duration-rule', 'TRUSTED_BACKEND'),
        operator: 'COMPARE',
        variableId: 'trip-duration',
        comparison: 'LTE',
        value: { type: 'DURATION', seconds: 604_800 },
      },
    }]),
  ];

  return { definition, publicFrame, publicSnapshot, drafts };
}

function publicFrameFromDefinition(definition: ReturnType<typeof KE.DecisionDefinition.parse>) {
  return KE.PublicDecisionFrame.parse({
    ...definition,
    variables: definition.variables.filter(variable => variable.visibility !== 'OWNER_PRIVATE')
      .map(variable => Object.fromEntries(Object.entries(variable).filter(([key]) => key !== 'ownerParticipantId'))),
    rules: definition.rules.filter(rule => rule.visibility === 'PUBLIC'),
  });
}

export async function buildHypotheticalContributionFixture() {
  const participants = [
    { id: 'maya', displayName: 'Maya', requiredForApproval: true },
    { id: 'leo', displayName: 'Leo', requiredForApproval: true },
    { id: 'nina', displayName: 'Nina', requiredForApproval: true },
  ];
  const definition = KE.DecisionDefinition.parse({
    schemaVersion: KE.KE_SCHEMA_VERSION,
    decisionId: 'purchase-decision',
    frameVersion: 1,
    semanticVersion: 1,
    contextToken: PURCHASE_CONTEXT,
    title: 'Hypothetical shared purchase',
    objective: 'Review a hypothetical contribution and ownership arrangement.',
    description: 'Illustrative amounts and percentages only; this is not legal or financial advice.',
    participants,
    requiredParticipantIds: participants.map(person => person.id),
    variables: [
      { id: 'maya-contribution', type: 'MONEY', label: 'Maya hypothetical contribution', required: true, visibility: 'OWNER_PRIVATE', ownerParticipantId: 'maya', currencyCode: 'USD', minorUnit: 2 },
      { id: 'leo-contribution', type: 'MONEY', label: 'Leo hypothetical contribution', required: true, visibility: 'OWNER_PRIVATE', ownerParticipantId: 'leo', currencyCode: 'USD', minorUnit: 2 },
      { id: 'nina-contribution', type: 'MONEY', label: 'Nina hypothetical contribution', required: true, visibility: 'OWNER_PRIVATE', ownerParticipantId: 'nina', currencyCode: 'USD', minorUnit: 2 },
      { id: 'maya-ownership', type: 'PERCENTAGE', label: 'Maya proposed ownership', required: true, visibility: 'PUBLIC', ownerParticipantId: null },
      { id: 'leo-ownership', type: 'PERCENTAGE', label: 'Leo proposed ownership', required: true, visibility: 'PUBLIC', ownerParticipantId: null },
      { id: 'nina-ownership', type: 'PERCENTAGE', label: 'Nina proposed ownership', required: true, visibility: 'PUBLIC', ownerParticipantId: null },
    ],
    rules: [
      {
        ...ruleBase('ownership-totals-one-hundred-percent', 'PUBLIC'),
        operator: 'SUM_EQUALS',
        variableIds: ['maya-ownership', 'leo-ownership', 'nina-ownership'],
        target: { type: 'PERCENTAGE', basisPoints: 10_000 },
      },
      {
        ...ruleBase('hypothetical-contributions-equal-total', 'TRUSTED_BACKEND'),
        operator: 'SUM_EQUALS',
        variableIds: ['maya-contribution', 'leo-contribution', 'nina-contribution'],
        target: moneyValue(5_000_000),
      },
    ],
  });

  const candidate = KE.CandidateProposal.parse({
    schemaVersion: KE.KE_SCHEMA_VERSION,
    proposalId: 'purchase-proposal-1',
    decisionId: definition.decisionId,
    semanticVersion: definition.semanticVersion,
    contextToken: definition.contextToken,
    proposalVersion: 1,
    values: [
      { variableId: 'maya-contribution', value: moneyValue(2_500_000) },
      { variableId: 'leo-contribution', value: moneyValue(1_500_000) },
      { variableId: 'nina-contribution', value: moneyValue(1_000_000) },
      { variableId: 'maya-ownership', value: { type: 'PERCENTAGE', basisPoints: 5_000 } },
      { variableId: 'leo-ownership', value: { type: 'PERCENTAGE', basisPoints: 3_000 } },
      { variableId: 'nina-ownership', value: { type: 'PERCENTAGE', basisPoints: 2_000 } },
    ],
    validation: {
      status: 'VALID',
      checkedRuleIds: definition.rules.map(rule => rule.id),
      failedRuleIds: [],
      unknownRuleIds: [],
      unsupportedConditionIds: [],
    },
    permissionDependencies: [],
    createdAt: FIXTURE_NOW,
  });
  KE.CandidateForDecision.parse({ definition, candidate });

  const publicFrame = publicFrameFromDefinition(definition);
  const publicFacts = KE.PublicProposalFacts.parse({
    schemaVersion: KE.KE_SCHEMA_VERSION,
    decisionId: definition.decisionId,
    contextToken: definition.contextToken,
    semanticVersion: definition.semanticVersion,
    proposalVersion: candidate.proposalVersion,
    requiredParticipantIds: definition.requiredParticipantIds,
    values: candidate.values.filter(assignment => definition.variables
      .some(variable => variable.id === assignment.variableId && variable.visibility === 'PUBLIC')),
  });
  const publicCandidate = {
    proposalId: candidate.proposalId,
    facts: publicFacts,
    publicHash: await KE.hashDecisionProposal(publicFacts),
    createdAt: candidate.createdAt,
  };
  const publicSnapshot = KE.PublicDecisionSnapshot.parse({
    schemaVersion: KE.KE_SCHEMA_VERSION,
    frame: publicFrame,
    viewerParticipantId: 'maya',
    semanticVersion: definition.semanticVersion,
    contextToken: definition.contextToken,
    publicRevision: 2,
    status: 'PROPOSED',
    frameConfirmations: participants.map(person => ({
      decisionId: definition.decisionId,
      participantId: person.id,
      frameVersion: definition.frameVersion,
      semanticVersion: definition.semanticVersion,
      contextToken: definition.contextToken,
      confirmedAt: FIXTURE_NOW,
    })),
    currentProposal: publicCandidate,
    approvedParticipantIds: [],
    publishedDisclosures: [],
  });
  const ownerSnapshot = KE.OwnerDecisionSnapshot.parse({
    schemaVersion: KE.KE_SCHEMA_VERSION,
    publicSnapshot,
    ownerParticipantId: 'maya',
    ownInputReadiness: 'READY',
    privateVariables: [definition.variables.find(variable => variable.id === 'maya-contribution')],
    privateProposalValues: {
      proposalId: candidate.proposalId,
      proposalVersion: candidate.proposalVersion,
      values: [{ variableId: 'maya-contribution', value: moneyValue(2_500_000) }],
    },
    controlVersion: 4,
    ownerVersion: 2,
    draftVersion: null,
    draft: null,
    confirmedConstraints: [],
    pendingQuestions: [],
    refusedRequests: [],
    negotiationPermissions: [],
    disclosurePermissions: [],
    ownApproval: null,
  });

  return { definition, candidate, publicFrame, publicFacts, publicCandidate, publicSnapshot, ownerSnapshot };
}

function covers(available: { date: string; timezone: string; startMinute: number; endMinute: number },
  required: { date: string; timezone: string; startMinute: number; endMinute: number }): boolean {
  return available.date === required.date && available.timezone === required.timezone
    && available.startMinute <= required.startMinute && available.endMinute >= required.endMinute;
}

function overlaps(left: { date: string; timezone: string; startMinute: number; endMinute: number },
  right: { date: string; timezone: string; startMinute: number; endMinute: number }): boolean {
  return left.date === right.date && left.timezone === right.timezone
    && left.startMinute < right.endMinute && right.startMinute < left.endMinute;
}

function utcMillis(value: string): string {
  return value.endsWith('Z') && !value.includes('.') ? value.slice(0, -1) + '.000Z' : value;
}

export async function adaptTeamTableFixture(withGrant = false) {
  const legacy = buildTeamTableFixture({ withGrant });
  const contextToken = 'c'.repeat(64);
  const decisionId = 'teamtable-compatibility';
  const rosterIds = legacy.roster.map(person => person.id);
  const definition = KE.DecisionDefinition.parse({
    schemaVersion: KE.KE_SCHEMA_VERSION,
    decisionId,
    frameVersion: 1,
    semanticVersion: 1,
    contextToken,
    title: 'Legacy TeamTable regression frame',
    objective: 'Represent the retained synthetic meeting and duty assignment.',
    description: 'A fixture-only bridge. Legacy policy ranking remains in the TeamTable regression suite.',
    participants: legacy.roster.map(person => ({ id: person.id, displayName: person.displayName, requiredForApproval: true })),
    requiredParticipantIds: rosterIds,
    variables: [
      {
        id: 'meeting-slot', type: 'ENUM', label: 'Meeting time', required: true, visibility: 'PUBLIC', ownerParticipantId: null,
        options: legacy.schedule.slots.map(slot => ({ id: slot.id, label: slot.id })),
      },
      {
        id: 'lead-assignee', type: 'PARTICIPANT', label: 'Lead duty owner', required: true, visibility: 'PUBLIC', ownerParticipantId: null,
        participantIds: legacy.schedule.duties.find(duty => duty.id === 'lead')!.qualifiedMemberIds,
      },
      {
        id: 'followup-assignee', type: 'PARTICIPANT', label: 'Follow-up duty owner', required: true, visibility: 'PUBLIC', ownerParticipantId: null,
        participantIds: legacy.schedule.duties.find(duty => duty.id === 'followup')!.qualifiedMemberIds,
      },
    ],
    rules: [{
      ...ruleBase('distinct-duty-assignees', 'PUBLIC'),
      operator: 'ALL_DIFFERENT',
      variableIds: ['lead-assignee', 'followup-assignee'],
    }],
  });

  const constraints: ReturnType<typeof KE.ConfirmedConstraint.parse>[] = [];
  const slots = legacy.schedule.slots;
  for (const owner of legacy.owners) {
    for (const condition of owner.confirmedInputs.values.conditions) {
      const ruleId = 'legacy-rule-' + condition.id;
      let allowedSlots: string[];
      if (condition.kind === 'HARD_AVAILABILITY') {
        allowedSlots = slots.filter(slot => condition.availableIntervals
          .some(available => covers(available, slot.interval))).map(slot => slot.id);
      } else {
        allowedSlots = slots.filter(slot => !overlaps(condition.interval, slot.interval)).map(slot => slot.id);
      }
      const kind = condition.kind === 'NEGOTIABLE_UNAVAILABLE' && condition.inviteException
        ? 'NEGOTIABLE' as const : 'HARD' as const;
      const constraint = KE.ConfirmedConstraint.parse({
        schemaVersion: KE.KE_SCHEMA_VERSION,
        constraintId: condition.id,
        decisionId,
        ownerParticipantId: owner.ownerMemberId,
        kind,
        rule: {
          ...ruleBase(ruleId, 'TRUSTED_BACKEND'),
          operator: 'IN',
          variableId: 'meeting-slot',
          values: allowedSlots.map(optionId => enumValue(optionId)),
        },
        constraintVersion: 1,
        ownerVersion: owner.confirmedInputs.inputRevision,
        semanticVersion: 1,
        contextToken,
        confirmedAt: utcMillis(owner.confirmedInputs.confirmedAt),
        status: 'ACTIVE',
        sourceSummary: 'Synthetic private TeamTable condition retained for compatibility testing.',
      });
      constraints.push(constraint);
    }
    for (const cost of owner.confirmedInputs.values.dutyCosts) {
      const variableId = cost.dutyId === 'lead' ? 'lead-assignee' : 'followup-assignee';
      constraints.push(KE.ConfirmedConstraint.parse({
        schemaVersion: KE.KE_SCHEMA_VERSION,
        constraintId: 'preference-' + owner.ownerMemberId + '-' + cost.dutyId,
        decisionId,
        ownerParticipantId: owner.ownerMemberId,
        kind: 'PREFERENCE',
        preference: {
          variableId,
          value: participantValue(owner.ownerMemberId),
          cost: cost.cost,
        },
        constraintVersion: 1,
        ownerVersion: owner.confirmedInputs.inputRevision,
        semanticVersion: 1,
        contextToken,
        confirmedAt: utcMillis(owner.confirmedInputs.confirmedAt),
        status: 'ACTIVE',
        sourceSummary: 'Synthetic private duty preference retained for compatibility testing.',
      }));
    }
  }

  const questions: ReturnType<typeof KE.NegotiationQuestion.parse>[] = [];
  const permissions: ReturnType<typeof KE.NegotiationPermission.parse>[] = [];
  if (withGrant) {
    const baseRule = {
      ...ruleBase('legacy-exception-adjustment', 'TRUSTED_BACKEND' as const),
      operator: 'IN' as const,
      variableId: 'meeting-slot',
      values: [enumValue('meeting-1100')],
    };
    for (const grant of legacy.exceptionGrants) {
      const ownerParticipantId = 'nina';
      const constraintId = grant.scope.conditionId;
      const constraint = constraints.find(item => item.constraintId === constraintId && item.ownerParticipantId === ownerParticipantId);
      if (!constraint || constraint.kind !== 'NEGOTIABLE') throw new Error('Legacy grant must target Nina’s current negotiable condition');
      const questionId = 'question-' + grant.id;
      const requestIdentity = await KE.hashNegotiationRequestIdentity({
        decisionId,
        contextToken,
        semanticVersion: 1,
        targetParticipantId: ownerParticipantId,
        constraintId,
        constraintVersion: constraint.constraintVersion,
        adjustment: baseRule,
      });
      questions.push(KE.NegotiationQuestion.parse({
        questionId,
        decisionId,
        contextToken,
        semanticVersion: 1,
        targetParticipantId: ownerParticipantId,
        constraintId,
        constraintVersion: constraint.constraintVersion,
        adjustment: baseRule,
        requestIdentity,
        expiresAt: utcMillis(grant.scope.expiresAt),
        status: 'ALLOWED',
      }));
      permissions.push(KE.NegotiationPermission.parse({
        permissionId: 'permission-' + grant.id,
        permissionVersion: grant.version,
        decisionId,
        contextToken,
        semanticVersion: 1,
        ownerParticipantId,
        questionId,
        requestIdentity,
        constraintId,
        constraintVersion: constraint.constraintVersion,
        adjustment: baseRule,
        status: 'ACTIVE',
        expiresAt: utcMillis(grant.scope.expiresAt),
      }));
    }
  }
  return { definition, constraints, questions, negotiationPermissions: permissions, legacyPolicy: legacy.policy };
}
