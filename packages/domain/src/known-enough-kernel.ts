import { KnownEnough as KE } from '@deal-table/contracts';

export const MAX_KERNEL_INPUT_BYTES = 360 * 1024;
export const MAX_ACTIVE_CONFIRMED_CONSTRAINTS = 64;
export const MAX_KERNEL_OPERATIONS = 1_000_000;

const MAX_DIAGNOSTICS = 64;
const MAX_UNRESOLVED_CONDITIONS = KE.MAX_DECISION_PARTICIPANTS * 16;
const MAX_RETAINED_PERMISSIONS = 192;
const MAX_RETAINED_CONSTRAINTS = KE.MAX_DECISION_PARTICIPANTS * KE.MAX_PRIVATE_CONSTRAINTS;
const KERNEL_ID = /^[A-Za-z0-9_-]{1,80}$/;
const KERNEL_INPUT_KEYS = [
  'definition', 'candidate', 'publicProposal', 'confirmedConstraints', 'frameConfirmations',
  'readyParticipantIds', 'unresolvedConditionIds', 'negotiationPermissions',
  'disclosurePermissions', 'now',
] as const;
const CANDIDATE_KEYS = [
  'schemaVersion', 'proposalId', 'decisionId', 'semanticVersion', 'contextToken',
  'proposalVersion', 'values', 'validation', 'permissionDependencies', 'createdAt',
] as const;

export type KnownEnoughKernelStatus = 'VALID' | 'INVALID' | 'NEEDS_CLARIFICATION' | 'NEEDS_PERMISSION';

export type KnownEnoughKernelDiagnosticCode =
  | 'INPUT_INVALID'
  | 'INPUT_CAPACITY_EXCEEDED'
  | 'CONTEXT_STALE'
  | 'FRAME_CONFIRMATION_REQUIRED'
  | 'PARTICIPANT_INPUT_NOT_READY'
  | 'UNRESOLVED_CONDITION'
  | 'MISSING_REQUIRED_VALUE'
  | 'INVALID_VALUE'
  | 'INVALID_RULE'
  | 'RULE_VALUE_UNKNOWN'
  | 'RULE_FAILED'
  | 'NEGOTIABLE_PERMISSION_REQUIRED'
  | 'PERMISSION_STALE_OR_REVOKED'
  | 'PERMISSION_ADJUSTMENT_NOT_APPLICABLE'
  | 'PERMISSION_DEPENDENCY_UNUSED'
  | 'PUBLIC_PROPOSAL_MISMATCH'
  | 'PUBLIC_HASH_MISMATCH'
  | 'DISCLOSURE_SCOPE_INVALID'
  | 'DISCLOSURE_TEXT_HASH_INVALID';

export interface KnownEnoughKernelDiagnostic {
  readonly code: KnownEnoughKernelDiagnosticCode;
  readonly ruleId?: string;
  readonly constraintId?: string;
  readonly ownerParticipantId?: string;
  readonly variableId?: string;
  readonly permissionId?: string;
}

export interface KnownEnoughKernelResult {
  readonly status: KnownEnoughKernelStatus;
  /** The only fields a public response may copy from this result. */
  readonly publicResult: { readonly status: KnownEnoughKernelStatus };
  /** Internal bounded diagnostics. They contain identifiers and codes only. */
  readonly diagnostics: readonly KnownEnoughKernelDiagnostic[];
  readonly checkedRuleIds: readonly string[];
  readonly failedRuleIds: readonly string[];
  readonly unknownRuleIds: readonly string[];
  readonly workUnits: number;
}

interface KernelInput {
  readonly definition: KE.DecisionDefinition;
  readonly candidate: KE.CandidateProposal;
  readonly publicProposal: KE.PublicCandidateProposal;
  readonly confirmedConstraints: readonly KE.ConfirmedConstraint[];
  readonly frameConfirmations: readonly KE.FrameConfirmation[];
  readonly readyParticipantIds: readonly string[];
  readonly unresolvedConditionIds: readonly string[];
  readonly negotiationPermissions: readonly KE.NegotiationPermission[];
  readonly disclosurePermissions: readonly KE.DisclosurePermission[];
  readonly now: string;
}

type Variable = KE.DecisionDefinition['variables'][number];
type Value = KE.DecisionValue;
type Rule = KE.ValidationRule;
type Constraint = KE.ConfirmedConstraint;
type PermissionDependency = KE.CandidateProposal['permissionDependencies'][number];
type RuleResult = 'TRUE' | 'FALSE' | 'UNKNOWN' | 'CAPACITY';

const EMPTY_EVALUATION = {
  status: 'VALID' as const,
  checkedRuleIds: [] as string[],
  failedRuleIds: [] as string[],
  unknownRuleIds: [] as string[],
  unsupportedConditionIds: [] as string[],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function parseStringList(value: unknown, max: number): string[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const output: string[] = [];
  const unique = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || !KERNEL_ID.test(item) || unique.has(item)) return null;
    output.push(item);
    unique.add(item);
  }
  return output;
}

function serializedByteLength(value: unknown): number | null {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === 'string' ? new TextEncoder().encode(serialized).byteLength : null;
  } catch {
    return null;
  }
}

function parseCandidateIgnoringClaim(value: unknown): KE.CandidateProposal | null {
  if (!isRecord(value) || !hasExactKeys(value, CANDIDATE_KEYS) || !Object.hasOwn(value, 'validation')) return null;
  try {
    // Candidate validation is an untrusted claim. Preserve the required wire field, but
    // replace it before schema validation so a contradictory claim cannot affect outcome.
    return KE.CandidateProposal.parse({ ...value, validation: EMPTY_EVALUATION });
  } catch {
    return null;
  }
}

function parseKernelInput(input: unknown): { input: KernelInput | null; tooLarge: boolean } {
  const byteLength = serializedByteLength(input);
  if (byteLength === null) return { input: null, tooLarge: false };
  if (byteLength > MAX_KERNEL_INPUT_BYTES) return { input: null, tooLarge: true };
  if (!isRecord(input) || !hasExactKeys(input, KERNEL_INPUT_KEYS)) return { input: null, tooLarge: false };

  const candidate = parseCandidateIgnoringClaim(input.candidate);
  const readyParticipantIds = parseStringList(input.readyParticipantIds, KE.MAX_DECISION_PARTICIPANTS);
  const unresolvedConditionIds = parseStringList(input.unresolvedConditionIds, MAX_UNRESOLVED_CONDITIONS);
  if (!candidate || !readyParticipantIds || !unresolvedConditionIds) return { input: null, tooLarge: false };

  try {
    const definition = KE.DecisionDefinition.parse(input.definition);
    const publicProposal = KE.PublicCandidateProposal.parse(input.publicProposal);
    if (!Array.isArray(input.confirmedConstraints)
      || input.confirmedConstraints.length > MAX_RETAINED_CONSTRAINTS
      || !Array.isArray(input.frameConfirmations)
      || input.frameConfirmations.length > KE.MAX_DECISION_PARTICIPANTS
      || !Array.isArray(input.negotiationPermissions)
      || input.negotiationPermissions.length > MAX_RETAINED_PERMISSIONS
      || !Array.isArray(input.disclosurePermissions)
      || input.disclosurePermissions.length > MAX_RETAINED_PERMISSIONS
      || typeof input.now !== 'string') return { input: null, tooLarge: true };
    const activeCount = input.confirmedConstraints.reduce((count, item) =>
      count + (isRecord(item) && item.status === 'ACTIVE' ? 1 : 0), 0);
    if (activeCount > MAX_ACTIVE_CONFIRMED_CONSTRAINTS) return { input: null, tooLarge: true };

    const confirmedConstraints = input.confirmedConstraints.map(item => KE.ConfirmedConstraint.parse(item));
    const frameConfirmations = input.frameConfirmations.map(item => KE.FrameConfirmation.parse(item));
    const negotiationPermissions = input.negotiationPermissions.map(item => KE.NegotiationPermission.parse(item));
    const disclosurePermissions = input.disclosurePermissions.map(item => KE.DisclosurePermission.parse(item));
    // Reuse the canonical UTC instant schema without adding another contract surface.
    KE.FrameConfirmation.parse({
      decisionId: definition.decisionId,
      participantId: definition.participants[0]!.id,
      frameVersion: definition.frameVersion,
      semanticVersion: definition.semanticVersion,
      contextToken: definition.contextToken,
      confirmedAt: input.now,
    });
    if (new Set(frameConfirmations.map(item => item.participantId)).size !== frameConfirmations.length
      || new Set(negotiationPermissions.map(item => item.permissionId)).size !== negotiationPermissions.length
      || new Set(disclosurePermissions.map(item => item.permissionId)).size !== disclosurePermissions.length)
      return { input: null, tooLarge: false };

    return {
      input: {
        definition, candidate, publicProposal, confirmedConstraints, frameConfirmations,
        readyParticipantIds, unresolvedConditionIds, negotiationPermissions,
        disclosurePermissions, now: input.now,
      },
      tooLarge: false,
    };
  } catch {
    return { input: null, tooLarge: false };
  }
}

function sameDomain(left: Variable, right: Variable): boolean {
  if (left.type !== right.type) return false;
  if (left.type === 'NUMBER' && right.type === 'NUMBER') return left.unitCode === right.unitCode && left.scale === right.scale;
  if (left.type === 'MONEY' && right.type === 'MONEY') return left.currencyCode === right.currencyCode && left.minorUnit === right.minorUnit;
  if (left.type === 'DATETIME' && right.type === 'DATETIME') return left.displayTimeZone === right.displayTimeZone;
  if (left.type === 'DURATION' && right.type === 'DURATION') return left.unit === right.unit;
  return true;
}

function variableAccepts(variable: Variable, value: Value): boolean {
  if (variable.type !== value.type) return false;
  switch (variable.type) {
    case 'NUMBER': return value.type === 'NUMBER' && value.unitCode === variable.unitCode && value.scale === variable.scale;
    case 'MONEY': return value.type === 'MONEY' && value.currencyCode === variable.currencyCode && value.minorUnit === variable.minorUnit;
    case 'PERCENTAGE':
    case 'DATE':
    case 'BOOLEAN': return true;
    case 'DATETIME': return value.type === 'DATETIME' && value.displayTimeZone === variable.displayTimeZone;
    case 'DURATION': return value.type === 'DURATION';
    case 'ENUM': return value.type === 'ENUM' && variable.options.some(option => option.id === value.optionId);
    case 'ENUM_SET': return value.type === 'ENUM_SET' && value.optionIds.every(id => variable.options.some(option => option.id === id));
    case 'PARTICIPANT': return value.type === 'PARTICIPANT' && variable.participantIds.includes(value.participantId);
  }
}

function comparable(value: Value): bigint | string | null {
  switch (value.type) {
    case 'NUMBER': return BigInt(value.coefficient) * (10n ** BigInt(6 - value.scale));
    case 'MONEY': return BigInt(value.amountMinor);
    case 'PERCENTAGE': return BigInt(value.basisPoints);
    case 'DATE': return value.date;
    case 'DATETIME': return value.instant;
    case 'DURATION': return BigInt(value.seconds);
    default: return null;
  }
}

function compareValues(left: Value, right: Value): number | null {
  const a = comparable(left);
  const b = comparable(right);
  if (a === null || b === null || typeof a !== typeof b) return null;
  if (typeof a === 'bigint' && typeof b === 'bigint') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  return null;
}

function ruleVariableIds(rule: Rule): string[] {
  switch (rule.operator) {
    case 'COMPARE':
    case 'IN':
    case 'RANGE': return [rule.variableId];
    case 'SUM_EQUALS':
    case 'ALL_DIFFERENT':
    case 'MUTUALLY_EXCLUSIVE': return rule.variableIds;
    case 'IMPLIES': return [rule.antecedent.variableId, rule.consequent.variableId];
  }
}

function canonicalValue(value: Value): string {
  if (value.type === 'ENUM_SET') return JSON.stringify({ ...value, optionIds: [...value.optionIds].sort() });
  return JSON.stringify(value);
}

function ownerCanReadRule(rule: Rule, ownerParticipantId: string, variables: ReadonlyMap<string, Variable>): boolean {
  return ruleVariableIds(rule).every(id => {
    const variable = variables.get(id);
    return variable !== undefined
      && (variable.visibility === 'PUBLIC' || variable.ownerParticipantId === ownerParticipantId);
  });
}

function validateRule(rule: Rule, variables: ReadonlyMap<string, Variable>): string | null {
  const refs = ruleVariableIds(rule);
  if (refs.some(id => !variables.has(id))) return 'INVALID_RULE';
  const accepts = (variableId: string, value: Value) => {
    const variable = variables.get(variableId);
    return variable !== undefined && variableAccepts(variable, value);
  };
  const ordered = (variableId: string) => {
    const variable = variables.get(variableId);
    return variable !== undefined && ['NUMBER', 'MONEY', 'PERCENTAGE', 'DATE', 'DATETIME', 'DURATION'].includes(variable.type);
  };
  switch (rule.operator) {
    case 'COMPARE':
      if (!accepts(rule.variableId, rule.value)) return 'INVALID_RULE';
      if (rule.comparison !== 'EQ' && rule.comparison !== 'NE' && !ordered(rule.variableId)) return 'INVALID_RULE';
      return null;
    case 'IN': {
      if (rule.values.some(value => !accepts(rule.variableId, value))) return 'INVALID_RULE';
      if (new Set(rule.values.map(canonicalValue)).size !== rule.values.length) return 'INVALID_RULE';
      return null;
    }
    case 'RANGE': {
      if (!ordered(rule.variableId) || !accepts(rule.variableId, rule.minimum) || !accepts(rule.variableId, rule.maximum)) return 'INVALID_RULE';
      const order = compareValues(rule.minimum, rule.maximum);
      if (order === null || order > 0 || (order === 0 && (!rule.includeMinimum || !rule.includeMaximum))) return 'INVALID_RULE';
      return null;
    }
    case 'SUM_EQUALS': {
      const firstId = rule.variableIds[0];
      const first = firstId ? variables.get(firstId) : undefined;
      if (!first || !['NUMBER', 'MONEY', 'PERCENTAGE'].includes(first.type)
        || !accepts(first.id, rule.target)
        || rule.variableIds.some(id => {
          const variable = variables.get(id);
          return !variable || !sameDomain(first, variable);
        })) return 'INVALID_RULE';
      return null;
    }
    case 'ALL_DIFFERENT': {
      const firstId = rule.variableIds[0];
      const first = firstId ? variables.get(firstId) : undefined;
      if (!first || first.type === 'ENUM_SET'
        || rule.variableIds.some(id => {
          const variable = variables.get(id);
          return !variable || variable.type === 'ENUM_SET' || !sameDomain(first, variable);
        })) return 'INVALID_RULE';
      return null;
    }
    case 'MUTUALLY_EXCLUSIVE':
      return rule.maximumSelected >= rule.variableIds.length
        || rule.variableIds.some(id => variables.get(id)?.type !== 'BOOLEAN') ? 'INVALID_RULE' : null;
    case 'IMPLIES':
      return accepts(rule.antecedent.variableId, rule.antecedent.value)
        && accepts(rule.consequent.variableId, rule.consequent.value) ? null : 'INVALID_RULE';
  }
}

function makeResult(
  status: KnownEnoughKernelStatus,
  diagnostics: readonly KnownEnoughKernelDiagnostic[],
  checkedRuleIds: readonly string[] = [],
  failedRuleIds: readonly string[] = [],
  unknownRuleIds: readonly string[] = [],
  workUnits = 0,
): KnownEnoughKernelResult {
  return {
    status,
    publicResult: { status },
    diagnostics: diagnostics.slice(0, MAX_DIAGNOSTICS),
    checkedRuleIds,
    failedRuleIds,
    unknownRuleIds,
    workUnits,
  };
}

class Evaluation {
  private count = 0;
  private readonly diagnostics: KnownEnoughKernelDiagnostic[] = [];
  private readonly diagnosticKeys = new Set<string>();
  private readonly checked: string[] = [];
  private readonly failed: string[] = [];
  private readonly unknown: string[] = [];
  private readonly enumSets = new WeakMap<object, Set<string>>();
  private invalid = false;
  private clarification = false;
  private needsPermission = false;

  constructor(private readonly input: KernelInput) {}

  private add(code: KnownEnoughKernelDiagnosticCode, ids: Partial<KnownEnoughKernelDiagnostic> = {}): void {
    const item = { code, ...ids };
    const key = JSON.stringify(item);
    if (this.diagnosticKeys.has(key)) return;
    this.diagnosticKeys.add(key);
    if (this.diagnostics.length < MAX_DIAGNOSTICS) this.diagnostics.push(item);
    else this.clarification = true;
  }

  private work(amount = 1): boolean {
    if (this.count + amount <= MAX_KERNEL_OPERATIONS) {
      this.count += amount;
      return true;
    }
    this.count = MAX_KERNEL_OPERATIONS;
    this.clarification = true;
    this.add('INPUT_CAPACITY_EXCEEDED');
    return false;
  }

  private invalidContext(): void {
    this.clarification = true;
    this.add('CONTEXT_STALE');
  }

  private checkContextAndReadiness(): void {
    const { definition, candidate } = this.input;
    if (candidate.decisionId !== definition.decisionId
      || candidate.contextToken !== definition.contextToken
      || candidate.semanticVersion !== definition.semanticVersion
      || candidate.proposalVersion < 1) this.invalidContext();

    const participantIds = new Set(definition.participants.map(participant => participant.id));
    const required = new Set(definition.requiredParticipantIds);
    const confirmations = new Map(this.input.frameConfirmations.map(item => [item.participantId, item]));
    for (const confirmation of this.input.frameConfirmations) {
      if (!participantIds.has(confirmation.participantId)
        || confirmation.decisionId !== definition.decisionId
        || confirmation.frameVersion !== definition.frameVersion
        || confirmation.semanticVersion !== definition.semanticVersion
        || confirmation.contextToken !== definition.contextToken
        || Date.parse(confirmation.confirmedAt) > Date.parse(this.input.now)) {
        this.clarification = true;
        this.add('CONTEXT_STALE', { ownerParticipantId: confirmation.participantId });
      }
    }
    for (const participantId of required) {
      if (!confirmations.has(participantId)) {
        this.clarification = true;
        this.add('FRAME_CONFIRMATION_REQUIRED', { ownerParticipantId: participantId });
      }
      if (!this.input.readyParticipantIds.includes(participantId)) {
        this.clarification = true;
        this.add('PARTICIPANT_INPUT_NOT_READY', { ownerParticipantId: participantId });
      }
    }
    if (this.input.readyParticipantIds.some(id => !participantIds.has(id))) {
      this.invalid = true;
      this.add('INPUT_INVALID');
    }
    if (this.input.unresolvedConditionIds.length > 0) {
      this.clarification = true;
      this.add('UNRESOLVED_CONDITION');
    }
  }

  private checkCandidateValues(variables: ReadonlyMap<string, Variable>): Map<string, Value> {
    const values = new Map<string, Value>();
    for (const assignment of this.input.candidate.values) {
      const variable = variables.get(assignment.variableId);
      if (!variable || !variableAccepts(variable, assignment.value)) {
        this.invalid = true;
        this.add('INVALID_VALUE', { variableId: assignment.variableId });
        continue;
      }
      values.set(assignment.variableId, assignment.value);
    }
    for (const variable of this.input.definition.variables) {
      if (variable.required && !values.has(variable.id)) {
        this.clarification = true;
        this.add('MISSING_REQUIRED_VALUE', { variableId: variable.id });
      }
    }
    return values;
  }

  private compareEqual(left: Value, right: Value): boolean | null {
    if (!this.work()) return null;
    if (left.type !== right.type) return false;
    switch (left.type) {
      case 'NUMBER': return right.type === 'NUMBER' && left.coefficient === right.coefficient
        && left.scale === right.scale && left.unitCode === right.unitCode;
      case 'MONEY': return right.type === 'MONEY' && left.amountMinor === right.amountMinor
        && left.currencyCode === right.currencyCode && left.minorUnit === right.minorUnit;
      case 'PERCENTAGE': return right.type === 'PERCENTAGE' && left.basisPoints === right.basisPoints;
      case 'DATE': return right.type === 'DATE' && left.date === right.date;
      case 'DATETIME': return right.type === 'DATETIME' && left.instant === right.instant
        && left.displayTimeZone === right.displayTimeZone;
      case 'DURATION': return right.type === 'DURATION' && left.seconds === right.seconds;
      case 'BOOLEAN': return right.type === 'BOOLEAN' && left.value === right.value;
      case 'ENUM': return right.type === 'ENUM' && left.optionId === right.optionId;
      case 'PARTICIPANT': return right.type === 'PARTICIPANT' && left.participantId === right.participantId;
      case 'ENUM_SET': {
        if (right.type !== 'ENUM_SET' || left.optionIds.length !== right.optionIds.length) return false;
        let rightIds = this.enumSets.get(right);
        if (!rightIds) {
          rightIds = new Set<string>();
          for (const optionId of right.optionIds) {
            if (!this.work()) return null;
            rightIds.add(optionId);
          }
          this.enumSets.set(right, rightIds);
        }
        for (const optionId of left.optionIds) {
          if (!this.work()) return null;
          if (!rightIds.has(optionId)) return false;
        }
        return true;
      }
    }
  }

  private evaluate(rule: Rule, values: ReadonlyMap<string, Value>): RuleResult {
    if (!this.work(ruleVariableIds(rule).length)) return 'CAPACITY';
    const value = (variableId: string) => values.get(variableId);
    const equal = (left: Value, right: Value): boolean | null => this.compareEqual(left, right);
    const compare = (left: Value, right: Value): number | null => {
      if (!this.work()) return null;
      return compareValues(left, right);
    };
    const evaluateLiteral = (condition: { variableId: string; operator: 'EQ' | 'NE'; value: Value }): boolean | null => {
      const actual = value(condition.variableId);
      if (!actual) return null;
      const result = equal(actual, condition.value);
      return result === null ? null : condition.operator === 'EQ' ? result : !result;
    };
    switch (rule.operator) {
      case 'COMPARE': {
        const actual = value(rule.variableId);
        if (!actual) return 'UNKNOWN';
        if (rule.comparison === 'EQ' || rule.comparison === 'NE') {
          const same = equal(actual, rule.value);
          if (same === null) return 'CAPACITY';
          return (rule.comparison === 'EQ' ? same : !same) ? 'TRUE' : 'FALSE';
        }
        const order = compare(actual, rule.value);
        if (order === null) return this.count > MAX_KERNEL_OPERATIONS ? 'CAPACITY' : 'UNKNOWN';
        return (rule.comparison === 'LT' ? order < 0
          : rule.comparison === 'LTE' ? order <= 0
            : rule.comparison === 'GT' ? order > 0 : order >= 0) ? 'TRUE' : 'FALSE';
      }
      case 'IN': {
        const actual = value(rule.variableId);
        if (!actual) return 'UNKNOWN';
        for (const allowed of rule.values) {
          const same = equal(actual, allowed);
          if (same === null) return 'CAPACITY';
          if (same) return 'TRUE';
        }
        return 'FALSE';
      }
      case 'RANGE': {
        const actual = value(rule.variableId);
        if (!actual) return 'UNKNOWN';
        const lower = compare(actual, rule.minimum);
        const upper = compare(actual, rule.maximum);
        if (lower === null || upper === null) return this.count > MAX_KERNEL_OPERATIONS ? 'CAPACITY' : 'UNKNOWN';
        const meetsMinimum = rule.includeMinimum ? lower >= 0 : lower > 0;
        const meetsMaximum = rule.includeMaximum ? upper <= 0 : upper < 0;
        return meetsMinimum && meetsMaximum ? 'TRUE' : 'FALSE';
      }
      case 'SUM_EQUALS': {
        let sum = 0n;
        for (const id of rule.variableIds) {
          if (!this.work()) return 'CAPACITY';
          const item = value(id);
          if (!item) return 'UNKNOWN';
          const scalar = comparable(item);
          if (typeof scalar !== 'bigint') return 'UNKNOWN';
          sum += scalar;
        }
        const target = comparable(rule.target);
        if (typeof target !== 'bigint') return 'UNKNOWN';
        return sum === target ? 'TRUE' : 'FALSE';
      }
      case 'ALL_DIFFERENT': {
        const seen = new Set<string>();
        for (const id of rule.variableIds) {
          if (!this.work()) return 'CAPACITY';
          const item = value(id);
          if (!item) return 'UNKNOWN';
          const identity = canonicalValue(item);
          if (seen.has(identity)) return 'FALSE';
          seen.add(identity);
        }
        return 'TRUE';
      }
      case 'MUTUALLY_EXCLUSIVE': {
        let selected = 0;
        for (const id of rule.variableIds) {
          if (!this.work()) return 'CAPACITY';
          const item = value(id);
          if (!item) return 'UNKNOWN';
          if (item.type !== 'BOOLEAN') return 'UNKNOWN';
          if (item.value && ++selected > rule.maximumSelected) return 'FALSE';
        }
        return 'TRUE';
      }
      case 'IMPLIES': {
        const antecedent = evaluateLiteral(rule.antecedent);
        const consequent = evaluateLiteral(rule.consequent);
        if (antecedent === false || consequent === true) return 'TRUE';
        if (antecedent === true && consequent === false) return 'FALSE';
        return 'UNKNOWN';
      }
    }
  }

  private recordRule(rule: Rule, result: RuleResult, constraint?: Constraint): void {
    const ids = constraint && constraint.kind !== 'PREFERENCE'
      ? { constraintId: constraint.constraintId, ownerParticipantId: constraint.ownerParticipantId }
      : {};
    if (result === 'CAPACITY') {
      this.clarification = true;
      this.add('INPUT_CAPACITY_EXCEEDED', { ruleId: rule.id, ...ids });
      return;
    }
    if (result === 'UNKNOWN') {
      this.clarification = true;
      this.unknown.push(rule.id);
      this.add('RULE_VALUE_UNKNOWN', { ruleId: rule.id, ...ids });
      return;
    }
    this.checked.push(rule.id);
    if (result === 'FALSE') {
      this.failed.push(rule.id);
      this.add('RULE_FAILED', { ruleId: rule.id, ...ids });
      if (!constraint || constraint.kind === 'HARD') this.invalid = true;
    }
  }

  private validateCurrentConstraints(variables: ReadonlyMap<string, Variable>): Constraint[] {
    const definition = this.input.definition;
    const participantIds = new Set(definition.participants.map(participant => participant.id));
    const active: Constraint[] = [];
    const seen = new Set<string>();
    for (const constraint of this.input.confirmedConstraints) {
      if (constraint.status === 'SUPERSEDED') continue;
      active.push(constraint);
      const identity = `${constraint.ownerParticipantId}\u0000${constraint.constraintId}`;
      if (seen.has(identity) || !participantIds.has(constraint.ownerParticipantId)) {
        this.invalid = true;
        this.add('INVALID_RULE', { constraintId: constraint.constraintId, ownerParticipantId: constraint.ownerParticipantId });
        continue;
      }
      seen.add(identity);
      if (constraint.decisionId !== definition.decisionId
        || constraint.semanticVersion !== definition.semanticVersion
        || constraint.contextToken !== definition.contextToken) {
        this.clarification = true;
        this.add('CONTEXT_STALE', { constraintId: constraint.constraintId, ownerParticipantId: constraint.ownerParticipantId });
      }
      if (constraint.kind === 'PREFERENCE') {
        const variable = variables.get(constraint.preference.variableId);
        if (!variable || !ownerCanReadRule({
          id: constraint.constraintId,
          visibility: 'TRUSTED_BACKEND',
          operator: 'COMPARE',
          variableId: constraint.preference.variableId,
          comparison: 'EQ',
          value: constraint.preference.value,
        }, constraint.ownerParticipantId, variables) || !variableAccepts(variable, constraint.preference.value)) {
          this.invalid = true;
          this.add('INVALID_RULE', { constraintId: constraint.constraintId, ownerParticipantId: constraint.ownerParticipantId, variableId: constraint.preference.variableId });
        }
      } else {
        const issue = validateRule(constraint.rule, variables)
          ?? (!ownerCanReadRule(constraint.rule, constraint.ownerParticipantId, variables) ? 'INVALID_RULE' : null);
        if (issue) {
          this.invalid = true;
          this.add(issue as KnownEnoughKernelDiagnosticCode, {
            ruleId: constraint.rule.id,
            constraintId: constraint.constraintId,
            ownerParticipantId: constraint.ownerParticipantId,
          });
        }
      }
    }
    if (active.length > MAX_ACTIVE_CONFIRMED_CONSTRAINTS) {
      this.clarification = true;
      this.add('INPUT_CAPACITY_EXCEEDED');
    }
    return active;
  }

  private async checkNegotiationPermission(
    constraint: Extract<Constraint, { kind: 'HARD' | 'NEGOTIABLE' }>,
    values: ReadonlyMap<string, Value>,
    variables: ReadonlyMap<string, Variable>,
    candidateDependencies: ReadonlyMap<string, PermissionDependency>,
    used: Set<string>,
  ): Promise<boolean> {
    const nowMs = Date.parse(this.input.now);
    for (const permission of this.input.negotiationPermissions) {
      if (permission.constraintId !== constraint.constraintId
        || permission.ownerParticipantId !== constraint.ownerParticipantId
        || permission.constraintVersion !== constraint.constraintVersion) continue;
      const dependency = candidateDependencies.get(permission.permissionId);
      const current = permission.status === 'ACTIVE'
        && permission.decisionId === this.input.definition.decisionId
        && permission.contextToken === this.input.definition.contextToken
        && permission.semanticVersion === this.input.definition.semanticVersion
        && Date.parse(permission.expiresAt) > nowMs
        && dependency !== undefined
        && dependency.permissionVersion === permission.permissionVersion
        && dependency.kind === 'NEGOTIATION'
        && dependency.expiresAt === permission.expiresAt;
      if (!current) continue;
      const invalidRule = validateRule(permission.adjustment, variables)
        ?? (!ownerCanReadRule(permission.adjustment, permission.ownerParticipantId, variables) ? 'INVALID_RULE' : null);
      if (invalidRule) {
        this.invalid = true;
        this.add('INVALID_RULE', {
          ruleId: permission.adjustment.id,
          ownerParticipantId: permission.ownerParticipantId,
          permissionId: permission.permissionId,
        });
        continue;
      }
      const result = this.evaluate(permission.adjustment, values);
      if (result === 'CAPACITY') return false;
      if (result !== 'TRUE') {
        if (result === 'FALSE') this.add('PERMISSION_ADJUSTMENT_NOT_APPLICABLE', {
          ruleId: permission.adjustment.id,
          ownerParticipantId: permission.ownerParticipantId,
          permissionId: permission.permissionId,
        });
        continue;
      }
      used.add(permission.permissionId);
      return true;
    }
    return false;
  }

  private async checkDisclosureDependencies(): Promise<void> {
    const permissionById = new Map(this.input.disclosurePermissions.map(item => [item.permissionId, item]));
    const participantIds = new Set(this.input.definition.participants.map(person => person.id));
    const variables = new Map(this.input.definition.variables.map(variable => [variable.id, variable]));
    const assignmentIds = new Set(this.input.candidate.values.map(item => item.variableId));
    const nowMs = Date.parse(this.input.now);
    for (const dependency of this.input.candidate.permissionDependencies.filter(item => item.kind === 'DISCLOSURE')) {
      const permission = permissionById.get(dependency.permissionId);
      if (!permission || permission.permissionVersion !== dependency.permissionVersion
        || permission.status !== 'ACTIVE'
        || permission.expiresAt !== dependency.expiresAt
        || Date.parse(permission.expiresAt) <= nowMs
        || permission.decisionId !== this.input.definition.decisionId
        || permission.contextToken !== this.input.definition.contextToken
        || permission.semanticVersion !== this.input.definition.semanticVersion
        || permission.proposalId !== this.input.candidate.proposalId
        || permission.proposalVersion !== this.input.candidate.proposalVersion
        || !participantIds.has(permission.ownerParticipantId)
        || permission.audienceParticipantIds.some(id => !participantIds.has(id))) {
        this.needsPermission = true;
        this.add('PERMISSION_STALE_OR_REVOKED', { permissionId: dependency.permissionId });
        continue;
      }
      if (permission.kind === 'EXACT_TEXT') {
        const bytes = new TextEncoder().encode(permission.text);
        try {
          const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
          const textHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
          if (textHash !== permission.textHash) {
            this.needsPermission = true;
            this.add('DISCLOSURE_TEXT_HASH_INVALID', { permissionId: permission.permissionId });
          }
        } catch {
          this.clarification = true;
          this.add('INPUT_CAPACITY_EXCEEDED', { permissionId: permission.permissionId });
        }
      } else {
        const validVariables = permission.variableIds.every(id => {
          const variable = variables.get(id);
          return variable?.visibility === 'CONSENT_REQUIRED'
            && variable.ownerParticipantId === permission.ownerParticipantId
            && assignmentIds.has(id);
        });
        if (!validVariables) {
          this.needsPermission = true;
          this.add('DISCLOSURE_SCOPE_INVALID', { permissionId: permission.permissionId });
        }
      }
    }
  }

  private async checkPublicProposal(): Promise<void> {
    const { definition, candidate, publicProposal } = this.input;
    const expectedFacts = KE.PublicProposalFacts.parse({
      schemaVersion: KE.KE_SCHEMA_VERSION,
      decisionId: definition.decisionId,
      contextToken: definition.contextToken,
      semanticVersion: definition.semanticVersion,
      proposalVersion: candidate.proposalVersion,
      requiredParticipantIds: definition.requiredParticipantIds,
      values: candidate.values.filter(assignment => definition.variables
        .some(variable => variable.id === assignment.variableId && variable.visibility === 'PUBLIC')),
    });
    const stale = publicProposal.proposalId !== candidate.proposalId
      || publicProposal.facts.decisionId !== definition.decisionId
      || publicProposal.facts.contextToken !== definition.contextToken
      || publicProposal.facts.semanticVersion !== definition.semanticVersion
      || publicProposal.facts.proposalVersion !== candidate.proposalVersion
      || publicProposal.createdAt !== candidate.createdAt;
    if (stale) {
      this.clarification = true;
      this.add('PUBLIC_PROPOSAL_MISMATCH');
    }
    if (KE.serializeDecisionProposal(expectedFacts) !== KE.serializeDecisionProposal(publicProposal.facts)) {
      this.invalid = true;
      this.add('PUBLIC_PROPOSAL_MISMATCH');
    }
    try {
      if (await KE.hashDecisionProposal(expectedFacts) !== publicProposal.publicHash) {
        this.invalid = true;
        this.add('PUBLIC_HASH_MISMATCH');
      }
    } catch {
      this.clarification = true;
      this.add('INPUT_CAPACITY_EXCEEDED');
    }
  }

  async run(): Promise<KnownEnoughKernelResult> {
    this.checkContextAndReadiness();
    const variables = new Map(this.input.definition.variables.map(variable => [variable.id, variable]));
    const values = this.checkCandidateValues(variables);
    const activeConstraints = this.validateCurrentConstraints(variables);
    const negotiationDependencies = new Map(this.input.candidate.permissionDependencies
      .filter(item => item.kind === 'NEGOTIATION').map(item => [item.permissionId, item]));
    const usedNegotiationDependencies = new Set<string>();

    for (const rule of this.input.definition.rules) {
      const result = this.evaluate(rule, values);
      this.recordRule(rule, result);
    }
    for (const constraint of activeConstraints) {
      if (constraint.kind === 'PREFERENCE') continue;
      const result = this.evaluate(constraint.rule, values);
      if (constraint.kind === 'NEGOTIABLE' && result === 'FALSE') {
        const granted = await this.checkNegotiationPermission(
          constraint, values, variables, negotiationDependencies, usedNegotiationDependencies,
        );
        if (!granted) {
          this.needsPermission = true;
          this.add('NEGOTIABLE_PERMISSION_REQUIRED', {
            ruleId: constraint.rule.id,
            constraintId: constraint.constraintId,
            ownerParticipantId: constraint.ownerParticipantId,
          });
          this.failed.push(constraint.rule.id);
        }
        continue;
      }
      this.recordRule(constraint.rule, result, constraint);
    }
    for (const dependency of negotiationDependencies.values()) {
      if (!usedNegotiationDependencies.has(dependency.permissionId)) {
        this.needsPermission = true;
        this.add('PERMISSION_DEPENDENCY_UNUSED', { permissionId: dependency.permissionId });
      }
    }
    await this.checkDisclosureDependencies();
    await this.checkPublicProposal();

    const status: KnownEnoughKernelStatus = this.invalid ? 'INVALID'
      : this.clarification ? 'NEEDS_CLARIFICATION'
        : this.needsPermission ? 'NEEDS_PERMISSION' : 'VALID';
    return makeResult(status, this.diagnostics, this.checked, this.failed, this.unknown, this.count);
  }
}

/** Validate one caller-supplied candidate against a single trusted current decision snapshot. */
export async function evaluateKnownEnoughCandidate(input: unknown): Promise<KnownEnoughKernelResult> {
  const parsed = parseKernelInput(input);
  if (!parsed.input) {
    if (parsed.tooLarge) return makeResult('NEEDS_CLARIFICATION', [{ code: 'INPUT_CAPACITY_EXCEEDED' }]);
    return makeResult('INVALID', [{ code: 'INPUT_INVALID' }]);
  }
  return new Evaluation(parsed.input).run();
}
