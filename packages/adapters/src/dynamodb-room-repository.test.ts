import { describe, expect, it } from 'vitest';
import { GetCommand, PutCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DealTableApplication, type RoomRecord } from '@deal-table/application';
import { buildTeamTableFixture } from '@deal-table/test-support';
import { ConcurrentRoomUpdateError, DynamoDBRoomRepository, RoomAlreadyExistsError } from './dynamodb-room-repository.ts';
import { InMemoryRoomRepository } from './index.ts';

const roomId = 'room-synthetic';
const tableName = 'deal-table-test';

function conditionalFailure(): Error {
  const error = new Error('condition failed');
  error.name = 'ConditionalCheckFailedException';
  return error;
}

function fakeDocumentClient() {
  const items = new Map<string, Record<string, unknown>>();
  const puts: PutCommand[] = [];
  const gets: GetCommand[] = [];
  let injectedCasConflicts = 0;
  const itemKey = (table: string, key: { PK: string; SK: string }) => `${table}|${key.PK}|${key.SK}`;
  const client = {
    async send(command: GetCommand | PutCommand): Promise<unknown> {
      await Promise.resolve();
      if (command instanceof GetCommand) {
        gets.push(command);
        const key = command.input.Key as { PK: string; SK: string };
        const item = items.get(itemKey(command.input.TableName!, key));
        return item === undefined ? {} : { Item: structuredClone(item) };
      }
      if (command instanceof PutCommand) {
        puts.push(command);
        const key = command.input.Item as { PK: string; SK: string; storageVersion?: number };
        const dbKey = itemKey(command.input.TableName!, key);
        const existing = items.get(dbKey);
        if (command.input.ConditionExpression?.includes('attribute_not_exists')) {
          if (existing) throw conditionalFailure();
        } else {
          if (injectedCasConflicts > 0) {
            injectedCasConflicts -= 1;
            throw conditionalFailure();
          }
          const expected = command.input.ExpressionAttributeValues?.[':expectedVersion'];
          if (!existing || existing.storageVersion !== expected) throw conditionalFailure();
        }
        items.set(dbKey, structuredClone(command.input.Item as Record<string, unknown>));
        return {};
      }
      throw new Error('Unexpected DynamoDB command');
    },
  };
  return {
    client: client as unknown as DynamoDBDocumentClient,
    items, gets, puts, itemKey,
    injectCasConflicts: (count: number) => { injectedCasConflicts = count; },
  };
}

async function roomRecord(): Promise<RoomRecord> {
  const fixture = buildTeamTableFixture();
  let sequence = 0;
  const inMemory = new InMemoryRoomRepository();
  const source = new DealTableApplication({
    repository: inMemory,
    clock: { now: () => fixture.now },
    ids: { next: () => `source-id-${++sequence}` },
  });
  await source.createRoom({
    roomId,
    schedule: fixture.schedule,
    roster: [...fixture.roster],
    policy: fixture.policy,
    organizerSubject: 'organizer',
    memberships: fixture.roster.map(member => ({ subject: member.id, memberId: member.id })),
  });
  return inMemory.transaction(roomId, room => structuredClone(room!));
}

describe('DynamoDBRoomRepository', () => {
  it('creates each room once and uses a consistent read of its aggregate item', async () => {
    const fake = fakeDocumentClient();
    const repository = new DynamoDBRoomRepository({ client: fake.client, tableName });
    await repository.create(await roomRecord());
    await expect(repository.create(await roomRecord())).rejects.toBeInstanceOf(RoomAlreadyExistsError);

    const room = await repository.transaction(roomId, value => value);
    expect(room!.roomId).toBe(roomId);
    expect(fake.gets[0]!.input.ConsistentRead).toBe(true);
    expect(fake.items.size).toBe(1);
  });

  it('rolls back thrown transitions and returns detached data', async () => {
    const fake = fakeDocumentClient();
    const repository = new DynamoDBRoomRepository({ client: fake.client, tableName });
    await repository.create(await roomRecord());
    const initialPuts = fake.puts.length;

    await expect(repository.transaction(roomId, room => {
      room!.policy = 'LOWEST_INCONVENIENCE';
      throw new Error('abort');
    })).rejects.toThrow('abort');
    expect(fake.puts).toHaveLength(initialPuts);

    const detached = await repository.transaction(roomId, room => room!);
    detached.policy = 'LOWEST_INCONVENIENCE';
    expect((await repository.transaction(roomId, room => room!)).policy).toBe('BALANCE_RECENT_LOAD');
  });

  it('retries conditional conflicts so simultaneous transactions do not lose updates', async () => {
    const fake = fakeDocumentClient();
    const repository = new DynamoDBRoomRepository({ client: fake.client, tableName });
    const source = await roomRecord();
    await repository.create(source);

    await Promise.all(Array.from({ length: 12 }, () => repository.transaction(roomId, async room => {
      const prior = room!.controlVersion;
      await Promise.resolve();
      room!.controlVersion = prior + 1;
    })));

    const current = await repository.transaction(roomId, room => room!);
    expect(current.controlVersion).toBe(source.controlVersion + 12);
    expect(fake.items.get(fake.itemKey(tableName, { PK: `ROOM#${roomId}`, SK: 'STATE' }))!.storageVersion).toBe(12);
  });

  it('leaves missing rooms absent and validates retry configuration', async () => {
    const fake = fakeDocumentClient();
    const repository = new DynamoDBRoomRepository({ client: fake.client, tableName });
    await expect(repository.transaction(roomId, room => room)).resolves.toBeNull();
    expect(fake.items.size).toBe(0);
    expect(fake.puts).toHaveLength(0);
    expect(() => new DynamoDBRoomRepository({ client: fake.client, tableName, maxConflictRetries: -1 })).toThrow(/maxConflictRetries/);
    expect(() => new DynamoDBRoomRepository({ client: fake.client, tableName: '  ' })).toThrow(/table name/);
  });

  it('bounds repeated conditional conflicts and retries once when configured', async () => {
    const fake = fakeDocumentClient();
    const retrying = new DynamoDBRoomRepository({ client: fake.client, tableName, maxConflictRetries: 1 });
    await retrying.create(await roomRecord());
    fake.injectCasConflicts(1);
    await retrying.transaction(roomId, room => { room!.controlVersion += 1; });
    expect((await retrying.transaction(roomId, room => room!)).controlVersion).toBe(1);

    const strict = new DynamoDBRoomRepository({ client: fake.client, tableName, maxConflictRetries: 0 });
    fake.injectCasConflicts(1);
    await expect(strict.transaction(roomId, room => { room!.controlVersion += 1; }))
      .rejects.toBeInstanceOf(ConcurrentRoomUpdateError);
    expect((await retrying.transaction(roomId, room => room!)).controlVersion).toBe(1);
  });
});
