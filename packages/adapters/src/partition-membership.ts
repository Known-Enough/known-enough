import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { DynamoDBClient, GetItemCommand, QueryCommand, BatchGetItemCommand } from '@aws-sdk/client-dynamodb';
import { z } from 'zod';
import { PartitionMembershipRow, partitionMembershipKey } from './partition-membership-contract.ts';
export { PartitionMembershipRow, partitionMembershipKey } from './partition-membership-contract.ts';
import { PartitionRowSchema, partitionAccountKey, partitionGroupKey, type PartitionKey, type PartitionRow, type PartitionIOContext } from './partitioned-group-repository.ts';
import { ArchivedGroupRow } from './partition-archive.ts';
import { MigrationControlSchema, migrationIO, migrationCall, MigrationRunError } from './partition-migration-runner.ts';
import { PARTITION_MIGRATION_RESOURCES as resources } from './dynamo-partition-migration.ts';

// Inactive: version2 migration installation and verified service identity must precede runtime selection.
const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const integer = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const sha = z.string().regex(/^[a-f0-9]{40}$/).refine(value => !/^0+$/.test(value));
const hash = z.string().regex(/^[a-f0-9]{64}$/).refine(value => !/^0+$/.test(value));
type Header = Extract<PartitionRow, { kind: 'GROUP' }>;
type Account = Extract<PartitionRow, { kind: 'ACCOUNT' }>;
const groupRow = z.union([PartitionRowSchema, ArchivedGroupRow]);
const stringAttribute = z.strictObject({ S: z.string() });
const envelope = z.strictObject({ PK: stringAttribute, SK: stringAttribute,
  revision: z.strictObject({ N: z.string().regex(/^[1-9][0-9]*$/) }), payload: stringAttribute });
const keyEnvelope = z.strictObject({ PK: stringAttribute, SK: stringAttribute });
const cursorSchema = z.strictObject({ schemaVersion: z.literal(1), subject: id, sourceSha: sha, planHash: hash,
  accountRevision: integer, limit: z.number().int().min(1).max(20), afterGroup: id,
  issuedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), expiresAt: integer });
export class PartitionMembershipError extends Error {
  constructor(readonly code: 'MEMBERSHIP_INVALID' | 'MEMBERSHIP_DENIED' | 'MEMBERSHIP_STALE' | 'MEMBERSHIP_STORAGE_UNAVAILABLE'
    | 'MEMBERSHIP_TIMEOUT' | 'MEMBERSHIP_REQUEST_LIMIT', options?: ErrorOptions) {
    super(code, options); this.name = 'PartitionMembershipError';
  }
}
const fail = (code: PartitionMembershipError['code']): never => { throw new PartitionMembershipError(code); };
const attributes = (key: PartitionKey) => ({ PK: { S: key.PK }, SK: { S: key.SK } });
function decode<T extends { revision: number }>(raw: unknown, key: PartitionKey, schema: z.ZodType<T>, maximum = 352 * 1024): T {
  const parsed = envelope.safeParse(raw);
  if (!parsed.success || parsed.data.PK.S !== key.PK || parsed.data.SK.S !== key.SK || Buffer.byteLength(parsed.data.payload.S) > maximum) return fail('MEMBERSHIP_INVALID');
  let row: T;
  try { row = schema.parse(JSON.parse(parsed.data.payload.S)); } catch { return fail('MEMBERSHIP_INVALID'); }
  if (String(row.revision) !== parsed.data.revision.N || JSON.stringify(row) !== parsed.data.payload.S) return fail('MEMBERSHIP_INVALID');
  return row;
}
function header(raw: unknown): Header {
  const parsed = PartitionRowSchema.safeParse(raw);
  if (!parsed.success || parsed.data.kind !== 'GROUP') return fail('MEMBERSHIP_INVALID');
  const row = parsed.data;
  if (!Number.isSafeInteger(row.value.version) || !row.value.members.includes(row.value.organizer)
    || new Set(row.value.members).size !== row.value.members.length
    || new Set(row.value.draftIds).size !== row.value.draftIds.length
    || new Set(row.value.decisionIds).size !== row.value.decisionIds.length) return fail('MEMBERSHIP_INVALID');
  return row;
}
/** Pure initial index compiler. These rows MUST join source-bound migration or atomic header/account guards. */
export function partitionMembershipSeeds(raw: unknown) {
  const row = header(raw);
  return row.value.members.map(subject => ({ key: partitionMembershipKey(subject, row.value.id),
    row: PartitionMembershipRow.parse({ schemaVersion: 1, kind: 'MEMBERSHIP', revision: 1,
      value: { subject, groupId: row.value.id, active: true } }) }));
}

/** Discovery only: callers still hydrate/authorize each selected group through the scoped service/fence. */
export function createPartitionMembershipReader(config: { sourceSha: string; planHash: string; cursorKey: Buffer;
  verifiedTarget: { account: string; region: string }; now?: () => number; timeoutMs?: number; maxRequests?: number }) {
  if (!sha.safeParse(config.sourceSha).success || !hash.safeParse(config.planHash).success || !Buffer.isBuffer(config.cursorKey)
    || config.cursorKey.length !== 32 || !isDeepStrictEqual(config.verifiedTarget, { account: resources.account, region: resources.region })) return fail('MEMBERSHIP_INVALID');
  try { migrationIO(config); } catch { return fail('MEMBERSHIP_INVALID'); }
  const secret = Buffer.from(config.cursorKey); const sourceSha = config.sourceSha; const planHash = config.planHash;
  const clock = config.now ?? Date.now; const options = { ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
    ...(config.maxRequests === undefined ? {} : { maxRequests: config.maxRequests }) };
  const aad = Buffer.from(JSON.stringify({ account: resources.account, region: resources.region, table: resources.target, sourceSha, planHash }));
  const client = new DynamoDBClient({ region: resources.region, maxAttempts: 1, endpoint: 'https://dynamodb.us-east-1.amazonaws.com' });
  const controlKey = { PK: 'MIGRATION#CONTROL', SK: 'STATE' };
  function now() { const time = clock(); if (!Number.isSafeInteger(time) || time < 0 || time > Number.MAX_SAFE_INTEGER - 900_000) return fail('MEMBERSHIP_INVALID'); return time; }
  function seal(payload: z.infer<typeof cursorSchema>) {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', secret, iv); cipher.setAAD(aad);
    const bytes = Buffer.concat([cipher.update(JSON.stringify(cursorSchema.parse(payload))), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64url');
  }
  function open(token: string) {
    if (!/^[A-Za-z0-9_-]{40,1600}$/.test(token)) return fail('MEMBERSHIP_INVALID');
    const bytes = Buffer.from(token, 'base64url'); if (bytes.toString('base64url') !== token || bytes.length < 29) return fail('MEMBERSHIP_INVALID');
    try {
      const decipher = createDecipheriv('aes-256-gcm', secret, bytes.subarray(0, 12)); decipher.setAAD(aad); decipher.setAuthTag(bytes.subarray(12, 28));
      const plaintext = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
      const payload = cursorSchema.parse(JSON.parse(new globalThis.TextDecoder('utf8', { fatal: true }).decode(plaintext)));
      if (JSON.stringify(payload) !== plaintext.toString() || payload.sourceSha !== sourceSha || payload.planHash !== planHash
        || payload.expiresAt !== payload.issuedAt + 900_000 || payload.issuedAt > now() || payload.expiresAt <= now()) return fail('MEMBERSHIP_INVALID');
      return payload;
    } catch { return fail('MEMBERSHIP_INVALID'); }
  }
  async function call<T>(context: PartitionIOContext, work: () => Promise<T>): Promise<T> {
    try { return await migrationCall(context, work); }
    catch (error) {
      if (error instanceof PartitionMembershipError) throw error;
      if (error instanceof MigrationRunError) {
        if (error.cause instanceof PartitionMembershipError) throw error.cause;
        if (error.code === 'MIGRATION_TIMEOUT') return fail('MEMBERSHIP_TIMEOUT');
        if (error.code === 'MIGRATION_REQUEST_LIMIT') return fail('MEMBERSHIP_REQUEST_LIMIT');
      }
      throw new PartitionMembershipError('MEMBERSHIP_STORAGE_UNAVAILABLE', { cause: error });
    }
  }
  async function get<T extends { revision: number }>(key: PartitionKey, schema: z.ZodType<T>, context: PartitionIOContext): Promise<T | null> {
    const result = await call(context, () => client.send(new GetItemCommand({ TableName: resources.target,
      Key: attributes(key), ConsistentRead: true }), { abortSignal: context.signal }));
    return result.Item ? decode(result.Item, key, schema) : null;
  }
  async function account(subject: string, context: PartitionIOContext): Promise<Account> {
    const row = await get(partitionAccountKey(subject), PartitionRowSchema, context);
    if (row?.kind === 'ACCOUNT' && !Number.isSafeInteger(row.value.version)) return fail('MEMBERSHIP_INVALID');
    if (!row || row.kind !== 'ACCOUNT' || row.value.subject !== subject || row.value.status !== 'APPROVED') return fail('MEMBERSHIP_DENIED');
    return row;
  }
  async function control(context: PartitionIOContext) {
    const row = await get(controlKey, MigrationControlSchema, context);
    if (!row || !row.active || row.planHash !== planHash) return fail('MEMBERSHIP_DENIED'); return row;
  }
  async function groups(keys: PartitionKey[], context: PartitionIOContext) {
    if (!keys.length) return [];
    const output = new Map<string, z.infer<typeof groupRow>>(); let pending = keys;
    for (let attempt = 0; pending.length && attempt < 3; attempt++) {
      const result = await call(context, () => client.send(new BatchGetItemCommand({ RequestItems: {
        [resources.target]: { Keys: pending.map(attributes), ConsistentRead: true },
      } }), { abortSignal: context.signal }));
      const responseMap = z.record(z.string(), z.array(z.unknown()).max(20)).safeParse(result.Responses === undefined ? {} : result.Responses);
      const retryMap = z.record(z.string(), z.strictObject({ Keys: z.array(z.unknown()).max(20), ConsistentRead: z.literal(true).optional() }))
        .safeParse(result.UnprocessedKeys === undefined ? {} : result.UnprocessedKeys);
      if (!responseMap.success || !retryMap.success || Object.keys(responseMap.data).some(table => table !== resources.target)
        || Object.keys(retryMap.data).some(table => table !== resources.target)) return fail('MEMBERSHIP_INVALID');
      const wanted = new Set(pending.map(key => key.PK)); const returned = new Set<string>();
      function keyOf(raw: unknown) { const value = keyEnvelope.safeParse(raw); if (!value.success || value.data.SK.S !== 'STATE'
        || !wanted.has(value.data.PK.S)) return fail('MEMBERSHIP_INVALID'); return { PK: value.data.PK.S, SK: 'STATE' }; }
      for (const item of responseMap.data[resources.target] ?? []) {
        const wire = envelope.safeParse(item); if (!wire.success) return fail('MEMBERSHIP_INVALID');
        const key = keyOf({ PK: wire.data.PK, SK: wire.data.SK });
        if (returned.has(key.PK) || output.has(key.PK)) return fail('MEMBERSHIP_INVALID'); returned.add(key.PK);
        const row = decode(item, key, groupRow);
        if (row.kind === 'GROUP') { if (partitionGroupKey(header(row).value.id).PK !== key.PK) return fail('MEMBERSHIP_INVALID'); }
        else if (row.kind !== 'ARCHIVED_GROUP' || partitionGroupKey(row.groupId).PK !== key.PK) return fail('MEMBERSHIP_INVALID');
        output.set(key.PK, row);
      }
      const unprocessed = (retryMap.data[resources.target]?.Keys ?? []).map(keyOf);
      if (new Set(unprocessed.map(key => key.PK)).size !== unprocessed.length || unprocessed.some(key => returned.has(key.PK))) return fail('MEMBERSHIP_INVALID');
      pending = unprocessed;
    }
    if (pending.length) return fail('MEMBERSHIP_STORAGE_UNAVAILABLE');
    return keys.map(key => output.get(key.PK) ?? null);
  }
  return {
    async list(raw: { subject: string; limit?: number; cursor?: string }) {
      const parsed = z.strictObject({ subject: id, limit: z.number().int().min(1).max(20).default(10), cursor: z.string().optional() }).safeParse(raw);
      if (!parsed.success) return fail('MEMBERSHIP_INVALID');
      const { subject, limit, cursor } = parsed.data; const continuation = cursor === undefined ? null : open(cursor);
      if (continuation && (continuation.subject !== subject || continuation.limit !== limit)) return fail('MEMBERSHIP_INVALID');
      const context = migrationIO(options); const beforeControl = await control(context); const beforeAccount = await account(subject, context);
      if (continuation && continuation.accountRevision !== beforeAccount.revision) return fail('MEMBERSHIP_STALE');
      const pk = `MEMBER#${subject}`;
      const result = await call(context, () => client.send(new QueryCommand({ TableName: resources.target,
        KeyConditionExpression: '#pk=:pk AND begins_with(#sk,:prefix)', ExpressionAttributeNames: { '#pk': 'PK', '#sk': 'SK' },
        ExpressionAttributeValues: { ':pk': { S: pk }, ':prefix': { S: 'GROUP#' } }, ConsistentRead: true, ScanIndexForward: true, Limit: limit,
        ...(continuation ? { ExclusiveStartKey: attributes(partitionMembershipKey(subject, continuation.afterGroup)) } : {}),
      }), { abortSignal: context.signal }));
      const items = z.array(z.unknown()).max(limit).safeParse(result.Items === undefined ? [] : result.Items);
      if (!items.success) return fail('MEMBERSHIP_INVALID');
      const rows: PartitionMembershipRow[] = []; let previous = continuation ? `GROUP#${continuation.afterGroup}` : '';
      for (const item of items.data) {
        const wire = envelope.safeParse(item); if (!wire.success) return fail('MEMBERSHIP_INVALID');
        const key = keyEnvelope.safeParse({ PK: wire.data.PK, SK: wire.data.SK });
        if (!key.success || key.data.PK.S !== pk || !/^GROUP#[A-Za-z0-9_-]{1,80}$/.test(key.data.SK.S) || key.data.SK.S <= previous) return fail('MEMBERSHIP_INVALID');
        const row = decode(item, { PK: pk, SK: key.data.SK.S }, PartitionMembershipRow, 4096);
        if (!isDeepStrictEqual(partitionMembershipKey(row.value.subject, row.value.groupId), { PK: pk, SK: key.data.SK.S })) return fail('MEMBERSHIP_INVALID');
        previous = key.data.SK.S; rows.push(row);
      }
      let after: string | null = null;
      if (result.LastEvaluatedKey && Object.keys(result.LastEvaluatedKey).length) {
        const key = keyEnvelope.safeParse(result.LastEvaluatedKey);
        if (!key.success || !rows.length || key.data.PK.S !== pk || key.data.SK.S !== previous) return fail('MEMBERSHIP_INVALID');
        after = rows.at(-1)!.value.groupId;
      }
      const candidates = rows.filter(row => row.value.active); const keys = candidates.map(row => partitionGroupKey(row.value.groupId));
      const initial = await groups(keys, context); const current = await groups(keys, context);
      if (!isDeepStrictEqual(initial, current)) return fail('MEMBERSHIP_STALE');
      const latestAccount = await account(subject, context); const latestControl = await control(context);
      if (!isDeepStrictEqual(beforeAccount, latestAccount) || !isDeepStrictEqual(beforeControl, latestControl)) return fail('MEMBERSHIP_STALE');
      const summaries = current.flatMap(row => row?.kind === 'GROUP' && row.value.members.includes(subject) ? [{
        id: row.value.id, name: row.value.name, version: row.value.version, isOrganizer: row.value.organizer === subject,
      }] : []);
      const issuedAt = now();
      return { groups: summaries, cursor: after === null ? null : seal({ schemaVersion: 1, subject, sourceSha, planHash,
        accountRevision: latestAccount.revision, limit, afterGroup: after, issuedAt, expiresAt: issuedAt + 900_000 }) };
    },
  };
}
