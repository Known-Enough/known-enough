import type { Condition, Interval, Policy } from '@deal-table/contracts';
import { enumerateStructuralPlans } from './enumerate.ts';
import {
  intervalsCover,
  intervalsOverlap,
  parseSolveInput,
  sameInterval,
  type ParsedSolveInput,
} from './validation.ts';
import {
  DomainValidationError,
  type Clarification,
  type FeasiblePlan,
  type OwnedExceptionGrant,
  type OwnerSolverInputs,
  type RankedPlan,
  type RequiredGrantReference,
  type SolveDecisionInput,
  type SolveDecisionResult,
  type StructuralPlan,
} from './types.ts';

interface CandidateEvaluation {
  readonly state: 'FEASIBLE' | 'BLOCKED' | 'UNKNOWN';
  readonly plan: FeasiblePlan;
  readonly clarifications: readonly Clarification[];
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function setsEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function sameMeeting(
  left: StructuralPlan['facts']['meeting'],
  right: StructuralPlan['facts']['meeting'],
): boolean {
  return left.id === right.id && sameInterval(left.interval, right.interval);
}

function matchingGrant(
  input: ParsedSolveInput,
  plan: StructuralPlan,
  owner: OwnerSolverInputs,
  condition: Extract<Condition, { kind: 'NEGOTIABLE_UNAVAILABLE' }>,
): OwnedExceptionGrant | undefined {
  const rosterMemberIds = input.roster.map(participant => participant.id);
  const ownerHasDuty = plan.facts.assignments.some(assignment => assignment.participantId === owner.ownerMemberId);
  return input.exceptionGrants.find(grant => {
    const scope = grant.scope;
    return grant.status === 'ACTIVE'
      && Date.parse(scope.expiresAt) > input.nowEpochMs
      && grant.ownerMemberId === owner.ownerMemberId
      && condition.inviteException
      && scope.conditionId === condition.id
      && scope.roomId === input.roomId
      && scope.contextToken === input.contextToken
      && scope.decisionRevision === input.decisionRevision
      && scope.inputRevision === owner.confirmedInputs.inputRevision
      && setsEqual(scope.rosterMemberIds, rosterMemberIds)
      && scope.policy === input.policy
      && sameMeeting(scope.meeting, plan.facts.meeting)
      && scope.predicate === 'OWNER_HAS_NO_WEEKEND_DUTIES'
      && !ownerHasDuty;
  });
}

function grantReference(grant: OwnedExceptionGrant): RequiredGrantReference {
  return { id: grant.id, version: grant.version, ownerMemberId: grant.ownerMemberId };
}

function requiredIntervals(plan: StructuralPlan, memberId: string): Interval[] {
  return [
    plan.facts.meeting.interval,
    ...plan.facts.assignments
      .filter(assignment => assignment.participantId === memberId)
      .map(assignment => assignment.duty.interval),
  ];
}

function evaluateCandidate(input: ParsedSolveInput, plan: StructuralPlan): CandidateEvaluation {
  const requiredGrants = new Map<string, RequiredGrantReference>();
  const clarifications: Clarification[] = [];
  let blocked = false;
  for (const participant of input.roster) {
    const owner = input.owners.find(candidate => candidate.ownerMemberId === participant.id);
    if (!participant.submitted || !owner) {
      clarifications.push({ code: 'UNCONFIRMED_INPUTS', ownerMemberId: participant.id });
      continue;
    }
    if (owner.confirmedInputs.contextToken !== input.contextToken) {
      clarifications.push({ code: 'STALE_CONFIRMED_INPUTS', ownerMemberId: participant.id });
      continue;
    }
    const availableIntervals = owner.confirmedInputs.values.conditions
      .filter((condition): condition is Extract<Condition, { kind: 'HARD_AVAILABILITY' }> =>
        condition.kind === 'HARD_AVAILABILITY')
      .flatMap(condition => condition.availableIntervals);
    const negotiable = owner.confirmedInputs.values.conditions
      .filter((condition): condition is Extract<Condition, { kind: 'NEGOTIABLE_UNAVAILABLE' }> =>
        condition.kind === 'NEGOTIABLE_UNAVAILABLE');
    for (const interval of requiredIntervals(plan, participant.id)) {
      if (!intervalsCover(owner.availabilityReview.intervals, interval)) {
        clarifications.push({ code: 'UNKNOWN_AVAILABILITY', ownerMemberId: participant.id, interval });
        continue;
      }
      if (!intervalsCover(availableIntervals, interval)) {
        blocked = true;
        continue;
      }
      const blockingConditions = negotiable.filter(condition => intervalsOverlap(condition.interval, interval));
      if (blockingConditions.length) {
        const grants = blockingConditions.map(condition => matchingGrant(input, plan, owner, condition));
        if (grants.some(grant => grant === undefined)) {
          blocked = true;
          continue;
        }
        for (const grant of grants) {
          if (grant) requiredGrants.set(grant.id, grantReference(grant));
        }
        continue;
      }
    }
  }
  const feasiblePlan: FeasiblePlan = {
    ...plan,
    requiredGrants: [...requiredGrants.values()].sort((left, right) => compareText(left.id, right.id)),
  };
  if (blocked) return { state: 'BLOCKED', plan: feasiblePlan, clarifications: [] };
  if (clarifications.length) return { state: 'UNKNOWN', plan: feasiblePlan, clarifications };
  return { state: 'FEASIBLE', plan: feasiblePlan, clarifications: [] };
}

function safeLoad(prior: number, added: number): number {
  const result = prior + added;
  if (!Number.isSafeInteger(result)) {
    throw new DomainValidationError(['participant load exceeds the safe integer range']);
  }
  return result;
}

function rankingFor(plan: FeasiblePlan, input: ParsedSolveInput): RankedPlan | Clarification[] {
  let totalInconvenience = 0;
  const loadByMember = new Map(input.roster.map(participant => [participant.id, participant.sharedPriorLoad]));
  const missing: Clarification[] = [];
  for (const assignment of plan.facts.assignments) {
    const owner = input.owners.find(candidate => candidate.ownerMemberId === assignment.participantId);
    const dutyCost = owner?.confirmedInputs.values.dutyCosts
      .find(cost => cost.dutyId === assignment.duty.id)?.cost;
    if (dutyCost === undefined) {
      missing.push({
        code: 'MISSING_DUTY_COST',
        ownerMemberId: assignment.participantId,
        dutyId: assignment.duty.id,
      });
      continue;
    }
    totalInconvenience += dutyCost;
    const prior = loadByMember.get(assignment.participantId);
    if (prior === undefined) throw new DomainValidationError(['assignment owner is absent from roster']);
    loadByMember.set(assignment.participantId, safeLoad(prior, assignment.duty.loadPoints));
  }
  if (missing.length) return missing;
  const loads = [...loadByMember.values()];
  const maximumLoad = Math.max(...loads);
  const minimumLoad = Math.min(...loads);
  return {
    ...plan,
    ranking: {
      totalInconvenience,
      maximumLoad,
      loadSpread: maximumLoad - minimumLoad,
    },
  };
}

function compareRanked(left: RankedPlan, right: RankedPlan, policy: Policy): number {
  const leftTuple = policy === 'LOWEST_INCONVENIENCE'
    ? [left.ranking.totalInconvenience]
    : [left.ranking.maximumLoad, left.ranking.loadSpread, left.ranking.totalInconvenience];
  const rightTuple = policy === 'LOWEST_INCONVENIENCE'
    ? [right.ranking.totalInconvenience]
    : [right.ranking.maximumLoad, right.ranking.loadSpread, right.ranking.totalInconvenience];
  for (let index = 0; index < leftTuple.length; index += 1) {
    const difference = leftTuple[index]! - rightTuple[index]!;
    if (difference !== 0) return difference;
  }
  return compareText(left.stableId, right.stableId);
}

function uniqueClarifications(values: readonly Clarification[]): Clarification[] {
  const seen = new Set<string>();
  return values.filter(value => {
    const key = JSON.stringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => compareText(JSON.stringify(left), JSON.stringify(right)));
}

export function solveDecision(input: SolveDecisionInput | unknown): SolveDecisionResult {
  const parsed = parseSolveInput(input);
  const structuralPlans = enumerateStructuralPlans({
    schedule: parsed.schedule,
    rosterMemberIds: parsed.roster.map(participant => participant.id),
  });
  const unsupported = parsed.schedule.slots
    .filter(slot => slot.interval.endMinute - slot.interval.startMinute !== 30)
    .map(slot => ({ code: 'UNSUPPORTED_MEETING_DURATION' as const, interval: slot.interval }));
  if (unsupported.length) {
    return { status: 'NEEDS_CLARIFICATION', structuralPlans, clarifications: unsupported };
  }
  const inputClarifications = parsed.roster.flatMap<Clarification>(participant => {
    const owner = parsed.owners.find(candidate => candidate.ownerMemberId === participant.id);
    if (!participant.submitted || !owner) {
      return [{ code: 'UNCONFIRMED_INPUTS' as const, ownerMemberId: participant.id }];
    }
    const stale = owner.confirmedInputs.contextToken !== parsed.contextToken
      || owner.availabilityReview.contextToken !== parsed.contextToken
      || owner.availabilityReview.inputRevision !== owner.confirmedInputs.inputRevision;
    return stale ? [{ code: 'STALE_CONFIRMED_INPUTS' as const, ownerMemberId: participant.id }] : [];
  });
  if (inputClarifications.length) {
    return {
      status: 'NEEDS_CLARIFICATION',
      structuralPlans,
      clarifications: uniqueClarifications(inputClarifications),
    };
  }
  const evaluated = structuralPlans.map(plan => evaluateCandidate(parsed, plan));
  const unknown = evaluated.filter(result => result.state === 'UNKNOWN');
  if (unknown.length) {
    return {
      status: 'NEEDS_CLARIFICATION',
      structuralPlans,
      clarifications: uniqueClarifications(unknown.flatMap(result => result.clarifications)),
    };
  }
  const feasiblePlans = evaluated
    .filter((result): result is CandidateEvaluation & { state: 'FEASIBLE' } => result.state === 'FEASIBLE')
    .map(result => result.plan);
  if (!feasiblePlans.length) return { status: 'NO_AGREEMENT', structuralPlans, feasiblePlans: [] };
  const scored = feasiblePlans.map(plan => rankingFor(plan, parsed));
  const missingCosts = scored.flatMap(result => Array.isArray(result) ? result : []);
  if (missingCosts.length) {
    return {
      status: 'NEEDS_CLARIFICATION',
      structuralPlans,
      clarifications: uniqueClarifications(missingCosts),
    };
  }
  const rankedPlans = (scored as RankedPlan[]).sort((left, right) => compareRanked(left, right, parsed.policy));
  const selectedPlan = rankedPlans[0];
  if (!selectedPlan) throw new DomainValidationError(['feasible plan ranking unexpectedly produced no result']);
  return { status: 'SOLVED', structuralPlans, feasiblePlans, rankedPlans, selectedPlan };
}
