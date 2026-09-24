import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  GetItemCommand,
} from '@aws-sdk/client-dynamodb';
import { DealTableApplication, type RoomRecord } from '@deal-table/application';
import { buildTeamTableFixture } from '@deal-table/test-support';
import { DynamoDBRoomRepository } from './dynamodb.ts';
import { decodeGuardItem } from './dynamodb-codec.ts';
import { InMemoryRoomRepository } from './index.ts';

const endpoint = process.env.DYNAMODB_LOCAL_ENDPOINT;
const enabled = endpoint !== undefined;
const roomId = `local-${randomUUID().replaceAll('-', '')}`;
const tableName = `deal-table-local-${randomUUID().replaceAll('-', '')}`;
let lowLevel: DynamoDBClient;
let repository: DynamoDBRoomRepository;
let tableCreated = false;

function safeLocalEndpoint(value: string | undefined): string {
  if (!value) throw new Error('DYNAMODB_LOCAL_ENDPOINT is required');
  const parsed = new URL(value);
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (parsed.protocol !== 'http:' || !['localhost', '127.0.0.1', '::1'].includes(host)
    || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('DYNAMODB_LOCAL_ENDPOINT must be an HTTP root URL on localhost, 127.0.0.1, or ::1');
  }
  return parsed.toString().replace(/\/$/, '');
}

async function roomRecord(): Promise<RoomRecord> {
  const fixture = buildTeamTableFixture();
  let sequence = 0;
  const inMemory = new InMemoryRoomRepository();
  const source = new DealTableApplication({
    repository: inMemory,
    clock: { now: () => fixture.now },
    ids: { next: () => `local-id-${++sequence}` },
  });
  await source.createRoom({
    roomId,
    schedule: fixture.schedule,
    roster: [...fixture.roster],
    policy: fixture.policy,
    organizerSubject: 'local-organizer',
    memberships: fixture.roster.map(member => ({ subject: member.id, memberId: member.id })),
  });
  return inMemory.transaction(roomId, room => structuredClone(room!));
}

describe.skipIf(!enabled)('DynamoDBRoomRepository against explicitly enabled DynamoDB Local', () => {
  beforeAll(async () => {
    lowLevel = new DynamoDBClient({
      endpoint: safeLocalEndpoint(endpoint),
      region: 'us-west-2',
      credentials: { accessKeyId: 'fakeMyKeyId', secretAccessKey: 'fakeSecretAccessKey' },
      maxAttempts: 1,
    });
    await lowLevel.send(new CreateTableCommand({
      TableName: tableName,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
    }));
    tableCreated = true;
    repository = new DynamoDBRoomRepository({ client: lowLevel, tableName, maxAttempts: 12, random: () => 0, pause: async () => {} });
  }, 20_000);

  afterAll(async () => {
    if (lowLevel) {
      try {
        if (tableCreated) await lowLevel.send(new DeleteTableCommand({ TableName: tableName }));
      }
      finally { lowLevel.destroy(); }
    }
  });

  it('runs create, duplicate rejection, and competing transactional state/guard updates through the SDK', async () => {
    const source = await roomRecord();
    await repository.create(source);
    await expect(repository.create(source)).rejects.toThrow('Room already exists');

    await Promise.all(Array.from({ length: 12 }, () => repository.transaction(roomId, async room => {
      const prior = room!.controlVersion;
      await Promise.resolve();
      room!.controlVersion = prior + 1;
    })));

    const current = await repository.transaction(roomId, room => room!);
    expect(current.controlVersion).toBe(source.controlVersion + 12);
    const stored = await lowLevel.send(new GetItemCommand({
      TableName: tableName,
      Key: { PK: { S: `ROOM#${roomId}` }, SK: { S: 'GUARD' } },
      ConsistentRead: true,
    }));
    expect(decodeGuardItem(stored.Item, roomId).version).toBe(12);
  });
});
