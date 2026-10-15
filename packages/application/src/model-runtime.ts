import type { TrustedPrincipal } from './types.ts';

export type ModelJobKind = 'ARCHITECT' | 'OWNER' | 'NEGOTIATION';
/** Static stages and bounded schema metadata only. Never raw values, subjects or error text. */
export const MODEL_FAILURE_STAGES = [
  'PROVIDER', 'PROVIDER_ACCESS_DENIED', 'PROVIDER_INTERNAL', 'PROVIDER_MODEL_ERROR', 'PROVIDER_NOT_READY',
  'PROVIDER_TIMEOUT', 'PROVIDER_NOT_FOUND', 'PROVIDER_UNAVAILABLE', 'PROVIDER_THROTTLED', 'PROVIDER_VALIDATION',
  'MODEL_DEADLINE', 'BUDGET_BLOCKED', 'BUDGET_EXHAUSTED', 'TOOL_ENVELOPE', 'TOOL_OUTPUT', 'ARCHITECT_CALL', 'ARCHITECT_FIELDS',
  'ARCHITECT_WIRE_SCHEMA', 'ARCHITECT_REQUIREMENTS', 'ARCHITECT_DEFINITION', 'ARCHITECT_SCHEMA', 'ARCHITECT_SCHEMA_VARIABLES', 'ARCHITECT_SCHEMA_RULES', 'ARCHITECT_SCHEMA_OTHER', 'ARCHITECT_PRIVATE_FIELDS', 'ARCHITECT_OPTIONS', 'ARCHITECT_PUBLIC_SCHEMA',
  'ARCHITECT_RULE_FIELDS', 'ARCHITECT_RULE_REFERENCE', 'ARCHITECT_RULE_VALUE', 'ARCHITECT_RULE_DUPLICATE',
  'NEGOTIATION_KERNEL_REJECTION', 'NEGOTIATION_OUTPUT_ENVELOPE', 'NEGOTIATION_QUESTION_INTENTS', 'NEGOTIATION_QUESTION_COVERAGE', 'NEGOTIATION_PUBLIC_VALUES', 'NEGOTIATION_PERMISSION_DEPENDENCIES', 'NEGOTIATION_CANDIDATE_SCHEMA', 'NEGOTIATION_CATALOG_MISMATCH', 'NEGOTIATION_VALIDATION_EXCEPTION', 'NEGOTIATION_MODEL_ERROR',
  'SCENARIO_DEFINITION', 'SCENARIO_CLARIFICATION', 'SCENARIO_PERSISTENCE', 'SCENARIO_READBACK',
] as const;
export interface ModelFailureDiagnostic {
  kind: ModelJobKind;
  stage: typeof MODEL_FAILURE_STAGES[number];
  validation?: ModelValidationIssue[];
}
const validationFields = new Set(('NUMBER MONEY PERCENTAGE DATE DATETIME DURATION BOOLEAN ENUM ENUM_SET PARTICIPANT COMPARE IN RANGE SUM_EQUALS ALL_DIFFERENT MUTUALLY_EXCLUSIVE IMPLIES title description variables rules clarificationQuestions participantInformationRequirements '
  + 'schemaVersion decisionId frameVersion semanticVersion contextToken participants requiredParticipantIds '
  + 'id type label required visibility ownerParticipantId options participantIds unitCode scale currencyCode minorUnit displayTimeZone unit allowedValues '
  + 'operator variableId comparison value values minimum maximum includeMinimum includeMaximum variableIds target maximumSelected antecedent consequent '
  + 'coefficient amountMinor basisPoints date instant seconds optionId optionIds participantId displayName requiredForApproval question purpose kind').split(' '));
const validationCodes = new Set(['invalid_type', 'invalid_value', 'invalid_union', 'unrecognized_keys', 'too_small', 'too_big', 'invalid_format', 'not_multiple_of', 'custom']);
const valueTypes = new Set(['string', 'number', 'boolean', 'object', 'array', 'null', 'missing', 'integer', 'int', 'unknown']);
export interface ModelValidationIssue {
  path: (string | number)[]; code: string; received: string; expected?: string;
  unexpectedFields?: string[]; unrecognizedFieldCount?: number;
}
const safeField = (value: PropertyKey): string | number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 65536
  ? value : typeof value === 'string' && validationFields.has(value) ? value : '_unrecognized';
/** Traverse only to classify the value. Never serialize inputs or framework error messages. */
export function modelValidationIssues(issues: readonly { code: string; path: readonly PropertyKey[]; expected?: unknown; keys?: readonly string[] }[], input: unknown): ModelValidationIssue[] {
  return issues.slice(0, 12).map(issue => {
    let actual = input;
    for (const key of issue.path) actual = actual !== null && typeof actual === 'object' && Object.hasOwn(actual, key)
      ? (actual as Record<PropertyKey, unknown>)[key] : undefined;
    const received = actual === undefined ? 'missing' : actual === null ? 'null' : Array.isArray(actual) ? 'array' : typeof actual;
    return { path: issue.path.slice(0, 12).map(safeField), code: validationCodes.has(issue.code) ? issue.code : 'custom',
      received: valueTypes.has(received) ? received : 'unknown',
      ...(typeof issue.expected === 'string' && valueTypes.has(issue.expected) ? { expected: issue.expected } : {}),
      ...(issue.keys ? { unexpectedFields: issue.keys.slice(0, 12).map(key => String(safeField(key))),
        unrecognizedFieldCount: Math.min(issue.keys.length, 65536) } : {}) };
  });
}
/** Reconstruct an allowlist even for injected diagnostic callbacks. */
export function safeModelDiagnostic(value: ModelFailureDiagnostic): ModelFailureDiagnostic | null {
  if (!value || Object.keys(value).some(key => !['kind', 'stage', 'validation'].includes(key)) || !['ARCHITECT', 'OWNER', 'NEGOTIATION'].includes(value.kind) || !MODEL_FAILURE_STAGES.includes(value.stage)) return null;
  const validation = Array.isArray(value.validation) ? value.validation.slice(0, 12).map(issue => ({
    path: Array.isArray(issue.path) ? issue.path.slice(0, 12).map(safeField) : [],
    code: validationCodes.has(issue.code) ? issue.code : 'custom', received: valueTypes.has(issue.received) ? issue.received : 'unknown',
    ...(issue.expected && valueTypes.has(issue.expected) ? { expected: issue.expected } : {}),
    ...(Array.isArray(issue.unexpectedFields) ? { unexpectedFields: issue.unexpectedFields.slice(0, 12).map(key => String(safeField(key))),
      unrecognizedFieldCount: Number.isSafeInteger(issue.unrecognizedFieldCount) && Number(issue.unrecognizedFieldCount) >= 0 ? Math.min(Number(issue.unrecognizedFieldCount), 65536) : 0 } : {}),
  })) : undefined;
  return { kind: value.kind, stage: value.stage, ...(validation?.length ? { validation } : {}) };
}
export function reportModelFailure(
  diagnostic: ((value: ModelFailureDiagnostic) => void) | undefined,
  kind: ModelJobKind, stage: ModelFailureDiagnostic['stage'], validation?: ModelValidationIssue[],
): void {
  try { const value = safeModelDiagnostic({ kind, stage, ...(validation ? { validation } : {}) }); if (value) diagnostic?.(value); } catch { /* Diagnostics have no authority or retry effects. */ }
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
