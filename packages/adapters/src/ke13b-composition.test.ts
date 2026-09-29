import { TransactGetItemsCommand, TransactWriteItemsCommand, type DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { describe, expect, it } from 'vitest';
import { InMemoryRoomRepository } from './index.ts';
import { DynamoDBRoomRepository, createAwsDynamoDBRoomRepository } from './dynamodb.ts';
import { KnownEnoughApplication } from '@deal-table/application';
import { KnownEnough as KE } from '@deal-table/contracts';

const definition = KE.DecisionDefinition.parse({ schemaVersion: KE.KE_SCHEMA_VERSION,
  decisionId: 'ke13b-room', contextToken: '0'.repeat(64), frameVersion: 1, semanticVersion: 1,
  title: 'Synthetic stage decision', objective: 'Decide together.', description: '',
  participants: [{ id: 'maya', displayName: 'Maya', requiredForApproval: true }],
  requiredParticipantIds: ['maya'], variables: [], rules: [] });

describe('KE13B DynamoDB composition', () => {
  it('creates initial generic STATE and GUARD atomically and reads through a transaction', async () => {
    const memory = new InMemoryRoomRepository();
    const app = new KnownEnoughApplication({ repository: memory,
      clock: { now: () => '2026-10-01T12:00:00.000Z' }, ids: { next: () => crypto.randomUUID() } });
    await app.createDecision({ definition, creatorSubject: 'subject-maya',
      memberships: [{ participantId: 'maya', subject: 'subject-maya', active: true }] });
    const record = await memory.transactionDecision('ke13b-room', value => structuredClone(value));
    const sent: unknown[] = [];
    const client = { send: async (command: unknown) => {
      sent.push(command);
      if (command instanceof TransactGetItemsCommand) return { Responses: [] };
      return {};
    } } as unknown as DynamoDBClient;
    const durable = new DynamoDBRoomRepository({ client, tableName: 'KnownEnoughStage' });
    await durable.createDecision(record!);
    const write = sent[0] as TransactWriteItemsCommand;
    expect(write).toBeInstanceOf(TransactWriteItemsCommand);
    expect(write.input.TransactItems).toHaveLength(2);
    expect(write.input.TransactItems?.every(item => item.Put?.TableName === 'KnownEnoughStage')).toBe(true);
    expect(write.input.TransactItems?.map(item => item.Put?.Item?.PK?.S)).toEqual(['ROOM#ke13b-room', 'ROOM#ke13b-room']);
    await expect(durable.transactionDecision('ke13b-room', value => value)).rejects.toThrow();
    expect(sent[1]).toBeInstanceOf(TransactGetItemsCommand);
  });

  it('requires an explicit exact staging table and region for default credentials', () => {
    expect(createAwsDynamoDBRoomRepository('KnownEnoughStage', 'us-east-1')).toBeInstanceOf(DynamoDBRoomRepository);
    expect(() => createAwsDynamoDBRoomRepository('*', 'us-east-1')).toThrow();
    expect(() => createAwsDynamoDBRoomRepository('KnownEnoughStage', 'wrong')).toThrow();
  });
});
