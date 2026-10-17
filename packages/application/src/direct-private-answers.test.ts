import { expect, it } from 'vitest';
import { InMemoryRoomRepository } from '@deal-table/adapters';
import { KnownEnough as KE, compileChoicePlan } from '@deal-table/contracts';
import { KnownEnoughApplication } from './known-enough.ts';

const participant = (subject: string) => ({ kind: 'participant' as const, subject });
const service = { kind: 'service' as const, subject: 'synthetic-worker', roomIds: ['direct-decision'] };
const now = '2026-10-17T00:00:00.000Z';
async function fixture() {
  let sequence = 0;
  const repository = new InMemoryRoomRepository();
  const app = new KnownEnoughApplication({ repository, clock: { now: () => now }, ids: { next: () => `direct-${++sequence}` } });
  const compiled = compileChoicePlan({ title: 'Garden work', description: '', topics: [{ label: 'Task', kind: 'CHOICE', options: ['Planting', 'Watering'] }] });
  await app.createDecision({ creatorSubject: 'iris', memberships: ['iris','omar'].map(subject => ({ subject, participantId: subject, active: true })),
    definition: { schemaVersion: KE.KE_SCHEMA_VERSION, decisionId: 'direct-decision', frameVersion: 1, semanticVersion: 1,
      contextToken: 'c'.repeat(64), title: 'Garden work', objective: 'Choose a task', description: '',
      participants: ['iris','omar'].map(id => ({ id, displayName: id, requiredForApproval: true })), requiredParticipantIds: ['iris','omar'],
      variables: compiled.variables.map(variable => ({ ...variable, ownerParticipantId: null })), rules: compiled.rules } });
  const owner = (subject: string) => app.getOwnerSnapshot(participant(subject), 'direct-decision');
  async function command(subject: string, type: KE.DecisionCommand['type'], payload: unknown) {
    const state = await owner(subject), id = `command-${++sequence}`;
    return KE.DecisionCommand.parse({ schemaVersion: KE.KE_SCHEMA_VERSION, requestId: id, idempotencyKey: id, decisionId: 'direct-decision', type,
      expected: { contextToken: state.publicSnapshot.contextToken, semanticVersion: state.publicSnapshot.semanticVersion,
        ownerVersion: state.ownerVersion, controlVersion: state.controlVersion }, payload });
  }
  async function save(subject: string, mode: KE.PrivateChoiceAnswer['mode'] = 'ANY') {
    const state = await owner(subject);
    const value = await command(subject, 'CONFIRM_PRIVATE_ANSWERS', { processingConsent: 'SYNTHETIC_TEST',
      answers: [{ variableId: 'choice-1', mode, acceptableIndices: mode === 'SELECTED' ? [0] : [] }], retainedConstraintIds: [],
      ...(state.draft ? { draft: { draftId: state.draft.draftId, draftVersion: state.draft.draftVersion, constraintIds: [], replace: true } } : {}) });
    expect(await app.execute(participant(subject), value)).toMatchObject({ ok: true });
    return value;
  }
  async function propose() {
    const job = await app.startReasoning(service, 'direct-decision');
    const state = await repository.transactionDecision('direct-decision', value => structuredClone(value!));
    const candidate = { schemaVersion: KE.KE_SCHEMA_VERSION, decisionId: state.decisionId, proposalId: `proposal-${++sequence}`,
      proposalVersion: state.proposalVersion + 1, semanticVersion: state.definition.semanticVersion, contextToken: state.definition.contextToken,
      values: [{ variableId: 'choice-1', value: { type: 'ENUM', optionId: 'option-1-1' } }],
      validation: { status: 'VALID', checkedRuleIds: [], failedRuleIds: [], unknownRuleIds: [], unsupportedConditionIds: [] },
      permissionDependencies: [], createdAt: now };
    expect(await app.completeReasoning(service, 'direct-decision', job.id, candidate)).toBe('APPLIED');
    return (await owner('iris')).publicSnapshot.currentProposal!;
  }
  const approve = (subject: string, proposal: KE.PublicCandidateProposal) => command(subject, 'APPROVE_PROPOSAL', {
    proposalId: proposal.proposalId, proposalVersion: proposal.facts.proposalVersion, publicHash: proposal.publicHash });
  async function addMember() {
    const state = await repository.transactionDecision('direct-decision', value => structuredClone(value!));
    await app.reviseDecision(participant('iris'), { decisionId: state.decisionId, expectedControlVersion: state.controlVersion,
      definition: { ...state.definition, frameVersion: state.definition.frameVersion + 1, semanticVersion: state.definition.semanticVersion + 1,
        participants: [...state.definition.participants, { id: 'luca', displayName: 'luca', requiredForApproval: true }],
        requiredParticipantIds: [...state.definition.requiredParticipantIds, 'luca'] },
      memberships: [...state.memberships, { subject: 'luca', participantId: 'luca', active: true }] });
  }
  return { app, repository, owner, save, propose, approve, addMember };
}

it('finds a shared outcome after independent direct saves and requires both exact approvals', async () => {
  const h = await fixture(); await h.save('iris', 'SELECTED');
  expect((await h.owner('iris')).publicSnapshot.frameConfirmations.map(value => value.participantId)).toEqual(['iris']);
  await h.save('omar'); const proposal = await h.propose();
  expect((await h.owner('iris')).publicSnapshot.status).toBe('PROPOSED');
  expect(await h.app.execute(participant('iris'), await h.approve('iris', proposal))).toMatchObject({ ok: true });
  expect((await h.owner('iris')).publicSnapshot.status).toBe('APPROVING');
  expect(await h.app.execute(participant('omar'), await h.approve('omar', proposal))).toMatchObject({ ok: true });
  expect((await h.owner('iris')).publicSnapshot.status).toBe('AGREED');
});

it('changing direct answers preserves the other owner and invalidates the prior proposal and stale approval', async () => {
  const h = await fixture(); await h.save('iris', 'SELECTED'); await h.save('omar'); const proposal = await h.propose();
  expect(await h.app.execute(participant('iris'), await h.approve('iris', proposal))).toMatchObject({ ok: true });
  const stale = await h.approve('omar', proposal);
  const before = await h.owner('omar');
  await h.save('iris');
  const after = await h.owner('omar');
  expect(after.confirmedConstraints).toEqual(before.confirmedConstraints);
  expect(after.ownerVersion).toBe(before.ownerVersion);
  expect(after.publicSnapshot.currentProposal).toBeNull(); expect(after.publicSnapshot.approvedParticipantIds).toEqual([]);
  expect(await h.app.execute(participant('omar'), stale)).toMatchObject({ ok: false, error: { code: 'STALE_CONTEXT' } });
  const next = await h.propose(); expect(next.proposalId).not.toBe(proposal.proposalId);
  for (const subject of ['iris','omar']) expect(await h.app.execute(participant(subject), await h.approve(subject, next))).toMatchObject({ ok: true });
  expect((await h.owner('omar')).publicSnapshot.status).toBe('AGREED');
});

it('none of the listed options stays unresolved until the owner explicitly changes that answer', async () => {
  const h = await fixture(); await h.save('iris','NONE'); await h.save('omar');
  expect((await h.owner('iris')).draft?.unsupportedConditions).toHaveLength(1);
  await expect(h.app.startReasoning(service, 'direct-decision')).rejects.toMatchObject({ code: 'NEEDS_CLARIFICATION' });
  await h.save('iris', 'SELECTED'); await h.propose();
});

it('membership additions retain saved answers and confirmations while retiring unfinished proposal approval', async () => {
  const h = await fixture(); await h.save('iris','SELECTED'); await h.save('omar'); const proposal = await h.propose();
  expect(await h.app.execute(participant('iris'), await h.approve('iris', proposal))).toMatchObject({ ok: true });
  const before = await h.owner('iris'); await h.addMember(); const after = await h.owner('iris');
  expect(after.confirmedConstraints).toEqual(before.confirmedConstraints); expect(after.ownerVersion).toBe(before.ownerVersion);
  expect(after.publicSnapshot.frameConfirmations).toEqual(before.publicSnapshot.frameConfirmations);
  expect(after.publicSnapshot.currentProposal).toBeNull(); expect(after.publicSnapshot.approvedParticipantIds).toEqual([]);
  await h.save('luca'); await h.propose();
});

it('adding a group member leaves a finished decision and its recorded approvals untouched', async () => {
  const h = await fixture(); await h.save('iris'); await h.save('omar'); const proposal = await h.propose();
  for (const subject of ['iris','omar']) expect(await h.app.execute(participant(subject), await h.approve(subject, proposal))).toMatchObject({ ok: true });
  const before = await h.owner('iris'); await h.addMember();
  expect(await h.owner('iris')).toEqual(before);
  await expect(h.owner('luca')).rejects.toMatchObject({ code: 'NOT_FOUND' });
});
