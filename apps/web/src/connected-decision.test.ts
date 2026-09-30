import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildHypotheticalContributionFixture } from '../../../packages/test-support/src/known-enough-fixtures';
import { KnownEnough as KE } from '@deal-table/contracts';
import { ConnectedDecision, ruleText } from './connected-decision';

const variables: KE.PublicDecisionFrame['variables'] = [
  { id: 'a', type: 'PERCENTAGE', visibility: 'PUBLIC', required: true, label: 'Maya ownership' },
  { id: 'b', type: 'PERCENTAGE', visibility: 'PUBLIC', required: true, label: 'Leo ownership' },
  { id: 'first', type: 'BOOLEAN', visibility: 'PUBLIC', required: true, label: 'First choice' },
  { id: 'second', type: 'BOOLEAN', visibility: 'PUBLIC', required: true, label: 'Second choice' },
];
const percentage = (basisPoints: number) => ({ type: 'PERCENTAGE' as const, basisPoints });
const bool = (value: boolean) => ({ type: 'BOOLEAN' as const, value });
const rule = (value: unknown) => KE.ValidationRule.parse(value);
const base = { id: 'review-rule', visibility: 'PUBLIC' };

describe('KE14 exact closed-rule review text', () => {
  it('shows sum targets, inclusive/exclusive range bounds, and every referenced variable', () => {
    expect(ruleText(rule({ ...base, operator: 'SUM_EQUALS', variableIds: ['a', 'b'], target: percentage(10_000) }), variables))
      .toBe('Sum of Maya ownership + Leo ownership = 100%');
    expect(ruleText(rule({ ...base, operator: 'RANGE', variableId: 'a', minimum: percentage(2_000), maximum: percentage(5_000),
      includeMinimum: false, includeMaximum: true }), variables)).toBe('Maya ownership > 20% and ≤ 50%');
  });

  it('distinguishes all-different, mutually-exclusive and implication semantics', () => {
    expect(ruleText(rule({ ...base, operator: 'ALL_DIFFERENT', variableIds: ['a', 'b'] }), variables))
      .toBe('Maya ownership, Leo ownership must all have different values');
    expect(ruleText(rule({ ...base, operator: 'MUTUALLY_EXCLUSIVE', variableIds: ['first', 'second'], maximumSelected: 1 }), variables))
      .toBe('At most 1 of First choice, Second choice may be Yes');
    expect(ruleText(rule({ ...base, operator: 'IMPLIES', antecedent: { variableId: 'first', operator: 'EQ', value: bool(true) },
      consequent: { variableId: 'second', operator: 'NE', value: bool(true) } }), variables))
      .toBe('If First choice equals Yes, then Second choice does not equal Yes');
  });

  it('renders a valid complex private draft and names the preferred variable before confirmation', async () => {
    const fixture = await buildHypotheticalContributionFixture();
    const owner = fixture.ownerSnapshot;
    const draft = KE.AIConstraintDraft.parse({ schemaVersion: 2, draftId: 'review-draft', draftVersion: 1,
      decisionId: owner.publicSnapshot.frame.decisionId, ownerParticipantId: owner.ownerParticipantId,
      ownerVersion: owner.ownerVersion, semanticVersion: owner.publicSnapshot.semanticVersion,
      contextToken: owner.publicSnapshot.contextToken, sourceSummary: 'Review the exact synthetic conditions.',
      proposedConstraints: [
        { constraintId: 'ownership-total', kind: 'HARD', rule: { id: 'ownership-total-rule',
          visibility: 'TRUSTED_BACKEND', operator: 'SUM_EQUALS',
          variableIds: ['maya-ownership', 'leo-ownership', 'nina-ownership'], target: percentage(10_000) } },
        { constraintId: 'maya-preference', kind: 'PREFERENCE', preference: {
          variableId: 'maya-ownership', value: percentage(5_000), cost: 2 } },
      ], unsupportedConditions: [], createdAt: '2026-09-29T12:00:00.000Z' });
    const current = KE.OwnerDecisionSnapshot.parse({ ...owner, draftVersion: 1, draft });
    const markup = renderToStaticMarkup(createElement(ConnectedDecision, { snapshot: current.publicSnapshot,
      owner: current, api: async () => Response.json({}), refresh: async () => {} }));
    expect(markup).toContain('Sum of Maya proposed ownership + Leo proposed ownership + Nina proposed ownership = 100%');
    expect(markup).toContain('Maya proposed ownership: 50% (preference cost 2)');
    expect(markup).not.toContain('Combined condition');
    expect(markup).toContain('Confirm selected conditions');
  });
});
