import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  GetItemCommand,
} from '@aws-sdk/client-dynamodb';
import { DealTableApplication, KnownEnoughApplication, type RoomRecord } from '@deal-table/application';
import { KnownEnough as KE } from '@deal-table/contracts';
import { buildTeamTableFixture } from '@deal-table/test-support';
import { buildChristmasFixture } from '../../test-support/src/known-enough-fixtures.ts';
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
    clock: { now: () => '2026-10-01T12:00:00.000Z' },
    ids: { next: () => `local-id-${++sequence}` },
  });
  await source.createRoom({
    roomId,
    schedule: fixture.schedule,
    roster: [...fixture.roster],
    policy: fixture.policy,
    organizerSubject: 'local-organizer',
    memberships: fixture.roster.map(member => ({ subject: member.id, memberId: member.id, ...(member.id === 'maya' ? { status: 'PENDING' as const } : {}) })),
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

    let inviteSequence = 0;
    const inviteApp = new DealTableApplication({
      repository, clock: { now: () => buildTeamTableFixture().now },
      ids: { next: () => `local-invite-${++inviteSequence}` },
    });
    const issued = await inviteApp.issueRoomInvitation(
      { kind: 'participant', subject: 'local-organizer' }, roomId,
      { requestId: 'local-issue', memberId: 'maya' },
    );
    const attempts = await Promise.allSettled([
      inviteApp.redeemRoomInvitation({ kind: 'participant', subject: 'maya' }, roomId,
        { requestId: 'local-redeem-a', token: issued.token }),
      inviteApp.redeemRoomInvitation({ kind: 'participant', subject: 'maya' }, roomId,
        { requestId: 'local-redeem-b', token: issued.token }),
    ]);
    expect(attempts.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(value => value.status === 'rejected')).toHaveLength(1);
    const activated = await repository.transaction(roomId, room => room!);
    expect(activated.memberships.find(value => value.memberId === 'maya')?.status).toBe('ACTIVE');
    expect(activated.invitations[0]?.redeemedAt).not.toBeNull();
  });

  it('runs the generic STATE v5 path, guarded concurrency, and exact command replay through DynamoDB Local', async () => {
    const fixture = buildChristmasFixture();
    let sourceSequence = 0;
    const sourceRepository = new InMemoryRoomRepository();
    const sourceApplication = new KnownEnoughApplication({
      repository: sourceRepository,
      clock: { now: () => '2026-10-01T12:00:00.000Z' },
      ids: { next: () => `local-ke03-source-${++sourceSequence}` },
    });
    await sourceApplication.createDecision({
      definition: fixture.definition,
      creatorSubject: 'subject-maya',
      memberships: fixture.definition.participants.map(person => ({
        subject: `subject-${person.id}`, participantId: person.id, active: true,
      })),
    });
    const initial = await sourceRepository.transactionDecision(fixture.definition.decisionId, decision => structuredClone(decision!));
    await repository.createDecision(initial);
    await expect(repository.createDecision(initial)).rejects.toThrow('Room already exists');

    let appSequence = 0;
    const application = new KnownEnoughApplication({
      repository,
      clock: { now: () => '2026-10-01T12:00:00.000Z' },
      ids: { next: () => `local-ke03-command-${++appSequence}` },
    });
    const principal = { kind: 'participant' as const, subject: 'subject-maya' };
    const owner = await application.getOwnerSnapshot(principal, fixture.definition.decisionId);
    const command = {
      schemaVersion: KE.KE_SCHEMA_VERSION, type: 'CONFIRM_FRAME' as const,
      requestId: 'local-ke03-request', decisionId: fixture.definition.decisionId,
      idempotencyKey: 'local-ke03-confirm-frame',
      expected: {
        contextToken: owner.publicSnapshot.contextToken, semanticVersion: owner.publicSnapshot.semanticVersion,
        controlVersion: owner.controlVersion, ownerVersion: owner.ownerVersion,
      },
      payload: { frameVersion: owner.publicSnapshot.frame.frameVersion },
    };
    const first = await application.execute(principal, command);
    expect(first.ok).toBe(true);
    expect(await application.execute(principal, command)).toEqual(first);

    await Promise.all(Array.from({ length: 12 }, () => repository.transactionDecision(
      fixture.definition.decisionId, async decision => {
        const prior = decision!.controlVersion;
        await Promise.resolve();
        decision!.controlVersion = prior + 1;
      },
    )));
    const current = await repository.transactionDecision(fixture.definition.decisionId, decision => decision!);
    expect(current.controlVersion).toBe(initial.controlVersion + 13);
    const stored = await lowLevel.send(new GetItemCommand({
      TableName: tableName,
      Key: { PK: { S: `ROOM#${fixture.definition.decisionId}` }, SK: { S: 'GUARD' } },
      ConsistentRead: true,
    }));
    expect(decodeGuardItem(stored.Item, fixture.definition.decisionId).version).toBe(13);
  });
});
