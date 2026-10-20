import { z } from 'zod';
import * as KE from './known-enough.ts';

/** Public suggestion/editor format. No model-owned ids, participants, rules or permissions. */
export const ChoicePlan = z.strictObject({
  title: z.string().max(80), description: z.string().max(1000),
  topics: z.array(z.strictObject({ label: z.string().max(120), kind: z.enum(['CHOICE', 'DATE']),
    options: z.array(z.string().max(100)).max(16) })).max(6),
});
export type ChoicePlan = z.infer<typeof ChoicePlan>;
export function compileChoicePlan(plan: ChoicePlan) {
  const variables: KE.PublicDecisionVariable[] = [], rules: KE.ValidationRule[] = [], questions: string[] = [];
  if (!plan.topics.length) questions.push('What should your group choose? Add a topic and the options you are considering.');
  let combinations = 1;
  for (const [index, topic] of plan.topics.entries()) {
    const label = topic.label.trim(), options = topic.options.map(value => value.trim());
    if (!label) { questions.push(`What is the name of choice ${index + 1}?`); continue; }
    if (options.length > 16 || options.some(value => value.length > 100)) { questions.push(`Keep “${label}” to 16 options or fewer, each at most 100 characters.`); continue; }
    if (!options.length || options.some(value => !value)) { questions.push(`Which options should people choose between for “${label}”? Add at least one option and fill or remove empty lines.`); continue; }
    if (new Set(options.map(value => value.toLowerCase())).size !== options.length) { questions.push(`Some options for “${label}” are repeated. Remove duplicates.`); continue; }
    const id = `choice-${index + 1}`;
    if (topic.kind === 'DATE') {
      if (options.some(date => !KE.DecisionValue.safeParse({ type: 'DATE', date }).success)) {
        questions.push(`Which dates should your group consider for “${label}”? Choose exact dates, or change the options format to Text options.`); continue;
      }
      variables.push({ id, label, type: 'DATE', visibility: 'PUBLIC', required: true });
      rules.push({ id: `domain-${index + 1}`, visibility: 'PUBLIC', operator: 'IN', variableId: id,
        values: options.map(date => ({ type: 'DATE', date })) });
    } else variables.push({ id, label, type: 'ENUM', visibility: 'PUBLIC', required: true,
      options: options.map((label, option) => ({ id: `option-${index + 1}-${option + 1}`, label })) });
    combinations *= options.length;
  }
  if (combinations > 64) questions.push(`These choices make ${combinations} combinations of possible outcomes. Remove some options or split this into smaller decisions so there are no more than 64.`);
  return { variables, rules, questions, combinations };
}
