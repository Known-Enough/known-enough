import { expect, it } from 'vitest';
import { appViewSearch, readAppView, saveIntendedView, takeIntendedView } from './navigation';
it('round trips opaque parent and decision references, rejecting duplicate/traversal/invite-bearing ids', () => {
  const view = { kind: 'decision' as const, decisionId: 'groupdecision-safe', groupId: 'group-safe' };
  expect(readAppView(appViewSearch(view))).toEqual(view);
  for (const search of ['?decision=../private', '?group=a&group=b', '?decision=a&decision=b', '?group=', '?decision=x%2Fsecret']) expect(readAppView(search)).toEqual({ kind: 'invalid' });
  expect(readAppView('?code=callback&state=nonce')).toEqual({ kind: 'groups' });
});
it('restores only bounded transient intended navigation, once, without private input or authentication data', () => {
  const map = new Map<string, string>(); const storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => map.set(key, value), removeItem: (key: string) => map.delete(key) } as unknown as Storage;
  saveIntendedView({ kind: 'group', groupId: 'group-safe' }, storage);
  expect(takeIntendedView(storage)).toEqual({ kind: 'group', groupId: 'group-safe' }); expect(takeIntendedView(storage)).toBeNull();
  storage.setItem('ke-intended-view', JSON.stringify({ search: '?decision=old', at: Date.now() - 3600001 })); expect(takeIntendedView(storage)).toBeNull();
});
