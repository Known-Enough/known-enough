import { z } from 'zod';
import * as KE from './known-enough.ts';

/** Server/model transport only. Persisted decision schemas and participant authority are unchanged. */
export const Literal = z.string().max(2048);
const id = KE.PublicDecisionVariable.options[0].shape.id;

// Separate groups avoid a flat object that makes type-specific required fields optional.
// The existing storage contracts remain the source of truth for every variable/operator.
export const VariableGroups = KE.PublicDecisionVariable.options.map(definition => {
  const fields: Record<string, z.ZodType> = { ...definition.shape, allowedValues: z.array(Literal).max(32) };
  delete fields.type; delete fields.visibility;
  return { tag: definition.shape.type.value, schema: z.strictObject(fields) };
});
export const RuleGroups = KE.ValidationRule.options.map(definition => {
  const fields: Record<string, z.ZodType> = { ...definition.shape };
  delete fields.operator; delete fields.visibility;
  for (const key of ['value', 'minimum', 'maximum', 'target']) if (Object.hasOwn(fields, key)) fields[key] = Literal;
  if (Object.hasOwn(fields, 'values')) fields.values = z.array(Literal).min(1).max(KE.MAX_OPTIONS_PER_VARIABLE);
  if ('antecedent' in definition.shape) fields.antecedent = definition.shape.antecedent.extend({ value: Literal });
  if ('consequent' in definition.shape) fields.consequent = definition.shape.consequent.extend({ value: Literal });
  return { tag: definition.shape.operator.value, schema: z.strictObject(fields) };
});

const variableGroups = z.strictObject(Object.fromEntries(VariableGroups.map(group => [group.tag, z.array(group.schema).max(KE.MAX_DECISION_VARIABLES)])));
const ruleGroups = z.strictObject(Object.fromEntries(RuleGroups.map(group => [group.tag, z.array(group.schema).max(KE.MAX_DECISION_RULES)])));
const common = {
  title: KE.PublicDecisionFrame.shape.title,
  description: KE.PublicDecisionFrame.shape.description,
  rules: ruleGroups,
  clarificationQuestions: z.array(z.strictObject({ question: z.string().min(1).max(500),
    purpose: z.enum(['PUBLIC_SCOPE', 'PRIVATE_NEED']), variableId: z.string().max(80) })).max(12),
  participantInformationRequirements: z.array(z.strictObject({ participantId: id,
    kind: z.enum(['DATES', 'PREFERENCES', 'ACCESSIBILITY', 'BUDGET']) })).max(64),
};
export const Output = z.strictObject({ ...common, variables: variableGroups });
export const SelectedOutput = z.strictObject({ ...common, variableIds: z.array(id).min(1).max(KE.MAX_DECISION_VARIABLES) });
