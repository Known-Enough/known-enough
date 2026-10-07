import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { loadPartitionMigration, type PartitionMigrationExpected } from './partition-migration.ts';
import { type PartitionIOContext, type PartitionKey, type PartitionMutation } from './partitioned-group-repository.ts';

// Inactive server-side coordinator. A managed implementation of this atomic port is still required.
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const actor = z.union([z.literal(143764700), z.literal(44531296)]);
const versionId = z.string().min(1).max(1024).refine(value => value !== 'null'
  && ![...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127));
const controlSchema = z.strictObject({ schemaVersion: z.literal(1), account: z.literal('092954139775'),
  region: z.literal('us-east-1'), table: z.literal('KnownEnoughPartitions'), revision: integer,
  active: z.boolean(), planHash: hash.nullable() });
export type MigrationControl = z.infer<typeof controlSchema>;
const journalSchema = z.strictObject({ schemaVersion: z.literal(1), revision: integer.min(1), actorId: actor,
  planHash: hash, manifestHash: hash, manifestVersion: versionId, sourceSha: z.string().regex(/^[a-f0-9]{40}$/),
  sourceRevision: integer.min(1), sourceHash: hash, rowCount: integer.max(1000), nextBatch: integer.max(12),
  completedRows: integer.max(1000), state: z.enum(['PREPARED', 'APPLYING', 'COPIED']) });
export type MigrationJournal = z.infer<typeof journalSchema>;
export type MigrationAtomicCommit = {
  source: { table: 'KnownEnoughGroupsStage'; key: { PK: 'NP#GROUPS'; SK: 'STATE' }; revision: number; payload: Buffer };
  control: { expected: MigrationControl; next: MigrationControl | null };
  journal: { expectedRevision: number; next: MigrationJournal };
  rows: PartitionMutation[];
};
export interface MigrationRunnerPorts {
  source(context: PartitionIOContext): Promise<{ version: number; payload: Buffer }>;
  control(context: PartitionIOContext): Promise<unknown>;
  journal(planHash: string, context: PartitionIOContext): Promise<unknown | null>;
  targets(keys: PartitionKey[], context: PartitionIOContext): Promise<(unknown | null)[]>;
  manifests: {
    preserve(bytes: Buffer, hash: string, context: PartitionIOContext): Promise<{ bytes: Buffer; versionId: string }>;
    read(hash: string, versionId: string, context: PartitionIOContext): Promise<{ bytes: Buffer; versionId: string }>;
  };
  /** MUST atomically condition exact legacy revision/payload, control, journal and all exclusive row puts. */
  commit(request: MigrationAtomicCommit, context: PartitionIOContext): Promise<boolean>;
}
export class MigrationRunError extends Error {
  constructor(readonly code: 'MIGRATION_RUN_INVALID' | 'MIGRATION_SOURCE_CHANGED' | 'MIGRATION_TARGET_CONFLICT'
    | 'MIGRATION_RECOVERY_INVALID' | 'MIGRATION_JOURNAL_INVALID' | 'MIGRATION_TARGET_CORRUPT'
    | 'MIGRATION_CONFLICT' | 'MIGRATION_TIMEOUT' | 'MIGRATION_REQUEST_LIMIT'
    | 'MIGRATION_STORAGE_UNAVAILABLE' | 'MIGRATION_COMMIT_UNKNOWN', options?: ErrorOptions) {
    super(code, options); this.name = 'MigrationRunError';
  }
}
function fail(code: MigrationRunError['code']): never { throw new MigrationRunError(code); }
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
function context(options: { timeoutMs?: number; maxRequests?: number }): PartitionIOContext {
  const timeoutMs = options.timeoutMs ?? 20_000; const maxRequests = options.maxRequests ?? 64;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20_000
    || !Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 64) fail('MIGRATION_RUN_INVALID');
  const abort = new globalThis.AbortController();
  const signal = globalThis.AbortSignal.any([abort.signal, globalThis.AbortSignal.timeout(timeoutMs)]);
  let requests = 0;
  return { signal, request: () => {
    if (signal.aborted) throw signal.reason instanceof MigrationRunError ? signal.reason : new MigrationRunError('MIGRATION_TIMEOUT');
    if (++requests > maxRequests) { const error = new MigrationRunError('MIGRATION_REQUEST_LIMIT'); abort.abort(error); throw error; }
  } };
}
async function call<T>(io: PartitionIOContext, work: () => Promise<T>, commit = false): Promise<T> {
  io.request(); let submitted = false;
  try {
    return await new Promise<T>((resolve, reject) => {
      const abort = () => reject(io.signal.reason instanceof MigrationRunError ? io.signal.reason : new MigrationRunError('MIGRATION_TIMEOUT'));
      io.signal.addEventListener('abort', abort, { once: true });
      Promise.resolve().then(() => {
        if (io.signal.aborted) return abort();
        submitted = true; return work().then(resolve, reject);
      }).catch(reject).finally(() => io.signal.removeEventListener('abort', abort));
    });
  } catch (error) {
    if (commit && submitted) throw new MigrationRunError('MIGRATION_COMMIT_UNKNOWN', { cause: error });
    if (error instanceof MigrationRunError) throw error;
    throw new MigrationRunError('MIGRATION_STORAGE_UNAVAILABLE', { cause: error });
  }
}
/** Authority is verified project workflow/service context, never HTTP-submitted identity. */
export function createPartitionMigrationRunner(ports: MigrationRunnerPorts, manifestBytes: Buffer,
  expected: PartitionMigrationExpected, authority: { actorId: number; sourceSha: string },
  options: { timeoutMs?: number; maxRequests?: number } = {}) {
  const trusted = z.strictObject({ actorId: actor, sourceSha: z.string().regex(/^[a-f0-9]{40}$/) }).safeParse(authority);
  if (!trusted.success || trusted.data.sourceSha !== expected.sourceSha) fail('MIGRATION_RUN_INVALID');
  const binding = structuredClone(expected); const bytes = Buffer.from(manifestBytes);
  const plan = loadPartitionMigration(bytes, binding); context(options);
  const allRows = plan.batches.flat();
  async function current(io: PartitionIOContext) {
    const source = await call(io, () => ports.source(io));
    if (!source || !Buffer.isBuffer(source.payload) || source.payload.length > 300_000
      || source.version !== binding.sourceRevision || digest(source.payload) !== binding.sourceHash) fail('MIGRATION_SOURCE_CHANGED');
    const parsed = controlSchema.safeParse(await call(io, () => ports.control(io)));
    if (!parsed.success || parsed.data.revision === Number.MAX_SAFE_INTEGER) fail('MIGRATION_RUN_INVALID');
    if (parsed.data.active || (parsed.data.planHash !== null && parsed.data.planHash !== plan.planHash)) fail('MIGRATION_TARGET_CONFLICT');
    return parsed.data;
  }
  function checkedJournal(raw: unknown): MigrationJournal {
    const parsed = journalSchema.safeParse(raw); if (!parsed.success) return fail('MIGRATION_JOURNAL_INVALID');
    const journal = parsed.data;
    const completedRows = plan.batches.slice(0, journal.nextBatch).flat().length;
    const state = journal.nextBatch === plan.batches.length ? 'COPIED' : journal.nextBatch === 0 ? 'PREPARED' : 'APPLYING';
    if (journal.planHash !== plan.planHash || journal.manifestHash !== binding.manifestHash
      || journal.sourceSha !== binding.sourceSha || journal.sourceHash !== binding.sourceHash
      || journal.sourceRevision !== binding.sourceRevision || journal.rowCount !== plan.rowCount
      || journal.nextBatch > plan.batches.length || journal.completedRows !== completedRows
      || journal.revision !== journal.nextBatch + 1
      || journal.state !== state || journal.revision === Number.MAX_SAFE_INTEGER) fail('MIGRATION_JOURNAL_INVALID');
    return journal;
  }
  async function recovery(manifestVersion: string, io: PartitionIOContext) {
    const response = await call(io, () => ports.manifests.read(binding.manifestHash, manifestVersion, io));
    if (!response || response.versionId !== manifestVersion || !Buffer.isBuffer(response.bytes)) fail('MIGRATION_RECOVERY_INVALID');
    try { loadPartitionMigration(response.bytes, binding); }
    catch (error) { throw new MigrationRunError('MIGRATION_RECOVERY_INVALID', { cause: error }); }
  }
  async function targets(rows: PartitionMutation[], missing: boolean, io: PartitionIOContext) {
    for (let start = 0; start < rows.length; start += 100) {
      const batch = rows.slice(start, start + 100);
      const values = await call(io, () => ports.targets(batch.map(item => item.key), io));
      if (!Array.isArray(values) || values.length !== batch.length) fail('MIGRATION_TARGET_CORRUPT');
      if (values.some((value, n) => missing ? value !== null : !isDeepStrictEqual(value, batch[n]!.next))) {
        fail(missing ? 'MIGRATION_TARGET_CONFLICT' : 'MIGRATION_TARGET_CORRUPT');
      }
    }
  }
  const request = (control: MigrationControl, journal: MigrationJournal, priorRevision: number,
    rows: PartitionMutation[], next: MigrationControl | null): MigrationAtomicCommit => ({
    source: { table: 'KnownEnoughGroupsStage' as const, key: { PK: 'NP#GROUPS' as const, SK: 'STATE' as const },
      revision: binding.sourceRevision, payload: Buffer.from(plan.sourceSnapshot.payload) },
    control: structuredClone({ expected: control, next }),
    journal: structuredClone({ expectedRevision: priorRevision, next: journal }), rows: structuredClone(rows),
  });
  return {
    async prepare(): Promise<MigrationJournal> {
      const io = context(options);
      let control = await current(io);
      const preserved = await call(io, () => ports.manifests.preserve(Buffer.from(bytes), binding.manifestHash, io));
      if (!preserved || !versionId.safeParse(preserved.versionId).success || !Buffer.isBuffer(preserved.bytes)
        || digest(preserved.bytes) !== binding.manifestHash) fail('MIGRATION_RECOVERY_INVALID');
      await recovery(preserved.versionId, io);
      for (let attempt = 0; attempt < 3; attempt++) {
        const raw = await call(io, () => ports.journal(plan.planHash, io));
        if (raw !== null) {
          const journal = checkedJournal(raw);
          control = await current(io);
          if (control.planHash !== plan.planHash) fail('MIGRATION_JOURNAL_INVALID');
          await recovery(journal.manifestVersion, io);
          await targets(plan.batches.slice(0, journal.nextBatch).flat(), false, io);
          return structuredClone(journal);
        }
        if (control.planHash !== null) fail('MIGRATION_JOURNAL_INVALID');
        await targets(allRows, true, io);
        const journal: MigrationJournal = { schemaVersion: 1, revision: 1, actorId: trusted.data.actorId,
          planHash: plan.planHash, manifestHash: binding.manifestHash, manifestVersion: preserved.versionId,
          sourceSha: binding.sourceSha, sourceRevision: binding.sourceRevision, sourceHash: binding.sourceHash,
          rowCount: plan.rowCount, nextBatch: 0, completedRows: 0, state: plan.batches.length ? 'PREPARED' : 'COPIED' };
        const next = { ...control, revision: control.revision + 1, planHash: plan.planHash };
        if (await call(io, () => ports.commit(request(control, journal, 0, [], next), io), true)) return structuredClone(journal);
        control = await current(io);
      }
      return fail('MIGRATION_CONFLICT');
    },
    /** One successful batch per invocation; a lost response requires a fresh journal/readback resume. */
    async step(): Promise<MigrationJournal> {
      const io = context(options);
      for (let attempt = 0; attempt < 3; attempt++) {
        const control = await current(io);
        if (control.planHash !== plan.planHash) fail('MIGRATION_JOURNAL_INVALID');
        const journal = checkedJournal(await call(io, () => ports.journal(plan.planHash, io)));
        await recovery(journal.manifestVersion, io);
        await targets(plan.batches.slice(0, journal.nextBatch).flat(), false, io);
        if (journal.state === 'COPIED') return structuredClone(journal);
        const batch = plan.batches[journal.nextBatch]!;
        const nextBatch = journal.nextBatch + 1;
        const next: MigrationJournal = { ...journal, revision: journal.revision + 1, nextBatch,
          completedRows: journal.completedRows + batch.length, state: nextBatch === plan.batches.length ? 'COPIED' : 'APPLYING' };
        if (await call(io, () => ports.commit(request(control, next, journal.revision, batch, null), io), true)) return structuredClone(next);
      }
      return fail('MIGRATION_CONFLICT');
    },
  };
}
