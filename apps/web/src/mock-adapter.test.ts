import { expect, it } from 'vitest';
import { publicMockClient } from './mock-adapter';
it('returns independently validated public-only mock snapshots', async () => {
  const first = await publicMockClient.getPublicRoom();
  first.roster[0]!.displayName = 'mutated';
  const next = await publicMockClient.getPublicRoom();
  expect(next.roster.map(p => p.displayName)).toEqual(['Maya', 'Leo', 'Nina']);
  expect(next.schedule.slots).toHaveLength(3);
  expect(next.schedule.duties).toHaveLength(2);
  expect(next.proposal).toBeNull();
  expect(next).not.toHaveProperty('confirmedInputs');
});
