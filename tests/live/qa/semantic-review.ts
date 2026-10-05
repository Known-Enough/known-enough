import type { KnownEnough as KE } from '@deal-table/contracts';

/** Synthetic participant review only: one condition, exact meaning on the two stated options. */
export function syntheticConditionMatches(
  conditions: KE.AIConstraintDraft['proposedConstraints'],
  expected: { kind: 'HARD' | 'NEGOTIABLE'; variableId: string; optionId: string; otherOptionId: string },
): boolean {
  if (conditions.length !== 1 || expected.optionId === expected.otherOptionId) return false;
  const condition = conditions[0]!;
  if (condition.kind === 'PREFERENCE' || condition.kind !== expected.kind) return false;
  const rule = condition.rule;
  if (rule.visibility !== 'TRUSTED_BACKEND' || !('variableId' in rule) || rule.variableId !== expected.variableId) return false;
  const accepts = (optionId: string) => {
    if (rule.operator === 'COMPARE' && rule.value.type === 'ENUM') {
      if (rule.comparison === 'EQ') return optionId === rule.value.optionId;
      if (rule.comparison === 'NE') return optionId !== rule.value.optionId;
    }
    if (rule.operator === 'IN') return rule.values.some(value => value.type === 'ENUM' && value.optionId === optionId);
    return false;
  };
  // Do not accept an unrecognized option or mixed value domain as an equivalent rule.
  const values = rule.operator === 'COMPARE' ? [rule.value] : rule.operator === 'IN' ? rule.values : [];
  return values.length > 0 && values.every(value => value.type === 'ENUM' && [expected.optionId, expected.otherOptionId].includes(value.optionId))
    && accepts(expected.optionId) && !accepts(expected.otherOptionId);
}
