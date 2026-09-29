import { KnownEnough } from '@deal-table/contracts';

/** The simulated host receives a deliberately small public read model, never an owner snapshot. */
export type PublicAssistantContext = {
  decisionId: string;
  contextToken: string;
  semanticVersion: number;
  publicRevision: number;
  viewerParticipantId: string | null;
  status: KnownEnough.PublicDecisionSnapshot['status'];
  requiredApprovals: number;
  recordedApprovals: number;
  proposalId: string | null;
  proposalVersion: number | null;
  publishedReasons: string[];
};
export type PublicAssistantMemory = { stateKey: string; topic: 'status' | 'reasons' | null };
export type PublicAssistantTurn = { answer: string; memory: PublicAssistantMemory; revised: boolean };

function describePublishedValue(value: KnownEnough.DecisionValue, variable: KnownEnough.PublicDecisionVariable, snapshot: KnownEnough.PublicDecisionSnapshot): string {
  switch (value.type) {
    case 'NUMBER': return `${value.coefficient / (10 ** value.scale)} ${value.unitCode}`;
    case 'MONEY': return new Intl.NumberFormat('en-US', { style: 'currency', currency: value.currencyCode }).format(value.amountMinor / (10 ** value.minorUnit));
    case 'PERCENTAGE': return `${value.basisPoints / 100}%`;
    case 'DATE': return value.date;
    case 'DATETIME': return `${value.instant} (${value.displayTimeZone})`;
    case 'DURATION': return `${value.seconds} seconds`;
    case 'BOOLEAN': return value.value ? 'yes' : 'no';
    case 'ENUM': return variable.type === 'ENUM' ? variable.options.find(option => option.id === value.optionId)?.label ?? value.optionId : value.optionId;
    case 'ENUM_SET': return value.optionIds.map(id => variable.type === 'ENUM_SET' ? variable.options.find(option => option.id === id)?.label ?? id : id).join(', ');
    case 'PARTICIPANT': return snapshot.frame.participants.find(person => person.id === value.participantId)?.displayName ?? value.participantId;
  }
}

export function publicAssistantContext(raw: unknown): PublicAssistantContext {
  const snapshot = KnownEnough.PublicDecisionSnapshot.parse(raw);
  const proposal = snapshot.currentProposal;
  const now = Date.now();
  return {
    decisionId: snapshot.frame.decisionId,
    contextToken: snapshot.contextToken,
    semanticVersion: snapshot.semanticVersion,
    publicRevision: snapshot.publicRevision,
    viewerParticipantId: snapshot.viewerParticipantId,
    status: snapshot.status,
    requiredApprovals: snapshot.frame.requiredParticipantIds.length,
    recordedApprovals: snapshot.approvedParticipantIds.length,
    proposalId: proposal?.proposalId ?? null,
    proposalVersion: proposal?.facts.proposalVersion ?? null,
    publishedReasons: snapshot.publishedDisclosures.filter(item =>
      proposal && item.proposalId === proposal.proposalId
      && item.proposalVersion === proposal.facts.proposalVersion
      && item.contextToken === snapshot.contextToken
      && item.semanticVersion === snapshot.semanticVersion
      && item.decisionId === snapshot.frame.decisionId
      && (snapshot.viewerParticipantId === null
        ? snapshot.frame.participants.every(person => item.audienceParticipantIds.includes(person.id))
        : item.audienceParticipantIds.includes(snapshot.viewerParticipantId))
      && Date.parse(item.publishedAt) <= now
    ).slice(0, 3).map(item => {
      if (item.kind === 'EXACT_TEXT') return item.text.length <= 300 ? item.text : 'A longer published statement is available in the public view.';
      const parts = item.values.map(assignment => {
        const variable = snapshot.frame.variables.find(entry => entry.id === assignment.variableId);
        return variable ? `${variable.label}: ${describePublishedValue(assignment.value, variable, snapshot)}` : '';
      }).filter(Boolean);
      const statement = `Published values: ${parts.join('; ')}`;
      return statement.length <= 300 ? statement : 'A longer published value list is available in the public view.';
    }),
  };
}

export function publicAssistantStateKey(context: PublicAssistantContext): string {
  return JSON.stringify([context.decisionId, context.contextToken, context.semanticVersion,
    context.publicRevision, context.viewerParticipantId, context.status, context.proposalId,
    context.proposalVersion, context.requiredApprovals, context.recordedApprovals, context.publishedReasons]);
}

function statusAnswer(context: PublicAssistantContext): string {
  if (context.status === 'AGREED') return `The current proposal is agreed. All ${context.requiredApprovals} required approvals are recorded.`;
  if (context.status === 'PROPOSED' || context.status === 'APPROVING') {
    const remaining = context.requiredApprovals - context.recordedApprovals;
    return `A proposal is ready and is awaiting ${remaining} ${remaining === 1 ? 'approval' : 'approvals'}. ${context.recordedApprovals} of ${context.requiredApprovals} required approvals are recorded.`;
  }
  if (context.status === 'NO_AGREEMENT') return 'There is no current agreement or proposal.';
  if (context.status === 'CLOSED' || context.status === 'SUPERSEDED') return 'This decision is no longer active. There is no current proposal.';
  if (context.status === 'PRIVATE_NEGOTIATION' || context.status === 'REASONING') return 'The decision is still being worked on. There is no public proposal yet.';
  return 'There is no current proposal yet. The group is still preparing the decision.';
}

const privateProbe = /\b(who|whose|which person|which participant|name|identify|guess|infer|deduce|reconstruct|reverse.engineer|afford\w*|income|salary|budget|contribut\w*|private|secret|hidden|conflict\w*|refus\w*|rating\w*|preference\w*|condition\w*|constraint\w*|medical|health|availability)\b/i;
const otherDecision = /\b(other|another|different|cross.room|all rooms|every room|elsewhere)\s+(decision|room|group|trip|proposal)\b|\b(decision|room|group)\s+(other|another|different)\b/i;
const reasonQuestion = /\b(why|reason|explain|because|rationale|best|rank|better|chosen|choice)\b/i;
const statusQuestion = /\b(status|proposal|approvals?|approved|agree|agreement|ready|progress|pending|waiting|what now)\b/i;

export function answerPublicTurn(context: PublicAssistantContext, question: string, previous?: PublicAssistantMemory): PublicAssistantTurn {
  const key = publicAssistantStateKey(context);
  const revised = !!previous && previous.stateKey !== key;
  const memory: PublicAssistantMemory = { stateKey: key, topic: null };
  const normalized = question.trim().slice(0, 500);
  if (!normalized) return { answer: 'Ask about the current proposal, approvals, or published public reasons.', memory, revised };
  const namedDecision = normalized.match(/\b[A-Za-z0-9_-]+-decision\b/g)?.some(id => id !== context.decisionId);
  if (otherDecision.test(normalized) || namedDecision) return { answer: 'I can answer only for this decision. Open the other decision and load its current public view there.', memory, revised };
  if (privateProbe.test(normalized)) return { answer: 'I cannot identify or infer anyone’s private circumstances, inputs, conflicts, ratings, or refusals. I can share the current public status and explicitly published wording.', memory, revised };
  const reasons = reasonQuestion.test(normalized) || (/^(and|what about|tell me more|more)\b/i.test(normalized) && !revised && previous?.topic === 'reasons');
  if (reasons) {
    memory.topic = 'reasons';
    if (!context.proposalId) return { answer: 'There is no current proposal to explain. I cannot describe private deliberation.', memory, revised };
    if (!context.publishedReasons.length) return { answer: 'No public reason has been published for the current proposal. Its public terms are visible in the shared decision, but they do not prove it is the best option.', memory, revised };
    return { answer: `Published information for this proposal: ${context.publishedReasons.map(value => `“${value}”`).join(' ')} This does not prove the proposal is the best option or reveal anyone’s private reasons.`, memory, revised };
  }
  if (statusQuestion.test(normalized) || (/^(and|what about|tell me more|more)\b/i.test(normalized) && !revised && previous?.topic === 'status')) {
    memory.topic = 'status';
    return { answer: statusAnswer(context), memory, revised };
  }
  return { answer: 'I can answer about the current proposal, approvals, or explicitly published public reasons. I cannot use private information or make decisions for participants.', memory, revised };
}
