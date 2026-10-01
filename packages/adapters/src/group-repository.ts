import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { Groups } from '@deal-table/contracts';
export interface GroupRepository { transaction<T>(update: (state: Groups.GroupState) => T | Promise<T>): Promise<T> }
/** Small bounded MVP aggregate: strong reads and conditional version writes serialize membership/admission. */
export function createDynamoGroupRepository(tableName: string, region: string): GroupRepository {
  const client = new DynamoDBClient({ region });
  return createGroupRepositoryTransport({
    read: async () => {
      const result = await client.send(new GetItemCommand({ TableName: tableName,
        Key: { PK: { S: 'NP#GROUPS' }, SK: { S: 'STATE' } }, ConsistentRead: true }));
      if (!result.Item) return null;
      const version = Number(result.Item.version?.N);
      if (!Number.isSafeInteger(version) || version < 1 || !result.Item.payload?.S) throw new Error('Invalid group state');
      return { version, state: Groups.GroupState.parse(JSON.parse(result.Item.payload.S)) };
    },
    write: async (expected, state) => {
      try {
        await client.send(new PutItemCommand({ TableName: tableName,
          Item: { PK: { S: 'NP#GROUPS' }, SK: { S: 'STATE' }, version: { N: String(expected + 1) }, payload: { S: JSON.stringify(state) } },
          ConditionExpression: expected === 0 ? 'attribute_not_exists(PK)' : '#v = :v',
          ...(expected ? { ExpressionAttributeNames: { '#v': 'version' }, ExpressionAttributeValues: { ':v': { N: String(expected) } } } : {}) }));
        return true;
      } catch (error) { if (error instanceof Error && error.name === 'ConditionalCheckFailedException') return false; throw error; }
    },
  });
}
export function createGroupRepositoryTransport(transport: {
  read: () => Promise<{ version: number; state: Groups.GroupState } | null>;
  write: (expected: number, state: Groups.GroupState) => Promise<boolean>;
}): GroupRepository {
  return { transaction: async update => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const prior = await transport.read();
      const state = Groups.GroupState.parse(prior ? structuredClone(prior.state) : { accounts: [], groups: [] });
      const before = JSON.stringify(state);
      const result = await update(state);
      const checked = Groups.GroupState.parse(state);
      const payload = JSON.stringify(checked);
      if (Buffer.byteLength(payload) > 300_000) throw new Error('Group capacity reached');
      if (payload === before || await transport.write(prior?.version ?? 0, checked)) return result;
    }
    throw new Error('Group conflict: retry the same request');
  } };
}
export class MemoryGroupRepository implements GroupRepository {
  private state: Groups.GroupState = { accounts: [], groups: [] };
  private tail: Promise<unknown> = Promise.resolve();
  transaction<T>(update: (state: Groups.GroupState) => T | Promise<T>): Promise<T> {
    const pending = this.tail.then(async () => {
      const state = structuredClone(this.state);
      const result = await update(state);
      this.state = Groups.GroupState.parse(state);
      return result;
    });
    this.tail = pending.catch(() => {});
    return pending;
  }
}
