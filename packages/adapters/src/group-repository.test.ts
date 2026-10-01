import { expect, it } from 'vitest';
import { createGroupRepositoryTransport } from './group-repository.ts';
import type { Groups } from '@deal-table/contracts';
it('retries a real CAS collision using fresh persisted state; reconstructing the repository retains both writers', async () => {
  let stored: { version: number; state: Groups.GroupState } | null = null;
  const transport = { read: async () => structuredClone(stored), write: async (expected: number, state: Groups.GroupState) => {
    if ((stored?.version ?? 0) !== expected) return false;
    stored = { version: expected + 1, state: structuredClone(state) }; return true;
  } };
  const repo = createGroupRepositoryTransport(transport);
  await Promise.all(['one', 'two'].map(subject => repo.transaction(state => {
    state.accounts.push({ subject, emailHash: subject === 'one' ? 'a'.repeat(64) : 'b'.repeat(64), displayName: subject, status: 'PENDING', version: 1 });
  })));
  expect(await createGroupRepositoryTransport(transport).transaction(state => state.accounts.map(item => item.subject).sort())).toEqual(['one', 'two']);
  expect(stored!.version).toBe(2);
});
it('fails closed on invalid persisted state and never writes on callback failure', async () => {
  let writes = 0;
  const repo = createGroupRepositoryTransport({ read: async () => null, write: async () => { writes++; return true; } });
  await expect(repo.transaction(state => { state.accounts.push({} as never); })).rejects.toThrow();
  await expect(repo.transaction(() => { throw new Error('Denied'); })).rejects.toThrow('Denied');
  expect(writes).toBe(0);
});
