import type {
  CommandEnvelope, CommandResult, ConfirmedInputs, DisclosureGrant, DisclosurePreview,
  ExceptionGrant, ExceptionOffer, FinalApproval, InputDraft, Interval,
  Participant, Policy, ProposalView, PublicRoomSnapshot, Schedule,
} from '@deal-table/contracts';
import type { RequiredGrantReference, SolveDecisionInput, SolveDecisionResult } from '@deal-table/domain';

/** Constructed only by a trusted identity adapter; this is not authentication. */
export type TrustedPrincipal =
  | { kind: 'participant'; subject: string }
  | { kind: 'display'; subject: string; roomId: string }
  | { kind: 'service'; subject: string; roomIds: readonly string[] };
export type ExpectedVersion = CommandEnvelope['expected'];
export type ErrorCode = Extract<CommandResult, { ok: false }>['error']['code'];
export interface Clock { now(): string }
/** Production adapters must supply unpredictable, valid opaque IDs. */
export interface IdSource { next(): string }
export interface RoomSeed {
  roomId: string;
  schedule: Schedule;
  roster: Participant[];
  policy: Policy;
  organizerSubject: string;
  memberships: { subject: string; memberId: string; status?: 'PENDING' | 'ACTIVE' }[];
}
export interface OwnerRecord {
  memberId: string;
  revision: number;
  acceptedContext: string | null;
  confirmed: ConfirmedInputs | null;
  reviewedIntervals: Interval[] | null;
  draft: InputDraft | null;
  offers: ExceptionOffer[];
  previews: DisclosurePreview[];
  exceptions: ExceptionGrant[];
  disclosures: DisclosureGrant[];
  approval: FinalApproval | null;
}
/** Maximum lifetime exception/disclosure decisions retained for a room. */
export const MAX_PERMISSION_HISTORY_RECORDS = 192;

export type RetiredDisclosureGrant = Omit<DisclosureGrant, 'preview'> & {
  preview: Omit<DisclosurePreview, 'text'>;
};
/** Private, immutable permission evidence retained after an owner leaves the roster. */
export interface RetiredPermissionHistory {
  ownerMemberId: string;
  exceptions: ExceptionGrant[];
  disclosures: RetiredDisclosureGrant[];
}
export interface RoomMembership { subject: string; memberId: string; status: 'PENDING' | 'ACTIVE' }
export interface RoomInvitationRecord { memberId: string; tokenHash: string; expiresAt: string; redeemedAt: string | null }
export interface RoomInvitationIssueResult { token: string; expiresAt: string }
export interface RoomInvitationRedeemResult { accepted: true }

export interface RoomRecord extends Omit<RoomSeed, 'memberships'> {
  memberships: RoomMembership[];
  invitations: RoomInvitationRecord[];
  contextToken: string;
  decisionRevision: number;
  controlVersion: number;
  status: PublicRoomSnapshot['status'];
  owners: OwnerRecord[];
  retiredPermissionHistory: RetiredPermissionHistory[];
  proposal: ProposalView | null;
  proposalVersion: number;
  requiredGrants: RequiredGrantReference[];
  publishedDisclosures: PublicRoomSnapshot['publishedDisclosures'];
  /** Immutable historical receipts; never projected into the current proposal. */
  agreementHistory: { proposal: ProposalView; approvals: FinalApproval[]; agreedAt: string }[];
  roundUsed: boolean;
  solveEpoch: number;
  job: { id: string; contextToken: string; epoch: number; completed: boolean } | null;
  replays: { keyHash: string; bodyHash: string; result: CommandResult }[];
}

/** Used by durable repositories to expose only the matching candidate receipt to a transition. */
export interface ReplayCandidate {
  keyHash: Promise<string>;
  commandType: string;
}
export interface RoomTransactionOptions {
  replay?: ReplayCandidate;
}

/** A deterministic admission failure: no STATE, GUARD, or REPLAY item was committed. */
export class RepositoryCapacityError extends Error {
  constructor() {
    super('ROOM_CAPACITY_REACHED');
    this.name = 'RepositoryCapacityError';
  }
}
/** Callback transitions are isolated, serialized and committed together, including replays. */
export interface RoomRepository {
  create(room: RoomRecord): Promise<void>;
  transaction<T>(
    roomId: string,
    transition: (room: RoomRecord | null) => Promise<T> | T,
    options?: RoomTransactionOptions,
  ): Promise<T>;
}
export interface ApplicationOptions {
  repository: RoomRepository;
  clock: Clock;
  ids: IdSource;
  solver?: (input: SolveDecisionInput) => SolveDecisionResult | Promise<SolveDecisionResult>;
  permissionTtlMs?: number;
  proposalTtlMs?: number;
  invitationTtlMs?: number;
}
