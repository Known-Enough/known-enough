import {
  MemberIds,
  PublicPlanFacts,
  Schedule,
  type PublicPlanFacts as PublicPlanFactsValue,
  type Schedule as ScheduleValue,
} from '@deal-table/contracts';
import { DomainValidationError, type StructuralPlan } from './types.ts';

const MAX_STRUCTURAL_PLANS = 1_000;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function intervalsOverlap(
  left: ScheduleValue['slots'][number]['interval'],
  right: ScheduleValue['slots'][number]['interval'],
): boolean {
  return left.date === right.date
    && left.timezone === right.timezone
    && left.startMinute < right.endMinute
    && right.startMinute < left.endMinute;
}

function canonicalPlanDescriptor(facts: PublicPlanFactsValue): string {
  const assignments = [...facts.assignments]
    .sort((left, right) => compareText(left.duty.id, right.duty.id))
    .map(({ duty, participantId }) => [
      duty.id,
      duty.label,
      duty.interval.date,
      duty.interval.timezone,
      duty.interval.startMinute,
      duty.interval.endMinute,
      duty.loadPoints,
      [...duty.qualifiedMemberIds].sort(),
      participantId,
    ]);
  const meeting = facts.meeting;
  return JSON.stringify([
    meeting.id,
    meeting.interval.date,
    meeting.interval.timezone,
    meeting.interval.startMinute,
    meeting.interval.endMinute,
    assignments,
  ]);
}

function utf8Hex(value: string): string {
  return Array.from(new TextEncoder().encode(value), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function stablePlanId(facts: PublicPlanFactsValue): string {
  try {
    const parsed = PublicPlanFacts.parse(facts);
    return `plan_${utf8Hex(canonicalPlanDescriptor(parsed))}`;
  } catch (error) {
    throw new DomainValidationError([error instanceof Error ? error.message : String(error)]);
  }
}

export interface EnumerateStructuralPlansInput {
  readonly schedule: ScheduleValue;
  readonly rosterMemberIds: readonly string[];
}

export function enumerateStructuralPlans(input: EnumerateStructuralPlansInput | unknown): StructuralPlan[] {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new DomainValidationError(['enumeration input must be an object']);
  }
  const value = input as Record<string, unknown>;
  const extras = Object.keys(value).filter(key => !['schedule', 'rosterMemberIds'].includes(key));
  if (extras.length) throw new DomainValidationError(extras.map(key => `enumeration input has unknown key ${key}`));
  let schedule: ScheduleValue;
  let rosterMemberIds: string[];
  try {
    schedule = Schedule.parse(value.schedule);
    rosterMemberIds = MemberIds.parse(value.rosterMemberIds);
  } catch (error) {
    throw new DomainValidationError([error instanceof Error ? error.message : String(error)]);
  }
  if (rosterMemberIds.length !== 3) {
    throw new DomainValidationError(['enumeration roster must contain exactly three participants']);
  }
  const roster = new Set(rosterMemberIds);
  if (schedule.duties.some(duty => duty.qualifiedMemberIds.some(id => !roster.has(id)))) {
    throw new DomainValidationError(['duty qualifications must belong to the enumeration roster']);
  }
  const [firstDuty, secondDuty] = [...schedule.duties].sort((left, right) => compareText(left.id, right.id));
  if (!firstDuty || !secondDuty) throw new DomainValidationError(['schedule requires two duties']);
  const plans: StructuralPlan[] = [];
  for (const meeting of schedule.slots) {
    if (schedule.duties.some(duty => intervalsOverlap(meeting.interval, duty.interval))) continue;
    for (const firstOwner of firstDuty.qualifiedMemberIds) {
      for (const secondOwner of secondDuty.qualifiedMemberIds) {
        if (firstOwner === secondOwner) continue;
        const facts = PublicPlanFacts.parse({
          meeting,
          assignments: [
            { duty: firstDuty, participantId: firstOwner },
            { duty: secondDuty, participantId: secondOwner },
          ],
        });
        plans.push({ stableId: stablePlanId(facts), facts });
        if (plans.length > MAX_STRUCTURAL_PLANS) {
          throw new DomainValidationError([`candidate domain exceeds ${MAX_STRUCTURAL_PLANS} structural plans`]);
        }
      }
    }
  }
  return plans.sort((left, right) => compareText(left.stableId, right.stableId));
}
