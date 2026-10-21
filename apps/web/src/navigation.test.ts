import { expect, it } from 'vitest';
import { appViewSearch, readAppView, sameAppWorkspace, saveIntendedView, takeIntendedView, type AppView } from './navigation';
it('round trips opaque parent and decision references, rejecting duplicate/traversal/invite-bearing ids', () => {
  const view = { kind: 'decision' as const, decisionId: 'groupdecision-safe', groupId: 'group-safe' };
  expect(readAppView(appViewSearch(view))).toEqual(view);
  for (const search of ['?decision=../private', '?group=a&group=b', '?decision=a&decision=b', '?group=', '?decision=x%2Fsecret']) expect(readAppView(search)).toEqual({ kind: 'invalid' });
  expect(readAppView('?code=callback&state=nonce')).toEqual({ kind: 'groups' });
});
it('restores creation steps and decision subpages from direct URLs while preserving old decision links', () => {
  const pages: AppView[] = [
    { kind: 'creation', groupId: 'group-safe', step: 'describe' },
    { kind: 'creation', groupId: 'group-safe', step: 'options' },
    { kind: 'decision', decisionId: 'decision-safe', groupId: 'group-safe', section: 'details' },
    { kind: 'decision', decisionId: 'decision-safe', section: 'outcome' },
  ];
  for (const page of pages) expect(readAppView(appViewSearch(page))).toEqual(page);
  expect(readAppView('?group=group-safe&create=decision')).toEqual(pages[0]);
  expect(readAppView('?decision=old&view=overview')).toEqual({ kind: 'decision', decisionId: 'old' });
});
it('rejects ambiguous workflow URLs instead of navigating to an unrelated editor or decision', () => {
  for (const query of ['?create=decision', '?group=a&create=other', '?group=a&create=decision&decision=b',
    '?group=a&create=decision&step=unknown', '?group=a&create=decision&view=details', '?group=a&step=options',
    '?view=outcome', '?decision=a&view=unknown', '?decision=a&view=details&view=outcome',
    '?group=a&create=decision&create=decision', '?group=a&create=decision&step=options&step=describe']) {
    expect(readAppView(query)).toEqual({ kind: 'invalid' });
  }
});
it('retains edits only inside the same group workspace or exact decision, including its parent', () => {
  const creation: AppView = { kind: 'creation', groupId: 'a', step: 'describe' };
  const decision: AppView = { kind: 'decision', decisionId: 'd', groupId: 'a' };
  expect(sameAppWorkspace(creation, { kind: 'group', groupId: 'a' })).toBe(true);
  expect(sameAppWorkspace(creation, { ...creation, step: 'options' })).toBe(true);
  expect(sameAppWorkspace(decision, { ...decision, section: 'outcome' })).toBe(true);
  expect(sameAppWorkspace(creation, { kind: 'group', groupId: 'b' })).toBe(false);
  expect(sameAppWorkspace(decision, { ...decision, decisionId: 'other' })).toBe(false);
  expect(sameAppWorkspace(decision, { ...decision, groupId: 'other' })).toBe(false);
  expect(sameAppWorkspace(decision, creation)).toBe(false);
});
it('restores only bounded transient intended navigation, once, without private input or authentication data', () => {
  const map = new Map<string, string>(); const storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => map.set(key, value), removeItem: (key: string) => map.delete(key) } as unknown as Storage;
  saveIntendedView({ kind: 'group', groupId: 'group-safe' }, storage);
  expect(takeIntendedView(storage)).toEqual({ kind: 'group', groupId: 'group-safe' }); expect(takeIntendedView(storage)).toBeNull();
  storage.setItem('ke-intended-view', JSON.stringify({ search: '?decision=old', at: Date.now() - 3600001 })); expect(takeIntendedView(storage)).toBeNull();
});
