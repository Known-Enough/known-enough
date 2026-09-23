import { isDeepStrictEqual } from 'node:util';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { RoomRecord, RoomRepository } from '@deal-table/application';

const ROOM_SORT_KEY = 'STATE';
const DEFAULT_CONFLICT_RETRIES = 32;
const BASE_RETRY_DELAY_MS = 2;
const MAX_RETRY_DELAY_MS = 40;

interface StoredRoomItem {
  PK: string;
  SK: typeof ROOM_SORT_KEY;
  storageVersion: number;
  record: RoomRecord;
}

export interface DynamoDBRoomRepositoryOptions {
  readonly client: DynamoDBDocumentClient;
  readonly tableName: string;
  /** Number of conditional-write conflicts to retry after the initial attempt. */
  readonly maxConflictRetries?: number;
}

export class RoomAlreadyExistsError extends Error {
  constructor() {
    super('Room already exists');
    this.name = 'RoomAlreadyExistsError';
  }
}

export class ConcurrentRoomUpdateError extends Error {
  constructor() {
    super('Room changed too often to complete the transaction');
    this.name = 'ConcurrentRoomUpdateError';
  }
}

function partitionKey(roomId: string): string {
  return `ROOM#${roomId}`;
}

function isConditionalCheckFailure(error: unknown): boolean {
  return error !== null && typeof error === 'object'
    && (error as { name?: unknown }).name === 'ConditionalCheckFailedException';
}

function storedItem(item: Record<string, unknown> | undefined, roomId: string): StoredRoomItem | null {
  if (item === undefined) return null;
  const valid = item.PK === partitionKey(roomId)
    && item.SK === ROOM_SORT_KEY
    && Number.isSafeInteger(item.storageVersion)
    && (item.storageVersion as number) >= 0
    && item.record !== null && typeof item.record === 'object' && !Array.isArray(item.record)
    && (item.record as Record<string, unknown>).roomId === roomId
    && Array.isArray((item.record as Record<string, unknown>).replays);
  if (!valid) throw new Error('Stored room record is invalid');
  return item as unknown as StoredRoomItem;
}

function cloneResult<T>(value: T): T {
  return structuredClone(value);
}

async function backoff(retry: number): Promise<void> {
  const ceiling = Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * (2 ** Math.min(retry, 10)));
  const delayMs = Math.max(1, Math.floor(Math.random() * ceiling));
  await new Promise<void>(resolve => setTimeout(resolve, delayMs));
}

/**
 * DynamoDB-backed RoomRepository. Each room is one aggregate item, so all
 * owner state, proposals, permissions, and replay entries commit atomically.
 * The private storageVersion is an optimistic concurrency fence; it is
 * intentionally separate from public context/control versions.
 */
export class DynamoDBRoomRepository implements RoomRepository {
  private readonly client: DynamoDBDocumentClient;
  private readonly tableName: string;
  private readonly maxConflictRetries: number;

  constructor(options: DynamoDBRoomRepositoryOptions) {
    if (!options.tableName.trim()) throw new Error('DynamoDB table name is required');
    const maxConflictRetries = options.maxConflictRetries ?? DEFAULT_CONFLICT_RETRIES;
    if (!Number.isSafeInteger(maxConflictRetries) || maxConflictRetries < 0 || maxConflictRetries > 100) {
      throw new Error('maxConflictRetries must be an integer between 0 and 100');
    }
    this.client = options.client;
    this.tableName = options.tableName;
    this.maxConflictRetries = maxConflictRetries;
  }

  async create(room: RoomRecord): Promise<void> {
    const item: StoredRoomItem = {
      PK: partitionKey(room.roomId),
      SK: ROOM_SORT_KEY,
      storageVersion: 0,
      record: cloneResult(room),
    };
    try {
      await this.client.send(new PutCommand({
        TableName: this.tableName,
        Item: item,
        ConditionExpression: 'attribute_not_exists(#pk) AND attribute_not_exists(#sk)',
        ExpressionAttributeNames: { '#pk': 'PK', '#sk': 'SK' },
      }));
    } catch (error) {
      if (isConditionalCheckFailure(error)) throw new RoomAlreadyExistsError();
      throw error;
    }
  }

  async transaction<T>(roomId: string, transition: (room: RoomRecord | null) => Promise<T> | T): Promise<T> {
    for (let retry = 0; retry <= this.maxConflictRetries; retry += 1) {
      const response = await this.client.send(new GetCommand({
        TableName: this.tableName,
        Key: { PK: partitionKey(roomId), SK: ROOM_SORT_KEY },
        ConsistentRead: true,
      }));
      const item = storedItem(response.Item, roomId);
      if (!item) return cloneResult(await transition(null));

      const original = cloneResult(item.record);
      const working = cloneResult(original);
      const result = await transition(working);
      if (isDeepStrictEqual(working, original)) return cloneResult(result);
      if (item.storageVersion >= Number.MAX_SAFE_INTEGER) throw new Error('Room storage version is exhausted');

      const next: StoredRoomItem = {
        PK: partitionKey(roomId),
        SK: ROOM_SORT_KEY,
        storageVersion: item.storageVersion + 1,
        record: working,
      };
      try {
        await this.client.send(new PutCommand({
          TableName: this.tableName,
          Item: next,
          ConditionExpression: '#version = :expectedVersion',
          ExpressionAttributeNames: { '#version': 'storageVersion' },
          ExpressionAttributeValues: { ':expectedVersion': item.storageVersion },
        }));
        return cloneResult(result);
      } catch (error) {
        if (!isConditionalCheckFailure(error)) throw error;
        if (retry === this.maxConflictRetries) throw new ConcurrentRoomUpdateError();
        await backoff(retry);
      }
    }
    throw new ConcurrentRoomUpdateError();
  }
}
