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

it('selects public scenarios without adding owner fields', async () => {
  const proposed = await publicMockClient.readPublicRoom('proposed');
  const empty = await publicMockClient.readPublicRoom('empty');
  await expect(publicMockClient.readPublicRoom('failure')).rejects.toThrow('Synthetic public mock failure');
  expect(proposed.value?.status).toBe('PROPOSED');
  expect(proposed.value).not.toHaveProperty('pendingOffers');
  expect(empty).toEqual({ value: null, freshness: 'fresh' });
});

it('marks stale reads and resolves the same scenario fresh after refresh', async () => {
  await expect(publicMockClient.readPublicRoom('stale')).resolves.toMatchObject({ freshness: 'stale', value: { status: 'COLLECTING' } });
  await expect(publicMockClient.readPublicRoom('stale', { refresh: true })).resolves.toMatchObject({ freshness: 'fresh', value: { status: 'COLLECTING' } });
});
