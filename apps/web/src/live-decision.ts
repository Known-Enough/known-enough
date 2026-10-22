import { Alexa } from '@deal-table/contracts';

/** Accept only the public tool result for the decision currently open in chat. */
export function liveDecisionResult(result: unknown, decisionId: string): Alexa.DecisionSummary {
  if (!result || typeof result !== 'object' || !('structuredContent' in result)
    || 'isError' in result && result.isError !== false && result.isError !== undefined) throw new Error('Decision read failed');
  const value = Alexa.DecisionSummary.parse(result.structuredContent);
  if (value.decisionId !== decisionId || value.approved > value.requiredApprovals
    || (value.proposalId === null) !== (value.proposalVersion === null)
    || !value.proposalId && value.choices.length
    || value.status === 'AGREED' && (!value.proposalId || !value.requiredApprovals || value.approved !== value.requiredApprovals)) {
    throw new Error('Decision result does not match');
  }
  return value;
}

export function liveDecisionCopy(value: Alexa.DecisionSummary) {
  const hasOutcome = !!value.proposalId && !['CLOSED', 'SUPERSEDED'].includes(value.status);
  if (value.status === 'AGREED') return { label: 'Decision agreed', explanation: 'Everyone has approved this outcome.', hasOutcome };
  if (value.status === 'CLOSED' || value.status === 'SUPERSEDED') return { label: 'Decision closed', explanation: 'This decision is no longer active.', hasOutcome: false };
  if (value.status === 'NO_AGREEMENT') return { label: 'No matching outcome', explanation: 'There is no matching outcome. You can return to the decision to edit your answers.', hasOutcome: false };
  if (value.status === 'REASONING') return { label: 'Finding an outcome', explanation: 'The group’s saved answers are being compared.', hasOutcome };
  if (hasOutcome) return { label: 'Proposed outcome', explanation: 'This proposal still needs approval. Each person approves for themselves.', hasOutcome };
  if (value.status === 'READY') return { label: 'Answers saved', explanation: 'The group’s answers are saved. An outcome has not been published yet.', hasOutcome: false };
  return { label: 'Decision in progress', explanation: 'An outcome will appear here when it is ready. Other people’s private answers stay private.', hasOutcome: false };
}
