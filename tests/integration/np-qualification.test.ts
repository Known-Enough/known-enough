import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { KnownEnoughApplication } from '@deal-table/application';
import { InMemoryRoomRepository } from '@deal-table/adapters';
import { encodeDecisionStateItem, decodeDecisionStateItem, encodeDecisionReplayItem, decodeDecisionReplayItem } from '../../packages/adapters/src/dynamodb-codec.ts';
import { npApi } from '../evaluations/np-api.ts';
import { npTransport } from '../evaluations/np-model.ts';
import { checked, freshGroup } from '../evaluations/np-lifecycle.ts';
const person = (subject: string) => ({ kind: 'participant' as const, subject });
async function proposal(api: Awaited<ReturnType<typeof npApi>>) {
  const h = await freshGroup(api); await h.ready(); await h.generate();
  const question = (await h.owner('iris')).pendingQuestions[0]!;
  await h.command('iris', 'ANSWER_NEGOTIATION', { questionId: question.questionId, constraintVersion: question.constraintVersion, requestIdentity: question.requestIdentity, answer: 'ALLOW' });
  await h.generate(); return h;
}
describe('NP04 offline fresh-group qualification; no cloud or paid model calls', () => {
  it('honors refusal without repeat pressure and blocks unsupported owner needs', async () => {
    const api = await npApi();
    try {
      const h = await freshGroup(api); await h.ready(); await h.generate(); const question = (await h.owner('iris')).pendingQuestions[0]!;
      await h.command('iris', 'ANSWER_NEGOTIATION', { questionId: question.questionId, constraintVersion: question.constraintVersion, requestIdentity: question.requestIdentity, answer: 'DECLINE' });
      for (let i = 0; i < 2; i++) expect([200, 422]).toContain((await api.call('iris', `/decisions/${h.decisionId}/reasoning`, { requestId: randomUUID() })).status);
      const refused = await h.owner('iris'); expect(refused.pendingQuestions.filter(item => item.status === 'PENDING')).toEqual([]);
      expect(refused.refusedRequests).toHaveLength(1); expect((await h.publicView()).currentProposal).toBeNull();
      const uncertain = await freshGroup(api); await uncertain.confirmFrames();
      for (const who of uncertain.people) { const draft = await uncertain.interpret(who, who === 'iris' ? 'unsupported private need' : 'second required'); await uncertain.command(who, 'CONFIRM_CONSTRAINTS', { draftId: draft.draftId, draftVersion: draft.draftVersion, constraintIds: draft.proposedConstraints.map(item => item.constraintId) }); }
      expect((await uncertain.owner('iris')).ownInputReadiness).toBe('NEEDS_CLARIFICATION');
      expect((await api.call('iris', `/decisions/${uncertain.decisionId}/reasoning`, { requestId: randomUUID() })).ok).toBe(false);
      expect((await uncertain.publicView()).currentProposal).toBeNull();
    } finally { await api.close(); }
  });
  it('revoking an allowed adjustment clears the proposal and rejects its previously prepared exact approval', async () => {
    const api = await npApi();
    try {
      const h = await proposal(api); const p = (await h.publicView()).currentProposal!;
      const stale = await h.envelope('omar', 'APPROVE_PROPOSAL', { proposalId: p.proposalId, proposalVersion: p.facts.proposalVersion, publicHash: p.publicHash });
      await h.command('vin', 'APPROVE_PROPOSAL', { proposalId: p.proposalId, proposalVersion: p.facts.proposalVersion, publicHash: p.publicHash });
      const permission = (await h.owner('iris')).negotiationPermissions.find(item => item.status === 'ACTIVE')!;
      await h.command('iris', 'REVOKE_NEGOTIATION', { permissionId: permission.permissionId, permissionVersion: permission.permissionVersion });
      expect((await api.call('omar', `/decisions/${h.decisionId}/commands`, stale)).status).toBe(409);
      const view = await h.publicView(); expect(view.status).toBe('SUPERSEDED'); expect(view.currentProposal).toBeNull(); expect(view.approvedParticipantIds).toEqual([]);
    } finally { await api.close(); }
  });
  it('membership revision rejects old approvals and resets all participant authority', async () => {
    const api = await npApi();
    try {
      const h = await proposal(api); const p = (await h.publicView()).currentProposal!;
      const stale = await h.envelope('omar', 'APPROVE_PROPOSAL', { proposalId: p.proposalId, proposalVersion: p.facts.proposalVersion, publicHash: p.publicHash });
      const group = (await api.groups.list(person('iris')))[0]!;
      await api.groups.remove(person('iris'), h.groupId, { memberId: group.members.find(member => member.displayName === 'vin')!.id, version: group.version });
      expect((await api.call('vin', `/decisions/${h.decisionId}/me`)).status).toBe(404);
      const preview = await api.groupDecisions.reviewRoster(person('iris'), h.groupId, h.decisionId);
      const revised = await api.groupDecisions.reviseRoster(person('iris'), h.groupId, h.decisionId, { controlVersion: preview.controlVersion, groupVersion: preview.groupVersion });
      expect(revised.frame.participants).toHaveLength(3); expect(revised.frameConfirmations).toEqual([]); expect(revised.approvedParticipantIds).toEqual([]); expect(revised.currentProposal).toBeNull();
      expect((await api.call('omar', `/decisions/${h.decisionId}/commands`, stale)).status).toBe(409);
      const own = await h.owner('iris'); expect(own.negotiationPermissions.filter(item => item.status === 'ACTIVE')).toEqual([]); expect(own.ownInputReadiness).toBe('NOT_STARTED');
    } finally { await api.close(); }
  });
  it('disclosure permission, publication and revocation remain independent from exact approvals and audience isolation', async () => {
    const api = await npApi();
    try {
      const h = await proposal(api); const view = await h.publicView(); const p = view.currentProposal!;
      const owner = await h.owner('iris'); const audience = (await h.owner('omar')).ownerParticipantId;
      const service = { kind: 'service' as const, subject: 'synthetic-disclosure', roomIds: [h.decisionId] };
      const text = 'Fictional note for Omar only.';
      const requestDisclosure = (permissionId: string) => api.application.requestDisclosure(service, { kind: 'EXACT_TEXT', permissionId, permissionVersion: 1, decisionId: h.decisionId,
        contextToken: view.contextToken, semanticVersion: view.semanticVersion, ownerParticipantId: owner.ownerParticipantId, proposalId: p.proposalId, proposalVersion: p.facts.proposalVersion,
        audienceParticipantIds: [audience], status: 'PENDING', expiresAt: new Date(Date.now() + 600000).toISOString(), text, textHash: createHash('sha256').update(text).digest('hex') });
      await requestDisclosure('np-note');
      await expect(api.application.publishDisclosure(service, h.decisionId, owner.ownerParticipantId, 'np-note', 1)).rejects.toThrow();
      await h.command('iris', 'DECIDE_DISCLOSURE', { permissionId: 'np-note', permissionVersion: 1, decision: 'ALLOW' });
      expect((await h.owner('iris')).ownApproval).toBeNull(); expect((await h.owner('omar')).publicSnapshot.publishedDisclosures).toEqual([]);
      await h.command('iris', 'REVOKE_DISCLOSURE', { permissionId: 'np-note', permissionVersion: 1 });
      await expect(api.application.publishDisclosure(service, h.decisionId, owner.ownerParticipantId, 'np-note', 1)).rejects.toThrow();
      await requestDisclosure('np-published');
      await h.command('iris', 'DECIDE_DISCLOSURE', { permissionId: 'np-published', permissionVersion: 1, decision: 'ALLOW' });
      await api.application.publishDisclosure(service, h.decisionId, owner.ownerParticipantId, 'np-published', 1);
      expect(JSON.stringify((await h.owner('omar')).publicSnapshot)).toContain(text);
      expect(JSON.stringify((await h.owner('tess')).publicSnapshot)).not.toContain(text);
      expect((await h.owner('iris')).disclosurePermissions.find(item => item.permissionId === 'np-published')!.status).toBe('PUBLISHED');
      for (const who of h.people) await h.command(who, 'APPROVE_PROPOSAL', { proposalId: p.proposalId, proposalVersion: p.facts.proposalVersion, publicHash: p.publicHash });
      expect((await h.publicView()).status).toBe('AGREED');
    } finally { await api.close(); }
  });
  it('rejects unverified/unapproved/disabled/expired/display and foreign-group authority without leaking private state', async () => {
    const logs: string[] = []; const logger = vi.spyOn(console, 'log').mockImplementation((...values) => { logs.push(values.map(String).join(' ')); });
    const api = await npApi();
    try {
      const h = await proposal(api);
      expect((await api.call('unverified', '/account/register', { displayName: 'Unverified' })).ok).toBe(false);
      await checked(await api.call('outsider', '/account/register', { displayName: 'Outsider' }));
      expect((await api.call('outsider', '/groups', { name: 'Bad', idempotencyKey: 'bad' })).status).toBe(403);
      await api.approve('outsider'); const foreign = await api.groups.create(person('outsider'), { name: 'Other club', idempotencyKey: 'other' });
      expect((await api.call('outsider', `/decisions/${h.decisionId}/me`)).status).toBe(404);
      expect((await api.call('outsider', `/groups/${h.groupId}/drafts`, { objective: 'Hijack', idempotencyKey: 'bad' })).status).toBe(404);
      const invite = await api.groups.invite(person('outsider'), foreign.id, { email: 'tess@example.invalid', replace: false });
      expect((await api.call('iris', '/groups/accept', { token: invite.token })).status).toBe(404);
      const getWith = (token: string) => fetch(`${api.base}/decisions/${h.decisionId}/me`, { headers: { authorization: `Bearer ${token}` } });
      expect((await getWith(api.bearer('iris', { expired: true }))).status).toBe(401);
      expect((await getWith(api.bearer('display', { display: true, decisionId: h.decisionId }))).ok).toBe(false);
      const oldBearer = api.bearer('iris'); await api.disable('iris'); expect((await getWith(oldBearer)).status).toBe(403);
      for (const who of ['omar', 'tess', 'vin']) {
        const text = await (await api.call(who, `/decisions/${h.decisionId}/public`)).text();
        expect(text).not.toMatch(/NP_PRIVATE_RAW_CANARY|permissionId|constraintId|requestIdentity|refusedRequests|emailHash|accessToken/);
      }
      expect(logs.join('\n')).not.toMatch(/NP_PRIVATE_RAW_CANARY|permissionId|constraintId|requestIdentity|refusedRequests|emailHash|accessToken|example\.invalid/);
    } finally { logger.mockRestore(); await api.close(); }
  });
  it('rejects injected architect output that attempts to smuggle owner-private fields into a public draft', async () => {
    const delegate = npTransport(); const api = await npApi({ send: async (command, options) => {
      const result = await delegate.send(command, options);
      if (command.input.toolConfig!.tools![0]!.toolSpec!.name === 'ke_architect_output') {
        const output = result.output!.message!.content![0]!.toolUse!;
        output.input = { ...(output.input as Record<string, unknown>), ownerPrivateConditions: 'NP_PRIVATE_RAW_CANARY' } as never;
      }
      return result;
    } });
    try {
      await checked(await api.call('iris', '/account/register', { displayName: 'Iris' })); await api.approve('iris');
      const group = await api.groups.create(person('iris'), { name: 'Injected club', idempotencyKey: 'inject' });
      const response = await api.call('iris', `/groups/${group.id}/drafts`, { objective: 'Choose a gallery meetup.', idempotencyKey: 'inject' });
      expect(response.ok).toBe(false); expect(await response.text()).not.toContain('NP_PRIVATE_RAW_CANARY');
      expect((await api.groups.list(person('iris')))[0]!.drafts).toEqual([]);
    } finally { await api.close(); }
  });
  it('reconstructs exact persisted authority in a fresh application and replays a committed command once', async () => {
    const api = await npApi();
    try {
      const h = await proposal(api); const p = (await h.publicView()).currentProposal!;
      const command = await h.envelope('iris', 'APPROVE_PROPOSAL', { proposalId: p.proposalId, proposalVersion: p.facts.proposalVersion, publicHash: p.publicHash });
      const first = await checked(await api.call('iris', `/decisions/${h.decisionId}/commands`, command));
      expect(await checked(await api.call('iris', `/decisions/${h.decisionId}/commands`, command))).toEqual(first);
      const stored = await api.decisionRepository.transactionDecision(h.decisionId, record => record!);
      const coldRepository = new InMemoryRoomRepository(); await coldRepository.createDecision({ ...decodeDecisionStateItem(encodeDecisionStateItem(stored), h.decisionId), replays: stored.replays.map(replay => decodeDecisionReplayItem(encodeDecisionReplayItem(h.decisionId, 'np-restart-guard', replay), h.decisionId, replay.keyHash, 'np-restart-guard')) });
      const cold = new KnownEnoughApplication({ repository: coldRepository, clock: { now: () => new Date().toISOString() }, ids: { next: randomUUID } });
      expect(await cold.getOwnerSnapshot(person('iris'), h.decisionId)).toEqual(await h.owner('iris'));
      expect(await cold.execute(person('iris'), command)).toEqual(first);
      expect((await cold.getPublicSnapshot(person('omar'), h.decisionId)).approvedParticipantIds).toHaveLength(1);
    } finally { await api.close(); }
  });
});
