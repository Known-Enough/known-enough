import { describe, expect, it } from 'vitest';
import { compileChoicePlan, type ChoicePlan } from '@deal-table/contracts';
import { normalizeChoicePlanDates } from './choice-plan-dates.ts';

const plan = (options: string[], kind: 'DATE' | 'CHOICE' = 'DATE'): ChoicePlan => ({
  title: 'Public dates', description: 'Supplied alternatives', topics: [{ label: 'Date', kind, options }],
});
describe('model choice-plan named dates', () => {
  it('compiles the exact retained E2E04 alternatives without a new clarification', () => {
    const input = plan(['30 October 2026', '31 October 2026']);
    const normalized = normalizeChoicePlanDates(input);
    expect(normalized.topics[0]!.options).toEqual(['2026-10-30', '2026-10-31']);
    expect(compileChoicePlan(normalized).questions).toEqual([]);
    expect(input.topics[0]!.options).toEqual(['30 October 2026', '31 October 2026']);
  });
  it.each(['February 29, 2028', '29 february 2028'])('canonicalizes a valid complete date: %s', value => {
    expect(normalizeChoicePlanDates(plan([value])).topics[0]!.options).toEqual(['2028-02-29']);
  });
  it.each(['31 February 2026', '29 February 2026', '10/11/2026', '31 October',
    'next Friday', '31 Oct 2026', '31 October 2026 or later', '2026-10-31'])('does not guess or rewrite: %s', value => {
    expect(normalizeChoicePlanDates(plan([value])).topics[0]!.options).toEqual([value]);
  });
  it('preserves CHOICE labels and every other supplied field', () => {
    const input = plan(['31 October 2026', 'next Friday'], 'CHOICE');
    expect(normalizeChoicePlanDates(input)).toEqual(input);
  });
});
