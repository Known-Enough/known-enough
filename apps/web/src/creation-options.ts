import { ChoicePlan, type Groups, type KnownEnough as KE } from '@deal-table/contracts';

export type CreationSuggestion = { draft: Groups.GroupDraft; plan: ChoicePlan; description: string; intent: 'description' | 'options' };
const normalized = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('en-US');

/** A local starting name, using only supplied words. AI names are reviewed separately. */
export function suggestedDecisionTitle(description: string): string {
  const line = description.trim().replace(/^[#*_\s]+/, '').split(/\n|[.!?](?:\s|$)/)[0] ?? '';
  let title = line.replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
  for (let pass = 0; pass < 3; pass++) title = title
    .replace(/^(?:(?:our|the|my) group (?:is |wants to |needs to )?|(?:we|i)(?:'re|'m| are| am| want to| need to| would like to)? |let's |should we |can we )/i, '')
    .replace(/^(?:to\s+)?(?:decid(?:e|ing)(?: on| between| whether)?|choos(?:e|ing)(?: between)?|pick(?:ing)?|select(?:ing)?|plan(?:ning)?|organiz(?:e|ing)|schedul(?:e|ing))\s+/i, '');
  const occasion = title.match(/\s+for\s+(.+)$/i)?.[1];
  if (occasion && !/^(?:us|me|everyone|our group|the group)$/i.test(occasion.trim()) && occasion.trim().split(/\s+/).length <= 7 && !/\b(?:under|less|more|at least|at most)\b|[$€£]/i.test(occasion)) title = occasion;
  title = title.replace(/^(?:(?:a|an|the|our|my)(?:\s+|$))+/i, '').split(/\s+/).slice(0, 7).join(' ')
    .replace(/\s+(?:a|an|the|to|for|on|of|and|or|with)$/i, '').replace(/[,:;*_\s]+$/, '').slice(0, 80).trim();
  return title ? title.charAt(0).toLocaleUpperCase() + title.slice(1) : 'New decision';
}

export function emptyChoicePlan(objective: string): ChoicePlan {
  return { title: suggestedDecisionTitle(objective), description: '',
    topics: [{ label: '', kind: 'CHOICE', options: [] }] };
}

/** A whole topic is accepted explicitly; existing named topics and options are never replaced. */
export function addSuggestedTopic(plan: ChoicePlan, topic: ChoicePlan['topics'][number]): ChoicePlan | null {
  if (!topic.label.trim() || !topic.options.length) return null;
  const next = structuredClone(plan);
  let index = next.topics.findIndex(item => normalized(item.label) === normalized(topic.label) && item.kind === topic.kind);
  if (index < 0) {
    const initial = next.topics.length === 1 && (!next.topics[0]!.label.trim() || next.topics[0]!.label === 'Options') && !next.topics[0]!.options.length;
    if (initial) { next.topics[0] = { label: topic.label, kind: topic.kind, options: [] }; index = 0; }
    else {
      if (next.topics.length >= 6) return null;
      next.topics.push({ label: topic.label, kind: topic.kind, options: [] }); index = next.topics.length - 1;
    }
  }
  const target = next.topics[index]!;
  const additions = topic.options.map(option => option.trim()).filter((option, at, options) => option && !target.options.some(saved => normalized(saved) === normalized(option))
    && options.findIndex(other => normalized(other) === normalized(option)) === at);
  if (!additions.length || target.options.length + additions.length > 16) return null;
  target.options.push(...additions);
  return ChoicePlan.safeParse(next).success ? next : null;
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
  if (index < 0 && next.topics.length === 1 && (!next.topics[0]!.label.trim() || next.topics[0]!.label === 'Options') && (!next.topics[0]!.options.length || next.topics[0]!.kind === topic.kind)) {
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
