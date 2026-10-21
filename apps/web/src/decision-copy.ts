import type { KnownEnough as KE } from '@deal-table/contracts';
const statusText: Record<KE.PublicDecisionSnapshot['status'], string> = {
  CREATING: 'Preparing the decision.', DEFINING: 'Review the options for your group.',
  COLLECTING_FRAME_CONFIRMATION: 'Waiting for the required participants to answer.',
  COLLECTING_PRIVATE_INPUT: 'Waiting for the required participants to save their answers.',
  NEEDS_CLARIFICATION: 'Some answers need more detail, or the group needs other options.',
  READY: 'The required answers are saved. An outcome will be prepared automatically.', REASONING: 'Finding an option that fits the saved answers.',
  PRIVATE_NEGOTIATION: 'Check your private follow-up question.', PROPOSED: 'A proposal is ready to review.',
  APPROVING: 'Waiting for the remaining approvals.', AGREED: 'All required participants approved this proposal.',
  NO_AGREEMENT: 'No matching outcome. You can edit your answers and try again.',
  SUPERSEDED: 'The decision changed. Check the updated options before continuing.', CLOSED: 'This decision is closed.',
};
export const decisionStatusText = (status: KE.PublicDecisionSnapshot['status']) => statusText[status];
export const privateReadinessText = (status: KE.OwnerDecisionSnapshot['ownInputReadiness']) => ({
  NOT_STARTED: 'You haven’t saved your answers yet.', NEEDS_CLARIFICATION: 'An extra requirement needs more detail before we can find an outcome.',
  READY: 'Your current private answers are saved.',
})[status];

/** Compact labels for the decision header; full guidance remains available separately. */
const phaseLabel: Record<KE.PublicDecisionSnapshot['status'], string> = {
  CREATING: 'Preparing', DEFINING: 'Setting up', COLLECTING_FRAME_CONFIRMATION: 'Collecting answers',
  COLLECTING_PRIVATE_INPUT: 'Collecting answers', NEEDS_CLARIFICATION: 'Follow-up needed',
  READY: 'Preparing outcome', REASONING: 'Finding an outcome', PRIVATE_NEGOTIATION: 'Private follow-up',
  PROPOSED: 'Proposal ready', APPROVING: 'Waiting for approvals', AGREED: 'Decision agreed',
  NO_AGREEMENT: 'No matching outcome', SUPERSEDED: 'Decision updated', CLOSED: 'Closed',
};
export const decisionPhaseLabel = (status: KE.PublicDecisionSnapshot['status']) => phaseLabel[status];
