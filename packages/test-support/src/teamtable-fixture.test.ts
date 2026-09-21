import { expect, it } from 'vitest';
import { buildTeamTableFixture } from './teamtable-fixture.ts';

it('returns fresh, independently editable schedule, condition, review, and grant facts', () => {
  const first = buildTeamTableFixture({ withGrant: true });
  const untouched = structuredClone(first);
  first.schedule.slots[1]!.interval.endMinute = 720;
  expect(first.exceptionGrants[0]!.scope.meeting.interval.endMinute).toBe(690);
  expect(first.owners[2]!.confirmedInputs).toEqual(untouched.owners[2]!.confirmedInputs);
  first.owners[0]!.availabilityReview.intervals[1]!.endMinute = 680;
  expect(first.owners[1]!.availabilityReview).toEqual(untouched.owners[1]!.availabilityReview);
  const hard = first.owners[2]!.confirmedInputs.values.conditions[0]!;
  if (hard.kind !== 'HARD_AVAILABILITY') throw new Error('Missing Nina availability');
  hard.availableIntervals[1]!.endMinute = 675;
  const negotiable = first.owners[2]!.confirmedInputs.values.conditions[1]!;
  expect(negotiable).toEqual(untouched.owners[2]!.confirmedInputs.values.conditions[1]);
  expect(buildTeamTableFixture({ withGrant: true })).toEqual(untouched);
});
