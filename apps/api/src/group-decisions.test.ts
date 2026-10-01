import { describe, expect, it, vi } from 'vitest';
import { Groups } from '@deal-table/contracts';
import { npApi } from '../../../tests/evaluations/np-api.ts';
const principal = (subject: string) => ({ kind: 'participant' as const, subject });
async function admitted(api: Awaited<ReturnType<typeof npApi>>, who: string) {
  await api.call(who, '/account/register', { displayName: who }); await api.approve(who);
}
describe('NP02 group-owned generic decisions', () => {
  it('drafts a new objective and arbitrary roster, persists/edits/replays before create, rejects private and forged fields', async () => {
    const api = await npApi();
    try {
      for (const who of ['iris', 'omar', 'tess', 'vin']) await admitted(api, who);
      const { group } = await (await api.call('iris', '/groups', { name: 'Art club', idempotencyKey: 'art' })).json();
      for (const who of ['omar', 'tess', 'vin']) {
        const invite = await (await api.call('iris', `/groups/${group.id}/invitations`, { email: `${who}@example.invalid`, replace: false })).json();
        await api.call(who, '/groups/accept', { token: invite.token });
      }
      const body = { objective: 'Choose a gallery meetup venue and time.', idempotencyKey: 'gallery' };
      const response = await api.call('iris', `/groups/${group.id}/drafts`, body); expect(response.status).toBe(200);
      const { draft } = await response.json(); expect(draft.frame.participants).toHaveLength(4);
      expect(draft.frame.variables.map((item: { id: string }) => item.id)).toEqual(['venue', 'slot']);
      expect((await (await api.call('iris', `/groups/${group.id}/drafts`, body)).json()).draft).toEqual(draft);
      expect((await api.call('iris', `/groups/${group.id}/drafts`, { ...body, subject: 'other' })).status).toBe(422);
      expect((await api.call('omar', `/groups/${group.id}/drafts`, body)).status).toBe(403);
      expect((await api.call('iris', `/groups/${group.id}/drafts/${draft.id}`, { revision: draft.revision, title: 'Private hijack', objective: body.objective,
        variables: [{ ...draft.frame.variables[0], visibility: 'OWNER_PRIVATE', ownerParticipantId: draft.frame.participants[0].id }], rules: [] })).status).toBe(422);
      const changed = { revision: draft.revision, title: 'Our gallery afternoon', objective: body.objective, variables: draft.frame.variables, rules: [] };
      const edited = await (await api.call('iris', `/groups/${group.id}/drafts/${draft.id}`, changed)).json(); expect(edited.draft.revision).toBe(2);
      expect((await api.call('iris', `/groups/${group.id}/drafts/${draft.id}/create`, { revision: 1 })).status).toBe(409);
      const created = await (await api.call('iris', `/groups/${group.id}/drafts/${draft.id}/create`, { revision: 2 })).json();
      expect(created.snapshot.frame.title).toBe(changed.title); expect(created.snapshot.frameConfirmations).toEqual([]); expect(created.snapshot.approvedParticipantIds).toEqual([]);
      const again = await (await api.call('iris', `/groups/${group.id}/drafts/${draft.id}/create`, { revision: 2 })).json(); expect(again.snapshot).toEqual(created.snapshot);
      expect((await api.call('omar', `/decisions/${created.snapshot.frame.decisionId}/me`)).status).toBe(200);
      expect(Groups.GroupDraft.parse((await (await api.call('iris', `/groups/${group.id}/drafts/${draft.id}`)).json()).draft).createdDecisionId).toBe(created.snapshot.frame.decisionId);
    } finally { await api.close(); }
  });
  it('group removal denies old access; explicit roster revision resets authority and new drafts differ from gallery', async () => {
    const api = await npApi();
    try {
      for (const who of ['iris', 'omar']) await admitted(api, who);
      const group = await api.groups.create(principal('iris'), { name: 'Garden', idempotencyKey: 'garden' });
      const link = await api.groups.invite(principal('iris'), group.id, { email: 'omar@example.invalid', replace: false }); await api.groups.accept(principal('omar'), { token: link.token });
      const draft = await api.groupDecisions.draft(principal('iris'), group.id, { objective: 'Choose our garden workday activity.', idempotencyKey: 'garden' });
      expect(draft.frame.variables[0]!.id).toBe('activity');
      const snapshot = await api.groupDecisions.create(principal('iris'), group.id, draft.id, { revision: 1 });
      const current = (await api.groups.list(principal('iris')))[0]!;
      await api.groups.remove(principal('iris'), group.id, { memberId: current.members.find(member => member.displayName === 'omar')!.id, version: current.version });
      expect((await api.call('omar', `/decisions/${snapshot.frame.decisionId}/public`)).status).toBe(404);
      expect((await api.call('iris', `/decisions/${snapshot.frame.decisionId}/public`)).status).toBe(409);
      const preview = await api.groupDecisions.reviewRoster(principal('iris'), group.id, snapshot.frame.decisionId);
      const revised = await api.groupDecisions.reviseRoster(principal('iris'), group.id, snapshot.frame.decisionId, { controlVersion: preview.controlVersion, groupVersion: preview.groupVersion });
      expect(revised.frame.participants).toHaveLength(1); expect(revised.frameConfirmations).toEqual([]); expect(revised.currentProposal).toBeNull();
      expect(revised.contextToken).not.toBe(snapshot.contextToken);
      expect((await api.call('iris', `/decisions/${snapshot.frame.decisionId}/public`)).status).toBe(200);
    } finally { await api.close(); }
  });
});

it('connects four new users to private conditions, explicit negotiation and exact unanimous approval on a generated frame', async () => {
  const api = await npApi();
  try {
    const { freshGroup } = await import('../../../tests/evaluations/np-lifecycle.ts');
    const h = await freshGroup(api); await h.ready();
    expect((await h.publicView()).frame.variables.map(item => item.id)).toEqual(['venue', 'slot']);
    expect((await h.generate()).outcome).toBe('NEEDS_PERMISSION');
    const question = (await h.owner('iris')).pendingQuestions[0]!;
    expect((await h.owner('omar')).pendingQuestions).toEqual([]);
    await h.command('iris', 'ANSWER_NEGOTIATION', { questionId: question.questionId, constraintVersion: question.constraintVersion, requestIdentity: question.requestIdentity, answer: 'ALLOW' });
    expect((await h.generate()).outcome).toBe('APPLIED');
    const proposal = (await h.publicView()).currentProposal!;
    for (const who of h.people.slice(0, -1)) await h.command(who, 'APPROVE_PROPOSAL', { proposalId: proposal.proposalId, proposalVersion: proposal.facts.proposalVersion, publicHash: proposal.publicHash });
    expect((await h.publicView()).status).toBe('APPROVING');
    await h.command('vin', 'APPROVE_PROPOSAL', { proposalId: proposal.proposalId, proposalVersion: proposal.facts.proposalVersion, publicHash: proposal.publicHash });
    expect((await h.publicView()).status).toBe('AGREED');
    expect(JSON.stringify(await h.publicView())).not.toMatch(/NP_PRIVATE_RAW_CANARY|permissionId|constraintId|requestIdentity|refusedRequests/);
  } finally { await api.close(); }
});

it('retains a reserved draft after failed persistence so reconstruction can retry the identical creation', async () => {
  const api = await npApi();
  try {
    await admitted(api, 'iris'); const group = await api.groups.create(principal('iris'), { name: 'New club', idempotencyKey: 'club' });
    const draft = await api.groupDecisions.draft(principal('iris'), group.id, { objective: 'Choose a gallery meetup.', idempotencyKey: 'retry' });
    vi.spyOn(api.application, 'createDecision').mockRejectedValueOnce(new Error('Synthetic storage failure'));
    await expect(api.groupDecisions.create(principal('iris'), group.id, draft.id, { revision: 1 })).rejects.toThrow('storage failure');
    expect((await api.groups.list(principal('iris')))[0]!.drafts).toContainEqual(expect.objectContaining({ id: draft.id, created: true }));
    const { GroupDecisionService } = await import('./group-decisions.ts');
    const reconstructed = new GroupDecisionService({ groups: api.groups, application: api.runtime.application, architect: api.runtime.architect,
      now: () => Date.now(), isEnabled: api.runtime.isEnabled });
    const recovered = await reconstructed.read(principal('iris'), group.id, draft.id);
    expect(recovered.createdDecisionId).toMatch(/^groupdecision-/);
    const snapshot = await reconstructed.create(principal('iris'), group.id, draft.id, { revision: 1 });
    expect(snapshot.frameConfirmations).toEqual([]);
    expect(snapshot.frame.decisionId).toBe(recovered.createdDecisionId);
  } finally { await api.close(); }
});
