import type { TrustedPrincipal } from './types.ts';

export type ModelJobKind = 'ARCHITECT' | 'OWNER' | 'NEGOTIATION';
/** Static server stages only. No request IDs, subjects, payloads, paths or error text. */
export const MODEL_FAILURE_STAGES = [
  'PROVIDER', 'MODEL_DEADLINE', 'BUDGET_BLOCKED', 'BUDGET_EXHAUSTED', 'TOOL_ENVELOPE', 'TOOL_OUTPUT', 'ARCHITECT_CALL', 'ARCHITECT_FIELDS',
  'ARCHITECT_REQUIREMENTS', 'ARCHITECT_DEFINITION', 'ARCHITECT_SCHEMA', 'ARCHITECT_PRIVATE_FIELDS', 'ARCHITECT_OPTIONS', 'ARCHITECT_PUBLIC_SCHEMA',
  'NEGOTIATION_KERNEL_REJECTION', 'NEGOTIATION_OUTPUT_ENVELOPE', 'NEGOTIATION_QUESTION_INTENTS', 'NEGOTIATION_QUESTION_COVERAGE', 'NEGOTIATION_PUBLIC_VALUES', 'NEGOTIATION_PERMISSION_DEPENDENCIES', 'NEGOTIATION_CANDIDATE_SCHEMA', 'NEGOTIATION_CATALOG_MISMATCH', 'NEGOTIATION_VALIDATION_EXCEPTION', 'NEGOTIATION_MODEL_ERROR',
  'SCENARIO_DEFINITION', 'SCENARIO_CLARIFICATION', 'SCENARIO_PERSISTENCE', 'SCENARIO_READBACK',
] as const;
export interface ModelFailureDiagnostic {
  kind: ModelJobKind;
  stage: typeof MODEL_FAILURE_STAGES[number];
}
export function reportModelFailure(
  diagnostic: ((value: ModelFailureDiagnostic) => void) | undefined,
  kind: ModelJobKind, stage: ModelFailureDiagnostic['stage'],
): void {
  try { diagnostic?.({ kind, stage }); } catch { /* Diagnostics have no authority or retry effects. */ }
}
/** Server-created capability; never serialized into a queue message or model prompt. */
export interface ModelInvocation {
  expiresAt: number;
  assertCurrent(): Promise<void>;
  signal?: AbortSignal;
}
/** Checked inside the same transaction that applies the model's output. */
export interface ModelCommitGuard {
  principal: TrustedPrincipal | null;
  controlVersion: number;
  expiresAt: number;
  isEnabled?: () => boolean;
}
export interface ModelJobRunner {
  run(kind: ModelJobKind, invocation: ModelInvocation, task: (signal: AbortSignal) => Promise<unknown>): Promise<unknown>;
}
