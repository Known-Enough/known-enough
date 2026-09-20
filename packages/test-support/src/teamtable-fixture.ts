import type { Interval, Policy } from '@deal-table/contracts';
import type { SolveDecisionInput } from '@deal-table/domain';

const timezone = 'America/Mexico_City' as const;

function interval(date: string, startMinute: number, endMinute: number): Interval {
  return { date, timezone, startMinute, endMinute };
}

const thursday1000 = interval('2026-10-08', 600, 630);
const thursday1100 = interval('2026-10-08', 660, 690);
const thursday1400 = interval('2026-10-08', 840, 870);
const saturdayLead = interval('2026-10-10', 600, 720);
const sundayFollowup = interval('2026-10-11', 600, 660);

export interface TeamTableFixtureOptions {
  readonly policy?: Policy;
  readonly withGrant?: boolean;
}

export function buildTeamTableFixture(options: TeamTableFixtureOptions = {}): SolveDecisionInput {
  const policy = options.policy ?? 'BALANCE_RECENT_LOAD';
  const roomId = 'room-synthetic';
  const contextToken = 'context-synthetic-v1';
  const decisionRevision = 1;
  const rosterMemberIds = ['maya', 'leo', 'nina'];
  const schedule = {
    slots: [
      { id: 'meeting-1000', interval: { ...thursday1000 } },
      { id: 'meeting-1100', interval: { ...thursday1100 } },
      { id: 'meeting-1400', interval: { ...thursday1400 } },
    ],
    duties: [
      {
        id: 'lead',
        label: 'Launch rehearsal lead',
        interval: { ...saturdayLead },
        loadPoints: 2,
        qualifiedMemberIds: ['maya', 'leo'],
      },
      {
        id: 'followup',
        label: 'Follow-up check',
        interval: { ...sundayFollowup },
        loadPoints: 1,
        qualifiedMemberIds: ['maya', 'leo', 'nina'],
      },
    ],
  };
  const reviewedMeetingAndDuties = [
    thursday1000, thursday1100, thursday1400, saturdayLead, sundayFollowup,
  ];
  const owner = (
    ownerMemberId: string,
    inputRevision: number,
    conditions: SolveDecisionInput['owners'][number]['confirmedInputs']['values']['conditions'],
    dutyCosts: SolveDecisionInput['owners'][number]['confirmedInputs']['values']['dutyCosts'],
  ): SolveDecisionInput['owners'][number] => ({
    ownerMemberId,
    confirmedInputs: {
      confirmed: true,
      confirmedAt: '2026-09-30T18:00:00Z',
      inputRevision,
      contextToken,
      values: {
        conditions: conditions.map(condition => condition.kind === 'HARD_AVAILABILITY'
          ? { ...condition, availableIntervals: condition.availableIntervals.map(value => ({ ...value })) }
          : { ...condition, interval: { ...condition.interval } }),
        dutyCosts: dutyCosts.map(cost => ({ ...cost })),
      },
    },
    availabilityReview: {
      contextToken,
      inputRevision,
      intervals: reviewedMeetingAndDuties.map(value => ({ ...value })),
    },
  });
  const owners = [
    owner('maya', 3, [{
      id: 'maya-available',
      kind: 'HARD_AVAILABILITY',
      availableIntervals: [thursday1100, thursday1400, saturdayLead, sundayFollowup],
    }], [{ dutyId: 'lead', cost: 3 }, { dutyId: 'followup', cost: 0 }]),
    owner('leo', 4, [{
      id: 'leo-available',
      kind: 'HARD_AVAILABILITY',
      availableIntervals: [thursday1000, thursday1100, saturdayLead, sundayFollowup],
    }], [{ dutyId: 'lead', cost: 0 }, { dutyId: 'followup', cost: 1 }]),
    owner('nina', 5, [
      {
        id: 'nina-available',
        kind: 'HARD_AVAILABILITY',
        availableIntervals: [thursday1000, thursday1100, thursday1400, sundayFollowup],
      },
      {
        id: 'nina-thursday-1100',
        kind: 'NEGOTIABLE_UNAVAILABLE',
        interval: thursday1100,
        inviteException: true,
      },
    ], [{ dutyId: 'followup', cost: 0 }]),
  ];
  const exceptionGrants = options.withGrant ? [{
    id: 'grant-nina-no-duty',
    version: 2,
    ownerMemberId: 'nina',
    status: 'ACTIVE' as const,
    scope: {
      conditionId: 'nina-thursday-1100',
      roomId,
      contextToken,
      decisionRevision,
      inputRevision: 5,
      rosterMemberIds,
      policy,
      meeting: structuredClone(schedule.slots[1]!),
      predicate: 'OWNER_HAS_NO_WEEKEND_DUTIES' as const,
      expiresAt: '2026-10-08T12:00:00Z',
    },
  }] : [];
  return {
    roomId,
    contextToken,
    decisionRevision,
    policy,
    now: '2026-10-01T12:00:00Z',
    schedule,
    roster: [
      { id: 'maya', displayName: 'Maya', submitted: true, sharedPriorLoad: 0 },
      { id: 'leo', displayName: 'Leo', submitted: true, sharedPriorLoad: 3 },
      { id: 'nina', displayName: 'Nina', submitted: true, sharedPriorLoad: 0 },
    ],
    owners,
    exceptionGrants,
  };
}

export function planLabel(plan: { facts: {
  meeting: { id: string };
  assignments: readonly { duty: { id: string }; participantId: string }[];
} }): string {
  const ownerOf = (dutyId: string) => plan.facts.assignments
    .find(assignment => assignment.duty.id === dutyId)?.participantId ?? '?';
  return `${plan.facts.meeting.id}: lead=${ownerOf('lead')}, followup=${ownerOf('followup')}`;
}
