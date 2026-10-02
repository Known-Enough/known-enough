import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { Groups } from '@deal-table/contracts';
import { npApi } from '../evaluations/np-api.ts';
import { checked } from '../evaluations/np-lifecycle.ts';
import { clarificationTransport } from '../evaluations/assessment-model.ts';
test('unchanged/title-only saves preserve unresolved questions; explicit answer redraft is reviewed independently', async () => {
  const api = await npApi(clarificationTransport());
  try {
    await checked(await api.call('iris', '/account/register', { displayName: 'Iris' })); await api.approve('iris');
    const { group } = await checked(await api.call('iris', '/groups', { name: 'Public scope', idempotencyKey: randomUUID() })); const groupId = (group as { id: string }).id;
    const response = await checked(await api.call('iris', `/groups/${groupId}/drafts`, { objective: 'Choose a gallery meetup.', idempotencyKey: randomUUID() }));
    let draft = Groups.GroupDraft.parse(response.draft); const originalId = draft.id; const questions = [...draft.clarificationQuestions]; expect(questions).toHaveLength(1);
    for (const title of [draft.frame.title, 'New public title']) {
      const saved = await checked(await api.call('iris', `/groups/${groupId}/drafts/${draft.id}`, { revision: draft.revision, title, objective: draft.frame.objective, variables: draft.frame.variables, rules: draft.frame.rules }));
      draft = Groups.GroupDraft.parse(saved.draft); expect(draft.clarificationQuestions).toEqual(questions);
      expect((await api.call('iris', `/groups/${groupId}/drafts/${draft.id}/create`, { revision: draft.revision })).status).toBe(422);
    }
    const clarified = await checked(await api.call('iris', `/groups/${groupId}/drafts`, { objective: draft.frame.objective + '\nPublic clarification answers:\n' + questions[0] + ' Answer: Indoors only.', idempotencyKey: randomUUID() }));
    const next = Groups.GroupDraft.parse(clarified.draft); expect(next.id).not.toBe(originalId); expect(next.clarificationQuestions).toHaveLength(0);
    const original = await checked(await api.call('iris', `/groups/${groupId}/drafts/${originalId}`)); expect(Groups.GroupDraft.parse(original.draft).clarificationQuestions).toEqual(questions);
    expect((await api.call('iris', `/groups/${groupId}/drafts/${next.id}/create`, { revision: next.revision })).ok).toBe(true);
  } finally { await api.close(); }
});
