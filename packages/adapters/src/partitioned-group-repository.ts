import { z } from 'zod';
import { Groups } from '@deal-table/contracts';
import {
  DynamoDBClient, GetItemCommand, BatchGetItemCommand, TransactWriteItemsCommand,
  type TransactWriteItem,
} from '@aws-sdk/client-dynamodb';
import { PartitionDirectoryRow, partitionDirectoryKey, isPartitionDirectoryKey,
  type PartitionDirectoryClaim, type PartitionDirectoryLookup } from './partition-directory.ts';
import { PartitionMembershipRow, partitionMembershipKey, isPartitionMembershipKey } from './partition-membership-contract.ts';

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
  PartitionDirectoryRow,
  PartitionMembershipRow,
]);
export { rowSchema as PartitionRowSchema };
export type PartitionRow = z.infer<typeof rowSchema>;
type DomainRow = Exclude<PartitionRow, { kind: 'DIRECTORY' | 'MEMBERSHIP' }>;
export type PartitionKey = { PK: string; SK: string };
export type PartitionScope = { accountSubjects: string[]; groupId?: string };
export type PartitionMutation = { key: PartitionKey; expected: number; next: PartitionRow | null };
export interface PartitionIOContext { signal: AbortSignal; request(): void }
/** All mutations, including read-only conditions, MUST commit as one atomic transaction. */
export interface PartitionTransport {
  read(key: PartitionKey, context?: PartitionIOContext): Promise<unknown | null>;
  /** Input order preserved, missing rows null; additional underlying requests charge the context. */
  readMany?(keys: PartitionKey[], context?: PartitionIOContext): Promise<(unknown | null)[]>;
  commit(mutations: PartitionMutation[], context?: PartitionIOContext): Promise<boolean>;
}
export interface PartitionFence {
  assertCurrent(): Promise<void>;
  /** Server-only conditions/puts to join the decision transaction, never HTTP authority. */
  mutations: PartitionMutation[];
}
export class PartitionStorageError extends Error {
  constructor(readonly code: 'PARTITION_INVALID' | 'PARTITION_CAPACITY' | 'PARTITION_CONFLICT' | 'PARTITION_STALE'
    | 'PARTITION_TIMEOUT' | 'PARTITION_REQUEST_LIMIT' | 'PARTITION_IDENTITY_CONFLICT') {
    super(code); this.name = 'PartitionStorageError';
  }
}
const fail = (code: PartitionStorageError['code']): never => { throw new PartitionStorageError(code); };
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const encodedKey = (key: PartitionKey) => `${key.PK}/${key.SK}`;
function ioContext(options: { timeoutMs?: number; maxRequests?: number } = {}): PartitionIOContext {
  const timeoutMs = options.timeoutMs ?? 20_000; const maxRequests = options.maxRequests ?? 64;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20_000
    || !Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 64) fail('PARTITION_INVALID');
  let requests = 0;
  const controller = new globalThis.AbortController();
  const signal = globalThis.AbortSignal.any([controller.signal, globalThis.AbortSignal.timeout(timeoutMs)]);
  return { signal, request: () => {
    if (signal.aborted) fail('PARTITION_TIMEOUT');
    if (++requests > maxRequests) {
      const error = new PartitionStorageError('PARTITION_REQUEST_LIMIT'); controller.abort(error); throw error;
    }
  } };
}
async function bounded<T>(context: PartitionIOContext, work: () => Promise<T>, request = true): Promise<T> {
  if (request) context.request();
  if (context.signal.aborted) fail('PARTITION_TIMEOUT');
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(context.signal.reason instanceof PartitionStorageError
      ? context.signal.reason : new PartitionStorageError('PARTITION_TIMEOUT'));
    context.signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => {
      if (context.signal.aborted) return fail('PARTITION_TIMEOUT');
      return work();
    }).then(resolve, reject).finally(() => context.signal.removeEventListener('abort', abort));
  });
}
export const partitionAccountKey = (subject: string): PartitionKey => ({ PK: `ACCOUNT#${id.parse(subject)}`, SK: 'STATE' });
export const partitionGroupKey = (groupId: string): PartitionKey => ({ PK: `GROUP#${id.parse(groupId)}`, SK: 'STATE' });
const childKey = (groupId: string, kind: 'DRAFT' | 'BINDING', childId: string): PartitionKey => ({
  PK: partitionGroupKey(groupId).PK, SK: `${kind}#${id.parse(childId)}`,
});
function checkedRow(raw: unknown, key: PartitionKey): PartitionRow {
  const parsed = rowSchema.safeParse(raw);
  if (!parsed.success) return fail('PARTITION_INVALID');
  const row = parsed.data;
  const valid = row.kind === 'DIRECTORY' ? equal(key, partitionDirectoryKey(row.value))
    : row.kind === 'MEMBERSHIP' ? equal(key, partitionMembershipKey(row.value.subject, row.value.groupId))
    : row.kind === 'ACCOUNT' ? equal(key, partitionAccountKey(row.value.subject))
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
function stateRows(state: Groups.GroupState, scope: PartitionScope): Map<string, { key: PartitionKey; row: DomainRow }> {
  const parsed = Groups.GroupState.safeParse(state);
  if (!parsed.success) return fail('PARTITION_INVALID');
  const rows = new Map<string, { key: PartitionKey; row: DomainRow }>();
  const add = (key: PartitionKey, row: DomainRow) => {
    if (rows.has(encodedKey(key))) fail('PARTITION_INVALID');
    const parsed = checkedRow(row, key); if (parsed.kind === 'DIRECTORY' || parsed.kind === 'MEMBERSHIP') return fail('PARTITION_INVALID');
    rows.set(encodedKey(key), { key, row: parsed });
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
    if (new Set(group.invitations.map(item => item.tokenHash)).size !== group.invitations.length) fail('PARTITION_INVALID');
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
/** Inactive migration compiler: validate the same scoped invariants, without any I/O. */
export function partitionSeedRows(state: Groups.GroupState, scope: PartitionScope): PartitionMutation[] {
  scopeKeys(scope);
  return structuredClone([...stateRows(state, scope).values()].map(({ key, row }) => ({ key, expected: 0, next: row })));
}
type Snapshot = { state: Groups.GroupState; rows: Map<string, { key: PartitionKey; row: PartitionRow | null }> };
export function createPartitionedGroupRepository(transport: PartitionTransport,
  options: { timeoutMs?: number; maxRequests?: number } = {}) {
  ioContext(options); // Validate trusted configuration before reading or invoking callbacks.
  async function readMany(keys: PartitionKey[], context: PartitionIOContext) {
    if (!keys.length) return [];
    const values: (unknown | null)[] = [];
    if (transport.readMany) values.push(...await bounded(context, () => transport.readMany!(keys, context)));
    else for (let start = 0; start < keys.length; start += 8) {
      values.push(...await Promise.all(keys.slice(start, start + 8).map(key => bounded(context, () => transport.read(key, context)))));
    }
    if (values.length !== keys.length) fail('PARTITION_INVALID');
    return values;
  }
  async function read(scope: PartitionScope, context: PartitionIOContext): Promise<Snapshot> {
    const keys = scopeKeys(scope);
    for (let attempt = 0; attempt < 6; attempt++) {
      const rows: Snapshot['rows'] = new Map();
      const authorities = await readMany(keys, context);
      for (const [index, key] of keys.entries()) {
        const raw = authorities[index];
        rows.set(encodedKey(key), { key, row: raw === null ? null : checkedRow(raw, key) });
      }
      const groupRow = scope.groupId ? rows.get(encodedKey(partitionGroupKey(scope.groupId)))?.row : null;
      if (groupRow && groupRow.kind !== 'GROUP') fail('PARTITION_INVALID');
      const accounts = [...rows.values()].flatMap(({ row }) => row?.kind === 'ACCOUNT' ? [row.value] : []);
      const groups: Groups.Group[] = [];
      if (groupRow?.kind === 'GROUP') {
        const { draftIds, decisionIds, ...metadata } = groupRow.value;
        if (metadata.members.some(subject => !scope.accountSubjects.includes(subject))) fail('PARTITION_STALE');
        if (new Set(draftIds).size !== draftIds.length || new Set(decisionIds).size !== decisionIds.length) fail('PARTITION_INVALID');
        const drafts: Groups.GroupDraft[] = []; const decisions: Groups.Group['decisions'] = [];
        const children = draftIds.map(childId => childKey(metadata.id, 'DRAFT', childId))
          .concat(decisionIds.map(childId => childKey(metadata.id, 'BINDING', childId)));
        const values = await readMany(children, context);
        for (const [index, key] of children.entries()) {
            const raw = values[index];
            if (raw === null) fail('PARTITION_INVALID');
            const row = checkedRow(raw, key); rows.set(encodedKey(key), { key, row });
            if (row.kind === 'DRAFT') drafts.push(row.value);
            else if (row.kind === 'BINDING') decisions.push(row.value);
            else fail('PARTITION_INVALID');
        }
        groups.push({ ...metadata, drafts, decisions });
      }
      // A header is advanced in every child commit. Reject torn reads and account changes.
      let current = true;
      const checkedAuthorities = await readMany(keys, context);
      for (const [index, key] of keys.entries()) {
        const raw = checkedAuthorities[index]; const row = raw === null ? null : checkedRow(raw, key);
        if (!equal(row, rows.get(encodedKey(key))!.row)) current = false;
      }
      if (!current) continue;
      const state = structuredClone({ accounts, groups }); stateRows(state, scope); return { state, rows };
    }
    return fail('PARTITION_CONFLICT');
  }
  async function mutations(snapshot: Snapshot, scope: PartitionScope, context: PartitionIOContext): Promise<PartitionMutation[]> {
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
      if (prior?.kind === 'ACCOUNT' && row.kind === 'ACCOUNT' && prior.value.emailHash !== row.value.emailHash) fail('PARTITION_IDENTITY_CONFLICT');
      if (prior?.kind === 'GROUP' && row.kind === 'GROUP') {
        for (const invitation of row.value.invitations) {
          const old = prior.value.invitations.find(item => item.tokenHash === invitation.tokenHash);
          if (old && (old.recipientHash !== invitation.recipientHash || old.expiresAt !== invitation.expiresAt
            || (old.acceptedBy && old.acceptedBy !== invitation.acceptedBy))) fail('PARTITION_IDENTITY_CONFLICT');
        }
      }
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
    // Discovery edges are private derived data, never callback-controlled authority.
    // Only roster differences change them; the header/account guards join every put.
    const priorHeader = scope.groupId ? snapshot.rows.get(encodedKey(partitionGroupKey(scope.groupId)))?.row : null;
    const nextHeader = scope.groupId ? next.get(encodedKey(partitionGroupKey(scope.groupId)))?.row : null;
    const before = priorHeader?.kind === 'GROUP' ? priorHeader.value.members : [];
    const after = nextHeader?.kind === 'GROUP' ? nextHeader.value.members : [];
    const changedMembers = [...new Set([...before, ...after])].filter(subject => before.includes(subject) !== after.includes(subject));
    const edgeKeys = changedMembers.map(subject => partitionMembershipKey(subject, scope.groupId!));
    const edges = await readMany(edgeKeys, context);
    for (const [index, subject] of changedMembers.entries()) {
      const key = edgeKeys[index]!; const raw = edges[index];
      const prior = raw === null ? null : checkedRow(raw, key);
      if (prior && prior.kind !== 'MEMBERSHIP') fail('PARTITION_INVALID');
      const wasMember = before.includes(subject);
      if ((prior?.kind === 'MEMBERSHIP' ? prior.value.active : false) !== wasMember) fail('PARTITION_INVALID');
      const expected = prior?.revision ?? 0;
      if (expected >= Number.MAX_SAFE_INTEGER) fail('PARTITION_CAPACITY');
      output.push({ key, expected, next: { schemaVersion: 1, kind: 'MEMBERSHIP', revision: expected + 1,
        value: { subject, groupId: scope.groupId!, active: after.includes(subject) } } });
    }
    const claims: PartitionDirectoryClaim[] = [];
    for (const mutation of output) {
      if (!mutation.next) continue;
      const prior = snapshot.rows.get(encodedKey(mutation.key))?.row;
      const row = mutation.next;
      if (row.kind === 'ACCOUNT' && !prior) claims.push({ type: 'EMAIL', subject: row.value.subject, emailHash: row.value.emailHash });
      if (row.kind === 'BINDING' && !prior) claims.push({ type: 'DECISION', decisionId: row.value.id, groupId: scope.groupId! });
      if (row.kind === 'GROUP') {
        for (const invitation of row.value.invitations) {
          if (prior?.kind !== 'GROUP' || !prior.value.invitations.some(item => item.tokenHash === invitation.tokenHash)) {
            claims.push({ type: 'INVITATION', groupId: row.value.id, tokenHash: invitation.tokenHash,
              recipientHash: invitation.recipientHash, expiresAt: invitation.expiresAt });
          }
        }
      }
    }
    const claimKeys = claims.map(partitionDirectoryKey);
    if (new Set(claimKeys.map(encodedKey)).size !== claimKeys.length) fail('PARTITION_IDENTITY_CONFLICT');
    if (output.length + claims.length > 100) fail('PARTITION_CAPACITY');
    const storedClaims = await readMany(claimKeys, context);
    for (const [index, value] of claims.entries()) {
      const key = claimKeys[index]!; const raw = storedClaims[index];
      const prior = raw === null ? null : checkedRow(raw, key);
      // Existing parent rows handle replay. Retained identifiers cannot recreate removed edges.
      if (prior) fail('PARTITION_IDENTITY_CONFLICT');
      output.push({ key, expected: 0, next: { schemaVersion: 1, revision: 1, kind: 'DIRECTORY', value } });
    }
    if (output.length > 100 || Buffer.byteLength(JSON.stringify(output)) > 3_500_000) fail('PARTITION_CAPACITY');
    return structuredClone(output);
  }
  return {
    async transaction<T>(scope: PartitionScope, update: (state: Groups.GroupState) => T | Promise<T>, supplied?: PartitionIOContext): Promise<T> {
      const context = supplied ?? ioContext(options);
      for (let attempt = 0; attempt < 6; attempt++) {
        const snapshot = await read(scope, context); const result = structuredClone(await bounded(context,
          () => Promise.resolve(update(snapshot.state)), false));
        // Conditions apply even if callback only read: authority is current at the commit boundary.
        const pending = await mutations(snapshot, scope, context);
        if (await bounded(context, () => transport.commit(pending, context))) return result;
      }
      return fail('PARTITION_CONFLICT');
    },
    async fence(scope: PartitionScope, inspect: (state: Groups.GroupState) => void, supplied?: PartitionIOContext): Promise<PartitionFence> {
      const context = supplied ?? ioContext(options);
      const snapshot = await read(scope, context); inspect(snapshot.state); const pending = await mutations(snapshot, scope, context);
      return { mutations: pending, assertCurrent: async () => {
        const currentValues = await readMany(pending.map(item => item.key), supplied ?? ioContext(options));
        for (const [index, mutation] of pending.entries()) {
          const raw = currentValues[index];
          const current = raw === null ? null : checkedRow(raw, mutation.key);
          if ((current?.revision ?? 0) !== mutation.expected) fail('PARTITION_STALE');
        }
      } };
    },
    async lookup(raw: PartitionDirectoryLookup, supplied?: PartitionIOContext): Promise<PartitionDirectoryClaim | null> {
      const key = partitionDirectoryKey(raw); const values = await readMany([key], supplied ?? ioContext(options));
      const row = values[0] === null ? null : checkedRow(values[0], key);
      if (row && row.kind !== 'DIRECTORY') fail('PARTITION_INVALID');
      return row?.kind === 'DIRECTORY' ? structuredClone(row.value) : null;
    },
  };
}
export { ioContext as partitionIO, bounded as partitionCall, checkedRow as checkPartitionRow };

export function partitionDynamoWrites(tableName: string, mutations: PartitionMutation[]): TransactWriteItem[] {
  if (tableName !== 'KnownEnoughPartitions' || mutations.length < 1 || mutations.length > 100
    || new Set(mutations.map(item => encodedKey(item.key))).size !== mutations.length) fail('PARTITION_INVALID');
  if (Buffer.byteLength(JSON.stringify(mutations)) > 3_500_000) fail('PARTITION_CAPACITY');
  return mutations.map(({ key, expected, next }) => {
    if (!Number.isSafeInteger(expected) || expected < 0
      || (!isPartitionMembershipKey(key) && !isPartitionDirectoryKey(key) && (!/^(ACCOUNT|GROUP)#[A-Za-z0-9_-]{1,80}$/.test(key.PK)
        || !/^(STATE|(DRAFT|BINDING)#[A-Za-z0-9_-]{1,80})$/.test(key.SK)
        || (key.PK.startsWith('ACCOUNT#') && key.SK !== 'STATE')))) fail('PARTITION_INVALID');
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
  const client = new DynamoDBClient({ region, maxAttempts: 1, endpoint: 'https://dynamodb.us-east-1.amazonaws.com' });
  const attributes = (key: PartitionKey) => ({ PK: { S: key.PK }, SK: { S: key.SK } });
  const decode = (item: { revision?: { N?: string }; payload?: { S?: string } }, key: PartitionKey) => {
    try {
      const row = checkedRow(JSON.parse(item.payload?.S ?? ''), key);
      if (String(row.revision) !== item.revision?.N) fail('PARTITION_INVALID');
      return row;
    } catch { return fail('PARTITION_INVALID'); }
  };
  return {
    read: async (key, supplied) => {
      // Reuse strict key validation before any I/O.
      partitionDynamoWrites(tableName, [{ key, expected: 0, next: null }]);
      const context = supplied ?? ioContext(); if (!supplied) context.request();
      const result = await client.send(new GetItemCommand({ TableName: tableName,
        Key: attributes(key), ConsistentRead: true }), { abortSignal: context.signal })
        .catch((error: unknown) => { throw new Error('PARTITION_STORAGE_UNAVAILABLE', { cause: error }); });
      if (!result.Item) return null;
      return decode(result.Item, key);
    },
    readMany: async (keys, supplied) => {
      if (keys.length > 145 || new Set(keys.map(encodedKey)).size !== keys.length) fail('PARTITION_INVALID');
      keys.forEach(key => partitionDynamoWrites(tableName, [{ key, expected: 0, next: null }]));
      const context = supplied ?? ioContext();
      const results = new Map<string, PartitionRow | null>(); let first = true;
      for (let start = 0; start < keys.length; start += 100) {
        let pending = keys.slice(start, start + 100);
        while (pending.length) {
          if (!first || !supplied) context.request(); first = false;
          const response = await client.send(new BatchGetItemCommand({ RequestItems: {
            [tableName]: { Keys: pending.map(attributes), ConsistentRead: true },
          } }), { abortSignal: context.signal })
            .catch((error: unknown) => { throw new Error('PARTITION_STORAGE_UNAVAILABLE', { cause: error }); });
          if (Object.keys(response.Responses ?? {}).some(table => table !== tableName)
            || Object.keys(response.UnprocessedKeys ?? {}).some(table => table !== tableName)) fail('PARTITION_INVALID');
          const requested = new Set(pending.map(encodedKey)); const returned = new Set<string>();
          const fromAttributes = (raw: { PK?: { S?: string }; SK?: { S?: string } }): PartitionKey => {
            if (!raw.PK?.S || !raw.SK?.S) return fail('PARTITION_INVALID');
            const key = { PK: raw.PK.S, SK: raw.SK.S };
            if (!requested.has(encodedKey(key))) fail('PARTITION_INVALID');
            return key;
          };
          for (const item of response.Responses?.[tableName] ?? []) {
            const key = fromAttributes(item); const encoded = encodedKey(key);
            if (returned.has(encoded) || results.has(encoded)) fail('PARTITION_INVALID');
            returned.add(encoded); results.set(encoded, decode(item, key));
          }
          const unprocessed = (response.UnprocessedKeys?.[tableName]?.Keys ?? []).map(fromAttributes);
          const outstanding = new Set(unprocessed.map(encodedKey));
          if (outstanding.size !== unprocessed.length || [...outstanding].some(key => returned.has(key) || results.has(key))) fail('PARTITION_INVALID');
          for (const key of pending) {
            const encoded = encodedKey(key);
            if (!returned.has(encoded) && !outstanding.has(encoded)) results.set(encoded, null);
          }
          pending = unprocessed;
        }
      }
      return keys.map(key => results.get(encodedKey(key)) ?? null);
    },
    commit: async (mutations, supplied) => {
      const TransactItems = partitionDynamoWrites(tableName, mutations);
      const context = supplied ?? ioContext(); if (!supplied) context.request();
      try { await client.send(new TransactWriteItemsCommand({ TransactItems }),
        { abortSignal: context.signal }); return true; }
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
