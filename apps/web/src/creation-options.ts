import { ChoicePlan, type Groups, type KnownEnough as KE } from '@deal-table/contracts';

export type CreationSuggestion = { draft: Groups.GroupDraft; plan: ChoicePlan; description: string; intent: 'description' | 'options' };
const normalized = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('en-US');

export function emptyChoicePlan(objective: string): ChoicePlan {
  return { title: objective.trim().split(/\s+/).slice(0, 3).join(' ').slice(0, 80), description: '',
    topics: [{ label: 'Options', kind: 'CHOICE', options: [] }] };
}

/** Older saved frames retain their original rules; this projection is only used to review suggestions. */
export function suggestedChoices(draft: Groups.GroupDraft): ChoicePlan {
  if (draft.choicePlan) return structuredClone(draft.choicePlan);
  return { title: draft.frame.title.slice(0, 80), description: draft.frame.description.slice(0, 1000),
    topics: draft.frame.variables.flatMap<ChoicePlan['topics'][number]>(variable => {
      if (variable.type === 'ENUM' || variable.type === 'ENUM_SET') return [{ label: variable.label, kind: 'CHOICE' as const, options: variable.options.map(option => option.label) }];
      const domain = draft.frame.rules.find(rule => 'variableId' in rule && rule.variableId === variable.id && rule.operator === 'IN');
      if (variable.type !== 'DATE' || domain?.operator !== 'IN' || domain.values.some(value => value.type !== 'DATE')) return [];
      return [{ label: variable.label, kind: 'DATE' as const, options: domain.values.map(value => (value as Extract<KE.DecisionValue, { type: 'DATE' }>).date) }];
    }).slice(0, 6) };
}

/** Explicitly merge one reviewed option; never replace user-authored options or another topic. */
export function addSuggestedOption(plan: ChoicePlan, topic: ChoicePlan['topics'][number], option: string): ChoicePlan | null {
  const value = option.trim();
  if (!value || value.length > 100) return null;
  const next = structuredClone(plan);
  let index = next.topics.findIndex(item => normalized(item.label) === normalized(topic.label) && item.kind === topic.kind);
  if (index < 0 && next.topics.length === 1 && next.topics[0]!.label === 'Options' && (!next.topics[0]!.options.length || next.topics[0]!.kind === topic.kind)) {
    if (!next.topics[0]!.options.length) { next.topics[0]!.label = topic.label; next.topics[0]!.kind = topic.kind; }
    index = 0;
  }
  if (index < 0) {
    if (next.topics.length >= 6) return null;
    next.topics.push({ label: topic.label, kind: topic.kind, options: [] }); index = next.topics.length - 1;
  }
  const target = next.topics[index]!;
  if (target.options.length >= 16 || target.options.some(item => normalized(item) === normalized(value))) return null;
  target.options.push(value);
  return ChoicePlan.safeParse(next).success ? next : null;
}
