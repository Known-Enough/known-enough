import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import {
  CommandResult, ConfirmedInputs, DisclosureGrant, DisclosurePreview, ExceptionOffer,
  ExceptionGrant, FinalApproval, Hash, Id, InputDraft, Interval, Participant, Policy, ProposalView,
  PublicStatus, PublishedDisclosure, Schedule, Timestamp, Version, KnownEnough as KE,
} from '@deal-table/contracts';
import {
  MAX_PERMISSION_HISTORY_RECORDS,
  type DecisionReplayRecord, type KnownEnoughRecord, type RoomRecord,
} from '@deal-table/application';
import { z } from 'zod';

const ownerSchema = z.strictObject({
  memberId: Id,
  revision: Version,
  acceptedContext: Id.nullable(),
  confirmed: ConfirmedInputs.nullable(),
  reviewedIntervals: z.array(Interval).min(1).max(20).nullable(),
  draft: InputDraft.nullable(),
  offers: z.array(ExceptionOffer).max(32),
  previews: z.array(DisclosurePreview).max(1),
  exceptions: z.array(z.strictObject({
    id: Id, version: Version,
    scope: ExceptionOffer.shape.scope,
    status: z.enum(['ACTIVE', 'DECLINED', 'REVOKED', 'EXPIRED', 'SUPERSEDED']),
  })).max(32),
  disclosures: z.array(DisclosureGrant).max(32),
  approval: FinalApproval.nullable(),
});
const requiredGrantSchema = z.strictObject({ id: Id, version: Version, ownerMemberId: Id });
const retiredDisclosureGrantSchema = DisclosureGrant.extend({
  preview: DisclosurePreview.omit({ text: true }),
});
const retiredPermissionHistorySchema = z.strictObject({
  ownerMemberId: Id,
  exceptions: z.array(ExceptionGrant).max(MAX_PERMISSION_HISTORY_RECORDS),
  disclosures: z.array(retiredDisclosureGrantSchema).max(MAX_PERMISSION_HISTORY_RECORDS),
});
const agreementSchema = z.strictObject({
  proposal: ProposalView,
  approvals: z.array(FinalApproval).length(3),
  agreedAt: Timestamp,
});
const membershipSchema = z.strictObject({ subject: Id, memberId: Id, status: z.enum(['PENDING', 'ACTIVE']) });
const invitationSchema = z.strictObject({ memberId: Id, tokenHash: Hash, expiresAt: Timestamp, redeemedAt: Timestamp.nullable() });
const jobSchema = z.strictObject({ id: Id, contextToken: Id, epoch: Version, completed: z.boolean() });

const roomRecordSchema = z.strictObject({
  roomId: Id,
  schedule: Schedule,
  roster: z.array(Participant).length(3),
  policy: Policy,
  organizerSubject: Id,
  memberships: z.array(membershipSchema).length(3),
  invitations: z.array(invitationSchema).max(3),
  contextToken: Id,
  decisionRevision: Version,
  controlVersion: Version,
  status: PublicStatus,
  owners: z.array(ownerSchema).length(3),
  retiredPermissionHistory: z.array(retiredPermissionHistorySchema).max(MAX_PERMISSION_HISTORY_RECORDS),
  proposal: ProposalView.nullable(),
  proposalVersion: Version,
  // Up to 20 supported conditions per each of the three room owners may require a grant.
  requiredGrants: z.array(requiredGrantSchema).max(60),
  publishedDisclosures: z.array(PublishedDisclosure).max(32),
  agreementHistory: z.array(agreementSchema).max(64),
  roundUsed: z.boolean(),
  solveEpoch: Version,
  job: jobSchema.nullable(),
}).superRefine((room, ctx) => {
  const rosterIds = room.roster.map(member => member.id);
  const ownerIds = room.owners.map(owner => owner.memberId);
  const membershipIds = room.memberships.map(binding => binding.memberId);
  const subjects = room.memberships.map(binding => binding.subject);
  const invitationMemberIds = room.invitations.map(invitation => invitation.memberId);
  const invitationTokenHashes = room.invitations.map(invitation => invitation.tokenHash);
  const add = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
  if (new Set(rosterIds).size !== rosterIds.length) add(['roster'], 'Duplicate room member');
  if (new Set(ownerIds).size !== ownerIds.length || [...rosterIds].sort().join() !== [...ownerIds].sort().join())
    add(['owners'], 'Owner records must correspond to the roster');
  // A trusted room revision may change the public roster before the separate
  // membership-provisioning composition updates these bindings. Retain but do
  // not authorize stale bindings; the application checks both binding and roster.
  if (new Set(membershipIds).size !== membershipIds.length || new Set(subjects).size !== subjects.length)
    add(['memberships'], 'Membership subject and member bindings must be unique');
  if (new Set(invitationMemberIds).size !== invitationMemberIds.length
    || new Set(invitationTokenHashes).size !== invitationTokenHashes.length
    || room.invitations.some(invitation => {
      const membership = room.memberships.find(value => value.memberId === invitation.memberId);
      return !membership || (invitation.redeemedAt === null) !== (membership.status === 'PENDING');
    })) add(['invitations'], 'Invitations must uniquely match their pending or redeemed membership');
  const retiredOwnerIds = room.retiredPermissionHistory.map(history => history.ownerMemberId);
  if (new Set(retiredOwnerIds).size !== retiredOwnerIds.length)
    add(['retiredPermissionHistory'], 'Retired owner histories must be consolidated by member');
  if (room.retiredPermissionHistory.some(history => history.exceptions.length + history.disclosures.length === 0))
    add(['retiredPermissionHistory'], 'Empty retired owner histories are not retained');
  const retainedPermissionHistory = room.retiredPermissionHistory.reduce(
    (sum, history) => sum + history.exceptions.length + history.disclosures.length, 0,
  ) + room.owners.reduce((sum, owner) => sum + owner.exceptions.length + owner.disclosures.length, 0);
  if (retainedPermissionHistory > MAX_PERMISSION_HISTORY_RECORDS)
    add(['retiredPermissionHistory'], 'Lifetime permission history exceeds the room limit');
  for (const owner of room.owners) {
    const hasCurrentDisclosure = owner.disclosures.some(grant => grant.preview.contextToken === room.contextToken);
    const prospectivePreview = owner.offers.length > 0 && owner.previews.length === 0 && !hasCurrentDisclosure ? 1 : 0;
    if (owner.exceptions.length + owner.offers.length > 32)
      add(['owners'], 'Exception history and pending offer reservations exceed the owner limit');
    if (owner.disclosures.length + owner.previews.length + prospectivePreview > 32)
      add(['owners'], 'Disclosure history and pending response reservations exceed the owner limit');
    if (owner.offers.some(offer => offer.scope.roomId !== room.roomId
      || offer.scope.contextToken !== room.contextToken || offer.scope.decisionRevision !== room.decisionRevision))
      add(['owners'], 'Pending exception offers must bind to the current room context');
    if (owner.previews.some(preview => preview.roomId !== room.roomId
      || preview.contextToken !== room.contextToken || preview.decisionRevision !== room.decisionRevision))
      add(['owners'], 'Pending disclosure previews must bind to the current room context');
  }
  if (room.proposal && (room.proposal.facts.roomId !== room.roomId
    || room.proposal.facts.contextToken !== room.contextToken || room.proposal.facts.policy !== room.policy
    || room.proposal.facts.proposalVersion !== room.proposalVersion))
    add(['proposal'], 'Proposal must bind to the current room context');
  if (room.requiredGrants.some(grant => !ownerIds.includes(grant.ownerMemberId)))
    add(['requiredGrants'], 'Required grant owner must be a room owner');
  if (room.job && (room.job.contextToken !== room.contextToken || room.job.epoch !== room.solveEpoch))
    add(['job'], 'Solve job must bind to the current context and epoch');
});

export type DynamoRoomRecord = Omit<RoomRecord, 'replays'>;
export type DynamoKnownEnoughRecord = Omit<KnownEnoughRecord, 'replays'>;
type DynamoItem = Record<string, AttributeValue>;

export const STATE_SCHEMA_VERSION = 4;
export const KNOWN_ENOUGH_STATE_SCHEMA_VERSION = 5;
export const GUARD_SCHEMA_VERSION = 1;
export const REPLAY_SCHEMA_VERSION = 1;

export interface GuardRecord {
  version: number;
  incarnation: string;
  ordinaryReceipts: number;
  permissionHistoryReceipts: number;
  safetyReserveReceipts: number;
  totalReceipts: number;
}

export interface ReplayRecord {
  keyHash: string;
  bodyHash: string;
  result: RoomRecord['replays'][number]['result'];
}
export type KnownEnoughReplayRecord = DecisionReplayRecord;

const decisionOwnerSchema = z.strictObject({
  participantId: Id,
  ownerVersion: Version,
  readiness: z.enum(['NOT_STARTED', 'NEEDS_CLARIFICATION', 'READY']),
  draftVersion: Version.nullable(),
  draft: KE.AIConstraintDraft.nullable(),
  confirmedConstraints: z.array(KE.ConfirmedConstraint).max(KE.MAX_PRIVATE_CONSTRAINTS),
  pendingQuestions: z.array(KE.NegotiationQuestion).max(32),
  refusedRequests: z.array(KE.RefusedNegotiationRequest).max(64),
  negotiationPermissions: z.array(KE.NegotiationPermission).max(64),
  disclosurePermissions: z.array(KE.DisclosurePermission).max(64),
  approval: KE.FinalApproval.nullable(),
});
const retiredDecisionPermissionsSchema = z.strictObject({
  participantId: Id,
  refusedRequests: z.array(KE.RefusedNegotiationRequest).max(64),
  negotiationPermissions: z.array(KE.NegotiationPermission).max(64),
  disclosurePermissions: z.array(KE.DisclosurePermission).max(64),
});
const decisionAgreementSchema = z.strictObject({
  proposal: KE.CandidateProposal,
  approvals: z.array(KE.FinalApproval).max(KE.MAX_DECISION_PARTICIPANTS),
  agreedAt: Timestamp,
});
const decisionMembershipSchema = z.strictObject({ subject: Id, participantId: Id, active: z.boolean() });
const decisionJobSchema = z.strictObject({ id: Id, contextToken: Hash, semanticVersion: Version, epoch: Version });
const decisionRecordSchema = z.strictObject({
  decisionId: Id,
  creatorSubject: Id,
  memberships: z.array(decisionMembershipSchema).max(KE.MAX_DECISION_PARTICIPANTS),
  definition: KE.DecisionDefinition,
  status: KE.PublicDecisionStatus,
  publicRevision: Version,
  controlVersion: Version,
  frameConfirmations: z.array(KE.FrameConfirmation).max(KE.MAX_DECISION_PARTICIPANTS),
  owners: z.array(decisionOwnerSchema).max(KE.MAX_DECISION_PARTICIPANTS),
  pendingCandidate: KE.CandidateProposal.nullable(),
  candidate: KE.CandidateProposal.nullable(),
  publicProposal: KE.PublicCandidateProposal.nullable(),
  proposalVersion: Version,
  supersededCandidates: z.array(KE.CandidateProposal).max(64),
  agreementHistory: z.array(decisionAgreementSchema).max(64),
  retiredPermissions: z.array(retiredDecisionPermissionsSchema).max(MAX_PERMISSION_HISTORY_RECORDS),
  publishedDisclosures: KE.PublicDecisionSnapshot.shape.publishedDisclosures,
  solveEpoch: Version,
  job: decisionJobSchema.nullable(),
}).superRefine((decision, ctx) => {
  const participants = decision.definition.participants.map(item => item.id);
  const membershipIds = decision.memberships.map(item => item.participantId);
  const subjects = decision.memberships.map(item => item.subject);
  const owners = decision.owners.map(item => item.participantId);
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
  if (decision.decisionId !== decision.definition.decisionId) issue(['definition', 'decisionId'], 'State and definition IDs must match');
  if (new Set(participants).size !== participants.length
    || [...participants].sort().join('|') !== [...membershipIds].sort().join('|')
    || new Set(membershipIds).size !== membershipIds.length
    || new Set(subjects).size !== subjects.length)
    issue(['memberships'], 'Memberships must uniquely bind every current participant');
  if ([...participants].sort().join('|') !== [...owners].sort().join('|') || new Set(owners).size !== owners.length)
    issue(['owners'], 'Owner records must match the current participant roster');
  const confirmationIds = decision.frameConfirmations.map(item => item.participantId);
  if (new Set(confirmationIds).size !== confirmationIds.length || decision.frameConfirmations.some(item =>
    item.decisionId !== decision.decisionId || item.frameVersion !== decision.definition.frameVersion
      || item.semanticVersion !== decision.definition.semanticVersion || item.contextToken !== decision.definition.contextToken
      || !participants.includes(item.participantId)))
    issue(['frameConfirmations'], 'Frame confirmations must bind uniquely to the current frame');
  const activeConstraints = decision.owners.reduce((sum, owner) => sum + owner.confirmedConstraints
    .filter(item => item.status === 'ACTIVE').length, 0);
  if (activeConstraints > 64) issue(['owners'], 'Active confirmed constraints exceed the shared decision bound');
  const retiredOwnerIds = decision.retiredPermissions.map(owner => owner.participantId);
  if (new Set(retiredOwnerIds).size !== retiredOwnerIds.length)
    issue(['retiredPermissions'], 'Retired participant histories must be consolidated');
  const currentPermissionCount = decision.owners.reduce((sum, owner) =>
    sum + owner.refusedRequests.length + owner.negotiationPermissions.length + owner.disclosurePermissions.length, 0);
  const retiredPermissionCount = decision.retiredPermissions.reduce((sum, owner) =>
    sum + owner.refusedRequests.length + owner.negotiationPermissions.length + owner.disclosurePermissions.length, 0);
  if (currentPermissionCount + retiredPermissionCount > MAX_PERMISSION_HISTORY_RECORDS)
    issue(['retiredPermissions'], 'Decision permission history exceeds the retained room bound');
  const activeProposal = ['PROPOSED', 'APPROVING', 'AGREED'].includes(decision.status);
  if (activeProposal !== (decision.candidate !== null && decision.publicProposal !== null))
    issue(['candidate'], 'Only an active proposal state carries both private and public proposal records');
  if (decision.candidate && decision.publicProposal
    && (decision.candidate.proposalId !== decision.publicProposal.proposalId
      || decision.candidate.proposalVersion !== decision.publicProposal.facts.proposalVersion
      || decision.candidate.contextToken !== decision.publicProposal.facts.contextToken))
    issue(['publicProposal'], 'Public and private proposals must bind to the exact candidate');
  const approved = decision.owners.filter(owner => owner.approval !== null).map(owner => owner.participantId);
  if (approved.some(id => !decision.definition.requiredParticipantIds.includes(id))
    || (decision.status === 'AGREED' && decision.definition.requiredParticipantIds.some(id => !approved.includes(id))))
    issue(['owners'], 'Current agreement requires exact approvals from every required participant');
  if (decision.job && (decision.job.contextToken !== decision.definition.contextToken
    || decision.job.semanticVersion !== decision.definition.semanticVersion || decision.job.epoch !== decision.solveEpoch))
    issue(['job'], 'Candidate jobs must bind to the current semantic context and epoch');
});
const decisionStateEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(KNOWN_ENOUGH_STATE_SCHEMA_VERSION),
  decisionId: Id,
  record: decisionRecordSchema,
});

export class CorruptDynamoRecordError extends Error {
  constructor() {
    super('Invalid durable room record');
    this.name = 'CorruptDynamoRecordError';
  }
}

const roomItemSchema = z.strictObject({
  PK: z.strictObject({ S: z.string() }),
  SK: z.strictObject({ S: z.string() }),
  schemaVersion: z.strictObject({ N: z.string() }),
  payload: z.strictObject({ S: z.string() }),
});
const guardItemSchema = z.strictObject({
  PK: z.strictObject({ S: z.string() }),
  SK: z.strictObject({ S: z.string() }),
  schemaVersion: z.strictObject({ N: z.string() }),
  version: z.strictObject({ N: z.string() }),
  incarnation: z.strictObject({ S: Id }),
  ordinaryReceipts: z.strictObject({ N: z.string() }),
  permissionHistoryReceipts: z.strictObject({ N: z.string() }),
  safetyReserveReceipts: z.strictObject({ N: z.string() }),
  totalReceipts: z.strictObject({ N: z.string() }),
});
const replayItemSchema = z.strictObject({
  PK: z.strictObject({ S: z.string() }),
  SK: z.strictObject({ S: z.string() }),
  schemaVersion: z.strictObject({ N: z.string() }),
  incarnation: z.strictObject({ S: Id }),
  keyHash: z.strictObject({ S: z.string() }),
  bodyHash: z.strictObject({ S: z.string() }),
  result: z.strictObject({ S: z.string() }),
});
const stateEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(STATE_SCHEMA_VERSION),
  roomId: Id,
  record: roomRecordSchema,
});
const replayValueSchema = z.strictObject({
  keyHash: z.string().regex(/^[a-f0-9]{64}$/),
  bodyHash: z.string().regex(/^[a-f0-9]{64}$/),
  result: CommandResult,
});
const decisionReplayValueSchema = z.strictObject({
  keyHash: z.string().regex(/^[a-f0-9]{64}$/),
  bodyHash: z.string().regex(/^[a-f0-9]{64}$/),
  result: KE.DecisionCommandResult,
});
const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const MAX_ID_A = 'a'.repeat(80);
const MAX_ID_B = 'b'.repeat(80);
const MAX_ID_C = 'c'.repeat(80);
const MAX_TIMESTAMP = '9999-12-31T23:59:59.999Z';
const MAX_SCOPE = {
  conditionId: MAX_ID_A,
  roomId: MAX_ID_B,
  contextToken: MAX_ID_C,
  decisionRevision: MAX_SAFE,
  inputRevision: MAX_SAFE,
  rosterMemberIds: [MAX_ID_A, MAX_ID_B, MAX_ID_C],
  policy: 'BALANCE_RECENT_LOAD',
  meeting: {
    id: MAX_ID_A,
    interval: { date: '9999-12-31', timezone: 'America/Mexico_City', startMinute: 0, endMinute: 30 },
  },
  predicate: 'OWNER_HAS_NO_WEEKEND_DUTIES',
  expiresAt: MAX_TIMESTAMP,
} as const;
const MAX_DISCLOSURE_PREVIEW = {
  id: MAX_ID_A,
  text: '\u0000'.repeat(500),
  textHash: 'f'.repeat(64),
  audienceMemberIds: [MAX_ID_A, MAX_ID_B, MAX_ID_C],
  roomId: MAX_ID_A,
  contextToken: MAX_ID_B,
  decisionRevision: MAX_SAFE,
  expiresAt: MAX_TIMESTAMP,
  inferenceWarning: 'People may infer who changed availability from the plan. Published words cannot be made secret again.',
} as const;
const MAX_EXCEPTION_RECORD = {
  id: MAX_ID_A, version: MAX_SAFE, scope: MAX_SCOPE, status: 'SUPERSEDED',
} as const;
const MAX_DISCLOSURE_RECORD = {
  id: MAX_ID_A, version: MAX_SAFE, preview: MAX_DISCLOSURE_PREVIEW,
  status: 'SUPERSEDED', publishedAt: MAX_TIMESTAMP,
} as const;
const utf8Length = (text: string): number => new TextEncoder().encode(text).byteLength;
const jsonLength = (value: unknown): number => utf8Length(JSON.stringify(value));
const RESERVATION_TRANSITION_OVERHEAD_BYTES = 768;
const DYNAMO_ITEM_OVERHEAD_BYTES = 64;
const DYNAMO_ATTRIBUTE_TYPE_OVERHEAD_BYTES = 2;
const MAX_EXCEPTION_RECORD_BYTES = jsonLength(MAX_EXCEPTION_RECORD);
const MAX_PREVIEW_BYTES = jsonLength(MAX_DISCLOSURE_PREVIEW);
const MAX_DISCLOSURE_RECORD_BYTES = jsonLength(MAX_DISCLOSURE_RECORD);

function parseJson(text: string): unknown {
  try { return JSON.parse(text) as unknown; }
  catch { throw new CorruptDynamoRecordError(); }
}
function dynamoItemSize(item: DynamoItem): number {
  let size = DYNAMO_ITEM_OVERHEAD_BYTES;
  for (const [name, value] of Object.entries(item)) {
    size += utf8Length(name) + DYNAMO_ATTRIBUTE_TYPE_OVERHEAD_BYTES;
    if ('S' in value && typeof value.S === 'string') size += utf8Length(value.S);
    else if ('N' in value && typeof value.N === 'string') size += utf8Length(value.N);
    else throw new CorruptDynamoRecordError();
  }
  return size;
}
const string = (value: string) => ({ S: value });
const number = (value: number) => ({ N: String(value) });
const roomKey = (roomId: string) => 'ROOM#' + roomId;

function cleanRoomRecord(room: RoomRecord): DynamoRoomRecord {
  const { replays: _replays, ...record } = room;
  void _replays;
  const parsed = roomRecordSchema.safeParse(record);
  if (!parsed.success) throw new CorruptDynamoRecordError();
  return parsed.data;
}

export function encodeStateItem(room: RoomRecord): DynamoItem {
  const record = cleanRoomRecord(room);
  const payload = JSON.stringify({ schemaVersion: STATE_SCHEMA_VERSION, roomId: record.roomId, record });
  const item: DynamoItem = {
    PK: string(roomKey(record.roomId)),
    SK: string('STATE'),
    schemaVersion: number(STATE_SCHEMA_VERSION),
    payload: string(payload),
  };
  dynamoItemSize(item);
  return item;
}

function cleanDecisionRecord(decision: KnownEnoughRecord): DynamoKnownEnoughRecord {
  const { replays: _replays, ...record } = decision;
  void _replays;
  const parsed = decisionRecordSchema.safeParse(record);
  if (!parsed.success) throw new CorruptDynamoRecordError();
  return parsed.data;
}

export function encodeDecisionStateItem(decision: KnownEnoughRecord): DynamoItem {
  const record = cleanDecisionRecord(decision);
  const payload = JSON.stringify({
    schemaVersion: KNOWN_ENOUGH_STATE_SCHEMA_VERSION,
    decisionId: record.decisionId,
    record,
  });
  const item: DynamoItem = {
    PK: string(roomKey(record.decisionId)),
    SK: string('STATE'),
    schemaVersion: number(KNOWN_ENOUGH_STATE_SCHEMA_VERSION),
    payload: string(payload),
  };
  dynamoItemSize(item);
  return item;
}

export function decisionStateItemSizeBytes(decision: KnownEnoughRecord): number {
  return dynamoItemSize(encodeDecisionStateItem(decision));
}

export function stateItemSizeBytes(room: RoomRecord): number {
  return dynamoItemSize(encodeStateItem(room));
}

export function decodeStateItem(value: unknown, expectedRoomId: string): DynamoRoomRecord {
  const item = roomItemSchema.safeParse(value);
  if (!item.success || item.data.PK.S !== roomKey(expectedRoomId) || item.data.SK.S !== 'STATE'
    || item.data.schemaVersion.N !== String(STATE_SCHEMA_VERSION)) throw new CorruptDynamoRecordError();
  const envelope = stateEnvelopeSchema.safeParse(parseJson(item.data.payload.S));
  if (!envelope.success || envelope.data.roomId !== expectedRoomId
    || envelope.data.record.roomId !== expectedRoomId) throw new CorruptDynamoRecordError();
  return envelope.data.record;
}

export function decodeDecisionStateItem(value: unknown, expectedDecisionId: string): DynamoKnownEnoughRecord {
  const item = roomItemSchema.safeParse(value);
  if (!item.success || item.data.PK.S !== roomKey(expectedDecisionId) || item.data.SK.S !== 'STATE'
    || item.data.schemaVersion.N !== String(KNOWN_ENOUGH_STATE_SCHEMA_VERSION)) throw new CorruptDynamoRecordError();
  const envelope = decisionStateEnvelopeSchema.safeParse(parseJson(item.data.payload.S));
  if (!envelope.success || envelope.data.decisionId !== expectedDecisionId
    || envelope.data.record.decisionId !== expectedDecisionId) throw new CorruptDynamoRecordError();
  return envelope.data.record;
}

export function encodeGuardItem(roomId: string, guard: GuardRecord): DynamoItem {
  const item: DynamoItem = {
    PK: string(roomKey(roomId)),
    SK: string('GUARD'),
    schemaVersion: number(GUARD_SCHEMA_VERSION),
    version: number(guard.version),
    incarnation: string(guard.incarnation),
    ordinaryReceipts: number(guard.ordinaryReceipts),
    permissionHistoryReceipts: number(guard.permissionHistoryReceipts),
    safetyReserveReceipts: number(guard.safetyReserveReceipts),
    totalReceipts: number(guard.totalReceipts),
  };
  dynamoItemSize(item);
  return item;
}

function integerAttribute(value: { N: string }): number {
  if (!/^(0|[1-9][0-9]*)$/.test(value.N)) throw new CorruptDynamoRecordError();
  const parsed = Number(value.N);
  if (!Number.isSafeInteger(parsed)) throw new CorruptDynamoRecordError();
  return parsed;
}

export function decodeGuardItem(value: unknown, expectedRoomId: string): GuardRecord {
  const item = guardItemSchema.safeParse(value);
  if (!item.success || item.data.PK.S !== roomKey(expectedRoomId) || item.data.SK.S !== 'GUARD'
    || item.data.schemaVersion.N !== String(GUARD_SCHEMA_VERSION)) throw new CorruptDynamoRecordError();
  const guard: GuardRecord = {
    version: integerAttribute(item.data.version),
    incarnation: item.data.incarnation.S,
    ordinaryReceipts: integerAttribute(item.data.ordinaryReceipts),
    permissionHistoryReceipts: integerAttribute(item.data.permissionHistoryReceipts),
    safetyReserveReceipts: integerAttribute(item.data.safetyReserveReceipts),
    totalReceipts: integerAttribute(item.data.totalReceipts),
  };
  if (guard.ordinaryReceipts > 4096 || guard.permissionHistoryReceipts > 192
    || guard.safetyReserveReceipts > 320 || guard.totalReceipts > 4608
    || guard.permissionHistoryReceipts > guard.totalReceipts
    || guard.totalReceipts < guard.ordinaryReceipts + guard.safetyReserveReceipts)
    throw new CorruptDynamoRecordError();
  return guard;
}

export function encodeReplayItem(roomId: string, incarnation: string, replay: ReplayRecord): DynamoItem {
  const parsed = replayValueSchema.safeParse(replay);
  if (!parsed.success) throw new CorruptDynamoRecordError();
  const item: DynamoItem = {
    PK: string(roomKey(roomId)),
    SK: string('REPLAY#' + parsed.data.keyHash),
    schemaVersion: number(REPLAY_SCHEMA_VERSION),
    incarnation: string(incarnation),
    keyHash: string(parsed.data.keyHash),
    bodyHash: string(parsed.data.bodyHash),
    result: string(JSON.stringify(parsed.data.result)),
  };
  return item;
}

export function encodeDecisionReplayItem(roomId: string, incarnation: string, replay: KnownEnoughReplayRecord): DynamoItem {
  const parsed = decisionReplayValueSchema.safeParse(replay);
  if (!parsed.success) throw new CorruptDynamoRecordError();
  return {
    PK: string(roomKey(roomId)),
    SK: string('REPLAY#' + parsed.data.keyHash),
    schemaVersion: number(REPLAY_SCHEMA_VERSION),
    incarnation: string(incarnation),
    keyHash: string(parsed.data.keyHash),
    bodyHash: string(parsed.data.bodyHash),
    result: string(JSON.stringify(parsed.data.result)),
  };
}

export function decodeReplayItem(
  value: unknown,
  roomId: string,
  expectedKeyHash: string,
  expectedIncarnation: string,
): ReplayRecord {
  const item = replayItemSchema.safeParse(value);
  if (!item.success || item.data.PK.S !== roomKey(roomId)
    || item.data.SK.S !== 'REPLAY#' + expectedKeyHash
    || item.data.schemaVersion.N !== String(REPLAY_SCHEMA_VERSION)
    || item.data.keyHash.S !== expectedKeyHash
    || item.data.incarnation.S !== expectedIncarnation) throw new CorruptDynamoRecordError();
  const replay = replayValueSchema.safeParse({
    keyHash: item.data.keyHash.S,
    bodyHash: item.data.bodyHash.S,
    result: parseJson(item.data.result.S),
  });
  if (!replay.success) throw new CorruptDynamoRecordError();
  return replay.data;
}

export function decodeDecisionReplayItem(
  value: unknown,
  decisionId: string,
  expectedKeyHash: string,
  expectedIncarnation: string,
): KnownEnoughReplayRecord {
  const item = replayItemSchema.safeParse(value);
  if (!item.success || item.data.PK.S !== roomKey(decisionId)
    || item.data.SK.S !== 'REPLAY#' + expectedKeyHash
    || item.data.schemaVersion.N !== String(REPLAY_SCHEMA_VERSION)
    || item.data.keyHash.S !== expectedKeyHash
    || item.data.incarnation.S !== expectedIncarnation) throw new CorruptDynamoRecordError();
  const replay = decisionReplayValueSchema.safeParse({
    keyHash: item.data.keyHash.S,
    bodyHash: item.data.bodyHash.S,
    result: parseJson(item.data.result.S),
  });
  if (!replay.success) throw new CorruptDynamoRecordError();
  return replay.data;
}

export function pendingResponseByteReservations(room: DynamoRoomRecord): number {
  let total = 0;
  for (const owner of room.owners) {
    total += owner.offers.length * (MAX_EXCEPTION_RECORD_BYTES + RESERVATION_TRANSITION_OVERHEAD_BYTES);
    const currentPreview = owner.previews.length > 0;
    const currentDisclosure = owner.disclosures.some(grant => grant.preview.contextToken === room.contextToken);
    if (currentPreview) {
      total += MAX_DISCLOSURE_RECORD_BYTES + RESERVATION_TRANSITION_OVERHEAD_BYTES;
    } else if (owner.offers.length > 0 && !currentDisclosure) {
      total += MAX_PREVIEW_BYTES + MAX_DISCLOSURE_RECORD_BYTES
        + 2 * RESERVATION_TRANSITION_OVERHEAD_BYTES;
    }
  }
  return total;
}

export function permissionHistoryCount(room: DynamoRoomRecord): number {
  const active = room.owners.reduce((sum, owner) => sum + owner.exceptions.length + owner.disclosures.length, 0);
  return active + room.retiredPermissionHistory.reduce(
    (sum, history) => sum + history.exceptions.length + history.disclosures.length, 0,
  );
}

export function pendingPermissionResponseCount(room: DynamoRoomRecord): number {
  return room.owners.reduce((sum, owner) => {
    const currentDisclosure = owner.disclosures.some(grant => grant.preview.contextToken === room.contextToken);
    const prospectivePreview = owner.offers.length > 0 && owner.previews.length === 0 && !currentDisclosure ? 1 : 0;
    return sum + owner.offers.length + owner.previews.length + prospectivePreview;
  }, 0);
}

export function decisionPermissionHistoryCount(decision: DynamoKnownEnoughRecord): number {
  const current = decision.owners.reduce((sum, owner) => sum + owner.refusedRequests.length
    + owner.negotiationPermissions.length + owner.disclosurePermissions.filter(item => item.status !== 'PENDING').length, 0);
  return current + decision.retiredPermissions.reduce((sum, owner) =>
    sum + owner.refusedRequests.length + owner.negotiationPermissions.length + owner.disclosurePermissions.length, 0);
}

export function pendingDecisionResponseCount(decision: DynamoKnownEnoughRecord): number {
  return decision.owners.reduce((sum, owner) => sum
    + owner.pendingQuestions.filter(question => question.status === 'PENDING').length
    + owner.disclosurePermissions.filter(permission => permission.status === 'PENDING').length, 0);
}

/** Conservative transfer reservation: every pending response may consume a full bounded command envelope. */
export function pendingDecisionResponseByteReservations(decision: DynamoKnownEnoughRecord): number {
  return pendingDecisionResponseCount(decision) * (KE.MAX_COMMAND_WIRE_BYTES + RESERVATION_TRANSITION_OVERHEAD_BYTES);
}

export function validateStateGuard(room: DynamoRoomRecord, guard: GuardRecord): void {
  if (room.roomId === '' || guard.permissionHistoryReceipts !== permissionHistoryCount(room)
    || permissionHistoryCount(room) + pendingPermissionResponseCount(room) > MAX_PERMISSION_HISTORY_RECORDS)
    throw new CorruptDynamoRecordError();
}

export function validateDecisionStateGuard(decision: DynamoKnownEnoughRecord, guard: GuardRecord): void {
  const permissionCount = decisionPermissionHistoryCount(decision);
  if (decision.decisionId === '' || guard.permissionHistoryReceipts !== permissionCount
    || permissionCount + pendingDecisionResponseCount(decision) > MAX_PERMISSION_HISTORY_RECORDS)
    throw new CorruptDynamoRecordError();
}

export function encodedStateRecord(room: RoomRecord): DynamoRoomRecord {
  return cleanRoomRecord(room);
}

export function encodedDecisionStateRecord(decision: KnownEnoughRecord): DynamoKnownEnoughRecord {
  return cleanDecisionRecord(decision);
}

export function estimateItemBytes(item: DynamoItem): number {
  return dynamoItemSize(item);
}
