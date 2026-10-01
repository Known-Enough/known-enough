import { expect, it } from 'vitest';
import { KnownEnough } from '@deal-table/contracts';
import { decisionStatusText, privateReadinessText } from './decision-copy';
it('every lifecycle state has plain action-oriented copy; approval and missing approval are distinct', () => {
  for (const state of KnownEnough.PublicDecisionStatus.options) {
    expect(decisionStatusText(state)).toMatch(/[a-z]/); expect(decisionStatusText(state)).not.toMatch(/schema|kernel|semantic|controlVersion|contextToken|API/);
  }
  expect(decisionStatusText('APPROVING')).toMatch(/missing/); expect(decisionStatusText('AGREED')).toMatch(/exact proposal/);
  expect(privateReadinessText('NEEDS_CLARIFICATION')).toMatch(/Clarify/);
});
