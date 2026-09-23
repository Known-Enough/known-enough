import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import {
  CommandResult, ConfirmedInputs, DisclosureGrant, DisclosurePreview, ExceptionOffer,
  FinalApproval, Id, InputDraft, Interval, Participant, Policy, ProposalView,
  PublicStatus, PublishedDisclosure, Schedule, Timestamp, Version,
} from '@deal-table/contracts';
import type { RoomRecord } from '@deal-table/application';
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
const agreementSchema = z.strictObject({
  proposal: ProposalView,
  approvals: z.array(FinalApproval).length(3),
  agreedAt: Timestamp,
});
const membershipSchema = z.strictObject({ subject: Id, memberId: Id });
const jobSchema = z.strictObject({ id: Id, contextToken: Id, epoch: Version, completed: z.boolean() });

const roomRecordSchema = z.strictObject({
  roomId: Id,
  schedule: Schedule,
  roster: z.array(Participant).length(3),
  policy: Policy,
  organizerSubject: Id,
  memberships: z.array(membershipSchema).length(3),
  contextToken: Id,
  decisionRevision: Version,
  controlVersion: Version,
  status: PublicStatus,
  owners: z.array(ownerSchema).length(3),
  proposal: ProposalView.nullable(),
  proposalVersion: Version,
  requiredGrants: z.array(requiredGrantSchema).max(3),
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
  const add = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
  if (new Set(rosterIds).size !== rosterIds.length) add(['roster'], 'Duplicate room member');
  if (new Set(ownerIds).size !== ownerIds.length || [...rosterIds].sort().join() !== [...ownerIds].sort().join())
    add(['owners'], 'Owner records must correspond to the roster');
  // A trusted room revision may change the public roster before the separate
  // membership-provisioning composition updates these bindings. Retain but do
  // not authorize stale bindings; the application checks both binding and roster.
  if (new Set(membershipIds).size !== membershipIds.length || new Set(subjects).size !== subjects.length)
    add(['memberships'], 'Membership subject and member bindings must be unique');
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
type DynamoItem = Record<string, AttributeValue>;

export const STATE_SCHEMA_VERSION = 2;
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
  return room.owners.reduce((sum, owner) => sum + owner.exceptions.length + owner.disclosures.length, 0);
}

export function pendingPermissionResponseCount(room: DynamoRoomRecord): number {
  return room.owners.reduce((sum, owner) => {
    const currentDisclosure = owner.disclosures.some(grant => grant.preview.contextToken === room.contextToken);
    const prospectivePreview = owner.offers.length > 0 && owner.previews.length === 0 && !currentDisclosure ? 1 : 0;
    return sum + owner.offers.length + owner.previews.length + prospectivePreview;
  }, 0);
}

export function validateStateGuard(room: DynamoRoomRecord, guard: GuardRecord): void {
  if (room.roomId === '' || guard.permissionHistoryReceipts !== permissionHistoryCount(room)
    || permissionHistoryCount(room) + pendingPermissionResponseCount(room) > 192)
    throw new CorruptDynamoRecordError();
}

export function encodedStateRecord(room: RoomRecord): DynamoRoomRecord {
  return cleanRoomRecord(room);
}

export function estimateItemBytes(item: DynamoItem): number {
  return dynamoItemSize(item);
}
