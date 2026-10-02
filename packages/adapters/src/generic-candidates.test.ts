import { expect, it } from 'vitest';
import { KnownEnough as KE } from '@deal-table/contracts';
import { genericCandidates, genericCandidateCatalog } from './generic-candidates.ts';
const frame = () => KE.PublicDecisionFrame.parse({ schemaVersion: 2, decisionId: 'groupdecision-new', frameVersion: 1,
  semanticVersion: 1, contextToken: 'a'.repeat(64), title: 'New task', objective: 'Choose a garden task', description: '',
  participants: [{ id: 'iris', displayName: 'Iris', requiredForApproval: true }], requiredParticipantIds: ['iris'],
  variables: [{ id: 'task', type: 'ENUM', visibility: 'PUBLIC', label: 'Task', required: true, options: [{ id: 'plant', label: 'Plant' }, { id: 'water', label: 'Water' }] },
    { id: 'indoors', type: 'BOOLEAN', visibility: 'PUBLIC', label: 'Indoors', required: true }], rules: [] });
it('derives different bounded combinations from arbitrary public variables, without any scenario catalog', () => {
  const result = genericCandidates(frame()); expect(result).toHaveLength(4);
  expect(result[0]).toEqual([{ variableId: 'task', value: { type: 'ENUM', optionId: 'plant' } }, { variableId: 'indoors', value: { type: 'BOOLEAN', value: false } }]);
  const changed = frame(); changed.variables[0] = { id: 'cost', type: 'MONEY', visibility: 'PUBLIC', label: 'Fictional public cost', required: true, currencyCode: 'USD', minorUnit: 2 };
  expect(genericCandidates(changed)).toEqual([]);
  changed.rules.push({ id: 'cost-domain', operator: 'IN', visibility: 'PUBLIC', variableId: 'cost', values: [{ type: 'MONEY', amountMinor: 1000, currencyCode: 'USD', minorUnit: 2 }] });
  expect(genericCandidates(changed)).toHaveLength(2);
});
it('fails closed on private/invalid frame or unbounded domain expansion', () => {
  const invalid = frame(); (invalid.variables[0] as unknown as Record<string, unknown>).visibility = 'OWNER_PRIVATE';
  expect(genericCandidates(invalid)).toEqual([]);
  const large = frame(); large.variables = Array.from({ length: 7 }, (_, index) => ({ id: `choice-${index}`, type: 'BOOLEAN', visibility: 'PUBLIC', label: 'Choice', required: true }));
  expect(genericCandidates(large)).toEqual([]);
});

it('enumerates every set subset, including the previously omitted two-option combinations', () => {
  const value = frame(); value.variables = [{ id: 'task', type: 'ENUM_SET', visibility: 'PUBLIC', label: 'Tasks', required: true,
    options: ['a', 'b', 'c'].map(id => ({ id, label: id })) }];
  const catalog = genericCandidates(value); expect(catalog).toHaveLength(8);
  expect(catalog.some(values => values[0]!.value.type === 'ENUM_SET' && values[0]!.value.optionIds.join() === 'a,b')).toBe(true);
});
it('includes all interior scaled numeric values and respects exclusive endpoints', () => {
  const value = frame(); value.variables = [{ id: 'count', type: 'NUMBER', label: 'Count', required: true, visibility: 'PUBLIC', scale: 0, unitCode: 'COUNT' }];
  const typed = (coefficient: number) => ({ type: 'NUMBER' as const, coefficient, scale: 0, unitCode: 'COUNT' });
  value.rules = [{ id: 'range', visibility: 'PUBLIC', operator: 'RANGE', variableId: 'count', minimum: typed(10), maximum: typed(20), includeMinimum: false, includeMaximum: false }];
  const catalog = genericCandidates(value); expect(catalog).toHaveLength(9);
  expect(catalog.map(values => values[0]!.value)).toContainEqual(typed(15)); expect(catalog.map(values => values[0]!.value)).not.toContainEqual(typed(10));
  value.rules = [{ id: 'lower', visibility: 'PUBLIC', operator: 'COMPARE', variableId: 'count', comparison: 'GT', value: typed(10) },
    { id: 'upper', visibility: 'PUBLIC', operator: 'COMPARE', variableId: 'count', comparison: 'LT', value: typed(20) }];
  expect(genericCandidates(value)).toHaveLength(9);
});
it.each([
  [{ type: 'MONEY', currencyCode: 'USD', minorUnit: 2 }, { type: 'MONEY', currencyCode: 'USD', minorUnit: 2, amountMinor: 10 }, { type: 'MONEY', currencyCode: 'USD', minorUnit: 2, amountMinor: 12 }, { type: 'MONEY', currencyCode: 'USD', minorUnit: 2, amountMinor: 11 }],
  [{ type: 'PERCENTAGE' }, { type: 'PERCENTAGE', basisPoints: 10 }, { type: 'PERCENTAGE', basisPoints: 12 }, { type: 'PERCENTAGE', basisPoints: 11 }],
  [{ type: 'DURATION', unit: 'SECONDS' }, { type: 'DURATION', seconds: 10 }, { type: 'DURATION', seconds: 12 }, { type: 'DURATION', seconds: 11 }],
  [{ type: 'DATE' }, { type: 'DATE', date: '2026-10-01' }, { type: 'DATE', date: '2026-10-03' }, { type: 'DATE', date: '2026-10-02' }],
  [{ type: 'DATETIME', displayTimeZone: 'UTC' }, { type: 'DATETIME', displayTimeZone: 'UTC', instant: '2026-10-01T00:00:00.000Z' }, { type: 'DATETIME', displayTimeZone: 'UTC', instant: '2026-10-01T00:00:00.002Z' }, { type: 'DATETIME', displayTimeZone: 'UTC', instant: '2026-10-01T00:00:00.001Z' }]
])('includes complete supported discrete interior values for %s', (variable, minimum, maximum, interior) => {
  const value = frame(); value.variables = [{ id: 'value', label: 'Value', required: true, visibility: 'PUBLIC', ...variable }] as KE.PublicDecisionFrame['variables'];
  value.rules = [{ id: 'range', visibility: 'PUBLIC', operator: 'RANGE', variableId: 'value', minimum, maximum, includeMinimum: true, includeMaximum: true }] as KE.PublicDecisionFrame['rules'];
  const catalog = genericCandidates(value); expect(catalog).toHaveLength(3); expect(catalog.map(values => values[0]!.value)).toContainEqual(interior);
});
it('large domains require clarification while an explicit finite IN vocabulary remains usable', () => {
  const value = frame(); value.variables = [{ id: 'task', type: 'ENUM_SET', visibility: 'PUBLIC', label: 'Tasks', required: true,
    options: Array.from({ length: 7 }, (_, index) => ({ id: 'option-' + index, label: 'Option ' + index })) }];
  expect(genericCandidateCatalog(value)).toMatchObject({ status: 'NEEDS_CLARIFICATION', candidates: [] });
  value.rules = [{ id: 'choices', operator: 'IN', visibility: 'PUBLIC', variableId: 'task', values: [
    { type: 'ENUM_SET', optionIds: ['option-0', 'option-1'] }] }];
  expect(genericCandidateCatalog(value).status).toBe('COMPLETE'); expect(genericCandidates(value)).toHaveLength(1);
});
it('an unbounded range or a catalog over 64 combinations cannot be labeled complete', () => {
  const value = frame(); value.variables = [{ id: 'count', type: 'NUMBER', label: 'Count', required: true, visibility: 'PUBLIC', scale: 0, unitCode: 'COUNT' }];
  const typed = (coefficient: number) => ({ type: 'NUMBER' as const, coefficient, scale: 0, unitCode: 'COUNT' });
  expect(genericCandidateCatalog(value).status).toBe('NEEDS_CLARIFICATION');
  value.rules = [{ id: 'range', operator: 'RANGE', visibility: 'PUBLIC', variableId: 'count', minimum: typed(0), maximum: typed(63), includeMinimum: true, includeMaximum: true }];
  expect(genericCandidates(value)).toHaveLength(64);
  value.rules[0] = { ...value.rules[0]!, maximum: typed(64) } as KE.PublicDecisionFrame['rules'][number];
  expect(genericCandidateCatalog(value)).toMatchObject({ status: 'NEEDS_CLARIFICATION', candidates: [] });
});

it('includes omission for optional public variables and counts it toward the combination cap', () => {
  const value = frame(); value.variables = [{ id: 'optional', type: 'BOOLEAN', visibility: 'PUBLIC', label: 'Optional', required: false }];
  const catalog = genericCandidateCatalog(value); expect(catalog.status).toBe('COMPLETE'); expect(catalog.candidates).toHaveLength(3);
  expect(catalog.candidates).toContainEqual([]);
  value.variables = Array.from({ length: 4 }, (_, index) => ({ id: 'optional-' + index, type: 'BOOLEAN', visibility: 'PUBLIC', label: 'Optional', required: false }));
  expect(genericCandidateCatalog(value).status).toBe('NEEDS_CLARIFICATION');
});
