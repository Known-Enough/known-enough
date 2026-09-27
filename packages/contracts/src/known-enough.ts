import { z } from 'zod';

export const KE_SCHEMA_VERSION = 2 as const;
export const MAX_DECISION_PARTICIPANTS = 20;
export const MAX_DECISION_VARIABLES = 64;
export const MAX_DECISION_RULES = 128;
export const MAX_RULE_REFERENCES = 20;
export const MAX_OPTIONS_PER_VARIABLE = 64;
export const MAX_PRIVATE_CONSTRAINTS = 64;
export const MAX_DECISION_WIRE_BYTES = 65_536;
export const MAX_COMMAND_WIRE_BYTES = 32_768;
export const MAX_DURATION_SECONDS = 315_360_000;

const Id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Version = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const SafeInteger = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const unique = (values: readonly string[]) => new Set(values).size === values.length;
const IdList = z.array(Id).min(1).max(MAX_DECISION_PARTICIPANTS).refine(unique, 'IDs must be unique');
const VariableIdList = z.array(Id).min(1).max(MAX_DECISION_VARIABLES).refine(unique, 'Variable IDs must be unique');
const ContextToken = Hash;
const UtcInstant = z.iso.datetime({ precision: 3 }).refine(
  value => value.endsWith('Z'),
  'Use a canonical UTC instant with millisecond precision',
);
const DateValue = z.iso.date();
const TimeZone = z.string().min(1).max(64).refine(value => {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone === value;
  } catch {
    return false;
  }
}, 'Use a canonical IANA timezone identifier or UTC');
const CurrencyCode = z.string().regex(/^[A-Z]{3}$/);
const UnitCode = z.string().regex(/^[A-Za-z][A-Za-z0-9._/-]{0,31}$/);
const DecimalScale = z.number().int().min(0).max(6);
const MoneyMinorUnit = z.number().int().min(0).max(4);


const DecimalValue = z.strictObject({
  type: z.literal('NUMBER'),
  coefficient: SafeInteger,
  scale: DecimalScale,
  unitCode: UnitCode,
});
const MoneyValue = z.strictObject({
  type: z.literal('MONEY'),
  amountMinor: SafeInteger,
  currencyCode: CurrencyCode,
  minorUnit: MoneyMinorUnit,
});
const PercentageValue = z.strictObject({
  type: z.literal('PERCENTAGE'),
  basisPoints: z.number().int().min(0).max(10_000),
});
const DateOnlyValue = z.strictObject({ type: z.literal('DATE'), date: DateValue });
const DateTimeValue = z.strictObject({
  type: z.literal('DATETIME'),
  instant: UtcInstant,
  displayTimeZone: TimeZone,
});
const DurationValue = z.strictObject({
  type: z.literal('DURATION'),
  seconds: z.number().int().min(0).max(MAX_DURATION_SECONDS),
});
const BooleanValue = z.strictObject({ type: z.literal('BOOLEAN'), value: z.boolean() });
const EnumValue = z.strictObject({ type: z.literal('ENUM'), optionId: Id });
const EnumSetValue = z.strictObject({
  type: z.literal('ENUM_SET'),
  optionIds: z.array(Id).max(MAX_OPTIONS_PER_VARIABLE).refine(unique, 'Option IDs must be unique'),
});
const DecisionParticipantValue = z.strictObject({ type: z.literal('PARTICIPANT'), participantId: Id });

export const DecisionValue = z.discriminatedUnion('type', [
  DecimalValue, MoneyValue, PercentageValue, DateOnlyValue, DateTimeValue,
  DurationValue, BooleanValue, EnumValue, EnumSetValue, DecisionParticipantValue,
]);
export type DecisionValue = z.infer<typeof DecisionValue>;

const VariableBase = {
  id: Id,
  label: z.string().min(1).max(120),
  required: z.boolean(),
  visibility: z.enum(['PUBLIC', 'OWNER_PRIVATE', 'CONSENT_REQUIRED']),
  ownerParticipantId: Id.nullable(),
};
const EnumOption = z.strictObject({ id: Id, label: z.string().min(1).max(100) });
const EnumOptions = z.array(EnumOption).min(1).max(MAX_OPTIONS_PER_VARIABLE)
  .refine(options => unique(options.map(option => option.id)), 'Option IDs must be unique');

export const DecisionVariable = z.discriminatedUnion('type', [
  z.strictObject({ ...VariableBase, type: z.literal('NUMBER'), unitCode: UnitCode, scale: DecimalScale }),
  z.strictObject({ ...VariableBase, type: z.literal('MONEY'), currencyCode: CurrencyCode, minorUnit: MoneyMinorUnit }),
  z.strictObject({ ...VariableBase, type: z.literal('PERCENTAGE') }),
  z.strictObject({ ...VariableBase, type: z.literal('DATE') }),
  z.strictObject({ ...VariableBase, type: z.literal('DATETIME'), displayTimeZone: TimeZone }),
  z.strictObject({ ...VariableBase, type: z.literal('DURATION'), unit: z.literal('SECONDS') }),
  z.strictObject({ ...VariableBase, type: z.literal('BOOLEAN') }),
  z.strictObject({ ...VariableBase, type: z.literal('ENUM'), options: EnumOptions }),
  z.strictObject({ ...VariableBase, type: z.literal('ENUM_SET'), options: EnumOptions }),
  z.strictObject({ ...VariableBase, type: z.literal('PARTICIPANT'), participantIds: IdList }),
]).superRefine((variable, ctx) => {
  if (variable.visibility === 'PUBLIC' && variable.ownerParticipantId !== null) {
    ctx.addIssue({ code: 'custom', path: ['ownerParticipantId'], message: 'Public variables cannot name a private owner' });
  }
  if (variable.visibility !== 'PUBLIC' && variable.ownerParticipantId === null) {
    ctx.addIssue({ code: 'custom', path: ['ownerParticipantId'], message: 'Private variables require one verified owner' });
  }
});
export type DecisionVariable = z.infer<typeof DecisionVariable>;

const PublicVariableBase = {
  id: Id,
  label: z.string().min(1).max(120),
  required: z.boolean(),
  visibility: z.enum(['PUBLIC', 'CONSENT_REQUIRED']),
};
export const PublicDecisionVariable = z.discriminatedUnion('type', [
  z.strictObject({ ...PublicVariableBase, type: z.literal('NUMBER'), unitCode: UnitCode, scale: DecimalScale }),
  z.strictObject({ ...PublicVariableBase, type: z.literal('MONEY'), currencyCode: CurrencyCode, minorUnit: MoneyMinorUnit }),
  z.strictObject({ ...PublicVariableBase, type: z.literal('PERCENTAGE') }),
  z.strictObject({ ...PublicVariableBase, type: z.literal('DATE') }),
  z.strictObject({ ...PublicVariableBase, type: z.literal('DATETIME'), displayTimeZone: TimeZone }),
  z.strictObject({ ...PublicVariableBase, type: z.literal('DURATION'), unit: z.literal('SECONDS') }),
  z.strictObject({ ...PublicVariableBase, type: z.literal('BOOLEAN') }),
  z.strictObject({ ...PublicVariableBase, type: z.literal('ENUM'), options: EnumOptions }),
  z.strictObject({ ...PublicVariableBase, type: z.literal('ENUM_SET'), options: EnumOptions }),
  z.strictObject({ ...PublicVariableBase, type: z.literal('PARTICIPANT'), participantIds: IdList }),
]);
export type PublicDecisionVariable = z.infer<typeof PublicDecisionVariable>;

const RuleVisibility = z.enum(['PUBLIC', 'TRUSTED_BACKEND']);
const RuleBase = { id: Id, visibility: RuleVisibility };
const CompareOperator = z.enum(['EQ', 'NE', 'LT', 'LTE', 'GT', 'GTE']);
const EqualityOperator = z.enum(['EQ', 'NE']);
const AtomicCondition = z.strictObject({
  variableId: Id,
  operator: EqualityOperator,
  value: DecisionValue,
});

export const ValidationRule = z.discriminatedUnion('operator', [
  z.strictObject({ ...RuleBase, operator: z.literal('COMPARE'), variableId: Id, comparison: CompareOperator, value: DecisionValue }),
  z.strictObject({ ...RuleBase, operator: z.literal('IN'), variableId: Id, values: z.array(DecisionValue).min(1).max(MAX_OPTIONS_PER_VARIABLE) }),
  z.strictObject({
    ...RuleBase, operator: z.literal('RANGE'), variableId: Id,
    minimum: DecisionValue, maximum: DecisionValue,
    includeMinimum: z.boolean(), includeMaximum: z.boolean(),
  }),
  z.strictObject({
    ...RuleBase, operator: z.literal('SUM_EQUALS'),
    variableIds: z.array(Id).min(2).max(MAX_RULE_REFERENCES).refine(unique, 'Variable IDs must be unique'),
    target: z.union([DecimalValue, MoneyValue, PercentageValue]),
  }),
  z.strictObject({
    ...RuleBase, operator: z.literal('ALL_DIFFERENT'),
    variableIds: z.array(Id).min(2).max(MAX_RULE_REFERENCES).refine(unique, 'Variable IDs must be unique'),
  }),
  z.strictObject({
    ...RuleBase, operator: z.literal('MUTUALLY_EXCLUSIVE'),
    variableIds: z.array(Id).min(2).max(MAX_RULE_REFERENCES).refine(unique, 'Variable IDs must be unique'),
    maximumSelected: z.number().int().min(0).max(MAX_RULE_REFERENCES - 1),
  }),
  z.strictObject({
    ...RuleBase, operator: z.literal('IMPLIES'),
    antecedent: AtomicCondition,
    consequent: AtomicCondition,
  }),
]);
export type ValidationRule = z.infer<typeof ValidationRule>;

const FrameParticipant = z.strictObject({
  id: Id,
  displayName: z.string().min(1).max(80),
  requiredForApproval: z.boolean(),
});
const ValueAssignment = z.strictObject({ variableId: Id, value: DecisionValue });
const ValueAssignments = z.array(ValueAssignment).max(MAX_DECISION_VARIABLES)
  .refine(items => unique(items.map(item => item.variableId)), 'Variable assignments must be unique');

type VariableShape = z.infer<typeof DecisionVariable>;
type PublicVariableShape = z.infer<typeof PublicDecisionVariable>;
type AnyVariableShape = VariableShape | PublicVariableShape;
type RuleShape = z.infer<typeof ValidationRule>;
type ValueShape = z.infer<typeof DecisionValue>;

function variableAccepts(variable: AnyVariableShape, value: ValueShape): boolean {
  if (variable.type !== value.type) return false;
  switch (variable.type) {
    case 'NUMBER':
      return value.type === 'NUMBER' && value.unitCode === variable.unitCode && value.scale === variable.scale;
    case 'MONEY':
      return value.type === 'MONEY' && value.currencyCode === variable.currencyCode && value.minorUnit === variable.minorUnit;
    case 'PERCENTAGE':
    case 'DATE':
    case 'BOOLEAN':
      return true;
    case 'DATETIME':
      return value.type === 'DATETIME' && value.displayTimeZone === variable.displayTimeZone;
    case 'DURATION':
      return value.type === 'DURATION';
    case 'ENUM':
      return value.type === 'ENUM' && variable.options.some(option => option.id === value.optionId);
    case 'ENUM_SET':
      return value.type === 'ENUM_SET' && value.optionIds.every(id => variable.options.some(option => option.id === id));
    case 'PARTICIPANT':
      return value.type === 'PARTICIPANT' && variable.participantIds.includes(value.participantId);
  }
}

function sameValueDomain(left: AnyVariableShape, right: AnyVariableShape): boolean {
  if (left.type !== right.type) return false;
  if (left.type === 'NUMBER' && right.type === 'NUMBER') return left.unitCode === right.unitCode && left.scale === right.scale;
  if (left.type === 'MONEY' && right.type === 'MONEY') return left.currencyCode === right.currencyCode && left.minorUnit === right.minorUnit;
  if (left.type === 'DATETIME' && right.type === 'DATETIME') return left.displayTimeZone === right.displayTimeZone;
  if (left.type === 'DURATION' && right.type === 'DURATION') return left.unit === right.unit;
  return true;
}

function comparableValue(value: ValueShape): bigint | string | null {
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

function compareValues(left: ValueShape, right: ValueShape): number | null {
  const a = comparableValue(left);
  const b = comparableValue(right);
  if (a === null || b === null || typeof a !== typeof b) return null;
  if (typeof a === 'bigint' && typeof b === 'bigint') {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }
  if (typeof a === 'string' && typeof b === 'string') {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }
  return null;
}

function ruleReferences(rule: RuleShape): string[] {
  switch (rule.operator) {
    case 'COMPARE':
    case 'IN':
    case 'RANGE':
      return [rule.variableId];
    case 'SUM_EQUALS':
    case 'ALL_DIFFERENT':
    case 'MUTUALLY_EXCLUSIVE':
      return rule.variableIds;
    case 'IMPLIES':
      return [rule.antecedent.variableId, rule.consequent.variableId];
  }
}

function validateRuleAgainstVariables(
  rule: RuleShape,
  variables: Map<string, AnyVariableShape>,
  path: (string | number)[],
  addIssue: (message: string, path: (string | number)[]) => void,
): void {
  const get = (id: string, fieldPath: (string | number)[]): AnyVariableShape | undefined => {
    const variable = variables.get(id);
    if (!variable) addIssue('Rule references an unknown variable', fieldPath);
    return variable;
  };
  const checkLiteral = (variable: AnyVariableShape | undefined, value: ValueShape, fieldPath: (string | number)[]) => {
    if (variable && !variableAccepts(variable, value)) addIssue('Rule value does not match the referenced variable type or domain', fieldPath);
  };
  const ordered = (variable: AnyVariableShape | undefined, fieldPath: (string | number)[]) => {
    if (variable && !['NUMBER', 'MONEY', 'PERCENTAGE', 'DATE', 'DATETIME', 'DURATION'].includes(variable.type))
      addIssue('This operator needs an ordered scalar value', fieldPath);
  };

  switch (rule.operator) {
    case 'COMPARE': {
      const variable = get(rule.variableId, [...path, 'variableId']);
      checkLiteral(variable, rule.value, [...path, 'value']);
      if (rule.comparison !== 'EQ' && rule.comparison !== 'NE') ordered(variable, [...path, 'variableId']);
      break;
    }
    case 'IN': {
      const variable = get(rule.variableId, [...path, 'variableId']);
      rule.values.forEach((value, index) => checkLiteral(variable, value, [...path, 'values', index]));
      const duplicateValues = new Set<string>();
      rule.values.forEach((value, index) => {
        const identity = canonicalJson(normalizeSetValues(value));
        if (duplicateValues.has(identity)) addIssue('Membership values must be unique', [...path, 'values', index]);
        duplicateValues.add(identity);
      });
      break;
    }
    case 'RANGE': {
      const variable = get(rule.variableId, [...path, 'variableId']);
      checkLiteral(variable, rule.minimum, [...path, 'minimum']);
      checkLiteral(variable, rule.maximum, [...path, 'maximum']);
      ordered(variable, [...path, 'variableId']);
      const order = compareValues(rule.minimum, rule.maximum);
      if (order !== null && order > 0) addIssue('Range minimum must not exceed maximum', [...path, 'minimum']);
      if (order === 0 && (!rule.includeMinimum || !rule.includeMaximum))
        addIssue('An equal range endpoint is valid only when both endpoints are inclusive', path);
      break;
    }
    case 'SUM_EQUALS': {
      const referenced = rule.variableIds.map((id, index) => get(id, [...path, 'variableIds', index]));
      const first = referenced[0];
      if (first) {
        if (!['NUMBER', 'MONEY', 'PERCENTAGE'].includes(first.type)) addIssue('SUM_EQUALS needs numeric, money, or percentage variables', path);
        referenced.forEach((variable, index) => {
          if (variable && !sameValueDomain(first, variable)) addIssue('SUM_EQUALS variables must use one exact unit and precision', [...path, 'variableIds', index]);
        });
        checkLiteral(first, rule.target, [...path, 'target']);
      }
    }
      break;
    case 'ALL_DIFFERENT': {
      const referenced = rule.variableIds.map((id, index) => get(id, [...path, 'variableIds', index]));
      const first = referenced[0];
      if (first) referenced.forEach((variable, index) => {
        if (variable && !sameValueDomain(first, variable)) addIssue('ALL_DIFFERENT variables must use one compatible type', [...path, 'variableIds', index]);
        if (variable && variable.type === 'ENUM_SET') addIssue('ALL_DIFFERENT does not accept set-valued variables', [...path, 'variableIds', index]);
      });
      break;
    }
    case 'MUTUALLY_EXCLUSIVE': {
      rule.variableIds.forEach((id, index) => {
        const variable = get(id, [...path, 'variableIds', index]);
        if (variable && variable.type !== 'BOOLEAN') addIssue('MUTUALLY_EXCLUSIVE accepts only boolean variables', [...path, 'variableIds', index]);
      });
      if (rule.maximumSelected >= rule.variableIds.length)
        addIssue('maximumSelected must be lower than the number of boolean variables', [...path, 'maximumSelected']);
      break;
    }
    case 'IMPLIES': {
      for (const [name, condition] of [['antecedent', rule.antecedent], ['consequent', rule.consequent]] as const) {
        const variable = get(condition.variableId, [...path, name, 'variableId']);
        checkLiteral(variable, condition.value, [...path, name, 'value']);
      }
      break;
    }
  }

  if (rule.visibility === 'PUBLIC') {
    for (const id of ruleReferences(rule)) {
      const variable = variables.get(id);
      if (variable && variable.visibility !== 'PUBLIC')
        addIssue('Public rules may reference only public variables', [...path, 'visibility']);
    }
  }
}

export const DecisionDefinition = z.strictObject({
  schemaVersion: z.literal(KE_SCHEMA_VERSION),
  decisionId: Id,
  frameVersion: Version,
  semanticVersion: Version,
  contextToken: ContextToken,
  title: z.string().min(1).max(160),
  objective: z.string().min(1).max(2_000),
  description: z.string().max(4_000),
  participants: z.array(FrameParticipant).min(1).max(MAX_DECISION_PARTICIPANTS),
  requiredParticipantIds: IdList,
  variables: z.array(DecisionVariable).max(MAX_DECISION_VARIABLES),
  rules: z.array(ValidationRule).max(MAX_DECISION_RULES),
}).superRefine((definition, ctx) => {
  const issue = (message: string, path: (string | number)[] = []) => ctx.addIssue({ code: 'custom', message, path });
  const participantIds = definition.participants.map(participant => participant.id);
  const participantSet = new Set(participantIds);
  if (!unique(participantIds)) issue('Participant IDs must be unique', ['participants']);
  if (!unique(definition.requiredParticipantIds)) issue('Required participant IDs must be unique', ['requiredParticipantIds']);
  definition.requiredParticipantIds.forEach((id, index) => {
    if (!participantSet.has(id)) issue('Required approver must be a decision participant', ['requiredParticipantIds', index]);
  });
  definition.participants.forEach((participant, index) => {
    if (participant.requiredForApproval !== definition.requiredParticipantIds.includes(participant.id))
      issue('Participant approval flag must match the required participant set', ['participants', index, 'requiredForApproval']);
  });

  const variables = new Map<string, VariableShape>();
  definition.variables.forEach((variable, index) => {
    if (variables.has(variable.id)) issue('Variable IDs must be unique', ['variables', index, 'id']);
    variables.set(variable.id, variable);
    if (variable.ownerParticipantId !== null && !participantSet.has(variable.ownerParticipantId))
      issue('Private variable owner must be a decision participant', ['variables', index, 'ownerParticipantId']);
    if (variable.type === 'PARTICIPANT' && variable.participantIds.some(id => !participantSet.has(id)))
      issue('Participant variable options must belong to the decision roster', ['variables', index, 'participantIds']);
  });
  const ruleIds = definition.rules.map(rule => rule.id);
  if (!unique(ruleIds)) issue('Rule IDs must be unique', ['rules']);
  definition.rules.forEach((rule, index) => validateRuleAgainstVariables(rule, variables, ['rules', index], issue));
});
export type DecisionDefinition = z.infer<typeof DecisionDefinition>;

export const PublicDecisionFrame = z.strictObject({
  schemaVersion: z.literal(KE_SCHEMA_VERSION),
  decisionId: Id,
  frameVersion: Version,
  semanticVersion: Version,
  contextToken: ContextToken,
  title: z.string().min(1).max(160),
  objective: z.string().min(1).max(2_000),
  description: z.string().max(4_000),
  participants: z.array(FrameParticipant).min(1).max(MAX_DECISION_PARTICIPANTS),
  requiredParticipantIds: IdList,
  variables: z.array(PublicDecisionVariable).max(MAX_DECISION_VARIABLES),
  rules: z.array(ValidationRule).max(MAX_DECISION_RULES),
}).superRefine((frame, ctx) => {
  const issue = (message: string, path: (string | number)[] = []) => ctx.addIssue({ code: 'custom', message, path });
  const participantIds = frame.participants.map(participant => participant.id);
  if (!unique(participantIds)) issue('Participant IDs must be unique', ['participants']);
  const variableIds = frame.variables.map(variable => variable.id);
  const ruleIds = frame.rules.map(rule => rule.id);
  if (!unique(variableIds)) issue('Variable IDs must be unique', ['variables']);
  if (!unique(ruleIds)) issue('Rule IDs must be unique', ['rules']);
  if (frame.requiredParticipantIds.some(id => !participantIds.includes(id)))
    issue('Required approvers must belong to the public roster', ['requiredParticipantIds']);
  frame.participants.forEach((participant, index) => {
    if (participant.requiredForApproval !== frame.requiredParticipantIds.includes(participant.id))
      issue('Participant approval flag must match the required participant set', ['participants', index]);
  });
  frame.variables.forEach((variable, index) => {
    if (variable.type === 'PARTICIPANT' && variable.participantIds.some(id => !participantIds.includes(id)))
      issue('Participant variable options must belong to the public roster', ['variables', index]);
  });
  frame.rules.forEach((rule, index) => {
    if (rule.visibility !== 'PUBLIC') issue('Public frames contain only public rules', ['rules', index]);
  });
  const variables = new Map(frame.variables.map(variable => [variable.id, variable]));
  frame.rules.forEach((rule, index) => validateRuleAgainstVariables(rule, variables, ['rules', index], issue));
});
export type PublicDecisionFrame = z.infer<typeof PublicDecisionFrame>;

export const FrameConfirmation = z.strictObject({
  decisionId: Id,
  participantId: Id,
  frameVersion: Version,
  semanticVersion: Version,
  contextToken: ContextToken,
  confirmedAt: UtcInstant,
});
export type FrameConfirmation = z.infer<typeof FrameConfirmation>;

const ConstraintBase = {
  schemaVersion: z.literal(KE_SCHEMA_VERSION),
  constraintId: Id,
  decisionId: Id,
  ownerParticipantId: Id,
  constraintVersion: Version,
  ownerVersion: Version,
  semanticVersion: Version,
  contextToken: ContextToken,
  confirmedAt: UtcInstant,
  status: z.enum(['ACTIVE', 'SUPERSEDED']),
  sourceSummary: z.string().min(1).max(2_000),
};
export const PreferenceCriterion = z.strictObject({
  variableId: Id,
  value: DecisionValue,
  cost: z.number().int().min(0).max(1_000),
});
export type PreferenceCriterion = z.infer<typeof PreferenceCriterion>;

export const ConfirmedConstraint = z.discriminatedUnion('kind', [
  z.strictObject({ ...ConstraintBase, kind: z.enum(['HARD', 'NEGOTIABLE']), rule: ValidationRule }),
  z.strictObject({ ...ConstraintBase, kind: z.literal('PREFERENCE'), preference: PreferenceCriterion }),
]).superRefine((constraint, ctx) => {
  if (constraint.kind !== 'PREFERENCE' && constraint.rule.visibility !== 'TRUSTED_BACKEND')
    ctx.addIssue({ code: 'custom', path: ['rule', 'visibility'], message: 'Owner constraints stay inside the trusted backend boundary' });
});
export type ConfirmedConstraint = z.infer<typeof ConfirmedConstraint>;

const UnsupportedCondition = z.strictObject({
  id: Id,
  sourceSummary: z.string().min(1).max(2_000),
  clarificationQuestion: z.string().min(1).max(1_000),
});
const DraftCondition = z.discriminatedUnion('kind', [
  z.strictObject({
    constraintId: Id,
    kind: z.enum(['HARD', 'NEGOTIABLE']),
    rule: ValidationRule,
  }),
  z.strictObject({
    constraintId: Id,
    kind: z.literal('PREFERENCE'),
    preference: PreferenceCriterion,
  }),
]);
export const AIConstraintDraft = z.strictObject({
  schemaVersion: z.literal(KE_SCHEMA_VERSION),
  draftId: Id,
  draftVersion: Version,
  decisionId: Id,
  ownerParticipantId: Id,
  ownerVersion: Version,
  semanticVersion: Version,
  contextToken: ContextToken,
  sourceSummary: z.string().min(1).max(4_000),
  proposedConstraints: z.array(DraftCondition).max(MAX_PRIVATE_CONSTRAINTS),
  unsupportedConditions: z.array(UnsupportedCondition).max(16),
  createdAt: UtcInstant,
}).superRefine((draft, ctx) => {
  const ids = draft.proposedConstraints.map(constraint => constraint.constraintId);
  if (!unique(ids)) ctx.addIssue({ code: 'custom', path: ['proposedConstraints'], message: 'Draft constraint IDs must be unique' });
  const unsupportedIds = draft.unsupportedConditions.map(condition => condition.id);
  if (!unique(unsupportedIds)) ctx.addIssue({ code: 'custom', path: ['unsupportedConditions'], message: 'Unsupported condition IDs must be unique' });
  draft.proposedConstraints.forEach((constraint, index) => {
    if (constraint.kind !== 'PREFERENCE' && constraint.rule.visibility !== 'TRUSTED_BACKEND')
      ctx.addIssue({ code: 'custom', path: ['proposedConstraints', index, 'rule', 'visibility'], message: 'Owner interpretations stay inside the trusted backend boundary' });
  });
});
export type AIConstraintDraft = z.infer<typeof AIConstraintDraft>;

export const CandidateEvaluation = z.strictObject({
  status: z.enum(['VALID', 'INVALID', 'NEEDS_CLARIFICATION']),
  checkedRuleIds: z.array(Id).max(MAX_DECISION_RULES).refine(unique),
  failedRuleIds: z.array(Id).max(MAX_DECISION_RULES).refine(unique),
  unknownRuleIds: z.array(Id).max(MAX_DECISION_RULES).refine(unique),
  unsupportedConditionIds: z.array(Id).max(16).refine(unique),
}).superRefine((result, ctx) => {
  if (result.status === 'VALID' && (result.failedRuleIds.length || result.unknownRuleIds.length || result.unsupportedConditionIds.length))
    ctx.addIssue({ code: 'custom', message: 'A valid candidate cannot contain failed, unknown, or unsupported checks' });
  if (result.status === 'INVALID' && result.failedRuleIds.length === 0)
    ctx.addIssue({ code: 'custom', path: ['failedRuleIds'], message: 'Invalid candidates need a failed known rule' });
  if (result.status === 'NEEDS_CLARIFICATION' && result.unknownRuleIds.length + result.unsupportedConditionIds.length === 0)
    ctx.addIssue({ code: 'custom', message: 'Clarification needs an unknown or unsupported condition' });
  if (result.checkedRuleIds.some(id => result.unknownRuleIds.includes(id)))
    ctx.addIssue({ code: 'custom', path: ['unknownRuleIds'], message: 'Unknown rules are not also marked as checked' });
  if (result.failedRuleIds.some(id => !result.checkedRuleIds.includes(id)))
    ctx.addIssue({ code: 'custom', path: ['failedRuleIds'], message: 'Failed rules must be included among checked rules' });
});
export const CandidateProposal = z.strictObject({
  schemaVersion: z.literal(KE_SCHEMA_VERSION),
  proposalId: Id,
  decisionId: Id,
  semanticVersion: Version,
  contextToken: ContextToken,
  proposalVersion: Version,
  values: ValueAssignments,
  validation: CandidateEvaluation,
  permissionDependencies: z.array(z.strictObject({
    permissionId: Id,
    permissionVersion: Version,
    kind: z.enum(['NEGOTIATION', 'DISCLOSURE']),
    expiresAt: UtcInstant,
  })).max(MAX_PRIVATE_CONSTRAINTS),
  createdAt: UtcInstant,
}).superRefine((candidate, ctx) => {
  const permissionIds = candidate.permissionDependencies.map(permission => permission.permissionId);
  if (!unique(permissionIds)) ctx.addIssue({ code: 'custom', path: ['permissionDependencies'], message: 'Permission dependencies must be unique' });
});
export type CandidateProposal = z.infer<typeof CandidateProposal>;

export const CandidateForDecision = z.strictObject({
  definition: DecisionDefinition,
  candidate: CandidateProposal,
}).superRefine((bundle, ctx) => {
  const { definition, candidate } = bundle;
  const issue = (message: string, path: (string | number)[]) => ctx.addIssue({ code: 'custom', message, path });
  if (candidate.decisionId !== definition.decisionId
    || candidate.contextToken !== definition.contextToken
    || candidate.semanticVersion !== definition.semanticVersion)
    issue('Candidate must bind to the exact decision context', ['candidate']);
  const variables = new Map(definition.variables.map(variable => [variable.id, variable]));
  const assigned = new Map(candidate.values.map(value => [value.variableId, value.value]));
  candidate.values.forEach((assignment, index) => {
    const variable = variables.get(assignment.variableId);
    if (!variable) issue('Candidate references an unknown decision variable', ['candidate', 'values', index, 'variableId']);
    else if (!variableAccepts(variable, assignment.value))
      issue('Candidate value does not match the declared type, units, precision, or options', ['candidate', 'values', index, 'value']);
  });
  definition.variables.forEach((variable, index) => {
    if (variable.required && !assigned.has(variable.id))
      issue('Required values cannot be missing or represented as unknown', ['candidate', 'values', index]);
  });
});
export type CandidateForDecision = z.infer<typeof CandidateForDecision>;

export const PublicProposalFacts = z.strictObject({
  schemaVersion: z.literal(KE_SCHEMA_VERSION),
  decisionId: Id,
  contextToken: ContextToken,
  semanticVersion: Version,
  proposalVersion: Version,
  requiredParticipantIds: IdList,
  values: ValueAssignments,
});
export type PublicProposalFacts = z.infer<typeof PublicProposalFacts>;

export const PublicCandidateProposal = z.strictObject({
  proposalId: Id,
  facts: PublicProposalFacts,
  publicHash: Hash,
  createdAt: UtcInstant,
});
export type PublicCandidateProposal = z.infer<typeof PublicCandidateProposal>;

export const NegotiationQuestion = z.strictObject({
  questionId: Id,
  decisionId: Id,
  contextToken: ContextToken,
  semanticVersion: Version,
  targetParticipantId: Id,
  constraintId: Id,
  constraintVersion: Version,
  adjustment: ValidationRule,
  requestIdentity: Hash,
  expiresAt: UtcInstant,
  status: z.enum(['PENDING', 'ALLOWED', 'DECLINED', 'EXPIRED', 'SUPERSEDED']),
}).superRefine((question, ctx) => {
  if (question.adjustment.visibility !== 'TRUSTED_BACKEND')
    ctx.addIssue({ code: 'custom', path: ['adjustment', 'visibility'], message: 'Negotiation adjustments stay private' });
});
export type NegotiationQuestion = z.infer<typeof NegotiationQuestion>;

export const RefusedNegotiationRequest = z.strictObject({
  decisionId: Id,
  contextToken: ContextToken,
  semanticVersion: Version,
  ownerParticipantId: Id,
  constraintId: Id,
  constraintVersion: Version,
  requestIdentity: Hash,
  refusedAt: UtcInstant,
});
export type RefusedNegotiationRequest = z.infer<typeof RefusedNegotiationRequest>;

export const NegotiationPermission = z.strictObject({
  permissionId: Id,
  permissionVersion: Version,
  decisionId: Id,
  contextToken: ContextToken,
  semanticVersion: Version,
  ownerParticipantId: Id,
  questionId: Id,
  requestIdentity: Hash,
  constraintId: Id,
  constraintVersion: Version,
  adjustment: ValidationRule,
  status: z.enum(['ACTIVE', 'DECLINED', 'REVOKED', 'EXPIRED', 'SUPERSEDED']),
  expiresAt: UtcInstant,
}).superRefine((permission, ctx) => {
  if (permission.adjustment.visibility !== 'TRUSTED_BACKEND')
    ctx.addIssue({ code: 'custom', path: ['adjustment', 'visibility'], message: 'Negotiation permissions stay private' });
});
export type NegotiationPermission = z.infer<typeof NegotiationPermission>;

const PermissionBase = {
  permissionId: Id,
  permissionVersion: Version,
  decisionId: Id,
  contextToken: ContextToken,
  semanticVersion: Version,
  ownerParticipantId: Id,
  proposalId: Id,
  proposalVersion: Version,
  audienceParticipantIds: IdList,
  status: z.enum(['PENDING', 'ACTIVE', 'DECLINED', 'REVOKED', 'EXPIRED', 'SUPERSEDED', 'PUBLISHED']),
  expiresAt: UtcInstant,
};
export const DisclosurePermission = z.discriminatedUnion('kind', [
  z.strictObject({
    ...PermissionBase,
    kind: z.literal('EXACT_TEXT'),
    text: z.string().min(1).max(2_000),
    textHash: Hash,
  }),
  z.strictObject({
    ...PermissionBase,
    kind: z.literal('VARIABLE_VALUES'),
    variableIds: VariableIdList,
  }),
]);
export type DisclosurePermission = z.infer<typeof DisclosurePermission>;

export const FinalApproval = z.strictObject({
  decisionId: Id,
  proposalId: Id,
  proposalVersion: Version,
  publicHash: Hash,
  semanticVersion: Version,
  contextToken: ContextToken,
  participantId: Id,
  ownerVersion: Version,
  approvedAt: UtcInstant,
});
export type FinalApproval = z.infer<typeof FinalApproval>;

const PublishedDisclosure = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('EXACT_TEXT'),
    decisionId: Id, contextToken: ContextToken, semanticVersion: Version, proposalId: Id,
    text: z.string().min(1).max(2_000),
    audienceParticipantIds: IdList,
    publishedAt: UtcInstant,
  }),
  z.strictObject({
    kind: z.literal('VARIABLE_VALUES'),
    decisionId: Id, contextToken: ContextToken, semanticVersion: Version,
    proposalId: Id,
    variableIds: VariableIdList,
    values: ValueAssignments,
    audienceParticipantIds: IdList,
    publishedAt: UtcInstant,
  }),
]);

export const PublicDecisionStatus = z.enum([
  'CREATING', 'DEFINING', 'COLLECTING_FRAME_CONFIRMATION', 'COLLECTING_PRIVATE_INPUT',
  'NEEDS_CLARIFICATION', 'READY', 'REASONING', 'PRIVATE_NEGOTIATION', 'PROPOSED', 'APPROVING', 'AGREED',
  'NO_AGREEMENT', 'SUPERSEDED', 'CLOSED',
]);

export const PublicDecisionSnapshot = z.strictObject({
  schemaVersion: z.literal(KE_SCHEMA_VERSION),
  frame: PublicDecisionFrame,
  viewerParticipantId: Id.nullable(),
  semanticVersion: Version,
  contextToken: ContextToken,
  publicRevision: Version,
  status: PublicDecisionStatus,
  frameConfirmations: z.array(FrameConfirmation).max(MAX_DECISION_PARTICIPANTS),
  currentProposal: PublicCandidateProposal.nullable(),
  approvedParticipantIds: z.array(Id).max(MAX_DECISION_PARTICIPANTS).refine(unique),
  publishedDisclosures: z.array(PublishedDisclosure).max(64),
}).superRefine((snapshot, ctx) => {
  const participants = snapshot.frame.participants.map(participant => participant.id);
  const required = snapshot.frame.requiredParticipantIds;
  const issue = (message: string, path: (string | number)[]) => ctx.addIssue({ code: 'custom', message, path });
  if (snapshot.viewerParticipantId !== null && !participants.includes(snapshot.viewerParticipantId))
    issue('Snapshot viewer must belong to the current roster', ['viewerParticipantId']);
  if (snapshot.frame.semanticVersion !== snapshot.semanticVersion || snapshot.frame.contextToken !== snapshot.contextToken)
    issue('Snapshot and frame contexts must match', ['frame']);
  const confirmationIds = snapshot.frameConfirmations.map(confirmation => confirmation.participantId);
  if (!unique(confirmationIds)) issue('Frame confirmations must be unique', ['frameConfirmations']);
  snapshot.frameConfirmations.forEach((confirmation, index) => {
    if (confirmation.decisionId !== snapshot.frame.decisionId
      || !participants.includes(confirmation.participantId)
      || confirmation.frameVersion !== snapshot.frame.frameVersion
      || confirmation.semanticVersion !== snapshot.semanticVersion
      || confirmation.contextToken !== snapshot.contextToken)
      issue('Frame confirmation must bind to a current participant and frame', ['frameConfirmations', index]);
  });
  const confirmedIds = new Set(confirmationIds);
  const allFramesConfirmed = required.every(id => confirmedIds.has(id));
  if (['COLLECTING_PRIVATE_INPUT', 'NEEDS_CLARIFICATION', 'READY', 'REASONING', 'PRIVATE_NEGOTIATION', 'PROPOSED', 'APPROVING', 'AGREED', 'NO_AGREEMENT'].includes(snapshot.status)
    && !allFramesConfirmed)
    issue('Private input and proposals require every required participant’s current frame confirmation', ['frameConfirmations']);
  if (snapshot.approvedParticipantIds.some(id => !required.includes(id)))
    issue('Only required participants may appear in the approval list', ['approvedParticipantIds']);

  const activeProposal = ['PROPOSED', 'APPROVING', 'AGREED'].includes(snapshot.status);
  if (activeProposal !== (snapshot.currentProposal !== null))
    issue('Only proposal states carry a current proposal', ['currentProposal']);
  if (snapshot.status === 'AGREED' && snapshot.approvedParticipantIds.length !== required.length)
    issue('Agreement needs approval from every required participant', ['approvedParticipantIds']);
  if (!activeProposal && snapshot.approvedParticipantIds.length)
    issue('Only a current proposal may have approvals', ['approvedParticipantIds']);
  if (snapshot.status === 'PROPOSED' && snapshot.approvedParticipantIds.length)
    issue('A proposal does not carry approvals until its approval phase', ['approvedParticipantIds']);
  if (snapshot.currentProposal) {
    const facts = snapshot.currentProposal.facts;
    if (facts.decisionId !== snapshot.frame.decisionId || facts.contextToken !== snapshot.contextToken
      || facts.semanticVersion !== snapshot.semanticVersion || facts.proposalVersion < 1
      || facts.requiredParticipantIds.slice().sort().join('|') !== required.slice().sort().join('|'))
      issue('Proposal facts must bind to the current public decision', ['currentProposal', 'facts']);
    const publicVariables = new Map(snapshot.frame.variables.map(variable => [variable.id, variable]));
    facts.values.forEach((assignment, index) => {
      const variable = publicVariables.get(assignment.variableId);
      if (!variable || variable.visibility !== 'PUBLIC') issue('Public proposal facts contain only public variable values', ['currentProposal', 'facts', 'values', index]);
      else if (!variableAccepts(variable, assignment.value))
        issue('Public proposal value must match the public variable type and domain', ['currentProposal', 'facts', 'values', index]);
    });
    snapshot.frame.variables.forEach((variable, index) => {
      if (variable.visibility === 'PUBLIC' && variable.required
        && !facts.values.some(assignment => assignment.variableId === variable.id))
        issue('Every required public variable needs a proposal value', ['currentProposal', 'facts', 'values', index]);
    });
  }
  snapshot.publishedDisclosures.forEach((disclosure, index) => {
    if (disclosure.decisionId !== snapshot.frame.decisionId
      || disclosure.contextToken !== snapshot.contextToken
      || disclosure.semanticVersion !== snapshot.semanticVersion
      || !snapshot.currentProposal
      || disclosure.proposalId !== snapshot.currentProposal.proposalId)
      issue('Disclosure must bind to the current exact proposal and context', ['publishedDisclosures', index]);
    if (disclosure.audienceParticipantIds.some(id => !participants.includes(id)))
      issue('Disclosure audience must belong to the current roster', ['publishedDisclosures', index, 'audienceParticipantIds']);
    if (snapshot.viewerParticipantId !== null) {
      if (!disclosure.audienceParticipantIds.includes(snapshot.viewerParticipantId))
        issue('Snapshot may include only disclosures authorized for its viewer', ['publishedDisclosures', index, 'audienceParticipantIds']);
    } else if (participants.some(id => !disclosure.audienceParticipantIds.includes(id))) {
      issue('Unscoped snapshots may include only disclosures authorized for every current participant', ['publishedDisclosures', index, 'audienceParticipantIds']);
    }
    if (disclosure.kind === 'VARIABLE_VALUES') {
      const variables = new Map(snapshot.frame.variables.map(variable => [variable.id, variable]));
      disclosure.values.forEach((assignment, valueIndex) => {
        const variable = variables.get(assignment.variableId);
        if (!variable || variable.visibility !== 'CONSENT_REQUIRED' || !disclosure.variableIds.includes(assignment.variableId))
          issue('Published values must be consent-required frame variables explicitly named by the permission', ['publishedDisclosures', index, 'values', valueIndex]);
        else if (!variableAccepts(variable, assignment.value))
          issue('Published value must match the exact public variable type and domain', ['publishedDisclosures', index, 'values', valueIndex]);
      });
      if (disclosure.variableIds.some(id => !disclosure.values.some(value => value.variableId === id)))
        issue('Every disclosed variable needs its exact candidate value', ['publishedDisclosures', index, 'values']);
    }
  });
});
export type PublicDecisionSnapshot = z.infer<typeof PublicDecisionSnapshot>;

export const OwnerDecisionSnapshot = z.strictObject({
  schemaVersion: z.literal(KE_SCHEMA_VERSION),
  publicSnapshot: PublicDecisionSnapshot,
  ownerParticipantId: Id,
  ownInputReadiness: z.enum(['NOT_STARTED', 'NEEDS_CLARIFICATION', 'READY']),
  privateVariables: z.array(DecisionVariable).max(MAX_DECISION_VARIABLES),
  privateProposalValues: z.strictObject({ proposalId: Id, proposalVersion: Version, values: ValueAssignments }).nullable(),
  controlVersion: Version,
  ownerVersion: Version,
  draftVersion: Version.nullable(),
  draft: AIConstraintDraft.nullable(),
  confirmedConstraints: z.array(ConfirmedConstraint).max(MAX_PRIVATE_CONSTRAINTS),
  pendingQuestions: z.array(NegotiationQuestion).max(32),
  refusedRequests: z.array(RefusedNegotiationRequest).max(64),
  negotiationPermissions: z.array(NegotiationPermission).max(64),
  disclosurePermissions: z.array(DisclosurePermission).max(64),
  ownApproval: FinalApproval.nullable(),
}).superRefine((snapshot, ctx) => {
  const owner = snapshot.ownerParticipantId;
  const decisionId = snapshot.publicSnapshot.frame.decisionId;
  const issue = (message: string, path: (string | number)[]) => ctx.addIssue({ code: 'custom', message, path });
  if (!snapshot.publicSnapshot.frame.participants.some(participant => participant.id === owner))
    issue('Owner must be a public decision participant', ['ownerParticipantId']);
  if (snapshot.publicSnapshot.viewerParticipantId !== owner)
    issue('Owner snapshot public projection must be scoped to this exact owner', ['publicSnapshot', 'viewerParticipantId']);
  const frameVariables = new Map(snapshot.publicSnapshot.frame.variables.map(variable => [variable.id, variable]));
  const privateVariables = new Map<string, VariableShape>();
  snapshot.privateVariables.forEach((variable, index) => {
    if (variable.visibility === 'PUBLIC' || variable.ownerParticipantId !== owner)
      issue('Owner snapshot may include only this owner’s private variable definitions', ['privateVariables', index]);
    if (privateVariables.has(variable.id)) issue('Private variable IDs must be unique', ['privateVariables', index, 'id']);
    privateVariables.set(variable.id, variable);
    const publicVariable = frameVariables.get(variable.id);
    if (publicVariable) {
      const scrubbed = { ...variable } as Record<string, unknown>;
      delete scrubbed.ownerParticipantId;
      if (variable.visibility !== 'CONSENT_REQUIRED' || canonicalJson(scrubbed) !== canonicalJson(publicVariable))
        issue('A public consent-required definition must exactly match this owner’s private definition', ['privateVariables', index]);
    }
    if (!publicVariable && variable.visibility === 'CONSENT_REQUIRED')
      issue('Consent-required variable definitions must be named in the public frame', ['privateVariables', index]);
  });
  if (snapshot.privateProposalValues) {
    const current = snapshot.publicSnapshot.currentProposal;
    if (!current || snapshot.privateProposalValues.proposalId !== current.proposalId
      || snapshot.privateProposalValues.proposalVersion !== current.facts.proposalVersion)
      issue('Private candidate values must bind to the owner’s current exact proposal', ['privateProposalValues']);
    snapshot.privateProposalValues.values.forEach((assignment, index) => {
      const variable = privateVariables.get(assignment.variableId);
      if (!variable || !variableAccepts(variable, assignment.value))
        issue('Private candidate values may reference only this owner’s private variables and their exact domains', ['privateProposalValues', 'values', index]);
    });
    snapshot.privateVariables.forEach((variable, index) => {
      if (variable.required && !snapshot.privateProposalValues!.values.some(value => value.variableId === variable.id))
        issue('Required owner values cannot be missing from this owner’s current proposal view', ['privateProposalValues', 'values', index]);
    });
  }
  const visibleVariables: Map<string, AnyVariableShape> = new Map(frameVariables);
  privateVariables.forEach((variable, id) => visibleVariables.set(id, variable));
  if (snapshot.draft && (snapshot.draft.ownerParticipantId !== owner || snapshot.draft.decisionId !== decisionId))
    issue('Owner snapshot may include only this owner’s draft for this decision', ['draft']);
  if (snapshot.draft && (snapshot.draft.contextToken !== snapshot.publicSnapshot.contextToken
    || snapshot.draft.semanticVersion !== snapshot.publicSnapshot.semanticVersion
    || snapshot.draft.ownerVersion !== snapshot.ownerVersion))
    issue('Draft must bind to the owner’s current semantic context and owner version', ['draft']);
  if ((snapshot.draft === null) !== (snapshot.draftVersion === null)
    || (snapshot.draft && snapshot.draft.draftVersion !== snapshot.draftVersion))
    issue('Draft version must bind to the returned owner draft', ['draftVersion']);
  if (snapshot.draft) {
    if (snapshot.draft.unsupportedConditions.length && snapshot.ownInputReadiness === 'READY')
      issue('Unsupported qualitative conditions keep this owner in clarification', ['ownInputReadiness']);
    snapshot.draft.proposedConstraints.forEach((condition, index) => {
      if (condition.kind === 'PREFERENCE') {
        const variable = visibleVariables.get(condition.preference.variableId);
        if (!variable) issue('Draft preference references an unknown variable', ['draft', 'proposedConstraints', index, 'preference', 'variableId']);
        else if (!variableAccepts(variable, condition.preference.value))
          issue('Draft preference must match the referenced variable type and domain', ['draft', 'proposedConstraints', index, 'preference', 'value']);
      } else {
        validateRuleAgainstVariables(condition.rule, visibleVariables, ['draft', 'proposedConstraints', index, 'rule'], issue);
      }
    });
  }
  const constraintIds = snapshot.confirmedConstraints.map(constraint => constraint.constraintId);
  if (!unique(constraintIds)) issue('Owner constraint IDs must be unique', ['confirmedConstraints']);
  snapshot.confirmedConstraints.forEach((constraint, index) => {
    if (constraint.ownerParticipantId !== owner || constraint.decisionId !== decisionId)
      issue('Owner snapshot may include only this owner’s constraints for this decision', ['confirmedConstraints', index]);
    if (constraint.status === 'ACTIVE'
      && (constraint.contextToken !== snapshot.publicSnapshot.contextToken
        || constraint.semanticVersion !== snapshot.publicSnapshot.semanticVersion))
      issue('Active constraints must bind to the current semantic context', ['confirmedConstraints', index]);
    if (constraint.kind === 'PREFERENCE') {
      const variable = visibleVariables.get(constraint.preference.variableId);
      if (!variable) issue('Preference references an unknown variable', ['confirmedConstraints', index, 'preference', 'variableId']);
      else if (!variableAccepts(variable, constraint.preference.value))
        issue('Preference value must match the referenced variable type and domain', ['confirmedConstraints', index, 'preference', 'value']);
    } else {
      if (constraint.rule.visibility !== 'TRUSTED_BACKEND')
        issue('Owner constraints stay inside the trusted backend boundary', ['confirmedConstraints', index, 'rule', 'visibility']);
      validateRuleAgainstVariables(constraint.rule, visibleVariables, ['confirmedConstraints', index, 'rule'], issue);
    }
  });
  const questionIds = snapshot.pendingQuestions.map(question => question.questionId);
  if (!unique(questionIds)) issue('Question IDs must be unique', ['pendingQuestions']);
  const questionIdentities = snapshot.pendingQuestions.map(question => question.requestIdentity);
  if (!unique(questionIdentities)) issue('Equivalent negotiation questions must share one pending identity', ['pendingQuestions']);
  snapshot.pendingQuestions.forEach((question, index) => {
    if (question.targetParticipantId !== owner || question.decisionId !== decisionId)
      issue('Owner snapshot may include only questions for this owner', ['pendingQuestions', index]);
  });
  snapshot.pendingQuestions.forEach((question, index) => {
    if (question.status === 'PENDING'
      && (question.contextToken !== snapshot.publicSnapshot.contextToken
        || question.semanticVersion !== snapshot.publicSnapshot.semanticVersion))
      issue('Pending questions must bind to the current semantic context', ['pendingQuestions', index]);
    const constraint = snapshot.confirmedConstraints.find(item => item.constraintId === question.constraintId
      && item.ownerParticipantId === owner && item.kind === 'NEGOTIABLE');
    if (!constraint) {
      issue('Negotiation questions must reference this owner’s negotiable constraint', ['pendingQuestions', index, 'constraintId']);
    } else if (constraint.constraintVersion !== question.constraintVersion) {
      issue('Negotiation questions must bind to the exact negotiable constraint version', ['pendingQuestions', index, 'constraintVersion']);
    }
    validateRuleAgainstVariables(question.adjustment, visibleVariables, ['pendingQuestions', index, 'adjustment'], issue);
    if (question.adjustment.visibility !== 'TRUSTED_BACKEND')
      issue('Negotiation adjustments are private trusted-backend rules', ['pendingQuestions', index, 'adjustment', 'visibility']);
  });
  const refusalIdentities = snapshot.refusedRequests.map(refusal => `${refusal.contextToken}:${refusal.semanticVersion}:${refusal.constraintId}:${refusal.requestIdentity}`);
  if (!unique(refusalIdentities)) issue('Refused negotiation identities must be unique within a constraint context', ['refusedRequests']);
  snapshot.refusedRequests.forEach((refusal, index) => {
    if (refusal.ownerParticipantId !== owner || refusal.decisionId !== decisionId)
      issue('Owner snapshot may include only this owner’s refusal identities', ['refusedRequests', index]);
    if (refusal.contextToken !== snapshot.publicSnapshot.contextToken
      || refusal.semanticVersion !== snapshot.publicSnapshot.semanticVersion)
      issue('Refusal identity must bind to the current semantic context', ['refusedRequests', index]);
    const refusedConstraint = snapshot.confirmedConstraints.find(constraint => constraint.constraintId === refusal.constraintId
      && constraint.ownerParticipantId === owner && constraint.kind === 'NEGOTIABLE');
    if (!refusedConstraint) {
      issue('Refusal identity must reference this owner’s negotiable constraint', ['refusedRequests', index, 'constraintId']);
    } else if (refusedConstraint.constraintVersion !== refusal.constraintVersion) {
      issue('Refusal identity must bind to the exact negotiable constraint version', ['refusedRequests', index, 'constraintVersion']);
    }
  });
  const negotiationPermissionIds = snapshot.negotiationPermissions.map(permission => permission.permissionId);
  if (!unique(negotiationPermissionIds)) issue('Negotiation permission IDs must be unique', ['negotiationPermissions']);
  snapshot.negotiationPermissions.forEach((permission, index) => {
    if (permission.ownerParticipantId !== owner || permission.decisionId !== decisionId)
      issue('Owner snapshot may include only this owner’s negotiation permissions', ['negotiationPermissions', index]);
  });
  snapshot.negotiationPermissions.forEach((permission, index) => {
    if (permission.status === 'ACTIVE'
      && (permission.contextToken !== snapshot.publicSnapshot.contextToken
        || permission.semanticVersion !== snapshot.publicSnapshot.semanticVersion))
      issue('Active negotiation permissions must bind to the current semantic context', ['negotiationPermissions', index]);
    const question = snapshot.pendingQuestions.find(item => item.questionId === permission.questionId
      && item.requestIdentity === permission.requestIdentity);
    if (!question) {
      issue('Negotiation permissions must bind to an exact owner question identity', ['negotiationPermissions', index]);
    } else if (question.constraintId !== permission.constraintId
      || question.constraintVersion !== permission.constraintVersion
      || question.targetParticipantId !== permission.ownerParticipantId
      || question.contextToken !== permission.contextToken
      || question.semanticVersion !== permission.semanticVersion) {
      issue('Negotiation permission must carry the exact question context and constraint', ['negotiationPermissions', index]);
    }
    if (permission.adjustment.visibility !== 'TRUSTED_BACKEND')
      issue('Negotiation permissions contain only trusted-backend rules', ['negotiationPermissions', index, 'adjustment', 'visibility']);
  });
  const disclosurePermissionIds = snapshot.disclosurePermissions.map(permission => permission.permissionId);
  if (!unique(disclosurePermissionIds)) issue('Disclosure permission IDs must be unique', ['disclosurePermissions']);
  snapshot.disclosurePermissions.forEach((permission, index) => {
    if (permission.ownerParticipantId !== owner || permission.decisionId !== decisionId)
      issue('Owner snapshot may include only this owner’s disclosure permissions', ['disclosurePermissions', index]);
  });
  snapshot.disclosurePermissions.forEach((permission, index) => {
    if (permission.status === 'ACTIVE'
      && (permission.contextToken !== snapshot.publicSnapshot.contextToken
        || permission.semanticVersion !== snapshot.publicSnapshot.semanticVersion
        || permission.proposalId !== snapshot.publicSnapshot.currentProposal?.proposalId
        || permission.proposalVersion !== snapshot.publicSnapshot.currentProposal?.facts.proposalVersion))
      issue('Active disclosure permissions must bind to the current exact proposal and context', ['disclosurePermissions', index]);
    if (permission.audienceParticipantIds.some(id => !snapshot.publicSnapshot.frame.participants.some(person => person.id === id)))
      issue('Disclosure audience must belong to the current roster', ['disclosurePermissions', index, 'audienceParticipantIds']);
    if (permission.kind === 'VARIABLE_VALUES'
      && permission.variableIds.some(id => !privateVariables.has(id)))
      issue('A participant may disclose only their own private variables', ['disclosurePermissions', index, 'variableIds']);
  });
  if (snapshot.ownApproval && (snapshot.ownApproval.participantId !== owner
    || snapshot.ownApproval.decisionId !== decisionId
    || snapshot.ownApproval.contextToken !== snapshot.publicSnapshot.contextToken
    || snapshot.ownApproval.semanticVersion !== snapshot.publicSnapshot.semanticVersion
    || snapshot.ownApproval.proposalId !== snapshot.publicSnapshot.currentProposal?.proposalId
    || snapshot.ownApproval.proposalVersion !== snapshot.publicSnapshot.currentProposal?.facts.proposalVersion
    || snapshot.ownApproval.publicHash !== snapshot.publicSnapshot.currentProposal?.publicHash))
    issue('Approval must bind to the owner’s current proposal and context', ['ownApproval']);
});
export type OwnerDecisionSnapshot = z.infer<typeof OwnerDecisionSnapshot>;

export const DecisionCommand = z.discriminatedUnion('type', [
  z.strictObject({
    schemaVersion: z.literal(KE_SCHEMA_VERSION), type: z.literal('CONFIRM_FRAME'),
    requestId: Id, decisionId: Id, idempotencyKey: Id,
    expected: z.strictObject({ contextToken: ContextToken, semanticVersion: Version, controlVersion: Version, ownerVersion: Version }),
    payload: z.strictObject({ frameVersion: Version }),
  }),
  z.strictObject({
    schemaVersion: z.literal(KE_SCHEMA_VERSION), type: z.literal('CONFIRM_CONSTRAINTS'),
    requestId: Id, decisionId: Id, idempotencyKey: Id,
    expected: z.strictObject({ contextToken: ContextToken, semanticVersion: Version, controlVersion: Version, ownerVersion: Version }),
    payload: z.strictObject({ draftId: Id, draftVersion: Version, constraintIds: z.array(Id).max(MAX_PRIVATE_CONSTRAINTS).refine(unique) }),
  }),
  z.strictObject({
    schemaVersion: z.literal(KE_SCHEMA_VERSION), type: z.literal('ANSWER_NEGOTIATION'),
    requestId: Id, decisionId: Id, idempotencyKey: Id,
    expected: z.strictObject({ contextToken: ContextToken, semanticVersion: Version, controlVersion: Version, ownerVersion: Version }),
    payload: z.strictObject({ questionId: Id, constraintVersion: Version, requestIdentity: Hash, answer: z.enum(['ALLOW', 'DECLINE']) }),
  }),
  z.strictObject({
    schemaVersion: z.literal(KE_SCHEMA_VERSION), type: z.literal('DECIDE_DISCLOSURE'),
    requestId: Id, decisionId: Id, idempotencyKey: Id,
    expected: z.strictObject({ contextToken: ContextToken, semanticVersion: Version, controlVersion: Version, ownerVersion: Version }),
    payload: z.strictObject({ permissionId: Id, permissionVersion: Version, decision: z.enum(['ALLOW', 'DECLINE']) }),
  }),
  z.strictObject({
    schemaVersion: z.literal(KE_SCHEMA_VERSION), type: z.literal('REVOKE_NEGOTIATION'),
    requestId: Id, decisionId: Id, idempotencyKey: Id,
    expected: z.strictObject({ contextToken: ContextToken, semanticVersion: Version, controlVersion: Version, ownerVersion: Version }),
    payload: z.strictObject({ permissionId: Id, permissionVersion: Version }),
  }),
  z.strictObject({
    schemaVersion: z.literal(KE_SCHEMA_VERSION), type: z.literal('REVOKE_DISCLOSURE'),
    requestId: Id, decisionId: Id, idempotencyKey: Id,
    expected: z.strictObject({ contextToken: ContextToken, semanticVersion: Version, controlVersion: Version, ownerVersion: Version }),
    payload: z.strictObject({ permissionId: Id, permissionVersion: Version }),
  }),
  z.strictObject({
    schemaVersion: z.literal(KE_SCHEMA_VERSION), type: z.literal('APPROVE_PROPOSAL'),
    requestId: Id, decisionId: Id, idempotencyKey: Id,
    expected: z.strictObject({ contextToken: ContextToken, semanticVersion: Version, controlVersion: Version, ownerVersion: Version }),
    payload: z.strictObject({ proposalId: Id, proposalVersion: Version, publicHash: Hash }),
  }),
  z.strictObject({
    schemaVersion: z.literal(KE_SCHEMA_VERSION), type: z.literal('WITHDRAW_APPROVAL'),
    requestId: Id, decisionId: Id, idempotencyKey: Id,
    expected: z.strictObject({ contextToken: ContextToken, semanticVersion: Version, controlVersion: Version, ownerVersion: Version }),
    payload: z.strictObject({ proposalId: Id, proposalVersion: Version, publicHash: Hash }),
  }),
]);
export type DecisionCommand = z.infer<typeof DecisionCommand>;

export const DECISION_ERROR_HTTP_STATUS = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  STALE_CONTEXT: 409,
  STALE_OWNER: 409,
  STALE_DRAFT: 409,
  STALE_PROPOSAL: 409,
  IDEMPOTENCY_CONFLICT: 409,
  INVALID_COMMAND: 422,
  NEEDS_CLARIFICATION: 422,
  RETRYABLE_SERVER_ERROR: 503,
} as const;
export const DecisionErrorCode = z.enum(['UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'STALE_CONTEXT', 'STALE_OWNER', 'STALE_DRAFT', 'STALE_PROPOSAL', 'IDEMPOTENCY_CONFLICT', 'INVALID_COMMAND', 'NEEDS_CLARIFICATION', 'RETRYABLE_SERVER_ERROR']);
const DecisionErrorStatus = z.union([z.literal(401), z.literal(403), z.literal(404), z.literal(409), z.literal(422), z.literal(503)]);
export const DecisionCommandResult = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true), requestId: Id, status: z.enum(['APPLIED', 'QUEUED']),
    contextToken: ContextToken, semanticVersion: Version, controlVersion: Version, ownerVersion: Version,
  }),
  z.strictObject({
    ok: z.literal(false), requestId: Id,
    error: z.strictObject({ code: DecisionErrorCode, httpStatus: DecisionErrorStatus }),
  }),
]).refine(result => result.ok || result.error.httpStatus === DECISION_ERROR_HTTP_STATUS[result.error.code], 'Decision error/status mismatch');
export type DecisionCommandResult = z.infer<typeof DecisionCommandResult>;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => JSON.stringify(key) + ':' + canonicalJson(item)).join(',') + '}';
  }
  return JSON.stringify(value);
}

function normalizeSetValues(value: ValueShape): ValueShape {
  if (value.type !== 'ENUM_SET') return value;
  return { ...value, optionIds: value.optionIds.slice().sort() };
}

export function serializeDecisionProposal(input: unknown): string {
  const facts = PublicProposalFacts.parse(input);
  facts.requiredParticipantIds.sort();
  facts.values.sort((left, right) => left.variableId < right.variableId ? -1 : left.variableId > right.variableId ? 1 : 0);
  facts.values.forEach(assignment => { assignment.value = normalizeSetValues(assignment.value); });
  return canonicalJson(facts);
}

export async function hashDecisionProposal(input: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(serializeDecisionProposal(input));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

const AtomicRequestIdentity = z.strictObject({
  decisionId: Id,
  contextToken: ContextToken,
  semanticVersion: Version,
  targetParticipantId: Id,
  constraintId: Id,
  constraintVersion: Version,
  adjustment: ValidationRule,
});

export function serializeNegotiationRequestIdentity(input: unknown): string {
  const identity = AtomicRequestIdentity.parse(input);
  const adjustment: Record<string, unknown> = { ...identity.adjustment };
  delete adjustment.id;
  delete adjustment.visibility;
  if (identity.adjustment.operator === 'IN') {
    const values = identity.adjustment.values.map(normalizeSetValues);
    values.sort((left, right) => {
      const a = canonicalJson(left);
      const b = canonicalJson(right);
      return a < b ? -1 : a > b ? 1 : 0;
    });
    adjustment.values = values.filter((value, index) => index === 0
      || canonicalJson(value) !== canonicalJson(values[index - 1]));
  }
  if (identity.adjustment.operator === 'SUM_EQUALS'
    || identity.adjustment.operator === 'ALL_DIFFERENT'
    || identity.adjustment.operator === 'MUTUALLY_EXCLUSIVE') {
    adjustment.variableIds = identity.adjustment.variableIds.slice().sort();
  }
  return canonicalJson({ ...identity, adjustment });
}

export async function hashNegotiationRequestIdentity(input: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(serializeNegotiationRequestIdentity(input));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function parseDecisionDefinition(input: unknown): DecisionDefinition {
  return parseBounded(DecisionDefinition, input, MAX_DECISION_WIRE_BYTES);
}

export function parseDecisionCommand(input: unknown): DecisionCommand {
  return parseBounded(DecisionCommand, input, MAX_COMMAND_WIRE_BYTES);
}

function parseBounded<T>(schema: z.ZodType<T>, input: unknown, maxBytes: number): T {
  let json: string | undefined;
  try {
    json = JSON.stringify(input);
  } catch {
    throw new RangeError('Input must be finite JSON within the configured byte limit');
  }
  if (json === undefined || new TextEncoder().encode(json).byteLength > maxBytes)
    throw new RangeError('Input exceeds the configured JSON byte limit');
  return schema.parse(input);
}
