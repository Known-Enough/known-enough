import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { DynamoDBClient, GetItemCommand, BatchGetItemCommand, TransactWriteItemsCommand,
  type TransactWriteItem } from '@aws-sdk/client-dynamodb';
import { loadPartitionMigration, type PartitionMigrationExpected } from './partition-migration.ts';
import { MigrationControlSchema, MigrationJournalSchema, MigrationRunError, migrationIO, migrationCall,
  type MigrationAtomicCommit, type MigrationControl, type MigrationJournal, type MigrationRunnerPorts } from './partition-migration-runner.ts';
import { partitionDynamoWrites, type PartitionKey, type PartitionRow } from './partitioned-group-repository.ts';

// Inactive concrete port; verified workflow identity and installed resource checks precede construction.
export const PARTITION_MIGRATION_RESOURCES = {
  account: '092954139775', region: 'us-east-1',
  source: 'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughGroupsStage',
  target: 'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughPartitions',
  journal: 'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughOperationsJournal',
} as const;
const controlKey = { PK: 'MIGRATION#CONTROL', SK: 'STATE' };
const sourceKey = { PK: 'NP#GROUPS', SK: 'STATE' } as const;
const attribute = z.strictObject({ S: z.string() });
const numeric = z.strictObject({ N: z.string().regex(/^[1-9][0-9]*$/) });
const envelope = z.strictObject({ PK: attribute, SK: attribute, revision: numeric, payload: attribute });
const legacyEnvelope = envelope.omit({ revision: true }).extend({ version: numeric });
const code = (key: PartitionKey) => `${key.PK}/${key.SK}`;
const attributes = (key: PartitionKey) => ({ PK: { S: key.PK }, SK: { S: key.SK } });
function invalid(): never { throw new MigrationRunError('MIGRATION_RUN_INVALID'); }
function parsedPayload(raw: unknown, key: PartitionKey, maximum: number) {
  const item = envelope.safeParse(raw);
  if (!item.success || item.data.PK.S !== key.PK || item.data.SK.S !== key.SK
    || Buffer.byteLength(item.data.payload.S) > maximum) return invalid();
  try { return { revision: item.data.revision.N, value: JSON.parse(item.data.payload.S) as unknown }; }
  catch { return invalid(); }
}
function encoded(key: PartitionKey, value: { revision: number }) {
  return { ...attributes(key), revision: { N: String(value.revision) }, payload: { S: JSON.stringify(value) } };
}
const expectedRecord = (value: { revision: number }) => ({
  ConditionExpression: '#r = :r AND #p = :p', ExpressionAttributeNames: { '#r': 'revision', '#p': 'payload' },
  ExpressionAttributeValues: { ':r': { N: String(value.revision) }, ':p': { S: JSON.stringify(value) } },
});
const absent = { ConditionExpression: 'attribute_not_exists(PK)' };

export interface DynamoPartitionMigrationPorts extends MigrationRunnerPorts {
  /** Operations only, after a compatible service is installed. Never a public HTTP authority. */
  freeze(options?: { timeoutMs?: number; maxRequests?: number }): Promise<MigrationControl>;
  activate(options?: { timeoutMs?: number; maxRequests?: number }): Promise<MigrationControl>;
}
export function createDynamoPartitionMigrationPorts(manifestBytes: Buffer, expected: PartitionMigrationExpected,
  verifiedTarget: { account: string; region: string }, manifests: MigrationRunnerPorts['manifests']): DynamoPartitionMigrationPorts {
  if (!isDeepStrictEqual(verifiedTarget, { account: PARTITION_MIGRATION_RESOURCES.account,
    region: PARTITION_MIGRATION_RESOURCES.region }) || typeof manifests?.read !== 'function'
    || typeof manifests?.preserve !== 'function') invalid();
  const binding = structuredClone(expected);
  const plan = loadPartitionMigration(Buffer.from(manifestBytes), binding);
  if (binding.sourceRevision > Number.MAX_SAFE_INTEGER - 2) invalid();
  const rows = new Map(plan.batches.flat().map(row => [code(row.key), row]));
  const journalKey = { PK: `PARTITION#${plan.planHash}`, SK: 'JOURNAL' };
  const emptyControl: MigrationControl = { schemaVersion: 1, account: PARTITION_MIGRATION_RESOURCES.account,
    region: PARTITION_MIGRATION_RESOURCES.region, table: 'KnownEnoughPartitions', revision: 0, active: false, planHash: null };
  const client = new DynamoDBClient({ region: PARTITION_MIGRATION_RESOURCES.region, maxAttempts: 1,
    endpoint: 'https://dynamodb.us-east-1.amazonaws.com' });
  const markerSchema = z.strictObject({ schemaVersion: z.literal(1), kind: z.literal('PARTITION_MIGRATION'),
    phase: z.enum(['FROZEN', 'ACTIVE']), planHash: z.string(), manifestHash: z.string(), manifestVersion: z.string(),
    sourceSha: z.string(), sourceRevision: z.number(), sourceHash: z.string(),
    account: z.literal('092954139775'), region: z.literal('us-east-1'), table: z.literal('KnownEnoughPartitions') });
  function marker(journal: MigrationJournal, phase: 'FROZEN' | 'ACTIVE') {
    return { schemaVersion: 1 as const, kind: 'PARTITION_MIGRATION' as const, phase, planHash: plan.planHash,
      manifestHash: binding.manifestHash, manifestVersion: journal.manifestVersion, sourceSha: binding.sourceSha,
      sourceRevision: binding.sourceRevision, sourceHash: binding.sourceHash,
      account: PARTITION_MIGRATION_RESOURCES.account, region: PARTITION_MIGRATION_RESOURCES.region,
      table: 'KnownEnoughPartitions' as const };
  }
  function sourceGuard(version: number, payload: string) {
    return { ConditionExpression: '#v = :v AND #p = :p', ExpressionAttributeNames: { '#v': 'version', '#p': 'payload' },
      ExpressionAttributeValues: { ':v': { N: String(version) }, ':p': { S: payload } } };
  }
  function legacy(raw: unknown) {
    const item = legacyEnvelope.safeParse(raw);
    if (!item.success || item.data.PK.S !== sourceKey.PK || item.data.SK.S !== sourceKey.SK
      || Buffer.byteLength(item.data.payload.S) > 300_000 || !Number.isSafeInteger(Number(item.data.version.N))) return invalid();
    return { version: Number(item.data.version.N), payload: Buffer.from(item.data.payload.S, 'utf8') };
  }
  function checkedJournal(raw: unknown) {
    const parsed = MigrationJournalSchema.safeParse(raw); if (!parsed.success) return invalid();
    const journal = parsed.data; const index = journal.nextBatch;
    if (journal.planHash !== plan.planHash || journal.manifestHash !== binding.manifestHash
      || journal.sourceSha !== binding.sourceSha || journal.sourceRevision !== binding.sourceRevision
      || journal.sourceHash !== binding.sourceHash || journal.rowCount !== plan.rowCount
      || index > plan.batches.length || journal.revision !== index + 1
      || journal.completedRows !== plan.batches.slice(0, index).flat().length
      || journal.state !== (index === plan.batches.length ? 'COPIED' : index === 0 ? 'PREPARED' : 'APPLYING')) return invalid();
    return journal;
  }
  function checkedControl(raw: unknown) {
    const value = MigrationControlSchema.safeParse(raw);
    if (!value.success || value.data.revision === Number.MAX_SAFE_INTEGER || value.data.active
      || (value.data.planHash !== null && value.data.planHash !== plan.planHash)) return invalid();
    return value.data;
  }
  function transaction(request: MigrationAtomicCommit): TransactWriteItem[] {
    const current = checkedControl(request.control.expected);
    const parsed = MigrationJournalSchema.safeParse(request.journal.next);
    if (!parsed.success) return invalid();
    const next = parsed.data;
    const prepare = next.nextBatch === 0;
    const completed = plan.batches.slice(0, next.nextBatch).flat().length;
    const state = next.nextBatch === plan.batches.length ? 'COPIED' : prepare ? 'PREPARED' : 'APPLYING';
    if (!isDeepStrictEqual(request.source.key, sourceKey) || request.source.table !== 'KnownEnoughGroupsStage'
      || request.source.revision !== binding.sourceRevision || !Buffer.isBuffer(request.source.payload)
      || !request.source.payload.equals(plan.sourceSnapshot.payload) || next.planHash !== plan.planHash
      || next.manifestHash !== binding.manifestHash || next.sourceHash !== binding.sourceHash
      || next.sourceSha !== binding.sourceSha || next.sourceRevision !== binding.sourceRevision
      || next.rowCount !== plan.rowCount || next.nextBatch > plan.batches.length || next.completedRows !== completed
      || next.state !== state || next.revision !== next.nextBatch + 1
      || request.journal.expectedRevision !== next.revision - 1
      || !isDeepStrictEqual(request.rows, prepare ? [] : plan.batches[next.nextBatch - 1])) return invalid();
    let control: TransactWriteItem;
    if (prepare) {
      const claimed = checkedControl(request.control.next);
      if (current.planHash !== null || current.revision > Number.MAX_SAFE_INTEGER - 3 || !isDeepStrictEqual(claimed,
        { ...current, revision: current.revision + 1, planHash: plan.planHash })) return invalid();
      control = { Put: { TableName: PARTITION_MIGRATION_RESOURCES.target, Item: encoded(controlKey, claimed),
        ...(current.revision === 0 ? absent : expectedRecord(current)) } };
    } else {
      if (current.revision < 1 || current.planHash !== plan.planHash || request.control.next !== null) return invalid();
      control = { ConditionCheck: { TableName: PARTITION_MIGRATION_RESOURCES.target, Key: attributes(controlKey),
        ...expectedRecord(current) } };
    }
    const priorBatch = next.nextBatch - 1;
    const prior = prepare ? null : MigrationJournalSchema.parse({ ...next, revision: next.revision - 1,
      nextBatch: priorBatch, completedRows: plan.batches.slice(0, priorBatch).flat().length,
      state: priorBatch === 0 ? 'PREPARED' : 'APPLYING' });
    const writes: TransactWriteItem[] = [
      { ConditionCheck: { TableName: PARTITION_MIGRATION_RESOURCES.source, Key: attributes(sourceKey),
        ...sourceGuard(binding.sourceRevision + (prepare ? 0 : 1),
          prepare ? plan.sourceSnapshot.payload.toString('utf8') : JSON.stringify(marker(next, 'FROZEN'))) } },
      control,
      { Put: { TableName: PARTITION_MIGRATION_RESOURCES.journal, Item: encoded(journalKey, next),
        ...(prepare ? absent : expectedRecord(prior!)) } },
      ...(request.rows.length ? partitionDynamoWrites('KnownEnoughPartitions', request.rows).map(write => {
        if (!write.Put) return invalid();
        return { Put: { ...write.Put, TableName: PARTITION_MIGRATION_RESOURCES.target } };
      }) : []),
    ];
    if (writes.length > 99 || Buffer.byteLength(JSON.stringify(writes)) > 4_000_000) invalid();
    return writes;
  }
  // Validate every batch's full wire envelope before recovery storage or Dynamo writes are reachable.
  function preflight() {
    const journal = { schemaVersion: 1 as const, actorId: 143764700 as const, planHash: plan.planHash,
      manifestHash: binding.manifestHash, manifestVersion: 'v'.repeat(1024), sourceSha: binding.sourceSha,
      sourceRevision: binding.sourceRevision, sourceHash: binding.sourceHash, rowCount: plan.rowCount };
    const claimed = { ...emptyControl, revision: 1, planHash: plan.planHash };
    for (let index = 0; index <= plan.batches.length; index++) {
      const next = { ...journal, revision: index + 1, nextBatch: index,
        completedRows: plan.batches.slice(0, index).flat().length,
        state: index === plan.batches.length ? 'COPIED' as const : index === 0 ? 'PREPARED' as const : 'APPLYING' as const };
      transaction({ source: { table: 'KnownEnoughGroupsStage', key: sourceKey,
        revision: binding.sourceRevision, payload: plan.sourceSnapshot.payload },
      control: { expected: index === 0 ? emptyControl : claimed, next: index === 0 ? claimed : null },
      journal: { expectedRevision: index, next }, rows: index === 0 ? [] : plan.batches[index - 1]! });
    }
  }
  preflight();
  async function get(table: string, key: PartitionKey, context: Parameters<MigrationRunnerPorts['source']>[0]) {
    if (context.signal.aborted) throw new MigrationRunError('MIGRATION_TIMEOUT');
    try { return (await client.send(new GetItemCommand({ TableName: table, Key: attributes(key), ConsistentRead: true }),
      { abortSignal: context.signal })).Item; }
    catch (error) { throw new MigrationRunError('MIGRATION_STORAGE_UNAVAILABLE', { cause: error }); }
  }
  const ports: DynamoPartitionMigrationPorts = {
    manifests,
    source: async context => {
      const stored = legacy(await get(PARTITION_MIGRATION_RESOURCES.source, sourceKey, context));
      if (stored.version === binding.sourceRevision && stored.payload.equals(plan.sourceSnapshot.payload)) return stored;
      let value: z.infer<typeof markerSchema>;
      try { value = markerSchema.parse(JSON.parse(stored.payload.toString('utf8'))); }
      catch { return invalid(); }
      context.request();
      const journal = checkedJournal(await ports.journal(plan.planHash, context));
      if (stored.version !== binding.sourceRevision + 1 || !isDeepStrictEqual(value, marker(journal, 'FROZEN'))
        || stored.payload.toString('utf8') !== JSON.stringify(value)) return invalid();
      return { version: binding.sourceRevision, payload: Buffer.from(plan.sourceSnapshot.payload) };
    },
    control: async context => {
      const item = await get(PARTITION_MIGRATION_RESOURCES.target, controlKey, context);
      if (item === undefined) return structuredClone(emptyControl);
      const stored = parsedPayload(item, controlKey, 4096); const value = MigrationControlSchema.safeParse(stored.value);
      if (!value.success || value.data.revision < 1 || String(value.data.revision) !== stored.revision) return invalid();
      return value.data;
    },
    journal: async (hash, context) => {
      if (hash !== plan.planHash) return invalid();
      const item = await get(PARTITION_MIGRATION_RESOURCES.journal, journalKey, context);
      if (item === undefined) return null;
      const stored = parsedPayload(item, journalKey, 4096); const value = MigrationJournalSchema.safeParse(stored.value);
      if (!value.success || value.data.planHash !== hash || String(value.data.revision) !== stored.revision) return invalid();
      return value.data;
    },
    targets: async (keys, context) => {
      if (keys.length > 100 || new Set(keys.map(code)).size !== keys.length || keys.some(key => !rows.has(code(key)))) return invalid();
      const result = new Map<string, PartitionRow | null>(); let pending = keys; let first = true;
      while (pending.length) {
        if (!first) context.request(); first = false;
        if (context.signal.aborted) throw new MigrationRunError('MIGRATION_TIMEOUT');
        const response = await client.send(new BatchGetItemCommand({ RequestItems: {
          [PARTITION_MIGRATION_RESOURCES.target]: { Keys: pending.map(attributes), ConsistentRead: true },
        } }), { abortSignal: context.signal });
        if ([...Object.keys(response.Responses ?? {}), ...Object.keys(response.UnprocessedKeys ?? {})]
          .some(table => table !== PARTITION_MIGRATION_RESOURCES.target)) return invalid();
        const requested = new Set(pending.map(code)); const returned = new Set<string>();
        function keyOf(raw: unknown) {
          const parsed = z.object({ PK: attribute, SK: attribute }).safeParse(raw);
          if (!parsed.success) return invalid();
          const key = { PK: parsed.data.PK.S, SK: parsed.data.SK.S };
          if (!requested.has(code(key))) return invalid();
          return key;
        }
        for (const item of response.Responses?.[PARTITION_MIGRATION_RESOURCES.target] ?? []) {
          const key = keyOf(item); const id = code(key);
          if (returned.has(id) || result.has(id)) return invalid();
          const stored = parsedPayload(item, key, 352 * 1024); const row = stored.value as PartitionRow;
          if (String(row?.revision) !== stored.revision) return invalid();
          partitionDynamoWrites('KnownEnoughPartitions', [{ key, expected: row.revision - 1, next: row }]);
          returned.add(id); result.set(id, row);
        }
        const outstanding = (response.UnprocessedKeys?.[PARTITION_MIGRATION_RESOURCES.target]?.Keys ?? []).map(keyOf);
        const unique = new Set(outstanding.map(code));
        if (unique.size !== outstanding.length || [...unique].some(key => returned.has(key) || result.has(key))) return invalid();
        pending.forEach(key => { if (!returned.has(code(key)) && !unique.has(code(key))) result.set(code(key), null); });
        pending = outstanding;
      }
      return keys.map(key => result.get(code(key)) ?? null);
    },
    freeze: options => transition('FROZEN', options),
    activate: options => transition('ACTIVE', options),
    commit: async (request, context) => {
      const TransactItems = transaction(request);
      return submit(TransactItems, context);
    },
  };
  async function submit(TransactItems: TransactWriteItem[], context: Parameters<MigrationRunnerPorts['source']>[0]) {
    if (context.signal.aborted) throw new MigrationRunError('MIGRATION_TIMEOUT');
    const ClientRequestToken = createHash('sha256').update(JSON.stringify(TransactItems)).digest('hex').slice(0, 32);
    try { await client.send(new TransactWriteItemsCommand({ TransactItems, ClientRequestToken }),
      { abortSignal: context.signal }); return true; }
    catch (error) {
      if (error instanceof Error && error.name === 'TransactionConflictException') return false;
      if (error instanceof Error && error.name === 'TransactionCanceledException' && 'CancellationReasons' in error
        && Array.isArray(error.CancellationReasons) && error.CancellationReasons.length === TransactItems.length
        && error.CancellationReasons.some(reason => ['ConditionalCheckFailed', 'TransactionConflict'].includes(reason?.Code))
        && error.CancellationReasons.every(reason => ['None', 'ConditionalCheckFailed', 'TransactionConflict'].includes(reason?.Code))) return false;
      throw new MigrationRunError('MIGRATION_STORAGE_UNAVAILABLE', { cause: error });
    }
  }
  async function transition(phase: 'FROZEN' | 'ACTIVE', options: { timeoutMs?: number; maxRequests?: number } = {}) {
    const io = migrationIO(options);
    for (let attempt = 0; attempt < 3; attempt++) {
      const stored = legacy(await migrationCall(io, () => get(PARTITION_MIGRATION_RESOURCES.source, sourceKey, io)));
      const parsed = MigrationControlSchema.safeParse(await migrationCall(io, () => ports.control(io)));
      if (!parsed.success || parsed.data.planHash !== plan.planHash || parsed.data.revision < 1) return invalid();
      const control = parsed.data;
      const journal = checkedJournal(await migrationCall(io, () => ports.journal(plan.planHash, io)));
      const recovery = await migrationCall(io, () => manifests.read(binding.manifestHash, journal.manifestVersion, io));
      if (!recovery || recovery.versionId !== journal.manifestVersion || !Buffer.isBuffer(recovery.bytes)) {
        throw new MigrationRunError('MIGRATION_RECOVERY_INVALID');
      }
      try { loadPartitionMigration(recovery.bytes, binding); }
      catch { throw new MigrationRunError('MIGRATION_RECOVERY_INVALID'); }
      const frozen = JSON.stringify(marker(journal, 'FROZEN')); const active = JSON.stringify(marker(journal, 'ACTIVE'));
      const already = stored.version === binding.sourceRevision + (phase === 'FROZEN' ? 1 : 2)
        && stored.payload.toString('utf8') === (phase === 'FROZEN' ? frozen : active);
      if (control.active !== (phase === 'ACTIVE' && already)
        || (already && control.revision < (phase === 'FROZEN' ? 2 : 3))) return invalid();
      if (phase === 'ACTIVE' && journal.state !== 'COPIED') throw new MigrationRunError('MIGRATION_JOURNAL_INVALID');
      if (!already && (phase === 'FROZEN'
        ? journal.nextBatch !== 0 || stored.version !== binding.sourceRevision || !stored.payload.equals(plan.sourceSnapshot.payload)
        : stored.version !== binding.sourceRevision + 1 || stored.payload.toString('utf8') !== frozen)) {
        throw new MigrationRunError('MIGRATION_SOURCE_CHANGED');
      }
      const required = phase === 'FROZEN' && !already ? plan.batches.flat()
        : plan.batches.slice(0, journal.nextBatch).flat();
      for (let index = 0; index < required.length; index += 100) {
        const batch = required.slice(index, index + 100);
        const actual = await migrationCall(io, () => ports.targets(batch.map(row => row.key), io));
        if (actual.length !== batch.length || actual.some((value, n) => phase === 'FROZEN' && !already
          ? value !== null : !isDeepStrictEqual(value, batch[n]!.next))) throw new MigrationRunError('MIGRATION_TARGET_CORRUPT');
      }
      if (already) return structuredClone(control);
      if (control.revision > Number.MAX_SAFE_INTEGER - (phase === 'FROZEN' ? 2 : 1)) return invalid();
      const next = { ...control, revision: control.revision + 1, active: phase === 'ACTIVE' };
      const TransactItems: TransactWriteItem[] = [
        { Put: { TableName: PARTITION_MIGRATION_RESOURCES.source, Item: { ...attributes(sourceKey),
          version: { N: String(stored.version + 1) }, payload: { S: phase === 'FROZEN' ? frozen : active } },
          ...sourceGuard(stored.version, stored.payload.toString('utf8')) } },
        { Put: { TableName: PARTITION_MIGRATION_RESOURCES.target, Item: encoded(controlKey, next), ...expectedRecord(control) } },
        { ConditionCheck: { TableName: PARTITION_MIGRATION_RESOURCES.journal, Key: attributes(journalKey), ...expectedRecord(journal) } },
      ];
      if (await migrationCall(io, () => submit(TransactItems, io), true)) return next;
    }
    throw new MigrationRunError('MIGRATION_CONFLICT');
  }
  return ports;
}
