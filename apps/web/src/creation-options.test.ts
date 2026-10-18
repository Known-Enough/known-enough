import { describe, expect, it } from 'vitest';
import { ChoicePlan, compileChoicePlan } from '@deal-table/contracts';
import { addSuggestedOption, emptyChoicePlan } from './creation-options';

describe('reviewed creation suggestions', () => {
  const topic: ChoicePlan['topics'][number] = { label: 'Destination', kind: 'CHOICE', options: ['Coast', 'Mountain'] };
  it('adds only the explicitly chosen option without modifying the original draft or importing the other suggestions', () => {
    const original: ChoicePlan = { title: 'Weekend plan', description: 'Our shared text', topics: [{ ...topic, options: ['City'] }] };
    const result = addSuggestedOption(original, topic, 'Coast')!;
    expect(result.topics[0]!.options).toEqual(['City', 'Coast']);
    expect(original.topics[0]!.options).toEqual(['City']);
    expect(result.description).toBe('Our shared text');
    expect(result.title).toBe('Weekend plan');
  });
  it('rejects an equivalent duplicate and does not replace an existing named empty topic', () => {
    const original: ChoicePlan = { title: 'Weekend', description: '', topics: [{ ...topic, options: [' Coast '] }, { label: 'Budget', kind: 'CHOICE', options: [] }] };
    expect(addSuggestedOption(original, topic, 'coast')).toBeNull();
    const result = addSuggestedOption(original, { ...topic, label: 'Day', kind: 'DATE' }, '2026-11-01')!;
    expect(result.topics[1]!.label).toBe('Budget');
    expect(result.topics[2]!.kind).toBe('DATE');
  });
  it('adds to the initial option list rather than inventing another choice to decide, while retaining typed date topics', () => {
    const original = emptyChoicePlan('Choose a destination'); original.topics[0]!.options.push('Our place');
    const added = addSuggestedOption(original, topic, 'Coast')!;
    expect(added.topics).toEqual([{ label: 'Options', kind: 'CHOICE', options: ['Our place', 'Coast'] }]);
    const withDay = addSuggestedOption(added, { label: 'Day', kind: 'DATE', options: [] }, '2026-11-14')!;
    expect(withDay.topics).toHaveLength(2);
    expect(withDay.topics[0]!.options).toEqual(['Our place', 'Coast']);
    const datesOnly = addSuggestedOption(emptyChoicePlan('Choose a date'), { label: 'Day', kind: 'DATE', options: [] }, '2026-11-14')!;
    expect(datesOnly.topics).toEqual([{ label: 'Day', kind: 'DATE', options: ['2026-11-14'] }]);
  });
  it('keeps the engine limits and incomplete state, including after an empty starting description', () => {
    const empty = emptyChoicePlan('');
    expect(compileChoicePlan(empty).questions.length).toBeGreaterThan(0);
    expect(addSuggestedOption(empty, topic, '')).toBeNull();
    expect(addSuggestedOption(empty, topic, 'a'.repeat(101))).toBeNull();
    const full = { ...empty, topics: Array.from({ length: 6 }, (_, i) => ({ label: 'Topic ' + i, kind: 'CHOICE' as const, options: ['A'] })) };
    expect(addSuggestedOption(full, topic, 'Coast')).toBeNull();
    const sixteen = { ...empty, topics: [{ ...topic, options: Array.from({ length: 16 }, (_, i) => String(i)) }] };
    expect(addSuggestedOption(sixteen, topic, 'Extra')).toBeNull();
  });
});
