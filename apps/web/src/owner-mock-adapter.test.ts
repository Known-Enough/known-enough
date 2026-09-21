import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { ownerMockClient } from './owner-mock-adapter';
import { publicMockClient } from './mock-adapter';
import { exceptionScopeSummary, proposalMatchesOwner, valuesForAvailability } from './owner-screen';
import { decideException } from './command-client';

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

it('maps either availability choice to its complete finite condition without changing unrelated inputs', async () => {
  const room = await ownerMockClient.getOwnerRoom();
  const interval = { date: '2026-10-08', timezone: 'America/Mexico_City' as const, startMinute: 660, endMinute: 720 };
  const available = valuesForAvailability(room.confirmedInputs!.values, 'available', interval, 3);
  const exception = valuesForAvailability(available, 'exception', interval, 1);
  expect(available).toMatchObject({ conditions: [{ id: 'condition-nina-1100', kind: 'HARD_AVAILABILITY', availableIntervals: [interval] }], dutyCosts: [{ dutyId: 'followup', cost: 3 }] });
  expect(exception).toMatchObject({ conditions: [{ id: 'condition-nina-1100', kind: 'NEGOTIABLE_UNAVAILABLE', interval, inviteException: true }], dutyCosts: [{ dutyId: 'followup', cost: 1 }] });
});

it('does not let a receipt enable acceptance without a matching current proposal', async () => {
  const { value: room } = await ownerMockClient.readOwnerRoom('approval');
  const { value: publicRoom } = await publicMockClient.readPublicRoom('proposed');
  expect(proposalMatchesOwner(room!, publicRoom!.proposal)).toBe(true);
  expect(proposalMatchesOwner(room!, { ...publicRoom!.proposal!, planHash: 'a'.repeat(64) })).toBe(false);
  expect(proposalMatchesOwner(room!, null)).toBe(false);
});

it('renders the same policy that an exception command binds, including a changed policy', async () => {
  const room = await ownerMockClient.getOwnerRoom();
  const changed = { ...room.pendingOffers[0]!, scope: { ...room.pendingOffers[0]!.scope, policy: 'LOWEST_INCONVENIENCE' as const } };
  const command = decideException(room, { decisionRevision: 1 }, changed, 'ALLOW', { requestId: () => 'request-test', idempotencyKey: () => 'key-test' });
  expect(exceptionScopeSummary(changed.scope)).toContain('policy Lowest declared inconvenience');
  expect(command.payload).toMatchObject({ scope: { policy: 'LOWEST_INCONVENIENCE' } });
});
