import type {
  ConfirmedInputs,
  ExceptionScope,
  Interval,
  Participant,
  Policy,
  PublicPlanFacts,
  Schedule,
} from '@deal-table/contracts';

export type ExceptionStatus = 'ACTIVE' | 'DECLINED' | 'REVOKED' | 'EXPIRED' | 'SUPERSEDED';

/** Trusted, current application snapshot. B02 owns loading the current record version. */
export interface OwnedExceptionGrant {
  readonly id: string;
  readonly version: number;
  readonly ownerMemberId: string;
  readonly scope: ExceptionScope;
  readonly status: ExceptionStatus;
}

/**
 * availabilityReview says which dated intervals the owner explicitly assessed.
 * It is separate from HARD_AVAILABILITY so absence can remain unknown rather
 * than being silently interpreted as unavailability.
 */
export interface OwnerSolverInputs {
  readonly ownerMemberId: string;
  readonly confirmedInputs: ConfirmedInputs;
  readonly availabilityReview: {
    readonly contextToken: string;
    readonly inputRevision: number;
    readonly intervals: readonly Interval[];
  };
}

export interface SolveDecisionInput {
  readonly roomId: string;
  readonly contextToken: string;
  readonly decisionRevision: number;
  readonly policy: Policy;
  /** Explicit application clock value. The solver never reads system time. */
  readonly now: string;
  readonly schedule: Schedule;
  readonly roster: readonly Participant[];
  readonly owners: readonly OwnerSolverInputs[];
  readonly exceptionGrants: readonly OwnedExceptionGrant[];
}

export interface StructuralPlan {
  /** Reversible encoding of all public plan facts, used only as a stable tie-breaker. */
  readonly stableId: string;
  readonly facts: PublicPlanFacts;
}

export interface RequiredGrantReference {
  readonly id: string;
  readonly version: number;
  readonly ownerMemberId: string;
}

export interface FeasiblePlan extends StructuralPlan {
  /** Server-only dependency metadata. Never spread a FeasiblePlan into a public DTO. */
  readonly requiredGrants: readonly RequiredGrantReference[];
}

export interface PlanRanking {
  readonly totalInconvenience: number;
  readonly maximumLoad: number;
  readonly loadSpread: number;
}

export interface RankedPlan extends FeasiblePlan {
  /** Contains private declared-cost-derived values and is server-only. */
  readonly ranking: PlanRanking;
}

export type ClarificationCode =
  | 'UNSUPPORTED_MEETING_DURATION'
  | 'UNCONFIRMED_INPUTS'
  | 'STALE_CONFIRMED_INPUTS'
  | 'UNKNOWN_AVAILABILITY'
  | 'MISSING_DUTY_COST';

export interface Clarification {
  readonly code: ClarificationCode;
  readonly ownerMemberId?: string;
  readonly interval?: Interval;
  readonly dutyId?: string;
}

interface SolveBase {
  readonly structuralPlans: readonly StructuralPlan[];
}

export type SolveDecisionResult =
  | (SolveBase & {
    readonly status: 'NEEDS_CLARIFICATION';
    readonly clarifications: readonly Clarification[];
  })
  | (SolveBase & {
    readonly status: 'NO_AGREEMENT';
    readonly feasiblePlans: readonly [];
  })
  | (SolveBase & {
    readonly status: 'SOLVED';
    readonly feasiblePlans: readonly FeasiblePlan[];
    readonly rankedPlans: readonly RankedPlan[];
    readonly selectedPlan: RankedPlan;
  });

export class DomainValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid solver input: ${issues.join('; ')}`);
    this.name = 'DomainValidationError';
    this.issues = [...issues];
  }
}
