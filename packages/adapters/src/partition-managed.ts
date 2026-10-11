import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { DynamoDBClient, TransactGetItemsCommand, TransactWriteItemsCommand,
  type TransactWriteItem } from '@aws-sdk/client-dynamodb';
import { KnownEnoughApplicationError, RepositoryCapacityError } from '@deal-table/application';
import { Groups } from '@deal-table/contracts';
import { loadPartitionMigration, type PartitionMigrationExpected } from './partition-migration.ts';
import { MigrationControlSchema, MigrationJournalSchema } from './partition-migration-runner.ts';
import { createDynamoPartitionTransport, partitionDynamoWrites, partitionIO, partitionCall,
  PartitionStorageError,
  type PartitionIOContext, type PartitionTransport } from './partitioned-group-repository.ts';
import { PARTITION_DECISION_TARGET, validatePartitionDecisionCommand, type PartitionDecisionTransport } from './partition-decision-repository.ts';
import { createPartitionMembershipReader } from './partition-membership.ts';
import type { PartitionGroupDiscovery } from './partition-group-session.ts';
import { createDynamoPartitionArchivePorts } from './dynamo-partition-archive.ts';
import { createDynamoPartitionLifecycle, type DynamoLifecycleOptions } from './dynamo-partition-lifecycle.ts';
import { archiveDynamoWrites, PartitionArchiveError, type ArchiveExpected, type ArchiveAuthority, type PartitionArchivePorts } from './partition-archive.ts';

/** Inactive server-only composition. Construction neither installs resources nor selects a runtime. */
export interface PartitionManagedOptions {
  manifestBytes: Buffer;
  expected: PartitionMigrationExpected;
  manifestVersion: string;
  verifiedTarget: { account: string; region: string };
  cursorKey: Buffer;
}
export interface PartitionManagedArchiveOptions {
  manifestBytes: Buffer; expected: ArchiveExpected; authority: ArchiveAuthority; recovery: PartitionArchivePorts['recovery'];
}
const sourceArn = 'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughGroupsStage';
const journalArn = 'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughOperationsJournal';
const sourceKey = { PK: 'NP#GROUPS', SK: 'STATE' };
const controlKey = { PK: 'MIGRATION#CONTROL', SK: 'STATE' };
const attribute = z.strictObject({ S: z.string() });
const numeric = z.strictObject({ N: z.string().regex(/^[1-9][0-9]*$/) });
const envelope = z.strictObject({ PK: attribute, SK: attribute, revision: numeric, payload: attribute });
const sourceEnvelope = envelope.omit({ revision: true }).extend({ version: numeric });
const version = z.string().min(1).max(1024).refine(value => value !== 'null'
  && [...value].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127));
const input = z.strictObject({ manifestBytes: z.instanceof(Buffer), expected: z.unknown(), manifestVersion: version,
  verifiedTarget: z.strictObject({ account: z.literal('092954139775'), region: z.literal('us-east-1') }),
  cursorKey: z.instanceof(Buffer).refine(value => value.length === 32) });
const attributes = (key: { PK: string; SK: string }) => ({ PK: { S: key.PK }, SK: { S: key.SK } });
const unavailable = (): never => { throw new KnownEnoughApplicationError('RETRYABLE_SERVER_ERROR'); };
const invalid = (): never => { throw new Error('PARTITION_MANAGED_INVALID'); };
function activationRejected(error: unknown, size: number) {
  if (!error || typeof error !== 'object') return false;
  const value = error as { name?: unknown; CancellationReasons?: unknown };
  if (value.name !== 'TransactionCanceledException' || !Array.isArray(value.CancellationReasons)
    || value.CancellationReasons.length !== size) return false;
  return value.CancellationReasons.every(reason => reason && typeof reason === 'object' && !Array.isArray(reason)
    && ['None', 'ConditionalCheckFailed', 'TransactionConflict'].includes(reason.Code))
    && value.CancellationReasons.slice(0, 3).some(reason => reason.Code === 'ConditionalCheckFailed');
}

export function createPartitionManagedDriver(options: PartitionManagedOptions): {
  groups: PartitionTransport; decisions: PartitionDecisionTransport; membershipDiscovery: PartitionGroupDiscovery;
  archivePorts: (options: PartitionManagedArchiveOptions) => PartitionArchivePorts;
  lifecycle: (options: Omit<DynamoLifecycleOptions, 'activation' | 'verifiedTarget'>) => ReturnType<typeof createDynamoPartitionLifecycle>;
  decisionArn: string; partitionArn: string;
  /** Classification only. Display JWT and fresh publication conditions still authorize every read. */
  legacyPublicDecision: (decisionId: string) => boolean;
} {
  const parsed = input.safeParse(options); if (!parsed.success) return invalid();
  const captured = parsed.data;
  let plan: ReturnType<typeof loadPartitionMigration>;
  let schemaVersion: unknown;
  try {
    const bytes = Buffer.from(captured.manifestBytes);
    plan = loadPartitionMigration(bytes, structuredClone(captured.expected) as PartitionMigrationExpected);
    schemaVersion = (JSON.parse(bytes.toString('utf8')) as { schemaVersion: unknown }).schemaVersion;
  }
  catch { return invalid(); }
  if (schemaVersion !== 2 || plan.sourceSnapshot.version > Number.MAX_SAFE_INTEGER - 2) return invalid();
  const sourceState = Groups.GroupState.parse(JSON.parse(plan.sourceSnapshot.payload.toString('utf8')));
  const migratedDecisionIds = new Set(sourceState.groups.flatMap(group => group.decisions.map(value => value.id)));
  const legacyPublicDecision = (decisionId: string) => /^[A-Za-z0-9_-]{1,80}$/.test(decisionId)
    && !migratedDecisionIds.has(decisionId) && !decisionId.startsWith('groupdecision-');
  const target = { ...PARTITION_DECISION_TARGET };
  const sourceHash = createHash('sha256').update(plan.sourceSnapshot.payload).digest('hex');
  const journalKey = { PK: `PARTITION#${plan.planHash}`, SK: 'JOURNAL' };
  const marker = { schemaVersion: 1, kind: 'PARTITION_MIGRATION', phase: 'ACTIVE', planHash: plan.planHash,
    manifestHash: plan.manifestHash, manifestVersion: captured.manifestVersion, sourceSha: plan.sourceSha,
    sourceRevision: plan.sourceSnapshot.version, sourceHash,
    account: '092954139775', region: 'us-east-1', table: 'KnownEnoughPartitions' };
  const markerBytes = JSON.stringify(marker);
  const client = new DynamoDBClient({ region: 'us-east-1', maxAttempts: 1, endpoint: 'https://dynamodb.us-east-1.amazonaws.com' });
  const base = createDynamoPartitionTransport('KnownEnoughPartitions', 'us-east-1');
  const discovery = createPartitionMembershipReader({ sourceSha: plan.sourceSha, planHash: plan.planHash,
    cursorKey: Buffer.from(captured.cursorKey), verifiedTarget: { ...captured.verifiedTarget } });
  // One atomic activation read per operation context, including parallel reads. It never replaces the commit conditions.
  const guards = new WeakMap<PartitionIOContext, Promise<TransactWriteItem[]>>();
  async function checkpoint(io: PartitionIOContext): Promise<TransactWriteItem[]> {
    let pending = guards.get(io);
    if (!pending) {
      pending = (async () => {
        const result = await partitionCall(io, () => client.send(new TransactGetItemsCommand({ TransactItems: [
          { Get: { TableName: sourceArn, Key: attributes(sourceKey) } },
          { Get: { TableName: target.partitionArn, Key: attributes(controlKey) } },
          { Get: { TableName: journalArn, Key: attributes(journalKey) } },
        ] }), { abortSignal: io.signal }));
        if (!Array.isArray(result.Responses) || result.Responses.length !== 3) return unavailable();
        const source = sourceEnvelope.safeParse(result.Responses[0]?.Item);
        if (!source.success || source.data.PK.S !== sourceKey.PK || source.data.SK.S !== sourceKey.SK
          || source.data.version.N !== String(plan.sourceSnapshot.version + 2) || source.data.payload.S !== markerBytes) return unavailable();
        function record<T extends { revision: number }>(raw: unknown, key: { PK: string; SK: string }, schema: z.ZodType<T>) {
          const wire = envelope.safeParse(raw);
          if (!wire.success || wire.data.PK.S !== key.PK || wire.data.SK.S !== key.SK || Buffer.byteLength(wire.data.payload.S) > 4096) return unavailable();
          let value: T;
          try { value = schema.parse(JSON.parse(wire.data.payload.S)); } catch { return unavailable(); }
          if (String(value.revision) !== wire.data.revision.N || JSON.stringify(value) !== wire.data.payload.S) return unavailable();
          return value;
        }
        const control = record(result.Responses[1]?.Item, controlKey, MigrationControlSchema);
        if (!control.active || control.revision < 3 || control.planHash !== plan.planHash) return unavailable();
        const journal = record(result.Responses[2]?.Item, journalKey, MigrationJournalSchema);
        if (journal.state !== 'COPIED' || journal.planHash !== plan.planHash || journal.manifestHash !== plan.manifestHash
          || journal.manifestVersion !== captured.manifestVersion || journal.sourceSha !== plan.sourceSha
          || journal.sourceRevision !== plan.sourceSnapshot.version || journal.sourceHash !== sourceHash
          || journal.rowCount !== plan.rowCount || journal.completedRows !== plan.rowCount
          || journal.nextBatch !== plan.batches.length || journal.revision !== plan.batches.length + 1) return unavailable();
        function condition(TableName: string, key: { PK: string; SK: string }, value: { revision: number }) {
          return { ConditionCheck: { TableName, Key: attributes(key), ConditionExpression: '#r = :r AND #p = :p',
            ExpressionAttributeNames: { '#r': 'revision', '#p': 'payload' },
            ExpressionAttributeValues: { ':r': { N: String(value.revision) }, ':p': { S: JSON.stringify(value) } } } };
        }
        return [{ ConditionCheck: { TableName: sourceArn, Key: attributes(sourceKey), ConditionExpression: '#v = :v AND #p = :p',
          ExpressionAttributeNames: { '#v': 'version', '#p': 'payload' },
          ExpressionAttributeValues: { ':v': { N: source.data.version.N }, ':p': { S: markerBytes } } } },
        condition(target.partitionArn, controlKey, control), condition(journalArn, journalKey, journal)];
      })();
      guards.set(io, pending);
    }
    const complete = await pending;
    return partitionCall(io, async () => structuredClone(complete), false);
  }
  async function joined(items: TransactWriteItem[], io: PartitionIOContext) {
    if (!items.length || items.length > 97) throw new RepositoryCapacityError();
    const result = [...await checkpoint(io), ...items];
    if (Buffer.byteLength(JSON.stringify(result)) > 3_500_000) throw new RepositoryCapacityError();
    return result;
  }
  const groups: PartitionTransport = {
    async read(key, supplied) {
      const capturedKey = structuredClone(key);
      partitionDynamoWrites('KnownEnoughPartitions', [{ key: capturedKey, expected: 0, next: null }]);
      const io = supplied ?? partitionIO(); await checkpoint(io); if (!supplied) io.request();
      return partitionCall(io, () => base.read(capturedKey, io), false);
    },
    async readMany(keys, supplied) {
      const capturedKeys = structuredClone(keys);
      if (capturedKeys.length > 145 || new Set(capturedKeys.map(key => `${key.PK}/${key.SK}`)).size !== capturedKeys.length) return invalid();
      capturedKeys.forEach(key => partitionDynamoWrites('KnownEnoughPartitions', [{ key, expected: 0, next: null }]));
      if (!capturedKeys.length) return [];
      const io = supplied ?? partitionIO(); await checkpoint(io); if (!supplied) io.request();
      return partitionCall(io, () => base.readMany!(capturedKeys, io), false);
    },
    async commit(mutations, supplied) {
      const items = partitionDynamoWrites('KnownEnoughPartitions', structuredClone(mutations));
      for (const item of items) (item.ConditionCheck ?? item.Put)!.TableName = target.partitionArn;
      const io = supplied ?? partitionIO(); const TransactItems = await joined(items, io); if (!supplied) io.request();
      try { await partitionCall(io, () => client.send(new TransactWriteItemsCommand({ TransactItems }), { abortSignal: io.signal }), false); return true; }
      catch (error) {
        if (error instanceof PartitionStorageError) throw error;
        if (activationRejected(error, TransactItems.length)) return unavailable();
        if (error instanceof Error && error.name === 'TransactionConflictException') return false;
        if (error instanceof Error && error.name === 'TransactionCanceledException' && 'CancellationReasons' in error
          && Array.isArray(error.CancellationReasons) && error.CancellationReasons.length === TransactItems.length
          && error.CancellationReasons.some(reason => ['ConditionalCheckFailed', 'TransactionConflict'].includes(reason?.Code))
          && error.CancellationReasons.every(reason => ['None', 'ConditionalCheckFailed', 'TransactionConflict'].includes(reason?.Code))) return false;
        throw new Error('PARTITION_STORAGE_UNAVAILABLE', { cause: error });
      }
    },
  };
  const decisions: PartitionDecisionTransport = { async send(command, io) {
    // Capture and validate BEFORE awaiting activation, so caller mutation cannot change the approved native request.
    const copy = command instanceof TransactGetItemsCommand ? new TransactGetItemsCommand(structuredClone(command.input))
      : command instanceof TransactWriteItemsCommand ? new TransactWriteItemsCommand(structuredClone(command.input)) : invalid();
    validatePartitionDecisionCommand(copy);
    if (copy instanceof TransactWriteItemsCommand) {
      copy.input.TransactItems = await joined(copy.input.TransactItems!, io);
      try { return await partitionCall(io, () => client.send(copy, { abortSignal: io.signal }), false); }
      catch (error) {
        // A changed activation tuple needs a fresh request/config check, not six retries against a cached tuple.
        if (activationRejected(error, copy.input.TransactItems.length)) return unavailable();
        throw error;
      }
    }
    await checkpoint(io); return partitionCall(io, () => client.send(copy, { abortSignal: io.signal }), false);
  } };
  const membershipDiscovery: PartitionGroupDiscovery = async (request, io) => {
    const copy = structuredClone(request); await checkpoint(io); return discovery.list(copy, io);
  };
  function archivePorts(options: PartitionManagedArchiveOptions): PartitionArchivePorts {
    const bytes = Buffer.from(options.manifestBytes); const expected = structuredClone(options.expected);
    const authority = structuredClone(options.authority);
    if (typeof options.recovery?.read !== 'function' || typeof options.recovery?.preserve !== 'function') return invalid();
    const recovery = { read: options.recovery.read.bind(options.recovery), preserve: options.recovery.preserve.bind(options.recovery) };
    const base = createDynamoPartitionArchivePorts(bytes, expected, authority, { ...captured.verifiedTarget }, recovery);
    async function active(io: PartitionIOContext) {
      try { return await checkpoint(io); }
      catch (error) {
        if (error instanceof KnownEnoughApplicationError) throw new PartitionArchiveError('ARCHIVE_TARGET_INACTIVE');
        throw error;
      }
    }
    return { recovery,
      group: async (groupId, io) => { await active(io); return base.group(groupId, io); },
      authority: async (who, io) => { await active(io); return base.authority(who, io); },
      journal: async (key, io) => { await active(io); return base.journal(key, io); },
      control: async io => {
        const checked = await active(io); const current = await base.control(io);
        if (!isDeepStrictEqual(current, JSON.parse(checked[1]!.ConditionCheck!.ExpressionAttributeValues![':p']!.S!))) {
          throw new PartitionArchiveError('ARCHIVE_TARGET_INACTIVE');
        }
        return current;
      },
      commit: async (request, io) => {
        // The archive compiler supplies its own exact control guard; never check the same item twice.
        const items = archiveDynamoWrites(structuredClone(request), bytes, expected, authority);
        const checked = await active(io);
        if (!isDeepStrictEqual(items[0], checked[1])) throw new PartitionArchiveError('ARCHIVE_TARGET_INACTIVE');
        const TransactItems = [checked[0]!, checked[2]!, ...items];
        if (TransactItems.length > 100 || Buffer.byteLength(JSON.stringify(TransactItems)) > 3_500_000) throw new PartitionArchiveError('ARCHIVE_CAPACITY');
        const ClientRequestToken = createHash('sha256').update(JSON.stringify(TransactItems)).digest('hex').slice(0, 32);
        try { await partitionCall(io, () => client.send(new TransactWriteItemsCommand({ TransactItems, ClientRequestToken }), { abortSignal: io.signal }), false); return true; }
        catch (error) {
          if (activationRejected(error, TransactItems.length)) { guards.delete(io); return false; }
          if (error instanceof Error && error.name === 'TransactionConflictException') return false;
          if (error instanceof Error && error.name === 'TransactionCanceledException' && 'CancellationReasons' in error
            && Array.isArray(error.CancellationReasons) && error.CancellationReasons.length === TransactItems.length
            && error.CancellationReasons.some(reason => ['ConditionalCheckFailed', 'TransactionConflict'].includes(reason?.Code))
            && error.CancellationReasons.every(reason => ['None', 'ConditionalCheckFailed', 'TransactionConflict'].includes(reason?.Code))) return false;
          throw new PartitionArchiveError('ARCHIVE_STORAGE_UNAVAILABLE', { cause: error });
        }
      },
    };
  }
  // Manifest/source bytes, recovery IDs and cursor secrets never leave the captured server closure.
  function lifecycle(options: Omit<DynamoLifecycleOptions, 'activation' | 'verifiedTarget'>) {
    return createDynamoPartitionLifecycle({ ...options, verifiedTarget: { ...captured.verifiedTarget }, activation: {
      read: async io => { await checkpoint(io); },
      write: async (items, io) => {
        const copy = structuredClone(items);
        const TransactItems = await joined(copy, io);
        await partitionCall(io, () => client.send(new TransactWriteItemsCommand({ TransactItems }), { abortSignal: io.signal }), false);
      },
    } });
  }
  return { groups, decisions, membershipDiscovery, archivePorts, lifecycle, legacyPublicDecision, ...target };
}
