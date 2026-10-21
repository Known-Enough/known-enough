import { KnownEnough as KE } from '@deal-table/contracts';

export type DecisionListStatus = { label: string; tone: 'action' | 'waiting' | 'agreed' | 'muted'; detail?: string | undefined };
export function decisionListStatus(owner: KE.OwnerDecisionSnapshot): DecisionListStatus {
  const snapshot = owner.publicSnapshot;
  const required = snapshot.frame.requiredParticipantIds.includes(owner.ownerParticipantId);
  const answered = snapshot.participantProgress ? `${snapshot.participantProgress.filter(item => item.answersSaved).length} of ${snapshot.frame.participants.length} answered` : undefined;
  if (snapshot.status === 'AGREED') return { label: 'Decision agreed', tone: 'agreed' };
  if (snapshot.status === 'CLOSED') return { label: 'Decision closed', tone: 'muted' };
  if (['CREATING', 'DEFINING'].includes(snapshot.status)) return { label: 'Draft', tone: 'muted' };
  if (snapshot.status === 'REASONING') return { label: 'Finding an outcome', tone: 'waiting' };
  if (owner.pendingQuestions.some(question => question.status === 'PENDING') || owner.disclosurePermissions.some(permission => permission.status === 'PENDING'))
    return { label: 'Needs your answer', tone: 'action', detail: 'Private follow-up' };
  if (snapshot.currentProposal) return owner.ownApproval || !required
    ? { label: 'Waiting for approvals', tone: 'waiting', detail: `${snapshot.frame.requiredParticipantIds.filter(id => snapshot.approvedParticipantIds.includes(id)).length} of ${snapshot.frame.requiredParticipantIds.length} approved` }
    : { label: 'Ready for approval', tone: 'action', detail: 'Outcome proposed' };
  if (!required) return { label: 'Waiting for others', tone: 'waiting', detail: answered };
  if (owner.ownInputReadiness !== 'READY') return { label: 'Needs your answer', tone: 'action', detail: answered };
  if (snapshot.status === 'READY') return { label: 'Preparing outcome', tone: 'waiting', detail: answered };
  if (snapshot.status === 'NO_AGREEMENT') return { label: 'No matching outcome', tone: 'muted' };
  if (snapshot.status === 'SUPERSEDED') return { label: 'Decision updated', tone: 'muted', detail: answered };
  return { label: 'Waiting for others', tone: 'waiting', detail: answered };
}
export async function readDecisionListStatus(api: (path: string, init?: RequestInit) => Promise<Response>, decisionId: string, signal: AbortSignal): Promise<DecisionListStatus> {
  const response = await api(`/decisions/${decisionId}/me`, { signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) });
  if (!response.ok) throw new Error('Status unavailable');
  const owner = KE.OwnerDecisionSnapshot.parse(await response.json());
  if (owner.publicSnapshot.frame.decisionId !== decisionId) throw new Error('Wrong decision');
  // Keep only derived labels/counts; never return/store private answers in list state.
  return decisionListStatus(owner);
}
