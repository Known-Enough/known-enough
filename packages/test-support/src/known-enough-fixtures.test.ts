import { expect, it } from 'vitest';
import { KnownEnough } from '@deal-table/contracts';
import {
  adaptTeamTableFixture,
  buildChristmasFixture,
  buildHypotheticalContributionFixture,
} from './known-enough-fixtures.ts';

const KE = KnownEnough;

it('builds five synthetic Christmas participants and an explicit clarification state', () => {
  const fixture = buildChristmasFixture();
  expect(fixture.definition.participants.map(person => person.id)).toEqual(['maya', 'leo', 'nina', 'ana', 'raul']);
  expect(fixture.publicSnapshot.status).toBe('NEEDS_CLARIFICATION');
  expect(fixture.publicSnapshot).not.toHaveProperty('inputReadiness');
  expect(JSON.stringify(fixture.publicSnapshot)).not.toContain('ana-proximity-condition');
  expect(fixture.drafts.find(draft => draft.ownerParticipantId === 'ana')?.unsupportedConditions).toHaveLength(1);
  expect(JSON.stringify(fixture.publicSnapshot)).not.toContain('ana-proximity-condition');
});

it('keeps hypothetical private contributions out of the public proposal and scoped to their owner', async () => {
  const fixture = await buildHypotheticalContributionFixture();
  expect(KE.CandidateForDecision.parse({ definition: fixture.definition, candidate: fixture.candidate })).toBeDefined();
  expect(fixture.publicFacts.values.map(value => value.variableId)).toEqual([
    'maya-ownership', 'leo-ownership', 'nina-ownership',
  ]);
  expect(fixture.publicCandidate.publicHash).toBe(await KE.hashDecisionProposal(fixture.publicFacts));
  expect(fixture.ownerSnapshot.privateProposalValues?.values).toEqual([{
    variableId: 'maya-contribution',
    value: { type: 'MONEY', amountMinor: 2_500_000, currencyCode: 'USD', minorUnit: 2 },
  }]);
  expect(JSON.stringify(fixture.publicSnapshot)).not.toContain('2500000');
  expect(JSON.stringify(fixture.ownerSnapshot)).not.toContain('1500000');
});

it('maps the TeamTable regression fixture to generic variables, owner constraints, and preferences', async () => {
  const fixture = await adaptTeamTableFixture();
  expect(KE.DecisionDefinition.parse(fixture.definition)).toEqual(fixture.definition);
  expect(fixture.definition.participants).toHaveLength(3);
  expect(fixture.definition.variables.map(variable => variable.id)).toEqual([
    'meeting-slot', 'lead-assignee', 'followup-assignee',
  ]);
  expect(fixture.constraints.some(constraint => constraint.kind === 'HARD')).toBe(true);
  expect(fixture.constraints.some(constraint => constraint.kind === 'NEGOTIABLE')).toBe(true);
  expect(fixture.constraints.some(constraint => constraint.kind === 'PREFERENCE')).toBe(true);
  expect(fixture.legacyPolicy).toBe('BALANCE_RECENT_LOAD');
});

it('maps a legacy conditional grant to an owner-only generic negotiation permission', async () => {
  const fixture = await adaptTeamTableFixture(true);
  expect(fixture.questions).toHaveLength(1);
  expect(fixture.negotiationPermissions).toHaveLength(1);
  expect(fixture.questions[0]!.requestIdentity).toBe(fixture.negotiationPermissions[0]!.requestIdentity);
  expect(fixture.questions[0]!.targetParticipantId).toBe('nina');
  expect(fixture.negotiationPermissions[0]!.status).toBe('ACTIVE');
  expect(JSON.stringify(fixture.definition)).not.toContain('grant-nina-no-duty');
});
