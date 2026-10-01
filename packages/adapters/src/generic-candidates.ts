import { KnownEnough as KE } from '@deal-table/contracts';
/** Bounded typed domain enumeration from public facts alone. No scenario IDs, owner values or private rules. */
export function genericCandidates(frame: KE.PublicDecisionFrame): KE.CandidateProposal['values'][] {
  const parsed = KE.PublicDecisionFrame.safeParse(frame);
  if (!parsed.success) return [];
  frame = parsed.data;
  if (!frame.variables.length || frame.variables.some(variable => variable.visibility !== 'PUBLIC')) return [];
  const domains = frame.variables.map(variable => {
    const values: KE.DecisionValue[] = variable.type === 'ENUM' ? variable.options.map(option => ({ type: 'ENUM', optionId: option.id }))
      : variable.type === 'ENUM_SET' ? [{ type: 'ENUM_SET', optionIds: [] }, ...variable.options.map(option => ({ type: 'ENUM_SET' as const, optionIds: [option.id] })), { type: 'ENUM_SET', optionIds: variable.options.map(option => option.id) }]
      : variable.type === 'BOOLEAN' ? [{ type: 'BOOLEAN', value: false }, { type: 'BOOLEAN', value: true }]
      : variable.type === 'PARTICIPANT' ? variable.participantIds.map(participantId => ({ type: 'PARTICIPANT', participantId }))
      : frame.rules.flatMap(rule => {
        if ((rule.operator === 'COMPARE' || rule.operator === 'IN' || rule.operator === 'RANGE') && rule.variableId === variable.id)
          return rule.operator === 'COMPARE' ? [rule.value] : rule.operator === 'IN' ? rule.values : [rule.minimum, rule.maximum];
        return [];
      });
    return [...new Map(values.map(value => [JSON.stringify(value), value])).values()];
  });
  if (domains.some(domain => !domain.length) || domains.reduce((total, domain) => total * domain.length, 1) > 64) return [];
  let candidates: KE.CandidateProposal['values'][] = [[]];
  for (let index = 0; index < domains.length; index++) candidates = candidates.flatMap(values => domains[index]!.map(value => [...values, { variableId: frame.variables[index]!.id, value }]));
  // A malformed type/reference must never reach the provider; the trust kernel still checks all rules/consent later.
  const definition = { ...frame, variables: frame.variables.map(variable => ({ ...variable, ownerParticipantId: null })) };
  return candidates.filter(values => KE.CandidateForDecision.safeParse({ definition, candidate: {
    schemaVersion: 2, proposalId: 'generic-domain-check', decisionId: frame.decisionId, contextToken: frame.contextToken,
    semanticVersion: frame.semanticVersion, proposalVersion: 1, values, permissionDependencies: [],
    createdAt: '2026-09-30T12:00:00.000Z', validation: { status: 'VALID', checkedRuleIds: [], failedRuleIds: [], unknownRuleIds: [], unsupportedConditionIds: [] },
  } }).success);
}
