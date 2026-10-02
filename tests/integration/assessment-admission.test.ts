import { randomUUID } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import { npApi } from '../evaluations/np-api.ts';
import { npTransport } from '../evaluations/np-model.ts';
import { freshGroup, checked } from '../evaluations/np-lifecycle.ts';
import { memberId } from '../../apps/api/src/group-service.ts';
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0)) await close(); });
function gate() { let release!: () => void; let entered!: () => void; return { wait: new Promise<void>(resolve => { release = resolve; }), entered: new Promise<void>(resolve => { entered = resolve; }), release: () => release(), signal: () => entered() }; }
test('a private read delayed after initial admission rejects an intervening account disable', async () => {
  const api = await npApi(); cleanup.push(api.close); const h = await freshGroup(api); const pause = gate();
  const original = api.groups.authorizeDecision.bind(api.groups);
  vi.spyOn(api.groups, 'authorizeDecision').mockImplementationOnce(async (...args) => { await original(...args); pause.signal(); await pause.wait; });
  const request = api.call('iris', `/decisions/${h.decisionId}/me`);
  await pause.entered; await api.disable('iris'); pause.release();
  expect((await request).status).toBe(409); expect((await api.call('iris', `/decisions/${h.decisionId}/me`)).status).toBe(403);
});
test.each(['disable', 'remove'])('delayed valid owner model output cannot commit after %s', async change => {
  const pause = gate(); const provider = npTransport();
  const api = await npApi({ send: async (command, options) => {
    if (command.input.toolConfig?.tools?.[0]?.toolSpec?.name === 'ke_owner_output') { pause.signal(); await pause.wait; }
    return provider.send(command, options);
  } }); cleanup.push(api.close); const h = await freshGroup(api); await h.confirmFrames();
  const request = api.call('iris', `/decisions/${h.decisionId}/owner-conversation/draft`, { requestId: randomUUID(), messages: [{ role: 'owner', text: 'first option required' }] });
  await pause.entered;
  if (change === 'disable') await api.disable('iris');
  else { const roster = await api.groups.roster({ kind: 'participant', subject: 'iris' }, h.groupId); await api.groups.remove({ kind: 'participant', subject: 'iris' }, h.groupId, { memberId: memberId('omar'), version: roster.version }); }
  pause.release(); const response = await request; expect(response.ok).toBe(false);
  const record = await api.decisionRepository.transactionDecision(h.decisionId, value => value!);
  expect(record.owners.every(owner => owner.draft === null && owner.draftVersion === null)).toBe(true);
});
test('failure before roster commit preserves decision and binding; retry commits both and resets consent once', async () => {
  const api = await npApi(); cleanup.push(api.close); const h = await freshGroup(api); await h.confirmFrames();
  const draft = await h.interpret('iris', 'first option required');
  await h.command('iris', 'CONFIRM_CONSTRAINTS', { draftId: draft.draftId, draftVersion: draft.draftVersion, constraintIds: draft.proposedConstraints.map(item => item.constraintId) });
  const principal = { kind: 'participant' as const, subject: 'iris' }; const roster = await api.groups.roster(principal, h.groupId);
  await api.groups.remove(principal, h.groupId, { memberId: memberId('omar'), version: roster.version });
  const preview = await api.groupDecisions.reviewRoster(principal, h.groupId, h.decisionId);
  const before = await api.decisionRepository.transactionDecision(h.decisionId, value => value!);
  const original = api.application.reviseDecision.bind(api.application);
  vi.spyOn(api.application, 'reviseDecision').mockImplementationOnce(async () => { throw new Error('BEFORE_ATOMIC_COMMIT'); });
  const input = { controlVersion: preview.controlVersion, groupVersion: preview.groupVersion };
  await expect(api.groupDecisions.reviseRoster(principal, h.groupId, h.decisionId, input)).rejects.toThrow('BEFORE_ATOMIC_COMMIT');
  expect(await api.decisionRepository.transactionDecision(h.decisionId, value => value!)).toEqual(before);
  const binding = await api.repository.transaction(state => state.groups.find(group => group.id === h.groupId)!.decisions.find(decision => decision.id === h.decisionId)!);
  expect(binding.version).not.toBe(preview.groupVersion);
  vi.mocked(api.application.reviseDecision).mockImplementation(original);
  await api.groupDecisions.reviseRoster(principal, h.groupId, h.decisionId, input);
  const after = await api.decisionRepository.transactionDecision(h.decisionId, value => value!);
  expect(after.definition.semanticVersion).toBe(before.definition.semanticVersion + 1); expect(after.frameConfirmations).toHaveLength(0);
  expect(after.owners.every(owner => owner.confirmedConstraints.length === 0 && owner.approval === null)).toBe(true);
  await api.groups.authorizeDecision(principal, h.decisionId);
  expect((await api.repository.transaction(state => state.groups.find(group => group.id === h.groupId)!.decisions.find(decision => decision.id === h.decisionId)!)).version).toBe(preview.groupVersion);
});
test('account disabled during decision creation cannot leave a newly committed decision', async () => {
  const api = await npApi(); cleanup.push(api.close); await freshGroup(api);
  const group = (await checked(await api.call('iris', '/groups', { name: 'Second', idempotencyKey: randomUUID() }))).group as { id: string };
  const drafted = (await checked(await api.call('iris', `/groups/${group.id}/drafts`, { objective: 'Choose a gallery meetup venue and time.', idempotencyKey: randomUUID() }))).draft as { id: string; revision: number };
  const pause = gate(); const original = api.application.createDecision.bind(api.application);
  vi.spyOn(api.application, 'createDecision').mockImplementationOnce(async input => { pause.signal(); await pause.wait; return original(input); });
  const pending = api.call('iris', `/groups/${group.id}/drafts/${drafted.id}/create`, { revision: drafted.revision });
  await pause.entered; await api.disable('iris'); pause.release(); expect((await pending).ok).toBe(false);
  const id = await api.repository.transaction(state => state.groups.find(item => item.id === group.id)!.drafts.find(item => item.id === drafted.id)!.createdDecisionId!);
  expect(await api.decisionRepository.transactionDecision(id, value => value)).toBeNull();
});
