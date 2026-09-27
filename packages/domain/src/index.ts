export { enumerateStructuralPlans, stablePlanId } from './enumerate.ts';
export { solveDecision } from './solve.ts';
export { DomainValidationError } from './types.ts';
export type {
  Clarification,
  ClarificationCode,
  FeasiblePlan,
  OwnedExceptionGrant,
  OwnerSolverInputs,
  PlanRanking,
  RankedPlan,
  RequiredGrantReference,
  SolveDecisionInput,
  SolveDecisionResult,
  StructuralPlan,
} from './types.ts';
export {
  evaluateKnownEnoughCandidate,
  MAX_ACTIVE_CONFIRMED_CONSTRAINTS,
  MAX_KERNEL_INPUT_BYTES,
  MAX_KERNEL_OPERATIONS,
} from './known-enough-kernel.ts';
export type {
  KnownEnoughKernelDiagnostic,
  KnownEnoughKernelDiagnosticCode,
  KnownEnoughKernelResult,
  KnownEnoughKernelStatus,
} from './known-enough-kernel.ts';
