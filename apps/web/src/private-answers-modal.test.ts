import { expect, it } from 'vitest';
import { compileChoicePlan, KnownEnough as KE, publicChoiceOptions } from '@deal-table/contracts';
import { buildHypotheticalContributionFixture } from '../../../packages/test-support/src/known-enough-fixtures';
import { savedChoiceAnswers } from './private-answers-modal';

async function fixture() {
  const original = (await buildHypotheticalContributionFixture()).ownerSnapshot;
  const compiled = compileChoicePlan({ title: 'Weekend', description: 'Choose a place.', topics: [{ label: 'Place', kind: 'CHOICE', options: ['Park', 'Museum'] }] });
  const owner = KE.OwnerDecisionSnapshot.parse({ ...original, publicSnapshot: { ...original.publicSnapshot,
    frame: { ...original.publicSnapshot.frame, variables: compiled.variables, rules: compiled.rules }, currentProposal: null, status: 'READY' }, privateVariables: [], privateProposalValues: null });
  const variable = owner.publicSnapshot.frame.variables[0]!;
  const values = publicChoiceOptions(owner.publicSnapshot.frame, variable)!;
  const rule = { id: 'selected-rule', visibility: 'TRUSTED_BACKEND' as const, operator: 'IN' as const, variableId: variable.id, values: [values[1]!] };
  const constraint: KE.ConfirmedConstraint = { schemaVersion: 2, constraintId: 'answer-saved', decisionId: owner.publicSnapshot.frame.decisionId, ownerParticipantId: owner.ownerParticipantId,
    constraintVersion: 1, ownerVersion: owner.ownerVersion, semanticVersion: owner.publicSnapshot.semanticVersion, contextToken: owner.publicSnapshot.contextToken,
    confirmedAt: '2026-10-18T00:00:00.000Z', status: 'ACTIVE', sourceSummary: 'Synthetic choices.', kind: 'HARD', rule };
  return { owner, variable, rule, constraint };
}
it('saved selection excludes superseded conditions and unconfirmed direct suggestions', async () => {
  const { owner, variable, constraint, rule } = await fixture();
  owner.confirmedConstraints = [constraint, { ...constraint, constraintId: 'answer-old', status: 'SUPERSEDED' }];
  owner.draftVersion = 1;
  owner.draft = { schemaVersion: 2, draftId: 'new-suggestion', draftVersion: 1, decisionId: owner.publicSnapshot.frame.decisionId, ownerParticipantId: owner.ownerParticipantId,
    ownerVersion: owner.ownerVersion, semanticVersion: owner.publicSnapshot.semanticVersion, contextToken: owner.publicSnapshot.contextToken, sourceSummary: 'Synthetic draft.',
    proposedConstraints: [{ constraintId: 'answer-unconfirmed', kind: 'HARD', rule: { ...rule, values: [publicChoiceOptions(owner.publicSnapshot.frame, variable)![0]!] } }], unsupportedConditions: [], createdAt: '2026-10-18T00:00:00.000Z' };
  const current = KE.OwnerDecisionSnapshot.parse(owner);
  expect(savedChoiceAnswers(current)[variable.id]).toEqual({ mode: 'SELECTED', acceptable: [1], preferred: '' });
});
it('distinguishes unanswered, unrestricted saved answers and saved None', async () => {
  const { owner, variable } = await fixture();
  expect(savedChoiceAnswers(owner)[variable.id]!.mode).toBe('ANY');
  owner.ownInputReadiness = 'NOT_STARTED';
  expect(savedChoiceAnswers(owner)[variable.id]!.mode).toBe('');
  owner.ownInputReadiness = 'NEEDS_CLARIFICATION'; owner.draftVersion = 1;
  owner.draft = KE.AIConstraintDraft.parse({ schemaVersion: 2, draftId: 'none-saved', draftVersion: 1, decisionId: owner.publicSnapshot.frame.decisionId, ownerParticipantId: owner.ownerParticipantId,
    ownerVersion: owner.ownerVersion, semanticVersion: owner.publicSnapshot.semanticVersion, contextToken: owner.publicSnapshot.contextToken, sourceSummary: 'Synthetic None.',
    proposedConstraints: [], unsupportedConditions: [{ id: 'answer-none', clarificationQuestion: `None of the listed options for ${variable.label} work. Additional shared options are needed.`, sourceSummary: 'None' }], createdAt: '2026-10-18T00:00:00.000Z' });
  expect(savedChoiceAnswers(owner)[variable.id]!.mode).toBe('NONE');
});
it('legacy restrictions are not presented as all options accepted', async () => {
  const { owner, variable, constraint } = await fixture();
  owner.confirmedConstraints = [{ ...constraint, constraintId: 'legacy-condition' }];
  expect(savedChoiceAnswers(KE.OwnerDecisionSnapshot.parse(owner))[variable.id]!.mode).toBe('');
});
