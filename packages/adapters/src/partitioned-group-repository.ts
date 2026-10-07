import { z } from 'zod';
import { Groups } from '@deal-table/contracts';
import {
  DynamoDBClient, GetItemCommand, TransactWriteItemsCommand,
  type TransactWriteItem,
} from '@aws-sdk/client-dynamodb';

// Inactive OPS01 boundary. Runtime selection and legacy callback integration are separate work.
const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const binding = Groups.Group.shape.decisions.element;
const header = Groups.Group.omit({ drafts: true, decisions: true }).extend({
  draftIds: z.array(id).max(64), decisionIds: z.array(id).max(64),
});
const base = { schemaVersion: z.literal(1), revision };
const rowSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...base, kind: z.literal('ACCOUNT'), value: Groups.Account }),
  z.strictObject({ ...base, kind: z.literal('GROUP'), value: header }),
  z.strictObject({ ...base, kind: z.literal('DRAFT'), value: Groups.GroupDraft }),
  z.strictObject({ ...base, kind: z.literal('BINDING'), value: binding }),
]);
export type PartitionRow = z.infer<typeof rowSchema>;
export type PartitionKey = { PK: string; SK: string };
export type PartitionScope = { accountSubjects: string[]; groupId?: string };
export type PartitionMutation = { key: PartitionKey; expected: number; next: PartitionRow | null };
/** All mutations, including read-only conditions, MUST commit as one atomic transaction. */
export interface PartitionTransport {
  read(key: PartitionKey): Promise<unknown | null>;
  commit(mutations: PartitionMutation[]): Promise<boolean>;
}
export interface PartitionFence {
  assertCurrent(): Promise<void>;
  /** Server-only conditions/puts to join the decision transaction, never HTTP authority. */
  mutations: PartitionMutation[];
}
export class PartitionStorageError extends Error {
  constructor(readonly code: 'PARTITION_INVALID' | 'PARTITION_CAPACITY' | 'PARTITION_CONFLICT' | 'PARTITION_STALE') {
    super(code); this.name = 'PartitionStorageError';
  }
}
const fail = (code: PartitionStorageError['code']): never => { throw new PartitionStorageError(code); };
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const encodedKey = (key: PartitionKey) => `${key.PK}/${key.SK}`;
export const partitionAccountKey = (subject: string): PartitionKey => ({ PK: `ACCOUNT#${id.parse(subject)}`, SK: 'STATE' });
export const partitionGroupKey = (groupId: string): PartitionKey => ({ PK: `GROUP#${id.parse(groupId)}`, SK: 'STATE' });
const childKey = (groupId: string, kind: 'DRAFT' | 'BINDING', childId: string): PartitionKey => ({
  PK: partitionGroupKey(groupId).PK, SK: `${kind}#${id.parse(childId)}`,
});
function checkedRow(raw: unknown, key: PartitionKey): PartitionRow {
  const parsed = rowSchema.safeParse(raw);
  if (!parsed.success) return fail('PARTITION_INVALID');
  const row = parsed.data;
  const valid = row.kind === 'ACCOUNT' ? equal(key, partitionAccountKey(row.value.subject))
    : row.kind === 'GROUP' ? equal(key, partitionGroupKey(row.value.id))
    : /^GROUP#[A-Za-z0-9_-]{1,80}$/.test(key.PK) && key.SK === `${row.kind}#${row.value.id}`;
  if (!valid) return fail('PARTITION_INVALID');
  if (Buffer.byteLength(JSON.stringify(row)) > 352 * 1024) return fail('PARTITION_CAPACITY');
  return row;
}
function scopeKeys(scope: PartitionScope) {
  // An account-only operation or one group's complete roster; no unbounded global callback.
  if (!scope.accountSubjects.length || scope.accountSubjects.length > 16
    || new Set(scope.accountSubjects).size !== scope.accountSubjects.length) return fail('PARTITION_INVALID');
  return scope.accountSubjects.map(partitionAccountKey).concat(scope.groupId ? [partitionGroupKey(scope.groupId)] : []);
}
function uniqueIds(values: { id: string }[]) {
  if (new Set(values.map(value => value.id)).size !== values.length) fail('PARTITION_INVALID');
}
function stateRows(state: Groups.GroupState, scope: PartitionScope): Map<string, { key: PartitionKey; row: PartitionRow }> {
  const parsed = Groups.GroupState.safeParse(state);
  if (!parsed.success) return fail('PARTITION_INVALID');
  const rows = new Map<string, { key: PartitionKey; row: PartitionRow }>();
  const add = (key: PartitionKey, row: PartitionRow) => {
    if (rows.has(encodedKey(key))) fail('PARTITION_INVALID');
    rows.set(encodedKey(key), { key, row: checkedRow(row, key) });
  };
  for (const account of parsed.data.accounts) {
    if (!scope.accountSubjects.includes(account.subject) || !Number.isSafeInteger(account.version)) fail('PARTITION_INVALID');
    add(partitionAccountKey(account.subject), { schemaVersion: 1, revision: 1, kind: 'ACCOUNT', value: account });
  }
  if (parsed.data.groups.length > 1) fail('PARTITION_INVALID');
  for (const group of parsed.data.groups) {
    if (group.id !== scope.groupId || !Number.isSafeInteger(group.version)
      || !group.members.includes(group.organizer) || new Set(group.members).size !== group.members.length
      || group.members.some(subject => !scope.accountSubjects.includes(subject)
        || !parsed.data.accounts.some(account => account.subject === subject))) fail('PARTITION_INVALID');
    uniqueIds(group.drafts); uniqueIds(group.decisions);
    if (group.drafts.some(draft => draft.createdDecisionId
      && !group.decisions.some(decision => decision.id === draft.createdDecisionId))) fail('PARTITION_INVALID');
    const { drafts, decisions, ...metadata } = group;
    add(partitionGroupKey(group.id), { schemaVersion: 1, revision: 1, kind: 'GROUP', value: {
      ...metadata, draftIds: drafts.map(item => item.id), decisionIds: decisions.map(item => item.id),
    } });
    drafts.forEach(value => add(childKey(group.id, 'DRAFT', value.id), { schemaVersion: 1, revision: 1, kind: 'DRAFT', value }));
    decisions.forEach(value => add(childKey(group.id, 'BINDING', value.id), { schemaVersion: 1, revision: 1, kind: 'BINDING', value }));
  }
  return rows;
}
type Snapshot = { state: Groups.GroupState; rows: Map<string, { key: PartitionKey; row: PartitionRow | null }> };
export function createPartitionedGroupRepository(transport: PartitionTransport) {
  async function read(scope: PartitionScope): Promise<Snapshot> {
    const keys = scopeKeys(scope);
    for (let attempt = 0; attempt < 6; attempt++) {
      const rows: Snapshot['rows'] = new Map();
      // At most 17 authority reads, then at most 128 children. Sequential requests are bounded.
      for (const key of keys) {
        const raw = await transport.read(key);
        rows.set(encodedKey(key), { key, row: raw === null ? null : checkedRow(raw, key) });
      }
      const groupRow = scope.groupId ? rows.get(encodedKey(partitionGroupKey(scope.groupId)))?.row : null;
      if (groupRow && groupRow.kind !== 'GROUP') fail('PARTITION_INVALID');
      const accounts = [...rows.values()].flatMap(({ row }) => row?.kind === 'ACCOUNT' ? [row.value] : []);
      const groups: Groups.Group[] = [];
      if (groupRow?.kind === 'GROUP') {
        const { draftIds, decisionIds, ...metadata } = groupRow.value;
        if (new Set(draftIds).size !== draftIds.length || new Set(decisionIds).size !== decisionIds.length) fail('PARTITION_INVALID');
        const drafts: Groups.GroupDraft[] = []; const decisions: Groups.Group['decisions'] = [];
        for (const [kind, ids] of [['DRAFT', draftIds], ['BINDING', decisionIds]] as const) {
          for (const childId of ids) {
            const key = childKey(metadata.id, kind, childId); const raw = await transport.read(key);
            if (raw === null) fail('PARTITION_INVALID');
            const row = checkedRow(raw, key); rows.set(encodedKey(key), { key, row });
            if (row.kind === 'DRAFT') drafts.push(row.value);
            else if (row.kind === 'BINDING') decisions.push(row.value);
            else fail('PARTITION_INVALID');
          }
        }
        groups.push({ ...metadata, drafts, decisions });
      }
      // A header is advanced in every child commit. Reject torn reads and account changes.
      let current = true;
      for (const key of keys) {
        const raw = await transport.read(key); const row = raw === null ? null : checkedRow(raw, key);
        if (!equal(row, rows.get(encodedKey(key))!.row)) current = false;
      }
      if (!current) continue;
      const state = structuredClone({ accounts, groups }); stateRows(state, scope); return { state, rows };
    }
    return fail('PARTITION_CONFLICT');
  }
  function mutations(snapshot: Snapshot, scope: PartitionScope): PartitionMutation[] {
    const next = stateRows(snapshot.state, scope); const output: PartitionMutation[] = [];
    // Normal mutation never deletes retained accounts, group identity or replay-bearing children.
    for (const [key, prior] of snapshot.rows) {
      if (prior.row && !next.has(key)) fail('PARTITION_INVALID');
    }
    let groupChanged = false;
    for (const [key, { row }] of next) {
      const prior = snapshot.rows.get(key)?.row;
      if (!equal(prior?.value, row.value) && row.kind !== 'ACCOUNT') groupChanged = true;
      if (prior?.kind === 'DRAFT' && row.kind === 'DRAFT'
        && prior.value.createdDecisionId && prior.value.createdDecisionId !== row.value.createdDecisionId) fail('PARTITION_INVALID');
    }
    for (const [key, entry] of next) {
      const prior = snapshot.rows.get(key)?.row; const expected = prior?.revision ?? 0;
      const changed = !equal(prior?.value, entry.row.value) || (entry.row.kind === 'GROUP' && groupChanged);
      if (changed && expected >= Number.MAX_SAFE_INTEGER) fail('PARTITION_CAPACITY');
      const row = changed ? { ...entry.row, revision: expected + 1 } : null;
      if (changed || entry.row.kind === 'ACCOUNT' || entry.row.kind === 'GROUP') output.push({ key: entry.key, expected, next: row });
    }
    for (const [key, prior] of snapshot.rows) {
      if (!next.has(key)) output.push({ key: prior.key, expected: 0, next: null });
    }
    if (output.length > 100 || Buffer.byteLength(JSON.stringify(output)) > 3_500_000) fail('PARTITION_CAPACITY');
    return structuredClone(output);
  }
  return {
    async transaction<T>(scope: PartitionScope, update: (state: Groups.GroupState) => T | Promise<T>): Promise<T> {
      for (let attempt = 0; attempt < 6; attempt++) {
        const snapshot = await read(scope); const result = structuredClone(await update(snapshot.state));
        // Conditions apply even if callback only read: authority is current at the commit boundary.
        if (await transport.commit(mutations(snapshot, scope))) return result;
      }
      return fail('PARTITION_CONFLICT');
    },
    async fence(scope: PartitionScope, inspect: (state: Groups.GroupState) => void): Promise<PartitionFence> {
      const snapshot = await read(scope); inspect(snapshot.state); const pending = mutations(snapshot, scope);
      return { mutations: pending, assertCurrent: async () => {
        for (const mutation of pending) {
          const raw = await transport.read(mutation.key);
          const current = raw === null ? null : checkedRow(raw, mutation.key);
          if ((current?.revision ?? 0) !== mutation.expected) fail('PARTITION_STALE');
        }
      } };
    },
  };
}

export function partitionDynamoWrites(tableName: string, mutations: PartitionMutation[]): TransactWriteItem[] {
  if (tableName !== 'KnownEnoughPartitions' || mutations.length < 1 || mutations.length > 100
    || new Set(mutations.map(item => encodedKey(item.key))).size !== mutations.length) fail('PARTITION_INVALID');
  if (Buffer.byteLength(JSON.stringify(mutations)) > 3_500_000) fail('PARTITION_CAPACITY');
  return mutations.map(({ key, expected, next }) => {
    if (!Number.isSafeInteger(expected) || expected < 0
      || !/^(ACCOUNT|GROUP)#[A-Za-z0-9_-]{1,80}$/.test(key.PK)
      || !/^(STATE|(DRAFT|BINDING)#[A-Za-z0-9_-]{1,80})$/.test(key.SK)
      || (key.PK.startsWith('ACCOUNT#') && key.SK !== 'STATE')) fail('PARTITION_INVALID');
    const Key = { PK: { S: key.PK }, SK: { S: key.SK } };
    const condition = expected ? { ConditionExpression: '#r=:r', ExpressionAttributeNames: { '#r': 'revision' },
      ExpressionAttributeValues: { ':r': { N: String(expected) } } } : { ConditionExpression: 'attribute_not_exists(PK)' };
    if (!next) return { ConditionCheck: { TableName: tableName, Key, ...condition } };
    const row = checkedRow(next, key);
    if (row.revision !== expected + 1) fail('PARTITION_INVALID');
    return { Put: { TableName: tableName, Item: { ...Key, revision: { N: String(row.revision) },
      payload: { S: JSON.stringify(row) } }, ...condition } };
  });
}
/** No table is created, runtime activated or environment configuration changed by construction. */
export function createDynamoPartitionTransport(tableName: string, region: string): PartitionTransport {
  if (tableName !== 'KnownEnoughPartitions' || region !== 'us-east-1') fail('PARTITION_INVALID');
  const client = new DynamoDBClient({ region, maxAttempts: 1 });
  return {
    read: async key => {
      // Reuse strict key validation before any I/O.
      partitionDynamoWrites(tableName, [{ key, expected: 0, next: null }]);
      const result = await client.send(new GetItemCommand({ TableName: tableName,
        Key: { PK: { S: key.PK }, SK: { S: key.SK } }, ConsistentRead: true }),
      { abortSignal: globalThis.AbortSignal.timeout(30_000) })
        .catch((error: unknown) => { throw new Error('PARTITION_STORAGE_UNAVAILABLE', { cause: error }); });
      if (!result.Item) return null;
      try {
        const row = checkedRow(JSON.parse(result.Item.payload?.S ?? ''), key);
        if (String(row.revision) !== result.Item.revision?.N) fail('PARTITION_INVALID');
        return row;
      } catch { return fail('PARTITION_INVALID'); }
    },
    commit: async mutations => {
      const TransactItems = partitionDynamoWrites(tableName, mutations);
      try { await client.send(new TransactWriteItemsCommand({ TransactItems }),
        { abortSignal: globalThis.AbortSignal.timeout(30_000) }); return true; }
      catch (error) {
        if (error instanceof Error && error.name === 'TransactionConflictException') return false;
        if (error instanceof Error && error.name === 'TransactionCanceledException'
          && 'CancellationReasons' in error && Array.isArray(error.CancellationReasons)
          && error.CancellationReasons.some(reason => ['ConditionalCheckFailed', 'TransactionConflict'].includes(reason?.Code))
          && error.CancellationReasons.every(reason => ['None', 'ConditionalCheckFailed', 'TransactionConflict'].includes(reason?.Code))) return false;
        throw new Error('PARTITION_STORAGE_UNAVAILABLE', { cause: error });
      }
    },
  };
}
