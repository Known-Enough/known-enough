import { expect, it } from 'vitest';
import { KnownEnough as KE } from '@deal-table/contracts';
import { genericCandidates } from './generic-candidates.ts';
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
