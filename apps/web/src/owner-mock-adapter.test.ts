import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { ownerMockClient } from './owner-mock-adapter';

it('builds an independently validated synthetic owner snapshot', async () => {
  const first = await ownerMockClient.getOwnerRoom();
  first.pendingOffers[0]!.scope.conditionId = 'mutated';
  const next = await ownerMockClient.getOwnerRoom();
  expect(next.ownerMemberId).toBe('nina');
  expect(next.pendingOffers[0]?.scope.predicate).toBe('OWNER_HAS_NO_WEEKEND_DUTIES');
  expect(next.availabilityReview).toEqual({
    contextToken: next.confirmedInputs?.contextToken,
    inputRevision: next.confirmedInputs?.inputRevision,
    intervals: [{ date: '2026-10-08', timezone: 'America/Mexico_City', startMinute: 660, endMinute: 690 }],
  });
  expect(next.disclosurePreviews[0]?.text).toBe('A conditional availability exception makes the proposed plan possible.');
  expect(next.disclosurePreviews[0]?.textHash).toBe(createHash('sha256').update(next.disclosurePreviews[0]!.text, 'utf8').digest('hex'));
});

it('keeps owner mock recovery states deterministic', async () => {
  await expect(ownerMockClient.readOwnerRoom('failure')).rejects.toThrow('Synthetic owner mock failure');
  await expect(ownerMockClient.readOwnerRoom('empty')).resolves.toEqual({ value: null, freshness: 'fresh' });
  await expect(ownerMockClient.readOwnerRoom('stale')).resolves.toMatchObject({ freshness: 'stale', value: { ownerMemberId: 'nina' } });
  await expect(ownerMockClient.readOwnerRoom('stale', { refresh: true })).resolves.toMatchObject({ freshness: 'fresh', value: { ownerMemberId: 'nina' } });
});

it('keeps the review receipt bound to confirmed inputs in every populated scenario', async () => {
  for (const scenario of ['review', 'draft', 'approval', 'stale'] as const) {
    const { value } = await ownerMockClient.readOwnerRoom(scenario);
    expect(value?.availabilityReview).toMatchObject({
      contextToken: value?.confirmedInputs?.contextToken,
      inputRevision: value?.confirmedInputs?.inputRevision,
    });
  }
});
