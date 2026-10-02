import { DynamoDBClient, GetItemCommand, PutItemCommand, type TransactWriteItem } from '@aws-sdk/client-dynamodb';
import { Groups } from '@deal-table/contracts';
import { admissionChanged, type DecisionAdmissionFence } from './admission-context.ts';
export interface GroupRepository {
  transaction<T>(update: (state: Groups.GroupState) => T | Promise<T>): Promise<T>;
  fence(inspect: (state: Groups.GroupState) => void): Promise<DecisionAdmissionFence>;
}
export class GroupCapacityError extends Error {
  constructor() { super('GROUP_CAPACITY_EXCEEDED'); this.name = 'GroupCapacityError'; }
}
type Versioned = { version: number; state: Groups.GroupState };
function checked(state: Groups.GroupState): Groups.GroupState {
  const parsed = Groups.GroupState.parse(state);
  if (Buffer.byteLength(JSON.stringify(parsed)) > 300_000) throw new GroupCapacityError();
  return parsed;
}
/** Strong reads and conditional writes; coordinated decision writes share the group condition/Put. */
export function createDynamoGroupRepository(tableName: string, region: string): GroupRepository {
  const client = new DynamoDBClient({ region });
  const key = { PK: { S: 'NP#GROUPS' }, SK: { S: 'STATE' } };
  const condition = (expected: number) => ({ ConditionExpression: expected ? '#v=:v' : 'attribute_not_exists(PK)',
    ...(expected ? { ExpressionAttributeNames: { '#v': 'version' }, ExpressionAttributeValues: { ':v': { N: String(expected) } } } : {}) });
  const put = (expected: number, state: Groups.GroupState) => ({ TableName: tableName,
    Item: { ...key, version: { N: String(expected + 1) }, payload: { S: JSON.stringify(state) } }, ...condition(expected) });
  return createGroupRepositoryTransport({
    read: async () => {
      const result = await client.send(new GetItemCommand({ TableName: tableName, Key: key, ConsistentRead: true }));
      if (!result.Item) return null;
      const version = Number(result.Item.version?.N);
      if (!Number.isSafeInteger(version) || version < 1 || !result.Item.payload?.S) throw new Error('Invalid group state');
      return { version, state: Groups.GroupState.parse(JSON.parse(result.Item.payload.S)) };
    },
    write: async (expected, state) => {
      try { await client.send(new PutItemCommand(put(expected, state))); return true; }
      catch (error) { if (error instanceof Error && error.name === 'ConditionalCheckFailedException') return false; throw error; }
    },
    fenceWrite: (expected, state) => state ? { Put: put(expected, state) }
      : { ConditionCheck: { TableName: tableName, Key: key, ...condition(expected) } }
  });
}
export function createGroupRepositoryTransport(transport: {
  read: () => Promise<Versioned | null>;
  write: (expected: number, state: Groups.GroupState) => Promise<boolean>;
  fenceWrite?: (expected: number, state: Groups.GroupState | null) => TransactWriteItem;
}): GroupRepository {
  return {
    transaction: async update => {
      for (let attempt = 0; attempt < 6; attempt++) {
        const prior = await transport.read();
        const state = Groups.GroupState.parse(prior ? structuredClone(prior.state) : { accounts: [], groups: [] });
        const before = JSON.stringify(state); const result = await update(state); const next = checked(state);
        if (JSON.stringify(next) === before || await transport.write(prior?.version ?? 0, next)) return result;
      }
      throw new Error('Group conflict: retry the same request');
    },
    fence: async inspect => {
      if (!transport.fenceWrite) throw new Error('ATOMIC_GROUP_FENCE_NOT_CONFIGURED');
      const prior = await transport.read(); const version = prior?.version ?? 0;
      const state = Groups.GroupState.parse(prior ? structuredClone(prior.state) : { accounts: [], groups: [] });
      const before = JSON.stringify(state); inspect(state); const next = checked(state);
      const assertCurrent = async () => { if (((await transport.read())?.version ?? 0) !== version) admissionChanged(); };
      return { assertCurrent, serialize: async work => { await assertCurrent(); return work(); },
        write: transport.fenceWrite(version, JSON.stringify(next) === before ? null : next) };
    }
  };
}
export class MemoryGroupRepository implements GroupRepository {
  private state: Groups.GroupState = { accounts: [], groups: [] };
  private version = 0;
  private tail: Promise<unknown> = Promise.resolve();
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.tail.then(work); this.tail = pending.catch(() => {}); return pending;
  }
  transaction<T>(update: (state: Groups.GroupState) => T | Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      const state = structuredClone(this.state); const result = await update(state); const next = checked(state);
      if (JSON.stringify(next) !== JSON.stringify(this.state)) { this.state = next; this.version++; }
      return result;
    });
  }
  fence(inspect: (state: Groups.GroupState) => void): Promise<DecisionAdmissionFence> {
    return this.exclusive(async () => {
      const version = this.version; const state = structuredClone(this.state); inspect(state); const next = checked(state);
      const changed = JSON.stringify(next) !== JSON.stringify(this.state);
      return {
        assertCurrent: () => this.exclusive(async () => { if (this.version !== version) admissionChanged(); }),
        serialize: work => this.exclusive(async () => {
          if (this.version !== version) admissionChanged();
          // Parse/capacity validation happened before work. Commit is synchronous after decision success.
          const result = await work();
          if (changed) { this.state = next; this.version++; }
          return result;
        })
      };
    });
  }
}
