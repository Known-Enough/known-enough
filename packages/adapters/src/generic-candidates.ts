import { KnownEnough as KE, publicChoiceOptions } from '@deal-table/contracts';
const LIMIT = 64;
const boundedQuestion = 'Please specify a smaller set of public choices or tighter value limits so every supported combination can be checked.';
export interface GenericCandidateCatalog {
  status: 'COMPLETE' | 'NEEDS_CLARIFICATION';
  candidates: KE.CandidateProposal['values'][];
  clarificationQuestion: string | null;
}
/** Complete enumeration of bounded discrete/explicit public domains; no private/scenario facts. */
export function genericCandidateCatalog(frame: KE.PublicDecisionFrame): GenericCandidateCatalog {
  const clarify = (question = boundedQuestion): GenericCandidateCatalog => ({ status: 'NEEDS_CLARIFICATION', candidates: [], clarificationQuestion: question });
  const parsed = KE.PublicDecisionFrame.safeParse(frame);
  if (!parsed.success || !parsed.data.variables.length || parsed.data.variables.some(variable => variable.visibility !== 'PUBLIC')) return clarify();
  frame = parsed.data;
  const domains = frame.variables.map(variable => {
    const values = publicChoiceOptions(frame, variable);
    if (!values) return null;
    const canonical = values.map(value => value.type === 'ENUM_SET' ? { ...value, optionIds: [...value.optionIds].sort() } : value);
    const unique: (KE.DecisionValue | null)[] = [...new Map(canonical.map(value => [JSON.stringify(value), value])).values()];
    if (!variable.required) unique.push(null);
    return unique;
  });
  const unbounded = domains.findIndex(values => values === null);
  if (unbounded >= 0) return clarify(`Set a finite list or tighter limits for “${frame.variables[unbounded]!.label.slice(0, 120)}”. Each public choice needs a bounded domain, and the complete decision must have at most ${LIMIT} combinations.`);
  const combinations = domains.reduce((count, values) => count * values!.length, 1);
  if (combinations > LIMIT) return clarify(`These choices produce ${combinations} combinations (${domains.map(values => values!.length).join(' × ')}); the current limit is ${LIMIT}. Which one choice should we narrow? Keep your other options as they are.`);
  let candidates: KE.CandidateProposal['values'][] = [[]];
  for (let index = 0; index < domains.length; index++) candidates = candidates.flatMap(values => domains[index]!.map(value => value === null ? [...values] : [...values, { variableId: frame.variables[index]!.id, value }]));
  const definition = { ...frame, variables: frame.variables.map(variable => ({ ...variable, ownerParticipantId: null })) };
  candidates = candidates.filter(values => KE.CandidateForDecision.safeParse({ definition, candidate: {
    schemaVersion: 2, proposalId: 'generic-domain-check', decisionId: frame.decisionId, contextToken: frame.contextToken,
    semanticVersion: frame.semanticVersion, proposalVersion: 1, values, permissionDependencies: [],
    createdAt: '2026-09-30T12:00:00.000Z', validation: { status: 'VALID', checkedRuleIds: [], failedRuleIds: [], unknownRuleIds: [], unsupportedConditionIds: [] }
  } }).success);
  if (!candidates.length) return clarify('The public limits leave no supported choices. Adjust them and request a new draft.');
  return { status: 'COMPLETE', candidates, clarificationQuestion: null };
}
export function genericCandidates(frame: KE.PublicDecisionFrame): KE.CandidateProposal['values'][] {
  return genericCandidateCatalog(frame).candidates;
}
