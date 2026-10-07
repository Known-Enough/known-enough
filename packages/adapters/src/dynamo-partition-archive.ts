import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { DynamoDBClient, GetItemCommand, BatchGetItemCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { PartitionRowSchema, partitionAccountKey, partitionGroupKey, type PartitionKey, type PartitionIOContext } from './partitioned-group-repository.ts';
import { MigrationControlSchema } from './partition-migration-runner.ts';
import { PARTITION_MIGRATION_RESOURCES as resources } from './dynamo-partition-migration.ts';
import { loadPartitionArchive, archiveDynamoWrites, ArchivedGroupRow, ArchiveJournal, ArchiveOperatorPolicy,
  PartitionArchiveError, type ArchiveAuthority, type ArchiveExpected, type PartitionArchivePorts } from './partition-archive.ts';

// Inactive operations port. Verified service/workflow identity and installed isolation precede construction.
const attribute = z.strictObject({ S: z.string() });
const envelope = z.strictObject({ PK: attribute, SK: attribute,
  revision: z.strictObject({ N: z.string().regex(/^[1-9][0-9]*$/) }), payload: attribute });
const keySchema = z.strictObject({ PK: attribute, SK: attribute });
const rowSchema = z.union([PartitionRowSchema, ArchivedGroupRow]);
const keyCode = (key: PartitionKey) => `${key.PK}/${key.SK}`;
const attributes = (key: PartitionKey) => ({ PK: { S: key.PK }, SK: { S: key.SK } });
function invalid(): never { throw new PartitionArchiveError('ARCHIVE_INVALID'); }
function decode<T extends { revision: number }>(raw: unknown, key: PartitionKey, schema: z.ZodType<T>, maximum: number): T {
  const item = envelope.safeParse(raw);
  if (!item.success || item.data.PK.S !== key.PK || item.data.SK.S !== key.SK
    || Buffer.byteLength(item.data.payload.S) > maximum) return invalid();
  let value: T;
  try { value = schema.parse(JSON.parse(item.data.payload.S)); } catch { return invalid(); }
  if (String(value.revision) !== item.data.revision.N || JSON.stringify(value) !== item.data.payload.S) return invalid();
  return value;
}
const organizer = z.strictObject({ kind: z.literal('ORGANIZER'), subject: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/) });
const operator = z.strictObject({ kind: z.literal('OPERATOR'), actorId: z.union([z.literal(143764700), z.literal(44531296)]) });
const authoritySchema = z.discriminatedUnion('kind', [organizer, operator]);

export function createDynamoPartitionArchivePorts(manifestBytes: Buffer, rawExpected: ArchiveExpected,
  rawAuthority: ArchiveAuthority, verifiedTarget: { account: string; region: string },
  recovery: PartitionArchivePorts['recovery']): PartitionArchivePorts {
  if (!isDeepStrictEqual(verifiedTarget, { account: resources.account, region: resources.region })
    || typeof recovery?.read !== 'function' || typeof recovery?.preserve !== 'function') return invalid();
  const trusted = authoritySchema.safeParse(rawAuthority);
  if (!trusted.success) throw new PartitionArchiveError('ARCHIVE_AUTHORITY_DENIED');
  const bytes = Buffer.from(manifestBytes); const expected = structuredClone(rawExpected); const authority = trusted.data;
  const plan = loadPartitionArchive(bytes, expected);
  const headerKey = partitionGroupKey(expected.groupId);
  const journalKey = { PK: `ARCHIVE#${expected.groupId}`, SK: `OP#${expected.manifestHash}` };
  const controlKey = { PK: 'MIGRATION#CONTROL', SK: 'STATE' };
  const authorityKey = authority.kind === 'ORGANIZER' ? partitionAccountKey(authority.subject)
    : { PK: 'OPERATIONS#ARCHIVE', SK: 'STATE' };
  const children = plan.entries.filter(entry => keyCode(entry.key) !== keyCode(headerKey));
  const client = new DynamoDBClient({ region: resources.region, maxAttempts: 1,
    endpoint: 'https://dynamodb.us-east-1.amazonaws.com' });
  function active(context: PartitionIOContext) {
    if (context.signal.aborted) throw new PartitionArchiveError('ARCHIVE_TIMEOUT');
  }
  async function send<T>(work: () => Promise<T>, context: PartitionIOContext): Promise<T> {
    active(context);
    try { return await work(); }
    catch (error) { throw new PartitionArchiveError('ARCHIVE_STORAGE_UNAVAILABLE', { cause: error }); }
  }
  async function get(table: string, key: PartitionKey, context: PartitionIOContext) {
    const response = await send(() => client.send(new GetItemCommand({ TableName: table, Key: attributes(key), ConsistentRead: true }),
      { abortSignal: context.signal }), context);
    return response.Item;
  }
  async function batch(keys: PartitionKey[], context: PartitionIOContext) {
    const values = new Map<string, z.infer<typeof PartitionRowSchema>>(); let pending = keys;
    // Coordinator charges the initial header read. Every batch/retry/header recheck charges separately.
    for (let attempt = 0; pending.length && attempt < 3; attempt++) {
      context.request();
      const response = await send(() => client.send(new BatchGetItemCommand({ RequestItems: {
        [resources.target]: { Keys: pending.map(attributes), ConsistentRead: true },
      } }), { abortSignal: context.signal }), context);
      const responses = response.Responses; const unprocessed = response.UnprocessedKeys;
      if ([...Object.keys(responses ?? {}), ...Object.keys(unprocessed ?? {})].some(table => table !== resources.target)) return invalid();
      const requested = new Set(pending.map(keyCode)); const returned = new Set<string>();
      function keyOf(raw: unknown, full = false) {
        const parsed = (full ? keySchema.loose() : keySchema).safeParse(raw);
        if (!parsed.success) return invalid();
        const key = { PK: parsed.data.PK.S, SK: parsed.data.SK.S };
        if (!requested.has(keyCode(key))) return invalid();
        return key;
      }
      for (const item of responses?.[resources.target] ?? []) {
        const key = keyOf(item, true); const code = keyCode(key);
        if (returned.has(code) || values.has(code)) return invalid();
        const value = decode(item, key, PartitionRowSchema, 352 * 1024);
        // Validate semantic key by comparing to the independently compiled manifest entry in the runner.
        returned.add(code); values.set(code, value);
      }
      const outstanding = (unprocessed?.[resources.target]?.Keys ?? []).map(key => keyOf(key));
      const remaining = new Set(outstanding.map(keyCode));
      if (remaining.size !== outstanding.length || [...remaining].some(code => returned.has(code) || values.has(code))) return invalid();
      if (pending.some(key => !returned.has(keyCode(key)) && !remaining.has(keyCode(key)))) {
        throw new PartitionArchiveError('ARCHIVE_SOURCE_CHANGED');
      }
      pending = outstanding;
    }
    if (pending.length) throw new PartitionArchiveError('ARCHIVE_STORAGE_UNAVAILABLE');
    return keys.map(key => ({ key, row: values.get(keyCode(key))! }));
  }
  return {
    recovery,
    group: async (groupId, context) => {
      if (groupId !== expected.groupId) return invalid();
      const header = decode(await get(resources.target, headerKey, context), headerKey, rowSchema, 352 * 1024);
      if (header.kind !== 'GROUP' && header.kind !== 'ARCHIVED_GROUP') return invalid();
      const entries: { key: PartitionKey; row: z.infer<typeof rowSchema> }[] = [{ key: headerKey, row: header }];
      for (let start = 0; start < children.length; start += 100) {
        entries.push(...await batch(children.slice(start, start + 100).map(entry => entry.key), context));
      }
      context.request();
      const after = decode(await get(resources.target, headerKey, context), headerKey, rowSchema, 352 * 1024);
      if (!isDeepStrictEqual(header, after)) throw new PartitionArchiveError('ARCHIVE_SOURCE_CHANGED');
      return entries;
    },
    control: async context => decode(await get(resources.target, controlKey, context), controlKey, MigrationControlSchema, 4096),
    authority: async (input, context) => {
      if (!isDeepStrictEqual(input, authority)) throw new PartitionArchiveError('ARCHIVE_AUTHORITY_DENIED');
      const raw = await get(resources.target, authorityKey, context);
      if (authority.kind === 'OPERATOR') return decode(raw, authorityKey, ArchiveOperatorPolicy, 4096);
      return decode(raw, authorityKey, PartitionRowSchema, 352 * 1024);
    },
    journal: async (key, context) => {
      if (!isDeepStrictEqual(key, journalKey)) return invalid();
      const raw = await get(resources.journal, journalKey, context);
      return raw === undefined ? null : decode(raw, journalKey, ArchiveJournal, 8192);
    },
    commit: async (request, context) => {
      const TransactItems = archiveDynamoWrites(request, bytes, expected, authority); active(context);
      const ClientRequestToken = createHash('sha256').update(JSON.stringify(TransactItems)).digest('hex').slice(0, 32);
      try {
        await client.send(new TransactWriteItemsCommand({ TransactItems, ClientRequestToken }), { abortSignal: context.signal });
        return true;
      } catch (error) {
        if (error instanceof Error && error.name === 'TransactionConflictException') return false;
        if (error instanceof Error && error.name === 'TransactionCanceledException' && 'CancellationReasons' in error
          && Array.isArray(error.CancellationReasons) && error.CancellationReasons.length === TransactItems.length
          && error.CancellationReasons.some(reason => ['ConditionalCheckFailed', 'TransactionConflict'].includes(reason?.Code))
          && error.CancellationReasons.every(reason => ['None', 'ConditionalCheckFailed', 'TransactionConflict'].includes(reason?.Code))) return false;
        // Submitted transport errors are ambiguous: the coordinator maps them to COMMIT_UNKNOWN.
        throw new PartitionArchiveError('ARCHIVE_STORAGE_UNAVAILABLE', { cause: error });
      }
    },
  };
}
