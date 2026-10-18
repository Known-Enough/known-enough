import type { KnownEnough as KE } from '@deal-table/contracts';
const statusText: Record<KE.PublicDecisionSnapshot['status'], string> = {
  CREATING: 'Preparing the decision.', DEFINING: 'Review the proposed public choices.',
  COLLECTING_FRAME_CONFIRMATION: 'Waiting for everyone to add their answers.',
  COLLECTING_PRIVATE_INPUT: 'Waiting for everyone to save their private answers.',
  NEEDS_CLARIFICATION: 'Some answers need clarification or new shared options.',
  READY: 'Everyone’s answers are saved. You can explore proposals.', REASONING: 'Exploring proposals against the confirmed needs.',
  PRIVATE_NEGOTIATION: 'A private adjustment question needs an answer.', PROPOSED: 'A proposal is ready for everyone to review.',
  APPROVING: 'Some approvals are still missing.', AGREED: 'Everyone approved this exact proposal.',
  NO_AGREEMENT: 'No agreement has been reached. Review the choices or your own needs.',
  SUPERSEDED: 'The decision changed. Review the updated terms before continuing.', CLOSED: 'This decision is closed.',
};
export const decisionStatusText = (status: KE.PublicDecisionSnapshot['status']) => statusText[status];
export const privateReadinessText = (status: KE.OwnerDecisionSnapshot['ownInputReadiness']) => ({
  NOT_STARTED: 'Your private answers have not been saved yet.', NEEDS_CLARIFICATION: 'Clarify your unresolved condition before continuing.',
  READY: 'Your current private answers are saved.',
})[status];

/** Compact labels for the decision header; full guidance remains available separately. */
const phaseLabel: Record<KE.PublicDecisionSnapshot['status'], string> = {
  CREATING: 'Preparing', DEFINING: 'Setting up', COLLECTING_FRAME_CONFIRMATION: 'Collecting answers',
  COLLECTING_PRIVATE_INPUT: 'Collecting answers', NEEDS_CLARIFICATION: 'Follow-up needed',
  READY: 'Ready to find an outcome', REASONING: 'Finding an outcome', PRIVATE_NEGOTIATION: 'Private follow-up',
  PROPOSED: 'Proposal ready', APPROVING: 'Waiting for approvals', AGREED: 'Decision agreed',
  NO_AGREEMENT: 'No agreement yet', SUPERSEDED: 'Decision updated', CLOSED: 'Closed',
};
export const decisionPhaseLabel = (status: KE.PublicDecisionSnapshot['status']) => phaseLabel[status];
