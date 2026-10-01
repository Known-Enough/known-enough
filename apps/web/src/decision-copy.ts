import type { KnownEnough as KE } from '@deal-table/contracts';
const statusText: Record<KE.PublicDecisionSnapshot['status'], string> = {
  CREATING: 'Preparing the decision.', DEFINING: 'Review the proposed public choices.',
  COLLECTING_FRAME_CONFIRMATION: 'Waiting for everyone to review and confirm the shared terms.',
  COLLECTING_PRIVATE_INPUT: 'Waiting for private needs to be confirmed.',
  NEEDS_CLARIFICATION: 'A condition needs clarification before proposals can be explored.',
  READY: 'The confirmed needs are ready. You can explore proposals.', REASONING: 'Exploring proposals against the confirmed needs.',
  PRIVATE_NEGOTIATION: 'A private adjustment question needs an answer.', PROPOSED: 'A proposal is ready for everyone to review.',
  APPROVING: 'Some approvals are still missing.', AGREED: 'Everyone approved this exact proposal.',
  NO_AGREEMENT: 'No agreement has been reached. Review the choices or your own needs.',
  SUPERSEDED: 'The decision changed. Review the updated terms before continuing.', CLOSED: 'This decision is closed.',
};
export const decisionStatusText = (status: KE.PublicDecisionSnapshot['status']) => statusText[status];
export const privateReadinessText = (status: KE.OwnerDecisionSnapshot['ownInputReadiness']) => ({
  NOT_STARTED: 'Your private needs have not been confirmed yet.', NEEDS_CLARIFICATION: 'Clarify your unresolved condition before continuing.',
  READY: 'Your current private needs are confirmed.',
})[status];
