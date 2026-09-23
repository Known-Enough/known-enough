import {
  DynamoDBClient, TransactGetItemsCommand, TransactWriteItemsCommand,
  type AttributeValue, type TransactGetItemsCommandInput, type TransactWriteItemsCommandInput,
} from '@aws-sdk/client-dynamodb';
import {
  MAX_PERMISSION_HISTORY_RECORDS, RepositoryCapacityError,
  type RoomRecord, type RoomRepository, type RoomTransactionOptions,
} from '@deal-table/application';
import { CommandResult, Id } from '@deal-table/contracts';
import {
  CorruptDynamoRecordError, decodeGuardItem, decodeReplayItem, decodeStateItem,
  encodeGuardItem, encodeReplayItem, encodeStateItem, encodedStateRecord,
  estimateItemBytes, pendingResponseByteReservations,
  permissionHistoryCount, stateItemSizeBytes, validateStateGuard,
  type DynamoRoomRecord, type GuardRecord, type ReplayRecord,
} from './dynamodb-codec.ts';

const ORDINARY_RECEIPT_LIMIT = 4096;
const PERMISSION_RECEIPT_LIMIT = MAX_PERMISSION_HISTORY_RECORDS;
const SAFETY_RECEIPT_LIMIT = 320;
const TOTAL_RECEIPT_LIMIT = 4608;
const ORDINARY_STATE_LIMIT_BYTES = 352 * 1024;
const PROTECTED_STATE_LIMIT_BYTES = 360 * 1024;
const REPLAY_KEY_HASH = /^[a-f0-9]{64}$/;
const PERMISSION_COMMANDS = new Set(['DECIDE_EXCEPTION', 'DECIDE_DISCLOSURE']);
const SAFETY_COMMANDS = new Set(['REVOKE_EXCEPTION', 'REVOKE_DISCLOSURE', 'WITHDRAW_APPROVAL']);
const PROTECTED_COMMANDS = new Set([
  'DECIDE_EXCEPTION', 'DECIDE_DISCLOSURE', 'REVOKE_EXCEPTION', 'REVOKE_DISCLOSURE',
  'WITHDRAW_APPROVAL', 'REVISE_DECISION',
]);

export class RepositoryStorageError extends Error {
  constructor() {
    super('RETRYABLE_SERVER_ERROR');
    this.name = 'RepositoryStorageError';
  }
}

class InvalidRoomCreationError extends Error {
  constructor() { super('Invalid room creation record'); this.name = 'InvalidRoomCreationError'; }
}
class RoomAlreadyExistsError extends Error {
  constructor() { super('Room already exists'); this.name = 'RoomAlreadyExistsError'; }
}

export interface DynamoDBRoomRepositoryOptions {
  client: DynamoDBClient;
  tableName: string;
  /** Bounded retries only for recognized conflict/throttle reasons; unknown outcomes return 503 immediately. */
  maxAttempts?: number;
  random?: () => number;
  pause?: (milliseconds: number) => Promise<void>;
}

interface LoadedRoom {
  room: RoomRecord | null;
  guard: GuardRecord | null;
  replay: ReplayRecord | null;
}

type DynamoItem = Record<string, AttributeValue>;

function roomKey(roomId: string): string { return 'ROOM#' + roomId; }
function key(roomId: string, sortKey: string): DynamoItem {
  return { PK: { S: roomKey(roomId) }, SK: { S: sortKey } };
}
function itemAt(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return (value as { Item?: unknown }).Item;
}
function responseItems(value: unknown, expectedCount: number): unknown[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new RepositoryStorageError();
  const responses = (value as { Responses?: unknown }).Responses;
  if (!Array.isArray(responses) || responses.length !== expectedCount) throw new RepositoryStorageError();
  return responses.map(itemAt);
}
function errorName(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  const named = error as { name?: unknown; Code?: unknown; code?: unknown };
  if (typeof named.name === 'string') return named.name;
  if (typeof named.Code === 'string') return named.Code;
  return typeof named.code === 'string' ? named.code : undefined;
}
type TransactionDisposition = 'retry' | 'capacity' | 'other';
function transactionDisposition(error: unknown): TransactionDisposition {
  const name = errorName(error) ?? '';
  if (['TransactionConflictException', 'ConditionalCheckFailedException', 'TransactionInProgressException',
    'ProvisionedThroughputExceededException', 'ThrottlingException', 'RequestLimitExceeded'].includes(name))
    return 'retry';
  if (name !== 'TransactionCanceledException' || error === null || typeof error !== 'object') return 'other';
  const reasons = (error as { CancellationReasons?: unknown }).CancellationReasons;
  if (!Array.isArray(reasons)) return 'other';
  const parsed = reasons.flatMap(reason => {
    if (reason === null || typeof reason !== 'object' || Array.isArray(reason)) return [];
    const value = reason as { Code?: unknown; Message?: unknown };
    return [{ code: typeof value.Code === 'string' ? value.Code : '',
      message: typeof value.Message === 'string' ? value.Message.toLowerCase() : '' }];
  });
  if (parsed.some(reason => ['ConditionalCheckFailed', 'TransactionConflict', 'ProvisionedThroughputExceeded',
    'ThrottlingError'].includes(reason.code))) return 'retry';
  if (parsed.some(reason => reason.code === 'ItemCollectionSizeLimitExceeded'
    || (reason.code === 'ValidationError' && reason.message.includes('item size')
      && (reason.message.includes('exceed') || reason.message.includes('size limit'))))) return 'capacity';
  return 'other';
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([name, item]) => JSON.stringify(name) + ':' + stable(item)).join(',') + '}';
  }
  return JSON.stringify(value);
}
function roomStateEqual(a: RoomRecord, b: RoomRecord): boolean {
  return stable(encodedStateRecord(a)) === stable(encodedStateRecord(b));
}
function replayEqual(a: ReplayRecord | undefined, b: ReplayRecord | undefined): boolean {
  return a === undefined ? b === undefined : b !== undefined && stable(a) === stable(b);
}
function commandResult(value: unknown): ReturnType<typeof CommandResult.safeParse> {
  return CommandResult.safeParse(value);
}
function isSafeTransition(before: DynamoRoomRecord, after: DynamoRoomRecord): boolean {
  if (before.contextToken !== after.contextToken || before.status === 'CLOSED' || after.status === 'CLOSED') return true;
  if (before.owners.some(owner => owner.approval !== null
    && after.owners.find(next => next.memberId === owner.memberId)?.approval === null)) return true;
  for (const owner of before.owners) {
    const next = after.owners.find(value => value.memberId === owner.memberId);
    if (!next) continue;
    if (owner.offers.some(offer => !next.offers.some(value => value.id === offer.id))
      || owner.previews.some(preview => !next.previews.some(value => value.id === preview.id))) return true;
    for (const grant of owner.exceptions) {
      const updated = next.exceptions.find(value => value.id === grant.id);
      if (grant.status === 'ACTIVE' && updated && ['REVOKED', 'EXPIRED', 'SUPERSEDED'].includes(updated.status)) return true;
    }
    for (const grant of owner.disclosures) {
      const updated = next.disclosures.find(value => value.id === grant.id);
      if (grant.status === 'ACTIVE' && updated && ['REVOKED', 'EXPIRED', 'SUPERSEDED'].includes(updated.status)) return true;
    }
  }
  return false;
}
function newPromptCount(room: DynamoRoomRecord): number {
  return room.owners.reduce((sum, owner) => sum + owner.offers.length + owner.previews.length, 0);
}
function makeGuard(
  prior: GuardRecord,
  nextRoom: DynamoRoomRecord,
  ordinaryReceipts: number,
  permissionHistoryReceipts: number,
  safetyReserveReceipts: number,
  totalReceipts: number,
): GuardRecord {
  if (prior.version >= Number.MAX_SAFE_INTEGER) throw new RepositoryStorageError();
  const next: GuardRecord = {
    version: prior.version + 1,
    incarnation: prior.incarnation,
    ordinaryReceipts,
    permissionHistoryReceipts,
    safetyReserveReceipts,
    totalReceipts,
  };
  validateStateGuard(nextRoom, next);
  return next;
}

export class DynamoDBRoomRepository implements RoomRepository {
  private readonly maxAttempts: number;
  private readonly random: () => number;
  private readonly pause: (milliseconds: number) => Promise<void>;

  constructor(private readonly options: DynamoDBRoomRepositoryOptions) {
    if (!options.tableName || options.tableName.length > 255) throw new Error('A DynamoDB table name is required');
    this.maxAttempts = options.maxAttempts ?? 6;
    this.random = options.random ?? Math.random;
    this.pause = options.pause ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
    if (!Number.isSafeInteger(this.maxAttempts) || this.maxAttempts < 1 || this.maxAttempts > 12)
      throw new Error('maxAttempts must be between 1 and 12');
  }

  async create(room: RoomRecord): Promise<void> {
    try {
      if (room.replays.length !== 0) throw new CorruptDynamoRecordError();
      const record = encodedStateRecord(room);
      const stateBytes = stateItemSizeBytes(room);
      const reservationBytes = pendingResponseByteReservations(record);
      if (stateBytes > ORDINARY_STATE_LIMIT_BYTES
        || stateBytes + reservationBytes > PROTECTED_STATE_LIMIT_BYTES) throw new RepositoryCapacityError();
      const guard: GuardRecord = {
        version: 0,
        incarnation: room.contextToken,
        ordinaryReceipts: 0,
        permissionHistoryReceipts: 0,
        safetyReserveReceipts: 0,
        totalReceipts: 0,
      };
      validateStateGuard(record, guard);
      const request: TransactWriteItemsCommandInput = {
        TransactItems: [
          { Put: {
            TableName: this.options.tableName,
            Item: encodeStateItem(room),
            ConditionExpression: 'attribute_not_exists(#pk)',
            ExpressionAttributeNames: { '#pk': 'PK' },
          } },
          { Put: {
            TableName: this.options.tableName,
            Item: encodeGuardItem(room.roomId, guard),
            ConditionExpression: 'attribute_not_exists(#pk)',
            ExpressionAttributeNames: { '#pk': 'PK' },
          } },
        ],
      };
      await this.options.client.send(new TransactWriteItemsCommand(request));
    } catch (error) {
      if (error instanceof RepositoryCapacityError) throw error;
      if (error instanceof CorruptDynamoRecordError) throw new InvalidRoomCreationError();
      const disposition = transactionDisposition(error);
      if (disposition === 'capacity') throw new RepositoryCapacityError();
      if (disposition === 'retry') throw new RoomAlreadyExistsError();
      throw new RepositoryStorageError();
    }
  }

  async transaction<T>(
    roomId: string,
    transition: (room: RoomRecord | null) => Promise<T> | T,
    transactionOptions?: RoomTransactionOptions,
  ): Promise<T> {
    if (!Id.safeParse(roomId).success) {
      const missingResult = await transition(null);
      return structuredClone(missingResult);
    }
    const candidate = transactionOptions?.replay;
    const candidateHash = candidate ? await candidate.keyHash : undefined;
    const replayKeyHash = candidateHash && REPLAY_KEY_HASH.test(candidateHash) ? candidateHash : undefined;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const loaded = await this.load(roomId, replayKeyHash);
      if (!loaded.room || !loaded.guard) {
        const missingResult = await transition(null);
        return structuredClone(missingResult);
      }

      const beforeRoom = loaded.room;
      const nextRoom = structuredClone(beforeRoom);
      const result = await transition(nextRoom);
      try {
        const beforeRecord = encodedStateRecord(beforeRoom);
        const nextRecord = encodedStateRecord(nextRoom);
        const stateChanged = !roomStateEqual(beforeRoom, nextRoom);
        const beforeReplay = loaded.replay ?? undefined;
        const resultingReplay = replayKeyHash
          ? nextRoom.replays.find(receipt => receipt.keyHash === replayKeyHash)
          : undefined;
        if (candidate && !replayKeyHash && nextRoom.replays.length) throw new CorruptDynamoRecordError();
        if (!candidate && nextRoom.replays.length) throw new CorruptDynamoRecordError();
        if (beforeReplay && !replayEqual(beforeReplay, resultingReplay)) throw new CorruptDynamoRecordError();
        if (resultingReplay && !beforeReplay && nextRoom.replays.length !== 1) throw new CorruptDynamoRecordError();
        if (nextRoom.replays.length > 1) throw new CorruptDynamoRecordError();

        const newReplay = resultingReplay && !beforeReplay ? resultingReplay : undefined;
        if (!stateChanged && !newReplay) return structuredClone(result);
        const historyBefore = permissionHistoryCount(beforeRecord);
        const historyAfter = permissionHistoryCount(nextRecord);
        if (historyAfter < historyBefore || historyAfter - historyBefore > 1) throw new CorruptDynamoRecordError();
        const historyDelta = historyAfter - historyBefore;
        const parsedResult = newReplay ? commandResult(result) : undefined;
        const nextCounters = {
          ordinary: loaded.guard.ordinaryReceipts,
          permission: loaded.guard.permissionHistoryReceipts,
          safety: loaded.guard.safetyReserveReceipts,
          total: loaded.guard.totalReceipts,
        };

        if (newReplay) {
          if (!candidate || newReplay.keyHash !== replayKeyHash) throw new CorruptDynamoRecordError();
          if (!parsedResult?.success) throw new CorruptDynamoRecordError();
          if (nextCounters.total >= TOTAL_RECEIPT_LIMIT) throw new RepositoryCapacityError();
          if (nextCounters.ordinary < ORDINARY_RECEIPT_LIMIT) {
            nextCounters.ordinary += 1;
            if (historyDelta === 1) {
              if (!PERMISSION_COMMANDS.has(candidate.commandType) || !parsedResult.data.ok
                || nextCounters.permission >= PERMISSION_RECEIPT_LIMIT) throw new RepositoryCapacityError();
              nextCounters.permission += 1;
            }
          } else if (!parsedResult.data.ok) {
            // Do not return an unreceipted semantic outcome that callers could later change under this key.
            throw new RepositoryCapacityError();
          } else if (PERMISSION_COMMANDS.has(candidate.commandType) && historyDelta === 1) {
            if (nextCounters.permission >= PERMISSION_RECEIPT_LIMIT) throw new RepositoryCapacityError();
            nextCounters.permission += 1;
          } else if (SAFETY_COMMANDS.has(candidate.commandType) && stateChanged) {
            if (nextCounters.safety >= SAFETY_RECEIPT_LIMIT) throw new RepositoryCapacityError();
            nextCounters.safety += 1;
          } else {
            throw new RepositoryCapacityError();
          }
          nextCounters.total += 1;
        } else if (historyDelta !== 0) {
          throw new CorruptDynamoRecordError();
        }

        const guard = makeGuard(loaded.guard, nextRecord, nextCounters.ordinary,
          nextCounters.permission, nextCounters.safety, nextCounters.total);
        const stateBytes = stateItemSizeBytes(nextRoom);
        const reservationBytes = pendingResponseByteReservations(nextRecord);
        const isPromptAdmission = newPromptCount(nextRecord) > newPromptCount(beforeRecord);
        const protectedWrite = isPromptAdmission || (candidate
          ? PROTECTED_COMMANDS.has(candidate.commandType)
          : isSafeTransition(beforeRecord, nextRecord));
        if (stateBytes + reservationBytes > PROTECTED_STATE_LIMIT_BYTES
          || (!protectedWrite && stateBytes > ORDINARY_STATE_LIMIT_BYTES)) throw new RepositoryCapacityError();

        const replayItem = newReplay
          ? encodeReplayItem(roomId, guard.incarnation, newReplay)
          : undefined;
        if (replayItem && estimateItemBytes(replayItem) > 8 * 1024) throw new RepositoryCapacityError();
        const guardItem = encodeGuardItem(roomId, guard);
        if (estimateItemBytes(guardItem) > 8 * 1024) throw new RepositoryStorageError();
        const write: TransactWriteItemsCommandInput = {
          TransactItems: [
            { Put: {
              TableName: this.options.tableName,
              Item: encodeStateItem(nextRoom),
              ConditionExpression: 'attribute_exists(#pk)',
              ExpressionAttributeNames: { '#pk': 'PK' },
            } },
            { Update: {
              TableName: this.options.tableName,
              Key: key(roomId, 'GUARD'),
              UpdateExpression: 'SET #version = :nextVersion, #ordinary = :nextOrdinary, #permission = :nextPermission, #safety = :nextSafety, #total = :nextTotal',
              ConditionExpression: '#version = :oldVersion AND #incarnation = :incarnation AND #ordinary = :oldOrdinary AND #permission = :oldPermission AND #safety = :oldSafety AND #total = :oldTotal',
              ExpressionAttributeNames: {
                '#version': 'version', '#incarnation': 'incarnation',
                '#ordinary': 'ordinaryReceipts', '#permission': 'permissionHistoryReceipts',
                '#safety': 'safetyReserveReceipts', '#total': 'totalReceipts',
              },
              ExpressionAttributeValues: {
                ':nextVersion': { N: String(guard.version) },
                ':nextOrdinary': { N: String(guard.ordinaryReceipts) },
                ':nextPermission': { N: String(guard.permissionHistoryReceipts) },
                ':nextSafety': { N: String(guard.safetyReserveReceipts) },
                ':nextTotal': { N: String(guard.totalReceipts) },
                ':oldVersion': { N: String(loaded.guard.version) },
                ':incarnation': { S: loaded.guard.incarnation },
                ':oldOrdinary': { N: String(loaded.guard.ordinaryReceipts) },
                ':oldPermission': { N: String(loaded.guard.permissionHistoryReceipts) },
                ':oldSafety': { N: String(loaded.guard.safetyReserveReceipts) },
                ':oldTotal': { N: String(loaded.guard.totalReceipts) },
              },
            } },
            ...(replayItem ? [{ Put: {
              TableName: this.options.tableName,
              Item: replayItem,
              ConditionExpression: 'attribute_not_exists(#pk)',
              ExpressionAttributeNames: { '#pk': 'PK' },
            } }] : []),
          ],
        };
        await this.options.client.send(new TransactWriteItemsCommand(write));
        return structuredClone(result);
      } catch (error) {
        if (error instanceof RepositoryCapacityError) throw error;
        if (error instanceof CorruptDynamoRecordError) throw new RepositoryStorageError();
        const disposition = transactionDisposition(error);
        if (disposition === 'capacity') throw new RepositoryCapacityError();
        if (disposition === 'retry') {
          if (attempt === this.maxAttempts) throw new RepositoryStorageError();
          const baseDelay = Math.min(160, 4 * (2 ** (attempt - 1)));
          const jitter = 0.5 + Math.max(0, Math.min(1, this.random()));
          await this.pause(Math.floor(baseDelay * jitter));
          continue;
        }
        throw new RepositoryStorageError();
      }
    }
    throw new RepositoryStorageError();
  }

  private async load(roomId: string, replayKeyHash?: string): Promise<LoadedRoom> {
    try {
      const requests: TransactGetItemsCommandInput['TransactItems'] = [
        { Get: { TableName: this.options.tableName, Key: key(roomId, 'STATE') } },
        { Get: { TableName: this.options.tableName, Key: key(roomId, 'GUARD') } },
        ...(replayKeyHash
          ? [{ Get: { TableName: this.options.tableName, Key: key(roomId, 'REPLAY#' + replayKeyHash) } }]
          : []),
      ];
      const response = await this.options.client.send(new TransactGetItemsCommand({ TransactItems: requests }));
      const items = responseItems(response, requests.length);
      const stateItem = items[0];
      const guardItem = items[1];
      if (stateItem === undefined && guardItem === undefined) {
        // Any orphan replay is intentionally ignored until a primary room pair exists.
        return { room: null, guard: null, replay: null };
      }
      if (stateItem === undefined || guardItem === undefined) throw new CorruptDynamoRecordError();
      const record = decodeStateItem(stateItem, roomId);
      const guard = decodeGuardItem(guardItem, roomId);
      validateStateGuard(record, guard);
      const replayItem = replayKeyHash ? items[2] : undefined;
      const replay = replayItem === undefined ? null
        : decodeReplayItem(replayItem, roomId, replayKeyHash!, guard.incarnation);
      const room: RoomRecord = { ...record, replays: replay ? [replay] : [] };
      return { room, guard, replay };
    } catch (error) {
      if (error instanceof CorruptDynamoRecordError) throw new RepositoryStorageError();
      throw new RepositoryStorageError();
    }
  }
}
