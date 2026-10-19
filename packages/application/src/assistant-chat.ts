import { Alexa, AssistantChat as Chat, publicChoiceOptions, type KnownEnough as KE } from '@deal-table/contracts';
import { KnownEnoughApplicationError, publicSnapshot } from './known-enough.ts';
import type { Clock, KnownEnoughRecord, KnownEnoughRepository, TrustedPrincipal } from './types.ts';

function fail(code: 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID_COMMAND' | 'STALE_CONTEXT' | 'CAPACITY_EXCEEDED'): never {
  throw new KnownEnoughApplicationError(code);
}
function member(record: KnownEnoughRecord | null, principal: TrustedPrincipal) {
  if (!record || principal.kind !== 'participant') return fail('NOT_FOUND');
  const value = record.memberships.find(value => value.active && value.subject === principal.subject);
  if (!value || !record.definition.participants.some(person => person.id === value.participantId)) return fail('NOT_FOUND');
  return value.participantId;
}
function visible(message: Chat.Message, scope: Chat.Scope, owner: string) {
  return message.scope === scope && (scope === 'group' || message.ownerId === owner);
}
export type ChatContext = { summary: Alexa.DecisionSummary; options: { topic: string; option: string }[];
  messages: { role: 'person' | 'assistant'; text: string }[]; contextToken: string; publicRevision: number };
function valueLabel(frame: KE.PublicDecisionFrame, variable: KE.PublicDecisionFrame['variables'][number], value: KE.DecisionValue): string {
  switch (value.type) {
    case 'ENUM': return variable.type === 'ENUM' ? variable.options.find(option => option.id === value.optionId)?.label ?? value.optionId : value.optionId;
    case 'ENUM_SET': return variable.type === 'ENUM_SET' ? value.optionIds.map(id => variable.options.find(option => option.id === id)?.label ?? id).join(', ') : value.optionIds.join(', ');
    case 'DATE': return value.date;
    case 'DATETIME': return `${value.instant} (${value.displayTimeZone})`;
    case 'MONEY': return new Intl.NumberFormat('en-US', { style: 'currency', currency: value.currencyCode }).format(value.amountMinor / 10 ** value.minorUnit);
    case 'NUMBER': return `${value.coefficient / 10 ** value.scale} ${value.unitCode}`;
    case 'PERCENTAGE': return `${value.basisPoints / 100}%`;
    case 'DURATION': return `${value.seconds} seconds`;
    case 'BOOLEAN': return value.value ? 'Yes' : 'No';
    case 'PARTICIPANT': return frame.participants.find(person => person.id === value.participantId)?.displayName ?? 'Participant';
  }
}
export function renderChatPlan(raw: unknown, context: ChatContext, scope: Chat.Scope): string {
  const plan = Chat.Plan.parse(raw), summary = context.summary;
  const approvals = `${summary.approved} of ${summary.requiredApprovals} required approvals are recorded.`;
  const status = summary.status === 'AGREED' ? 'The decision is agreed.' : summary.status === 'CLOSED' ? 'The decision is closed.'
    : summary.proposalId ? 'There is a proposal to review; it is not an agreed outcome.'
      : summary.status === 'REASONING' ? 'The app is finding an outcome from the saved answers.' : 'There is no shared outcome yet.';
  let answer: string;
  switch (plan.focus) {
    case 'PROGRESS': {
      const waiting = summary.participants.filter(person => person.answered === false).map(person => person.name);
      answer = status + ' ' + approvals + (waiting.length ? '\nWaiting for answers from: ' + waiting.join(', ') + '.'
        : summary.participants.every(person => person.answered === true) ? '\nEveryone’s answers are saved.' : '\nSome response information is unavailable.'); break;
    }
    case 'OUTCOME': answer = status + (summary.proposalId ? '\n' + summary.choices.map(choice => `${choice.topic}: ${choice.option}`).join('\n') + '\n' + approvals : ' Everyone can add their own answers in the decision screen.'); break;
    case 'APPROVALS': answer = status + ' ' + approvals + '\n' + summary.participants.filter(person => person.required).map(person => `${person.name}: ${person.approved ? 'approved' : 'approval pending'}`).join('\n'); break;
    case 'EXPLAIN': answer = status + ' ' + approvals + '\nThe app compares saved conditions with the shared choices. A proposal needs each required person’s explicit approval. Shared results do not explain anyone’s private reasons.'; break;
    case 'OPTIONS': {
      const indexes = [...new Set(plan.optionIndexes)];
      if (indexes.some(index => !context.options[index])) return fail('INVALID_COMMAND');
      const choices = indexes.length ? indexes.map(index => context.options[index]!) : context.options.slice(0, 3);
      answer = choices.length ? 'Some existing options to consider:\n' + choices.map(choice => `• ${choice.topic}: ${choice.option}`).join('\n')
        + '\nThese are suggestions to think about, not a result or a claim that they meet everyone’s preferences.' : 'No finite shared options are available to compare yet. You can discuss an idea here; the organizer edits the decision’s choices.'; break;
    }
    case 'REFLECT': answer = scope === 'private' ? 'We can work through what matters to you here. This conversation does not save your decision answers or share them with anyone.' : 'Everyone in this decision can read this conversation. Use the Private assistant to work through personal preferences.'; break;
    case 'PRIVACY': answer = 'I cannot access another person’s private answers or explain their personal reasons. I can explain shared progress, choices and results.'; break;
    case 'ACTION': answer = 'Use the decision screen to change answers, choices or permissions, or review and approve a proposal. Each person must make their own explicit choice; chat cannot do that for anyone.'; break;
    case 'ACKNOWLEDGE': answer = scope === 'private' ? 'We can explore your thoughts privately. Nothing here changes your saved answers or goes into Group chat unless you choose to post it.' : 'Your message is in Group chat. Everyone in this decision can see it. I can help explain the shared choices and current progress.'; break;
  }
  const prompts = { NONE: '', PRIORITY: 'What matters most to you about this choice?', TRADEOFF: 'What would you gain or give up with each option?', MUST_HAVE: 'Which part is essential for you, and which part is a preference?', FLEXIBILITY: 'Where would you feel comfortable being flexible?', COMPARE: 'Which two options would you like to compare?', NEXT_STEP: 'Would you like to look at the choices or check the current progress?' };
  return answer + (prompts[plan.question] ? '\n\n' + prompts[plan.question] : '');
}

export class AssistantChatApplication {
  constructor(private readonly repository: KnownEnoughRepository, private readonly clock: Clock) {}
  async read(principal: TrustedPrincipal, decisionId: string, scope: Chat.Scope): Promise<Chat.Snapshot> {
    return this.repository.transactionDecision(decisionId, record => {
      const owner = member(record, principal), now = Date.parse(this.clock.now());
      if (record!.assistantMessages?.some(message => Date.parse(message.expiresAt) <= now))
        record!.assistantMessages = record!.assistantMessages.filter(message => Date.parse(message.expiresAt) > now);
      return Chat.Snapshot.parse({ decisionId, scope, viewerId: owner, retentionDays: 30,
        messages: (record!.assistantMessages ?? []).filter(message => Date.parse(message.expiresAt) > now && visible(message, scope, owner)) });
    });
  }
  async post(principal: TrustedPrincipal, decisionId: string, scope: Chat.Scope, raw: unknown, retentionUntil: string, modelSource: string | null = null) {
    const post = Chat.Post.safeParse(raw); if (!post.success) return fail('INVALID_COMMAND');
    return this.repository.transactionDecision(decisionId, record => {
      const owner = member(record, principal), value = post.data, now = Date.parse(this.clock.now());
      const messages = (record!.assistantMessages ?? []).filter(message => Date.parse(message.expiresAt) > now);
      const previous = messages.find(message => message.id === value.requestId);
      if (previous) {
        if (previous.authorId !== owner || !visible(previous, scope, owner) || previous.text !== value.text || previous.askAssistant !== value.askAssistant) return fail('STALE_CONTEXT');
        return { message: previous, created: false };
      }
      if (value.shareMessageId) {
        const original = messages.find(message => message.id === value.shareMessageId && message.scope === 'private' && message.ownerId === owner);
        if (scope !== 'group' || !original || original.text !== value.text) return fail('FORBIDDEN');
      }
      const expiry = Math.min(now + Chat.RETENTION_MS, Date.parse(retentionUntil));
      if (!Number.isFinite(expiry) || expiry <= now) return fail('FORBIDDEN');
      const message = Chat.Message.parse({ id: value.requestId, scope, ownerId: scope === 'private' ? owner : null,
        authorId: owner, authorName: record!.definition.participants.find(person => person.id === owner)!.displayName,
        role: 'person', text: value.text, createdAt: this.clock.now(), expiresAt: new Date(expiry).toISOString(),
        replyTo: null, askAssistant: value.askAssistant, modelSource: value.askAssistant ? modelSource : null,
        contextToken: record!.definition.contextToken, publicRevision: record!.publicRevision });
      const next = Chat.History.safeParse([...messages, message]); if (!next.success) return fail('CAPACITY_EXCEEDED');
      record!.assistantMessages = next.data;
      return { message, created: true };
    });
  }
  async context(principal: TrustedPrincipal, decisionId: string, scope: Chat.Scope, requestId: string): Promise<ChatContext> {
    return this.repository.transactionDecision(decisionId, record => {
      const owner = member(record, principal), now = Date.parse(this.clock.now());
      const history = (record!.assistantMessages ?? []).filter(message => visible(message, scope, owner) && Date.parse(message.expiresAt) > now);
      const selected = history.find(message => message.id === requestId && message.authorId === owner && message.askAssistant);
      if (!selected) return fail('NOT_FOUND');
      const snapshot = publicSnapshot(record!, owner);
      const options = snapshot.frame.variables.flatMap(variable => (publicChoiceOptions(snapshot.frame, variable) ?? []).slice(0, 16)
        .map(value => ({ topic: variable.label, option: valueLabel(snapshot.frame, variable, value) }))).slice(0, 64);
      const preceding = history.slice(0, history.indexOf(selected) + 1);
      const ownQuestions = new Set(preceding.filter(message => message.authorId === owner).map(message => message.id));
      // Only this sender's messages and the server replies to them in THIS tab.
      // No peer chat, owner snapshots, private answers or other-tab context.
      return { summary: Alexa.sharedDecisionSummary(snapshot), options,
        messages: preceding.filter(message => message.authorId === owner || message.replyTo && ownQuestions.has(message.replyTo))
          .slice(-8).map(message => ({ role: message.role, text: message.text })),
        contextToken: snapshot.contextToken, publicRevision: snapshot.publicRevision };
    });
  }
  async reply(principal: TrustedPrincipal, decisionId: string, scope: Chat.Scope, requestId: string, plan: unknown, expected: ChatContext) {
    const fresh = await this.context(principal, decisionId, scope, requestId);
    if (fresh.contextToken !== expected.contextToken || fresh.publicRevision !== expected.publicRevision) return fail('STALE_CONTEXT');
    const rendered = renderChatPlan(plan, fresh, scope);
    const text = rendered.length > 4000 ? rendered.slice(0, 3900) + '\nOpen the decision to see the complete shared result.' : rendered;
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(requestId));
    const replyId = 'reply-' + Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
    return this.repository.transactionDecision(decisionId, record => {
      const owner = member(record, principal), messages = record!.assistantMessages ?? [];
      if (record!.definition.contextToken !== fresh.contextToken || record!.publicRevision !== fresh.publicRevision) return fail('STALE_CONTEXT');
      const original = messages.find(message => message.id === requestId && message.authorId === owner && visible(message, scope, owner));
      if (!original || Date.parse(original.expiresAt) <= Date.parse(this.clock.now())) return fail('NOT_FOUND');
      if (messages.some(message => message.replyTo === requestId)) return;
      const reply = Chat.Message.parse({ ...original, id: replyId, authorId: null, authorName: 'Alexa+', role: 'assistant',
        text, createdAt: this.clock.now(), replyTo: requestId, askAssistant: false, modelSource: null,
        contextToken: fresh.contextToken, publicRevision: fresh.publicRevision });
      const next = Chat.History.safeParse([...messages.filter(message => Date.parse(message.expiresAt) > Date.parse(this.clock.now())), reply]);
      if (!next.success) return fail('CAPACITY_EXCEEDED');
      record!.assistantMessages = next.data;
    });
  }
}
