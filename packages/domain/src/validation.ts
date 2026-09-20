import {
  ConfirmedInputs,
  ExceptionGrant,
  Id,
  Interval,
  Participant,
  Policy,
  Schedule,
  Timestamp,
  Version,
  type Interval as IntervalValue,
  type Participant as ParticipantValue,
  type Policy as PolicyValue,
  type Schedule as ScheduleValue,
} from '@deal-table/contracts';
import {
  DomainValidationError,
  type OwnedExceptionGrant,
  type OwnerSolverInputs,
  type SolveDecisionInput,
} from './types.ts';

const SOLVE_KEYS = [
  'roomId', 'contextToken', 'decisionRevision', 'policy', 'now', 'schedule',
  'roster', 'owners', 'exceptionGrants',
] as const;
const OWNER_KEYS = ['ownerMemberId', 'confirmedInputs', 'availabilityReview'] as const;
const REVIEW_KEYS = ['contextToken', 'inputRevision', 'intervals'] as const;
const GRANT_KEYS = ['id', 'version', 'ownerMemberId', 'scope', 'status'] as const;

function object(input: unknown, label: string): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new DomainValidationError([`${label} must be an object`]);
  }
  return input as Record<string, unknown>;
}

function strictKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const extras = Object.keys(value).filter(key => !expected.includes(key));
  const missing = expected.filter(key => !(key in value));
  const issues = [
    ...extras.map(key => `${label} has unknown key ${key}`),
    ...missing.map(key => `${label} is missing ${key}`),
  ];
  if (issues.length) throw new DomainValidationError(issues);
}

function parseWith<T>(parser: { parse(input: unknown): T }, input: unknown, label: string): T {
  try {
    return parser.parse(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new DomainValidationError([`${label}: ${message}`]);
  }
}

function parseOwner(input: unknown, index: number): OwnerSolverInputs {
  const value = object(input, `owners[${index}]`);
  strictKeys(value, OWNER_KEYS, `owners[${index}]`);
  const review = object(value.availabilityReview, `owners[${index}].availabilityReview`);
  strictKeys(review, REVIEW_KEYS, `owners[${index}].availabilityReview`);
  if (!Array.isArray(review.intervals) || review.intervals.length > 50) {
    throw new DomainValidationError([`owners[${index}].availabilityReview.intervals must contain at most 50 intervals`]);
  }
  return {
    ownerMemberId: parseWith(Id, value.ownerMemberId, `owners[${index}].ownerMemberId`),
    confirmedInputs: parseWith(ConfirmedInputs, value.confirmedInputs, `owners[${index}].confirmedInputs`),
    availabilityReview: {
      contextToken: parseWith(Id, review.contextToken, `owners[${index}].availabilityReview.contextToken`),
      inputRevision: parseWith(Version, review.inputRevision, `owners[${index}].availabilityReview.inputRevision`),
      intervals: review.intervals.map((interval, intervalIndex) =>
        parseWith(Interval, interval, `owners[${index}].availabilityReview.intervals[${intervalIndex}]`)),
    },
  };
}

function parseGrant(input: unknown, index: number): OwnedExceptionGrant {
  const value = object(input, `exceptionGrants[${index}]`);
  strictKeys(value, GRANT_KEYS, `exceptionGrants[${index}]`);
  const parsed = parseWith(ExceptionGrant, {
    id: value.id,
    version: value.version,
    scope: value.scope,
    status: value.status,
  }, `exceptionGrants[${index}]`);
  return {
    ...parsed,
    ownerMemberId: parseWith(Id, value.ownerMemberId, `exceptionGrants[${index}].ownerMemberId`),
  };
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

export interface ParsedSolveInput {
  readonly roomId: string;
  readonly contextToken: string;
  readonly decisionRevision: number;
  readonly policy: PolicyValue;
  readonly now: string;
  readonly nowEpochMs: number;
  readonly schedule: ScheduleValue;
  readonly roster: readonly ParticipantValue[];
  readonly owners: readonly OwnerSolverInputs[];
  readonly exceptionGrants: readonly OwnedExceptionGrant[];
}

export function parseSolveInput(input: SolveDecisionInput | unknown): ParsedSolveInput {
  const value = object(input, 'solve input');
  strictKeys(value, SOLVE_KEYS, 'solve input');
  const roomId = parseWith(Id, value.roomId, 'roomId');
  const contextToken = parseWith(Id, value.contextToken, 'contextToken');
  const decisionRevision = parseWith(Version, value.decisionRevision, 'decisionRevision');
  const policy = parseWith(Policy, value.policy, 'policy');
  const now = parseWith(Timestamp, value.now, 'now');
  const nowEpochMs = Date.parse(now);
  const schedule = parseWith(Schedule, value.schedule, 'schedule');
  if (!Array.isArray(value.roster) || value.roster.length !== 3) {
    throw new DomainValidationError(['roster must contain exactly three participants']);
  }
  const roster = value.roster.map((participant, index) =>
    parseWith(Participant, participant, `roster[${index}]`));
  if (!unique(roster.map(participant => participant.id))) {
    throw new DomainValidationError(['roster contains duplicate participant IDs']);
  }
  const rosterIds = new Set(roster.map(participant => participant.id));
  if (schedule.duties.some(duty => duty.qualifiedMemberIds.some(id => !rosterIds.has(id)))) {
    throw new DomainValidationError(['duty qualifications must belong to the current roster']);
  }
  if (!Array.isArray(value.owners) || !Array.isArray(value.exceptionGrants)) {
    throw new DomainValidationError(['owners and exceptionGrants must be arrays']);
  }
  const owners = value.owners.map(parseOwner);
  if (!unique(owners.map(owner => owner.ownerMemberId))) {
    throw new DomainValidationError(['owners contains duplicate participant IDs']);
  }
  if (owners.some(owner => !rosterIds.has(owner.ownerMemberId))) {
    throw new DomainValidationError(['owner inputs must belong to the current roster']);
  }
  const exceptionGrants = value.exceptionGrants.map(parseGrant);
  if (!unique(exceptionGrants.map(grant => grant.id))) {
    throw new DomainValidationError(['exception grants contain duplicate IDs']);
  }
  if (exceptionGrants.some(grant => !rosterIds.has(grant.ownerMemberId))) {
    throw new DomainValidationError(['exception grant owners must belong to the current roster']);
  }
  return {
    roomId,
    contextToken,
    decisionRevision,
    policy,
    now,
    nowEpochMs,
    schedule,
    roster,
    owners,
    exceptionGrants,
  };
}

export function sameInterval(left: IntervalValue, right: IntervalValue): boolean {
  return left.date === right.date
    && left.timezone === right.timezone
    && left.startMinute === right.startMinute
    && left.endMinute === right.endMinute;
}

export function containsInterval(container: IntervalValue, target: IntervalValue): boolean {
  return container.date === target.date
    && container.timezone === target.timezone
    && container.startMinute <= target.startMinute
    && container.endMinute >= target.endMinute;
}

/** Full coverage may be declared as several overlapping or exactly contiguous intervals. */
export function intervalsCover(containers: readonly IntervalValue[], target: IntervalValue): boolean {
  const relevant = containers
    .filter(interval => interval.date === target.date && interval.timezone === target.timezone)
    .map(interval => ({ start: interval.startMinute, end: interval.endMinute }))
    .sort((left, right) => left.start - right.start || left.end - right.end);
  let coveredUntil = target.startMinute;
  for (const interval of relevant) {
    if (interval.end <= coveredUntil) continue;
    if (interval.start > coveredUntil) return false;
    coveredUntil = interval.end;
    if (coveredUntil >= target.endMinute) return true;
  }
  return false;
}

export function intervalsOverlap(left: IntervalValue, right: IntervalValue): boolean {
  return left.date === right.date
    && left.timezone === right.timezone
    && left.startMinute < right.endMinute
    && right.startMinute < left.endMinute;
}
