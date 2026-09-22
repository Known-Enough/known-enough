import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { ownerMockClient } from './owner-mock-adapter';
import { publicMockClient } from './mock-adapter';
import { editableAvailabilityFor, exceptionScopeSummary, proposalMatchesOwner, valuesForAvailability } from './owner-screen';
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

it('maps either availability choice to its displayed finite interval without changing unrelated inputs', async () => {
  const room = await ownerMockClient.getOwnerRoom();
  const interval = { date: '2026-10-08', timezone: 'America/Mexico_City' as const, startMinute: 660, endMinute: 720 };
  const initial = room.confirmedInputs!.values.conditions[0]!;
  if (initial.kind !== 'NEGOTIABLE_UNAVAILABLE') throw new Error('fixture must supply a negotiable condition');
  const target = { conditionId: 'condition-nina-1100', interval: initial.interval };
  const available = valuesForAvailability(room.confirmedInputs!.values, 'available', target, interval, 3);
  const exception = valuesForAvailability(available, 'exception', { conditionId: target.conditionId, interval }, interval, 1);
  expect(available).toMatchObject({ conditions: [{ id: 'condition-nina-1100', kind: 'HARD_AVAILABILITY', availableIntervals: [interval] }], dutyCosts: [{ dutyId: 'followup', cost: 3 }] });
  expect(exception).toMatchObject({ conditions: [
    { id: 'condition-nina-1100', kind: 'HARD_AVAILABILITY', availableIntervals: [interval] },
    { id: 'condition-nina-1100-exception', kind: 'NEGOTIABLE_UNAVAILABLE', interval, inviteException: true },
  ], dutyCosts: [{ dutyId: 'followup', cost: 1 }] });
});

it('targets the editable condition and preserves unrelated hard intervals and conditions', async () => {
  const room = await ownerMockClient.getOwnerRoom();
  const thursday = { date: '2026-10-08', timezone: 'America/Mexico_City' as const, startMinute: 660, endMinute: 690 };
  const sunday = { date: '2026-10-11', timezone: 'America/Mexico_City' as const, startMinute: 600, endMinute: 660 };
  const negotiable = room.confirmedInputs!.values.conditions[0]!;
  if (negotiable.kind !== 'NEGOTIABLE_UNAVAILABLE') throw new Error('fixture must supply a negotiable condition');
  const values = { ...room.confirmedInputs!.values, conditions: [{ id: 'hard-thursday', kind: 'HARD_AVAILABILITY' as const, availableIntervals: [thursday, sunday] }, negotiable] };
  const edited = valuesForAvailability(values, 'available', { conditionId: negotiable.id, interval: negotiable.interval }, { ...negotiable.interval, endMinute: 720 }, 2);
  expect(edited.conditions).toEqual([
    { id: 'hard-thursday', kind: 'HARD_AVAILABILITY', availableIntervals: [thursday, sunday] },
    { id: negotiable.id, kind: 'HARD_AVAILABILITY', availableIntervals: [{ ...negotiable.interval, endMinute: 720 }] },
  ]);
  expect(edited.dutyCosts).toEqual([{ dutyId: 'followup', cost: 2 }]);
});

it('resolves the later negotiable condition when a hard condition appears first', async () => {
  const { value: room } = await ownerMockClient.readOwnerRoom('hard-first-draft');
  expect(editableAvailabilityFor(room!.draft!.values)).toEqual({
    conditionId: 'condition-nina-1100',
    availability: 'exception',
    interval: { date: '2026-10-08', timezone: 'America/Mexico_City', startMinute: 660, endMinute: 690 },
  });
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

it('preserves a do-not-ask condition when editing only a duty cost', async () => {
  const room = await ownerMockClient.getOwnerRoom();
  const original = room.confirmedInputs!.values;
  const condition = original.conditions[0]!;
  if (condition.kind !== 'NEGOTIABLE_UNAVAILABLE') throw new Error('Expected unavailable condition');
  const values = { ...original, conditions: [{ ...condition, inviteException: false }] };
  const target = editableAvailabilityFor(values)!;
  expect(target.availability).toBe('unavailable');
  const edited = valuesForAvailability(values, target.availability, target, target.interval, 3);
  expect(edited.conditions).toEqual(values.conditions);
  expect(edited.dutyCosts[0]?.cost).toBe(3);
});
