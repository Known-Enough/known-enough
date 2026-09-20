import { describe, expect, it } from 'vitest';
import type { SolveDecisionInput, StructuralPlan } from './index.ts';
import {
  DomainValidationError,
  enumerateStructuralPlans,
  solveDecision,
  stablePlanId,
} from './index.ts';
import { buildTeamTableFixture } from '../../test-support/src/teamtable-fixture.ts';

type Mutable<T> = {
  -readonly [Key in keyof T]: T[Key] extends readonly (infer Item)[]
    ? Mutable<Item>[]
    : T[Key] extends object
      ? Mutable<T[Key]>
      : T[Key];
};

const mutable = <T>(value: T): Mutable<T> => structuredClone(value) as Mutable<T>;

function assignment(plan: StructuralPlan, dutyId: string): string {
  const value = plan.facts.assignments.find(candidate => candidate.duty.id === dutyId);
  if (!value) throw new Error(`Missing ${dutyId} assignment`);
  return value.participantId;
}

function expectedKey(plan: StructuralPlan): string {
  return `${plan.facts.meeting.id}:${assignment(plan, 'lead')}:${assignment(plan, 'followup')}`;
}

function expectSolved(input: SolveDecisionInput) {
  const result = solveDecision(input);
  expect(result.status).toBe('SOLVED');
  if (result.status !== 'SOLVED') throw new Error(`Expected SOLVED, received ${result.status}`);
  return result;
}

function expectNoAgreement(input: SolveDecisionInput): void {
  const result = solveDecision(input);
  expect(result.status).toBe('NO_AGREEMENT');
  if (result.status === 'NO_AGREEMENT') expect(result.feasiblePlans).toHaveLength(0);
}

describe('structural enumeration', () => {
  it('independently matches the exact twelve slot and assignment combinations', () => {
    const input = buildTeamTableFixture();
    const plans = enumerateStructuralPlans({
      schedule: input.schedule,
      rosterMemberIds: input.roster.map(member => member.id),
    });
    const expected = ['meeting-1000', 'meeting-1100', 'meeting-1400'].flatMap(meeting => [
      `${meeting}:maya:leo`,
      `${meeting}:maya:nina`,
      `${meeting}:leo:maya`,
      `${meeting}:leo:nina`,
    ]).sort();

    expect(plans).toHaveLength(12);
    expect(plans.map(expectedKey).sort()).toEqual(expected);
    expect(new Set(plans.map(plan => plan.stableId))).toHaveProperty('size', 12);
    expect(plans.every(plan => assignment(plan, 'lead') !== assignment(plan, 'followup'))).toBe(true);
    expect(plans.every(plan => ['maya', 'leo'].includes(assignment(plan, 'lead')))).toBe(true);
  });

  it('filters a meeting that overlaps a duty but accepts touching endpoints', () => {
    const touching = mutable(buildTeamTableFixture());
    touching.schedule.duties[0]!.interval = {
      date: '2026-10-08', timezone: 'America/Mexico_City', startMinute: 630, endMinute: 660,
    };
    expect(enumerateStructuralPlans({
      schedule: touching.schedule,
      rosterMemberIds: touching.roster.map(member => member.id),
    })).toHaveLength(12);

    const overlapping = mutable(buildTeamTableFixture());
    overlapping.schedule.duties[0]!.interval = {
      date: '2026-10-08', timezone: 'America/Mexico_City', startMinute: 620, endMinute: 670,
    };
    const plans = enumerateStructuralPlans({
      schedule: overlapping.schedule,
      rosterMemberIds: overlapping.roster.map(member => member.id),
    });
    expect(plans).toHaveLength(4);
    expect(plans.every(plan => plan.facts.meeting.id === 'meeting-1400')).toBe(true);
  });

  it('uses a reversible fact encoding so delimiter-shaped IDs cannot collide', () => {
    const input = buildTeamTableFixture();
    const first = enumerateStructuralPlans({
      schedule: input.schedule,
      rosterMemberIds: input.roster.map(member => member.id),
    })[0]!;
    const changed = mutable(first.facts);
    changed.meeting.id = `${changed.meeting.id}_x`;
    expect(stablePlanId(changed)).not.toBe(first.stableId);
  });
});

describe('fixture feasibility and ranking', () => {
  it('has no baseline agreement and exactly two plans after Nina grants the scoped exception', () => {
    expectNoAgreement(buildTeamTableFixture());
    const solved = expectSolved(buildTeamTableFixture({ withGrant: true }));

    expect(solved.feasiblePlans.map(expectedKey).sort()).toEqual([
      'meeting-1100:leo:maya',
      'meeting-1100:maya:leo',
    ].sort());
    expect(solved.feasiblePlans.every(plan =>
      plan.requiredGrants.map(grant => grant.id).join(',') === 'grant-nina-no-duty')).toBe(true);
    expect(solved.feasiblePlans.every(plan =>
      plan.facts.assignments.every(value => value.participantId !== 'nina'))).toBe(true);
  });

  it('selects B for inconvenience and A for balanced recent load using independent expected scores', () => {
    const inconvenience = expectSolved(buildTeamTableFixture({
      policy: 'LOWEST_INCONVENIENCE', withGrant: true,
    }));
    expect(expectedKey(inconvenience.selectedPlan)).toBe('meeting-1100:leo:maya');
    expect(inconvenience.selectedPlan.ranking.totalInconvenience).toBe(0);
    expect(inconvenience.rankedPlans.map(plan => plan.ranking)).toEqual([
      { totalInconvenience: 0, maximumLoad: 5, loadSpread: 5 },
      { totalInconvenience: 4, maximumLoad: 4, loadSpread: 4 },
    ]);

    const balance = expectSolved(buildTeamTableFixture({
      policy: 'BALANCE_RECENT_LOAD', withGrant: true,
    }));
    expect(expectedKey(balance.selectedPlan)).toBe('meeting-1100:maya:leo');
    expect(balance.selectedPlan.ranking).toEqual({
      totalInconvenience: 4,
      maximumLoad: 4,
      loadSpread: 4,
    });
  });

  it('breaks equal maximum load by spread before inconvenience', () => {
    const input = mutable(buildTeamTableFixture({ withGrant: true }));
    input.roster[1]!.sharedPriorLoad = 1;
    input.roster[2]!.sharedPriorLoad = 5;
    const result = expectSolved(input);
    expect(result.rankedPlans.map(expectedKey)).toEqual([
      'meeting-1100:maya:leo', 'meeting-1100:leo:maya',
    ]);
    expect(result.rankedPlans.map(plan => plan.ranking)).toEqual([
      { totalInconvenience: 4, maximumLoad: 5, loadSpread: 3 },
      { totalInconvenience: 0, maximumLoad: 5, loadSpread: 4 },
    ]);
  });

  it('breaks equal maximum load and spread by inconvenience', () => {
    const input = mutable(buildTeamTableFixture({ withGrant: true }));
    input.roster[1]!.sharedPriorLoad = 0;
    input.roster[2]!.sharedPriorLoad = 4;
    const result = expectSolved(input);
    expect(expectedKey(result.selectedPlan)).toBe('meeting-1100:leo:maya');
    expect(result.rankedPlans.map(plan => plan.ranking)).toEqual([
      { totalInconvenience: 0, maximumLoad: 4, loadSpread: 3 },
      { totalInconvenience: 4, maximumLoad: 4, loadSpread: 3 },
    ]);
  });

  it.each(['LOWEST_INCONVENIENCE', 'BALANCE_RECENT_LOAD'] as const)(
    'uses stable plan identity for exact %s ties regardless of input array ordering', policy => {
    const input = mutable(buildTeamTableFixture({ policy, withGrant: true }));
    input.roster[1]!.sharedPriorLoad = 0;
    for (const owner of input.owners) {
      for (const cost of owner.confirmedInputs.values.dutyCosts) cost.cost = 0;
    }
    const first = expectSolved(input);
    input.schedule.slots.reverse();
    input.schedule.duties.reverse();
    input.roster.reverse();
    input.owners.reverse();
    for (const duty of input.schedule.duties) duty.qualifiedMemberIds.reverse();
    for (const owner of input.owners) {
      owner.confirmedInputs.values.conditions.reverse();
      owner.confirmedInputs.values.dutyCosts.reverse();
      owner.availabilityReview.intervals.reverse();
    }
    input.exceptionGrants[0]!.scope.rosterMemberIds.reverse();
    const second = expectSolved(input);
    const expectedFirstId = [...first.feasiblePlans.map(plan => plan.stableId)].sort()[0];
    expect(first.selectedPlan.stableId).toBe(expectedFirstId);
    expect(second.selectedPlan.stableId).toBe(expectedFirstId);
  });

  it('does not mutate any solver input', () => {
    const input = buildTeamTableFixture({ withGrant: true });
    const before = structuredClone(input);
    solveDecision(input);
    expect(input).toEqual(before);
  });
});

describe('exception scope enforcement', () => {
  const invalidGrantCases: Array<[
    string,
    (input: Mutable<SolveDecisionInput>) => void,
  ]> = [
    ['expired by clock', input => { input.exceptionGrants[0]!.scope.expiresAt = input.now; }],
    ['revoked', input => { input.exceptionGrants[0]!.status = 'REVOKED'; }],
    ['declined', input => { input.exceptionGrants[0]!.status = 'DECLINED'; }],
    ['recorded expired', input => { input.exceptionGrants[0]!.status = 'EXPIRED'; }],
    ['superseded', input => { input.exceptionGrants[0]!.status = 'SUPERSEDED'; }],
    ['wrong room', input => { input.exceptionGrants[0]!.scope.roomId = 'other-room'; }],
    ['wrong context', input => { input.exceptionGrants[0]!.scope.contextToken = 'other-context'; }],
    ['wrong decision revision', input => { input.exceptionGrants[0]!.scope.decisionRevision += 1; }],
    ['wrong input revision', input => { input.exceptionGrants[0]!.scope.inputRevision += 1; }],
    ['wrong roster', input => { input.exceptionGrants[0]!.scope.rosterMemberIds = ['maya', 'leo', 'other']; }],
    ['wrong policy', input => { input.exceptionGrants[0]!.scope.policy = 'LOWEST_INCONVENIENCE'; }],
    ['wrong owner', input => { input.exceptionGrants[0]!.ownerMemberId = 'maya'; }],
    ['wrong condition', input => { input.exceptionGrants[0]!.scope.conditionId = 'other-condition'; }],
    ['wrong meeting', input => { input.exceptionGrants[0]!.scope.meeting = input.schedule.slots[0]!; }],
    ['wrong meeting ID', input => { input.exceptionGrants[0]!.scope.meeting.id = 'other-meeting'; }],
    ['wrong meeting date', input => { input.exceptionGrants[0]!.scope.meeting.interval.date = '2026-10-09'; }],
    ['changed grant duration', input => { input.exceptionGrants[0]!.scope.meeting.interval.endMinute = 720; }],
    ['hard condition target', input => { input.exceptionGrants[0]!.scope.conditionId = 'nina-available'; }],
    ['exception not invited', input => {
      const condition = input.owners[2]!.confirmedInputs.values.conditions[1]!;
      if (condition.kind === 'NEGOTIABLE_UNAVAILABLE') condition.inviteException = false;
    }],
  ];

  it.each(invalidGrantCases)('does not unlock plans for a grant with %s', (_name, change) => {
    const input = mutable(buildTeamTableFixture({ withGrant: true }));
    change(input);
    expectNoAgreement(input);
  });

  it('requires every overlapping negotiable condition to have its own matching grant', () => {
    const input = mutable(buildTeamTableFixture({ withGrant: true }));
    input.owners[2]!.confirmedInputs.values.conditions.push({
      id: 'nina-second-condition', kind: 'NEGOTIABLE_UNAVAILABLE', inviteException: true,
      interval: { ...input.schedule.slots[1]!.interval },
    });
    expectNoAgreement(input);
  });

  it('never lets a matching negotiable grant override the same owner hard exclusion', () => {
    const input = mutable(buildTeamTableFixture({ withGrant: true }));
    const ninaHard = input.owners[2]!.confirmedInputs.values.conditions
      .find(condition => condition.kind === 'HARD_AVAILABILITY');
    if (!ninaHard || ninaHard.kind !== 'HARD_AVAILABILITY') throw new Error('Missing Nina hard availability');
    ninaHard.availableIntervals = ninaHard.availableIntervals
      .filter(interval => interval.startMinute !== 660);
    expectNoAgreement(input);
  });

  it('returns clarification for the unsupported 60-minute revision instead of reusing the grant', () => {
    const input = mutable(buildTeamTableFixture({ withGrant: true }));
    input.schedule.slots[1]!.interval.endMinute = 720;
    const result = solveDecision(input);
    expect(result.status).toBe('NEEDS_CLARIFICATION');
    if (result.status === 'NEEDS_CLARIFICATION') {
      expect(result.clarifications.map(value => value.code)).toContain('UNSUPPORTED_MEETING_DURATION');
    }
  });
});

describe('confirmed interval knowledge', () => {
  it('never treats absent HARD_AVAILABILITY as available, with or without a grant', () => {
    const reviewed = mutable(buildTeamTableFixture({ withGrant: true }));
    reviewed.owners[2]!.confirmedInputs.values.conditions = reviewed.owners[2]!
      .confirmedInputs.values.conditions.filter(condition => condition.kind !== 'HARD_AVAILABILITY');
    expectNoAgreement(reviewed);
    reviewed.owners[2]!.availabilityReview.intervals = [];
    expect(solveDecision(reviewed).status).toBe('NEEDS_CLARIFICATION');
  });

  it('requires the complete duty interval, with known exclusion distinct from unknown coverage', () => {
    const input = mutable(buildTeamTableFixture({ withGrant: true }));
    const hard = input.owners[0]!.confirmedInputs.values.conditions[0]!;
    if (hard.kind !== 'HARD_AVAILABILITY') throw new Error('Missing Maya availability');
    hard.availableIntervals.find(interval => interval.date === '2026-10-10')!.endMinute = 719;
    expect(expectSolved(input).feasiblePlans.map(expectedKey)).toEqual(['meeting-1100:leo:maya']);
    input.owners[0]!.availabilityReview.intervals
      .find(interval => interval.date === '2026-10-10')!.endMinute = 719;
    expect(solveDecision(input).status).toBe('NEEDS_CLARIFICATION');
  });

  it('combines HARD_AVAILABILITY records as a positive union across contiguous ranges', () => {
    const input = mutable(buildTeamTableFixture({ withGrant: true }));
    const maya = input.owners[0]!;
    const hard = maya.confirmedInputs.values.conditions[0]!;
    if (hard.kind !== 'HARD_AVAILABILITY') throw new Error('Missing Maya hard availability');
    hard.availableIntervals = [
      { date: '2026-10-08', timezone: 'America/Mexico_City', startMinute: 660, endMinute: 675 },
      ...hard.availableIntervals.filter(interval => interval.date !== '2026-10-08'),
    ];
    maya.confirmedInputs.values.conditions.push({
      id: 'maya-available-contiguous',
      kind: 'HARD_AVAILABILITY',
      availableIntervals: [
        { date: '2026-10-08', timezone: 'America/Mexico_City', startMinute: 675, endMinute: 690 },
        { date: '2026-10-08', timezone: 'America/Mexico_City', startMinute: 840, endMinute: 870 },
      ],
    });
    expect(expectSolved(input).feasiblePlans).toHaveLength(2);
  });

  it('blocks a one-minute hard availability gap within fully reviewed coverage', () => {
    const input = mutable(buildTeamTableFixture({ withGrant: true }));
    const ninaHard = input.owners[2]!.confirmedInputs.values.conditions
      .find(condition => condition.kind === 'HARD_AVAILABILITY');
    if (!ninaHard || ninaHard.kind !== 'HARD_AVAILABILITY') throw new Error('Missing Nina hard availability');
    ninaHard.availableIntervals = ninaHard.availableIntervals.flatMap(interval =>
      interval.startMinute === 660
        ? [
          { ...interval, endMinute: 675 },
          { ...interval, startMinute: 676 },
        ]
        : [interval]);
    const result = solveDecision(input);
    expect(result.status).toBe('NO_AGREEMENT');
  });

  it('requires clarification when review coverage has a gap even if an exception exists', () => {
    const input = mutable(buildTeamTableFixture({ withGrant: true }));
    const review = input.owners[2]!.availabilityReview.intervals;
    input.owners[2]!.availabilityReview.intervals = review.flatMap(interval =>
      interval.startMinute === 660
        ? [
          { ...interval, endMinute: 675 },
          { ...interval, startMinute: 676 },
        ]
        : [interval]);
    const result = solveDecision(input);
    expect(result.status).toBe('NEEDS_CLARIFICATION');
    if (result.status === 'NEEDS_CLARIFICATION') {
      expect(result.clarifications.map(value => value.code)).toContain('UNKNOWN_AVAILABILITY');
    }
  });

  it('does not escalate unknown data on a candidate already blocked by another hard condition', () => {
    const input = mutable(buildTeamTableFixture());
    input.owners[2]!.availabilityReview.intervals = input.owners[2]!.availabilityReview.intervals
      .filter(interval => interval.startMinute !== 600 || interval.date !== '2026-10-08');
    const ninaHard = input.owners[2]!.confirmedInputs.values.conditions
      .find(condition => condition.kind === 'HARD_AVAILABILITY');
    if (!ninaHard || ninaHard.kind !== 'HARD_AVAILABILITY') throw new Error('Missing Nina hard availability');
    ninaHard.availableIntervals = ninaHard.availableIntervals
      .filter(interval => interval.startMinute !== 600 || interval.date !== '2026-10-08');
    expectNoAgreement(input);
  });

  it('returns clarification for missing, stale, or unconfirmed owner data', () => {
    const missing = mutable(buildTeamTableFixture());
    missing.owners.pop();
    expect(solveDecision(missing).status).toBe('NEEDS_CLARIFICATION');

    const stale = mutable(buildTeamTableFixture());
    stale.owners[0]!.availabilityReview.inputRevision += 1;
    expect(solveDecision(stale).status).toBe('NEEDS_CLARIFICATION');

    const staleContext = mutable(buildTeamTableFixture());
    staleContext.owners[0]!.confirmedInputs.contextToken = 'old-context';
    expect(solveDecision(staleContext).status).toBe('NEEDS_CLARIFICATION');

    const unconfirmed = mutable(buildTeamTableFixture());
    unconfirmed.roster[0]!.submitted = false;
    expect(solveDecision(unconfirmed).status).toBe('NEEDS_CLARIFICATION');
  });

  it('does not select a known plan when a potentially better candidate lacks a duty cost', () => {
    const input = mutable(buildTeamTableFixture({ policy: 'LOWEST_INCONVENIENCE', withGrant: true }));
    input.owners[1]!.confirmedInputs.values.dutyCosts = input.owners[1]!.confirmedInputs.values.dutyCosts
      .filter(cost => cost.dutyId !== 'lead');
    const result = solveDecision(input);
    expect(result.status).toBe('NEEDS_CLARIFICATION');
    if (result.status === 'NEEDS_CLARIFICATION') {
      expect(result.clarifications.map(value => value.code)).toContain('MISSING_DUTY_COST');
    }
  });
});

describe('edge outcomes and boundaries', () => {
  it('solves a zero-concession variant and reports no required grants', () => {
    const input = mutable(buildTeamTableFixture());
    input.owners[2]!.confirmedInputs.values.conditions = input.owners[2]!.confirmedInputs.values.conditions
      .filter(condition => condition.kind !== 'NEGOTIABLE_UNAVAILABLE');
    const result = expectSolved(input);
    expect(result.feasiblePlans).toHaveLength(4);
    expect(result.feasiblePlans.every(plan => plan.requiredGrants.length === 0)).toBe(true);
  });

  it('keeps a hard-impossible case impossible even when an unrelated exception is active', () => {
    const input = mutable(buildTeamTableFixture({ withGrant: true }));
    const mayaHard = input.owners[0]!.confirmedInputs.values.conditions[0]!;
    if (mayaHard.kind !== 'HARD_AVAILABILITY') throw new Error('Missing Maya hard availability');
    mayaHard.availableIntervals = mayaHard.availableIntervals
      .filter(interval => interval.date !== '2026-10-08');
    expectNoAgreement(input);
  });

  it('keeps disclosure state outside feasibility inputs', () => {
    const wrapper = {
      solverInput: buildTeamTableFixture({ withGrant: true }),
      disclosure: { status: 'DECLINED', text: 'Synthetic optional sentence' },
    };
    const declined = solveDecision(wrapper.solverInput);
    wrapper.disclosure.status = 'ACTIVE';
    const allowed = solveDecision(wrapper.solverInput);
    expect(declined).toEqual(allowed);
    expect(declined.status).toBe('SOLVED');
  });

  it('throws a distinct validation error for malformed finite input', () => {
    const input = mutable(buildTeamTableFixture());
    input.schedule.slots[0]!.interval.startMinute = Number.NaN;
    expect(() => solveDecision(input)).toThrow(DomainValidationError);
  });

  it.each([
    ['invalid calendar date', { date: '2026-02-30' }],
    ['different timezone', { timezone: 'UTC' }],
    ['fractional minute', { startMinute: 600.5 }],
    ['non-finite endpoint', { endMinute: Infinity }],
  ])('validates %s at direct solve and enumeration boundaries', (_label, change) => {
    const input = mutable(buildTeamTableFixture());
    Object.assign(input.schedule.slots[0]!.interval, change);
    expect(() => solveDecision(input)).toThrow(DomainValidationError);
    expect(() => enumerateStructuralPlans({
      schedule: input.schedule, rosterMemberIds: input.roster.map(member => member.id),
    })).toThrow(DomainValidationError);
  });

  it('rejects duplicate owner records and qualifications outside the roster', () => {
    const duplicate = mutable(buildTeamTableFixture());
    duplicate.owners.push(duplicate.owners[0]!);
    expect(() => solveDecision(duplicate)).toThrow(DomainValidationError);
    const outsideRoster = mutable(buildTeamTableFixture());
    outsideRoster.schedule.duties[0]!.qualifiedMemberIds.push('other');
    expect(() => solveDecision(outsideRoster)).toThrow(DomainValidationError);
  });
});
