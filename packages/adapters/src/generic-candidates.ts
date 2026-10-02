import { KnownEnough as KE } from '@deal-table/contracts';
const LIMIT = 64;
const boundedQuestion = 'Please specify a smaller set of public choices or tighter value limits so every supported combination can be checked.';
export interface GenericCandidateCatalog {
  status: 'COMPLETE' | 'NEEDS_CLARIFICATION';
  candidates: KE.CandidateProposal['values'][];
  clarificationQuestion: string | null;
}
function scalar(value: KE.DecisionValue): bigint | null {
  switch (value.type) {
    case 'NUMBER': return BigInt(value.coefficient);
    case 'MONEY': return BigInt(value.amountMinor);
    case 'PERCENTAGE': return BigInt(value.basisPoints);
    case 'DURATION': return BigInt(value.seconds);
    case 'DATE': return BigInt(Date.parse(value.date + 'T00:00:00Z') / 86400000);
    case 'DATETIME': return BigInt(Date.parse(value.instant));
    default: return null;
  }
}
function valueAt(variable: KE.PublicDecisionFrame['variables'][number], value: bigint): KE.DecisionValue {
  const number = Number(value);
  switch (variable.type) {
    case 'NUMBER': return { type: 'NUMBER', coefficient: number, scale: variable.scale, unitCode: variable.unitCode };
    case 'MONEY': return { type: 'MONEY', amountMinor: number, currencyCode: variable.currencyCode, minorUnit: variable.minorUnit };
    case 'PERCENTAGE': return { type: 'PERCENTAGE', basisPoints: number };
    case 'DURATION': return { type: 'DURATION', seconds: number };
    case 'DATE': return { type: 'DATE', date: new Date(number * 86400000).toISOString().slice(0, 10) };
    case 'DATETIME': return { type: 'DATETIME', instant: new Date(number).toISOString(), displayTimeZone: variable.displayTimeZone };
    default: throw new Error('Unsupported scalar domain');
  }
}
function domain(frame: KE.PublicDecisionFrame, variable: KE.PublicDecisionFrame['variables'][number]): KE.DecisionValue[] | null {
  const rules = frame.rules.filter(rule => 'variableId' in rule && rule.variableId === variable.id);
  // IN/EQ defines the entire allowed finite vocabulary, including otherwise large set/time domains.
  const finite = rules.find(rule => rule.operator === 'IN' || (rule.operator === 'COMPARE' && rule.comparison === 'EQ'));
  if (finite?.operator === 'IN') return finite.values;
  if (finite?.operator === 'COMPARE') return [finite.value];
  if (variable.type === 'ENUM') return variable.options.map(option => ({ type: 'ENUM', optionId: option.id }));
  if (variable.type === 'ENUM_SET') {
    if (variable.options.length > 6) return null;
    return Array.from({ length: 2 ** variable.options.length }, (_, mask) => ({ type: 'ENUM_SET',
      optionIds: variable.options.filter((_option, index) => (mask & (1 << index)) !== 0).map(option => option.id) }));
  }
  if (variable.type === 'BOOLEAN') return [{ type: 'BOOLEAN', value: false }, { type: 'BOOLEAN', value: true }];
  if (variable.type === 'PARTICIPANT') return variable.participantIds.map(participantId => ({ type: 'PARTICIPANT', participantId }));
  let lower: bigint | null = variable.type === 'PERCENTAGE' || variable.type === 'DURATION' ? 0n : null;
  let upper: bigint | null = variable.type === 'PERCENTAGE' ? 10000n : null;
  const low = (value: bigint) => { lower = lower === null || value > lower ? value : lower; };
  const high = (value: bigint) => { upper = upper === null || value < upper ? value : upper; };
  for (const rule of rules) {
    if (rule.operator === 'RANGE') {
      const minimum = scalar(rule.minimum); const maximum = scalar(rule.maximum);
      if (minimum === null || maximum === null) return null;
      low(minimum + (rule.includeMinimum ? 0n : 1n)); high(maximum - (rule.includeMaximum ? 0n : 1n));
    } else if (rule.operator === 'COMPARE') {
      const value = scalar(rule.value); if (value === null) return null;
      if (rule.comparison === 'GT' || rule.comparison === 'GTE') low(value + (rule.comparison === 'GT' ? 1n : 0n));
      if (rule.comparison === 'LT' || rule.comparison === 'LTE') high(value - (rule.comparison === 'LT' ? 1n : 0n));
    }
  }
  if (lower === null || upper === null || upper - lower + 1n > BigInt(LIMIT)) return null;
  if (upper < lower) return [];
  return Array.from({ length: Number(upper - lower + 1n) }, (_, index) => valueAt(variable, lower! + BigInt(index)));
}
/** Complete enumeration of bounded discrete/explicit public domains; no private/scenario facts. */
export function genericCandidateCatalog(frame: KE.PublicDecisionFrame): GenericCandidateCatalog {
  const clarify = (question = boundedQuestion): GenericCandidateCatalog => ({ status: 'NEEDS_CLARIFICATION', candidates: [], clarificationQuestion: question });
  const parsed = KE.PublicDecisionFrame.safeParse(frame);
  if (!parsed.success || !parsed.data.variables.length || parsed.data.variables.some(variable => variable.visibility !== 'PUBLIC')) return clarify();
  frame = parsed.data;
  const domains = frame.variables.map(variable => {
    const values = domain(frame, variable);
    if (!values) return null;
    const canonical = values.map(value => value.type === 'ENUM_SET' ? { ...value, optionIds: [...value.optionIds].sort() } : value);
    const unique: (KE.DecisionValue | null)[] = [...new Map(canonical.map(value => [JSON.stringify(value), value])).values()];
    if (!variable.required) unique.push(null);
    return unique;
  });
  if (domains.some(values => values === null) || domains.reduce((count, values) => count * (values?.length ?? LIMIT + 1), 1) > LIMIT) return clarify();
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
