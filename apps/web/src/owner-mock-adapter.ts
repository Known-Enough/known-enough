import { OwnerSnapshot, type OwnerSnapshot as OwnerSnapshotType } from '@deal-table/contracts';

export type OwnerMockScenario = 'review' | 'draft' | 'hard-first-draft' | 'approval' | 'empty' | 'failure' | 'stale';

export interface OwnerMockRead {
  value: OwnerSnapshotType | null;
  freshness: 'fresh' | 'stale';
}

export interface OwnerRoomClient {
  getOwnerRoom(): Promise<OwnerSnapshotType>;
  readOwnerRoom(scenario?: OwnerMockScenario, options?: { refresh?: boolean }): Promise<OwnerMockRead>;
}

const timezone = 'America/Mexico_City' as const;
const meeting = { id: 'slot-660', interval: { date: '2026-10-08', timezone, startMinute: 660, endMinute: 690 } };
const condition = { id: 'condition-nina-1100', kind: 'NEGOTIABLE_UNAVAILABLE' as const, interval: meeting.interval, inviteException: true };
const values = { conditions: [condition], dutyCosts: [{ dutyId: 'followup', cost: 0 }] };
const draftValues = { conditions: [condition], dutyCosts: [{ dutyId: 'followup', cost: 1 }] };
const hardFirstDraftValues = { conditions: [
  { id: 'hard-owner', kind: 'HARD_AVAILABILITY' as const, availableIntervals: [
    { date: '2026-10-08', timezone, startMinute: 660, endMinute: 720 },
    { date: '2026-10-11', timezone, startMinute: 600, endMinute: 660 },
  ] },
  condition,
], dutyCosts: [{ dutyId: 'followup', cost: 1 }] };
const availabilityReview = { contextToken: 'ctx_Q7c2M9k1', inputRevision: 1, intervals: [meeting.interval] };
const expiresAt = '2026-10-08T15:00:00Z';
const inferenceWarning = 'People may infer who changed availability from the plan. Published words cannot be made secret again.' as const;

function buildOwnerSnapshot(scenario: Exclude<OwnerMockScenario, 'empty' | 'failure' | 'stale'>): OwnerSnapshotType {
  const snapshot = {
    schemaVersion: 1,
    roomId: 'room-synthetic',
    contextToken: 'ctx_Q7c2M9k1',
    ownerMemberId: 'nina',
    ownerRevision: scenario === 'draft' || scenario === 'hard-first-draft' ? 2 : 1,
    controlVersion: scenario === 'approval' ? 3 : 2,
    confirmedInputs: { values, confirmed: true, confirmedAt: '2026-10-01T16:00:00Z', inputRevision: 1, contextToken: 'ctx_Q7c2M9k1' },
    availabilityReview,
    draft: scenario === 'draft' || scenario === 'hard-first-draft'
      ? { draftId: 'draft-nina-2', draftRevision: 2, values: scenario === 'hard-first-draft' ? hardFirstDraftValues : draftValues }
      : null,
    pendingOffers: [{ id: 'offer-nina-1', version: 1, scope: { conditionId: condition.id, roomId: 'room-synthetic', contextToken: 'ctx_Q7c2M9k1', decisionRevision: 1, inputRevision: 1, rosterMemberIds: ['maya', 'leo', 'nina'], policy: 'BALANCE_RECENT_LOAD', meeting, predicate: 'OWNER_HAS_NO_WEEKEND_DUTIES', expiresAt } }],
    disclosurePreviews: [{ id: 'disclosure-nina-1', text: 'A conditional availability exception makes the proposed plan possible.', textHash: '3914698185f1d172061ca50290f9fdee09f4d88995863f449fdc4b65056d7771', audienceMemberIds: ['maya', 'leo', 'nina'], roomId: 'room-synthetic', contextToken: 'ctx_Q7c2M9k1', decisionRevision: 1, expiresAt, inferenceWarning }],
    exceptionGrants: scenario === 'approval' ? [{ id: 'grant-exception-nina-1', version: 1, scope: {
      conditionId: condition.id, roomId: 'room-synthetic', contextToken: 'ctx_Q7c2M9k1', decisionRevision: 1,
      inputRevision: 1, rosterMemberIds: ['maya', 'leo', 'nina'], policy: 'BALANCE_RECENT_LOAD', meeting,
      predicate: 'OWNER_HAS_NO_WEEKEND_DUTIES', expiresAt,
    }, status: 'ACTIVE' }] : [],
    disclosureGrants: scenario === 'approval' ? [{ id: 'grant-disclosure-nina-1', version: 1, preview: {
      id: 'disclosure-nina-1', text: 'A conditional availability exception makes the proposed plan possible.',
      textHash: '3914698185f1d172061ca50290f9fdee09f4d88995863f449fdc4b65056d7771',
      audienceMemberIds: ['maya', 'leo', 'nina'], roomId: 'room-synthetic', contextToken: 'ctx_Q7c2M9k1',
      decisionRevision: 1, expiresAt, inferenceWarning,
    }, status: 'ACTIVE', publishedAt: null }] : [],
    ownApproval: scenario === 'approval' ? { proposalId: 'proposal-A', proposalVersion: 1, contextToken: 'ctx_Q7c2M9k1', planHash: '27e5ade267f9fa2ee39ba863cd22608a6dbb5a0522596a5eb65b945f5ccc5081', acceptedAt: '2026-10-08T14:30:00Z' } : null,
  };
  return OwnerSnapshot.parse(snapshot);
}

const latency = () => new Promise<void>(resolve => globalThis.setTimeout(resolve, 180));

export const ownerMockClient: OwnerRoomClient = {
  async getOwnerRoom() { return buildOwnerSnapshot('review'); },
  async readOwnerRoom(scenario = 'review', options = {}) {
    await latency();
    if (scenario === 'failure') throw new Error('Synthetic owner mock failure');
    if (scenario === 'empty') return { value: null, freshness: 'fresh' };
    if (scenario === 'stale') return { value: buildOwnerSnapshot('review'), freshness: options.refresh ? 'fresh' : 'stale' };
    return { value: buildOwnerSnapshot(scenario), freshness: 'fresh' };
  },
};
