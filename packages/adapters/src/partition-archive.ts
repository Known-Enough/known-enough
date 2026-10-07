import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { TransactWriteItem } from '@aws-sdk/client-dynamodb';
import { Groups } from '@deal-table/contracts';
import { PartitionRowSchema, partitionDynamoWrites, partitionGroupKey, partitionAccountKey,
  type PartitionKey, type PartitionRow, type PartitionIOContext } from './partitioned-group-repository.ts';
import { PartitionDirectoryRow, partitionDirectoryKey, type PartitionDirectoryClaim } from './partition-directory.ts';
import { MigrationControlSchema, MigrationRunError, migrationIO, migrationCall,
  type MigrationControl, type MigrationRunnerPorts } from './partition-migration-runner.ts';
import { PARTITION_MIGRATION_RESOURCES as resources } from './dynamo-partition-migration.ts';

// Inactive operations/service boundary. No HTTP authority, restoration, erasure or runtime selection.
const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const sha = z.string().regex(/^[a-f0-9]{40}$/).refine(value => !/^0+$/.test(value));
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const version = z.string().min(1).max(1024).refine(value => value !== 'null'
  && ![...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127));
const utc = z.string().datetime();
const actor = z.union([z.literal(143764700), z.literal(44531296)]);
const authoritySchema = z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('ORGANIZER'), subject: id }),
  z.strictObject({ kind: z.literal('OPERATOR'), actorId: actor })]);
export type ArchiveAuthority = z.infer<typeof authoritySchema>;
export const ArchiveOperatorPolicy = z.strictObject({ schemaVersion: z.literal(1), revision,
  kind: z.literal('ARCHIVE_POLICY'), enabled: z.boolean(), actors: z.array(actor).max(2)
    .refine(values => new Set(values).size === values.length) });
type Policy = z.infer<typeof ArchiveOperatorPolicy>;
type AccountRow = Extract<PartitionRow, { kind: 'ACCOUNT' }>;
type Header = Extract<PartitionRow, { kind: 'GROUP' }>;
const entrySchema = z.strictObject({ key: z.strictObject({ PK: z.string(), SK: z.string() }), row: PartitionRowSchema });
export type ArchiveEntry = z.infer<typeof entrySchema>;
const manifestSchema = z.strictObject({ schemaVersion: z.literal(1), kind: z.literal('GROUP_ARCHIVE_RECOVERY'),
  sourceSha: sha, account: z.literal('092954139775'), region: z.literal('us-east-1'),
  table: z.literal('KnownEnoughPartitions'), groupId: id, sourceHeaderRevision: revision,
  sourceHash: hash, rows: z.array(entrySchema).min(1).max(257) });
const expectedSchema = manifestSchema.pick({ sourceSha: true, groupId: true, sourceHeaderRevision: true, sourceHash: true })
  .extend({ manifestHash: hash });
export type ArchiveExpected = z.infer<typeof expectedSchema>;
export const ArchivedGroupRow = z.strictObject({ schemaVersion: z.literal(1), revision,
  kind: z.literal('ARCHIVED_GROUP'), groupId: id, organizer: id, groupVersion: revision,
  sourceSha: sha, sourceHash: hash, manifestHash: hash, manifestVersion: version, archivedAt: utc });
export type ArchivedGroupRow = z.infer<typeof ArchivedGroupRow>;
export const ArchiveJournal = z.strictObject({ schemaVersion: z.literal(1), kind: z.literal('GROUP_ARCHIVE_JOURNAL'),
  revision: z.union([z.literal(1), z.literal(2)]), state: z.enum(['PREPARED', 'ARCHIVED']),
  groupId: id, sourceSha: sha, sourceHeaderRevision: revision, sourceHash: hash, manifestHash: hash,
  manifestVersion: version, preparedBy: authoritySchema, createdAt: utc, archivedAt: utc.nullable() });
export type ArchiveJournal = z.infer<typeof ArchiveJournal>;
export class PartitionArchiveError extends Error {
  constructor(readonly code: 'ARCHIVE_INVALID' | 'ARCHIVE_CAPACITY' | 'ARCHIVE_SOURCE_CHANGED' | 'ARCHIVE_AUTHORITY_DENIED'
    | 'ARCHIVE_TARGET_INACTIVE' | 'ARCHIVE_RECOVERY_INVALID' | 'ARCHIVE_JOURNAL_INVALID' | 'ARCHIVE_CONFLICT'
    | 'ARCHIVE_COMMIT_UNKNOWN' | 'ARCHIVE_TIMEOUT' | 'ARCHIVE_REQUEST_LIMIT' | 'ARCHIVE_STORAGE_UNAVAILABLE', options?: ErrorOptions) {
    super(code, options); this.name = 'PartitionArchiveError';
  }
}
function fail(code: PartitionArchiveError['code']): never { throw new PartitionArchiveError(code); }
const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const keyCode = (key: PartitionKey) => `${key.PK}/${key.SK}`;
const policyKey = { PK: 'OPERATIONS#ARCHIVE', SK: 'STATE' };
const controlKey = { PK: 'MIGRATION#CONTROL', SK: 'STATE' };
function rows(raw: unknown, groupId: string) {
  const result = z.array(entrySchema).min(1).max(257).safeParse(raw); if (!result.success) return fail('ARCHIVE_INVALID');
  const entries = result.data.sort((a, b) => keyCode(a.key).localeCompare(keyCode(b.key), 'en'));
  const byKey = new Map(entries.map(entry => [keyCode(entry.key), entry]));
  if (byKey.size !== entries.length) fail('ARCHIVE_INVALID');
  for (const entry of entries) {
    if (entry.row.kind === 'ACCOUNT') fail('ARCHIVE_INVALID');
    try { partitionDynamoWrites('KnownEnoughPartitions', [{ key: entry.key, expected: entry.row.revision - 1, next: entry.row }]); }
    catch { fail('ARCHIVE_INVALID'); }
  }
  const header = byKey.get(keyCode(partitionGroupKey(groupId)))?.row;
  if (!header || header.kind !== 'GROUP' || header.revision >= Number.MAX_SAFE_INTEGER
    || header.value.version >= Number.MAX_SAFE_INTEGER) return fail('ARCHIVE_INVALID');
  const { draftIds, decisionIds, ...metadata } = header.value;
  if (new Set(draftIds).size !== draftIds.length || new Set(decisionIds).size !== decisionIds.length
    || new Set(metadata.members).size !== metadata.members.length || !metadata.members.includes(metadata.organizer)) fail('ARCHIVE_INVALID');
  const children = (kind: 'DRAFT' | 'BINDING', ids: string[]) => ids.map(childId => {
    const row = byKey.get(`GROUP#${groupId}/${kind}#${childId}`)?.row;
    if (!row || row.kind !== kind) return fail('ARCHIVE_INVALID');
    return row;
  });
  const drafts = children('DRAFT', draftIds).map(row => { if (row.kind !== 'DRAFT') return fail('ARCHIVE_INVALID'); return row.value; });
  const decisions = children('BINDING', decisionIds).map(row => { if (row.kind !== 'BINDING') return fail('ARCHIVE_INVALID'); return row.value; });
  const group = Groups.Group.safeParse({ ...metadata, drafts, decisions });
  if (!group.success || !Number.isSafeInteger(group.data.version)
    || drafts.some(draft => !Number.isSafeInteger(draft.revision) || !Number.isSafeInteger(draft.groupVersion)
      || draft.groupVersion > metadata.version || (draft.createdDecisionId && !decisionIds.includes(draft.createdDecisionId)))
    || decisions.some(decision => !Number.isSafeInteger(decision.version))) return fail('ARCHIVE_INVALID');
  const claims: PartitionDirectoryClaim[] = [
    ...metadata.invitations.map(invitation => ({ type: 'INVITATION' as const, groupId, tokenHash: invitation.tokenHash,
      recipientHash: invitation.recipientHash, expiresAt: invitation.expiresAt })),
    ...decisions.map(decision => ({ type: 'DECISION' as const, groupId, decisionId: decision.id })),
  ];
  const expectedKeys = [partitionGroupKey(groupId), ...draftIds.map(childId => ({ PK: `GROUP#${groupId}`, SK: `DRAFT#${childId}` })),
    ...decisionIds.map(childId => ({ PK: `GROUP#${groupId}`, SK: `BINDING#${childId}` })), ...claims.map(partitionDirectoryKey)];
  if (expectedKeys.length !== entries.length || new Set(expectedKeys.map(keyCode)).size !== expectedKeys.length) fail('ARCHIVE_INVALID');
  for (const claim of claims) {
    const stored = byKey.get(keyCode(partitionDirectoryKey(claim)))?.row;
    const expected = PartitionDirectoryRow.parse({ schemaVersion: 1, revision: 1, kind: 'DIRECTORY', value: claim });
    if (!isDeepStrictEqual(stored, expected)) fail('ARCHIVE_INVALID');
  }
  return { entries, header };
}
export function preparePartitionArchive(raw: unknown, groupId: string, sourceSha: string) {
  if (!id.safeParse(groupId).success || !sha.safeParse(sourceSha).success) return fail('ARCHIVE_INVALID');
  const snapshot = rows(raw, groupId); const sourceHash = digest(JSON.stringify(snapshot.entries));
  const manifest = manifestSchema.parse({ schemaVersion: 1, kind: 'GROUP_ARCHIVE_RECOVERY', sourceSha,
    account: resources.account, region: resources.region, table: 'KnownEnoughPartitions', groupId,
    sourceHeaderRevision: snapshot.header.revision, sourceHash, rows: snapshot.entries });
  const manifestBytes = Buffer.from(JSON.stringify(manifest)); if (manifestBytes.length > 1024 * 1024) fail('ARCHIVE_CAPACITY');
  return { ...structuredClone(snapshot), sourceHash, manifestBytes, manifestHash: digest(manifestBytes) };
}
export function loadPartitionArchive(bytes: Buffer, rawExpected: ArchiveExpected) {
  const expected = expectedSchema.safeParse(rawExpected);
  if (!expected.success || !Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 1024 * 1024) return fail('ARCHIVE_INVALID');
  let manifest: z.infer<typeof manifestSchema>;
  try { manifest = manifestSchema.parse(JSON.parse(new globalThis.TextDecoder('utf8', { fatal: true }).decode(bytes))); }
  catch { return fail('ARCHIVE_INVALID'); }
  const plan = preparePartitionArchive(manifest.rows, manifest.groupId, manifest.sourceSha);
  if (!plan.manifestBytes.equals(bytes) || manifest.sourceSha !== expected.data.sourceSha || manifest.groupId !== expected.data.groupId
    || manifest.sourceHeaderRevision !== expected.data.sourceHeaderRevision || plan.sourceHash !== expected.data.sourceHash
    || plan.manifestHash !== expected.data.manifestHash) fail('ARCHIVE_SOURCE_CHANGED');
  return plan;
}
function journal(raw: unknown, expected: ArchiveExpected): ArchiveJournal {
  const parsed = ArchiveJournal.safeParse(raw); if (!parsed.success) return fail('ARCHIVE_JOURNAL_INVALID');
  const j = parsed.data;
  if (Object.entries(expected).some(([key, value]) => j[key as keyof ArchiveExpected] !== value)
    || (j.state === 'PREPARED' ? j.revision !== 1 || j.archivedAt !== null : j.revision !== 2 || j.archivedAt === null)) fail('ARCHIVE_JOURNAL_INVALID');
  return j;
}
function tombstone(plan: ReturnType<typeof loadPartitionArchive>, j: ArchiveJournal): ArchivedGroupRow {
  return ArchivedGroupRow.parse({ schemaVersion: 1, kind: 'ARCHIVED_GROUP', revision: plan.header.revision + 1,
    groupId: j.groupId, organizer: plan.header.value.organizer, groupVersion: plan.header.value.version + 1,
    sourceSha: j.sourceSha, sourceHash: j.sourceHash, manifestHash: j.manifestHash,
    manifestVersion: j.manifestVersion, archivedAt: j.archivedAt });
}
function authorityGuard(raw: unknown, authority: ArchiveAuthority, header: Header) {
  if (authority.kind === 'ORGANIZER') {
    const parsed = PartitionRowSchema.safeParse(raw); const account = parsed.success ? parsed.data : null;
    if (!account || account.kind !== 'ACCOUNT' || account.value.subject !== authority.subject
      || account.value.status !== 'APPROVED' || header.value.organizer !== authority.subject
      || !header.value.members.includes(authority.subject)) return fail('ARCHIVE_AUTHORITY_DENIED');
    return { key: partitionAccountKey(authority.subject), row: account };
  }
  const policy = ArchiveOperatorPolicy.safeParse(raw);
  if (!policy.success || !policy.data.enabled || !policy.data.actors.includes(authority.actorId)) return fail('ARCHIVE_AUTHORITY_DENIED');
  return { key: policyKey, row: policy.data };
}
export type ArchiveAtomicCommit = { control: MigrationControl; authority: { key: PartitionKey; row: AccountRow | Policy };
  header: { key: PartitionKey; expected: Header; next: ArchivedGroupRow | null };
  journal: { key: PartitionKey; expected: ArchiveJournal | null; next: ArchiveJournal } };
/** The concrete operations transport must submit exactly these conditions/puts as one transaction. */
export function archiveDynamoWrites(request: ArchiveAtomicCommit, bytes: Buffer, expected: ArchiveExpected,
  rawAuthority: ArchiveAuthority): TransactWriteItem[] {
  const trusted = authoritySchema.safeParse(rawAuthority); if (!trusted.success) return fail('ARCHIVE_AUTHORITY_DENIED');
  const authority = trusted.data; const plan = loadPartitionArchive(bytes, expected);
  const next = journal(request.journal.next, expected); const prior = request.journal.expected;
  const guard = authorityGuard(request.authority.row, authority, plan.header);
  const control = MigrationControlSchema.safeParse(request.control);
  if (!control.success || !control.data.active || control.data.planHash === null) return fail('ARCHIVE_TARGET_INACTIVE');
  const journalKey = { PK: `ARCHIVE#${expected.groupId}`, SK: `OP#${expected.manifestHash}` };
  if (!isDeepStrictEqual(request.authority, guard) || !isDeepStrictEqual(request.header.key, partitionGroupKey(expected.groupId))
    || !isDeepStrictEqual(request.header.expected, plan.header) || !isDeepStrictEqual(request.journal.key, journalKey)
    || (next.state === 'PREPARED' ? prior !== null || request.header.next !== null || !isDeepStrictEqual(next.preparedBy, authority)
      : !prior || !isDeepStrictEqual(journal(prior, expected), { ...next, revision: 1, state: 'PREPARED', archivedAt: null })
        || !isDeepStrictEqual(request.header.next, tombstone(plan, next)))) return fail('ARCHIVE_INVALID');
  const attrs = (key: PartitionKey) => ({ PK: { S: key.PK }, SK: { S: key.SK } });
  const condition = (value: { revision: number }) => ({ ConditionExpression: '#r = :r AND #p = :p',
    ExpressionAttributeNames: { '#r': 'revision', '#p': 'payload' },
    ExpressionAttributeValues: { ':r': { N: String(value.revision) }, ':p': { S: JSON.stringify(value) } } });
  const item = (key: PartitionKey, value: { revision: number }) => ({ ...attrs(key), revision: { N: String(value.revision) }, payload: { S: JSON.stringify(value) } });
  const output: TransactWriteItem[] = [
    { ConditionCheck: { TableName: resources.target, Key: attrs(controlKey), ...condition(control.data) } },
    { ConditionCheck: { TableName: resources.target, Key: attrs(guard.key), ...condition(guard.row) } },
    request.header.next ? { Put: { TableName: resources.target, Item: item(request.header.key, request.header.next), ...condition(plan.header) } }
      : { ConditionCheck: { TableName: resources.target, Key: attrs(request.header.key), ...condition(plan.header) } },
    { Put: { TableName: resources.journal, Item: item(journalKey, next), ...(prior ? condition(prior) : { ConditionExpression: 'attribute_not_exists(PK)' }) } },
  ];
  if (Buffer.byteLength(JSON.stringify(output)) > 4_000_000) fail('ARCHIVE_CAPACITY');
  return output;
}
export interface PartitionArchivePorts {
  /** Strong complete group/child/directory read, rechecking its header; charge every extra request. */
  group(groupId: string, context: PartitionIOContext): Promise<unknown>;
  control(context: PartitionIOContext): Promise<unknown>;
  authority(authority: ArchiveAuthority, context: PartitionIOContext): Promise<unknown>;
  journal(key: PartitionKey, context: PartitionIOContext): Promise<unknown | null>;
  recovery: MigrationRunnerPorts['manifests'];
  /** Atomic header/control/authority/journal conditions. No child deletion or approval mutation. */
  commit(request: ArchiveAtomicCommit, context: PartitionIOContext): Promise<boolean>;
}
function ioFailure(error: unknown): never {
  if (error instanceof MigrationRunError) {
    const code = error.code === 'MIGRATION_TIMEOUT' ? 'ARCHIVE_TIMEOUT' : error.code === 'MIGRATION_REQUEST_LIMIT' ? 'ARCHIVE_REQUEST_LIMIT'
      : error.code === 'MIGRATION_COMMIT_UNKNOWN' ? 'ARCHIVE_COMMIT_UNKNOWN' : error.code === 'MIGRATION_RUN_INVALID' ? 'ARCHIVE_INVALID' : 'ARCHIVE_STORAGE_UNAVAILABLE';
    throw new PartitionArchiveError(code, { cause: error });
  }
  throw error;
}
/** Authority comes only from verified service/workflow context, never a submitted role or identity. */
export function createPartitionArchiveRunner(ports: PartitionArchivePorts, bytes: Buffer, rawExpected: ArchiveExpected,
  rawAuthority: ArchiveAuthority, options: { timeoutMs?: number; maxRequests?: number } = {}) {
  const trusted = authoritySchema.safeParse(rawAuthority); if (!trusted.success) return fail('ARCHIVE_AUTHORITY_DENIED');
  const binding = expectedSchema.safeParse(rawExpected); if (!binding.success) return fail('ARCHIVE_INVALID');
  const expected = binding.data; const saved = Buffer.from(bytes);
  const plan = loadPartitionArchive(saved, expected); const authority = structuredClone(trusted.data);
  const makeIO = () => { try { return migrationIO(options); } catch (error) { return ioFailure(error); } }; makeIO();
  const key = { PK: `ARCHIVE#${expected.groupId}`, SK: `OP#${expected.manifestHash}` };
  async function call<T>(io: PartitionIOContext, work: () => Promise<T>, commit = false): Promise<T> {
    try { return await migrationCall(io, work, commit); } catch (error) {
      if (!commit && error instanceof MigrationRunError && error.code === 'MIGRATION_STORAGE_UNAVAILABLE'
        && error.cause instanceof PartitionArchiveError) throw error.cause;
      return ioFailure(error);
    }
  }
  async function current(io: PartitionIOContext, archived: ArchiveJournal | null) {
    const raw = await call(io, () => ports.group(expected.groupId, io));
    const parsedRows = z.array(entrySchema.extend({ row: z.union([PartitionRowSchema, ArchivedGroupRow]) })).max(257).safeParse(raw);
    if (!parsedRows.success || parsedRows.data.length !== plan.entries.length) return fail('ARCHIVE_SOURCE_CHANGED');
    const canonical = parsedRows.data.sort((a, b) => keyCode(a.key).localeCompare(keyCode(b.key), 'en'));
    const wanted = structuredClone(plan.entries) as { key: PartitionKey; row: PartitionRow | ArchivedGroupRow }[];
    if (archived) wanted.find(entry => keyCode(entry.key) === keyCode(partitionGroupKey(expected.groupId)))!.row = tombstone(plan, archived);
    if (!isDeepStrictEqual(canonical, wanted)) return fail('ARCHIVE_SOURCE_CHANGED');
    const parsed = MigrationControlSchema.safeParse(await call(io, () => ports.control(io)));
    if (!parsed.success || !parsed.data.active || parsed.data.planHash === null) return fail('ARCHIVE_TARGET_INACTIVE');
    const guard = authorityGuard(await call(io, () => ports.authority(authority, io)), authority, plan.header);
    return { control: parsed.data, authority: guard };
  }
  async function recovery(versionId: string, io: PartitionIOContext) {
    const value = await call(io, () => ports.recovery.read(expected.manifestHash, versionId, io));
    if (!value || value.versionId !== versionId || !Buffer.isBuffer(value.bytes)) return fail('ARCHIVE_RECOVERY_INVALID');
    try { loadPartitionArchive(value.bytes, expected); } catch { return fail('ARCHIVE_RECOVERY_INVALID'); }
  }
  const request = (guards: Awaited<ReturnType<typeof current>>, prior: ArchiveJournal | null, next: ArchiveJournal): ArchiveAtomicCommit => ({
    ...structuredClone(guards), header: { key: partitionGroupKey(expected.groupId), expected: structuredClone(plan.header),
      next: next.state === 'ARCHIVED' ? tombstone(plan, next) : null }, journal: { key, expected: prior, next } });
  return {
    async prepare(): Promise<ArchiveJournal> {
      const io = makeIO();
      for (let attempt = 0; attempt < 3; attempt++) {
        const raw = await call(io, () => ports.journal(key, io));
        const prior = raw === null ? null : journal(raw, expected);
        const guards = await current(io, prior?.state === 'ARCHIVED' ? prior : null);
        if (prior) { await recovery(prior.manifestVersion, io); return structuredClone(prior); }
        const preserved = await call(io, () => ports.recovery.preserve(Buffer.from(saved), expected.manifestHash, io));
        if (!preserved || !version.safeParse(preserved.versionId).success || !Buffer.isBuffer(preserved.bytes)
          || digest(preserved.bytes) !== expected.manifestHash) return fail('ARCHIVE_RECOVERY_INVALID');
        await recovery(preserved.versionId, io);
        const next: ArchiveJournal = { schemaVersion: 1, kind: 'GROUP_ARCHIVE_JOURNAL', revision: 1, state: 'PREPARED',
          ...expected, manifestVersion: preserved.versionId, preparedBy: authority, createdAt: new Date().toISOString(), archivedAt: null };
        const pending = request(guards, null, next); archiveDynamoWrites(pending, saved, expected, authority);
        if (await call(io, () => ports.commit(pending, io), true)) return structuredClone(next);
      }
      return fail('ARCHIVE_CONFLICT');
    },
    async archive(): Promise<ArchiveJournal> {
      const io = makeIO();
      for (let attempt = 0; attempt < 3; attempt++) {
        const prior = journal(await call(io, () => ports.journal(key, io)), expected);
        const guards = await current(io, prior.state === 'ARCHIVED' ? prior : null);
        await recovery(prior.manifestVersion, io);
        if (prior.state === 'ARCHIVED') return structuredClone(prior);
        const next: ArchiveJournal = { ...prior, revision: 2, state: 'ARCHIVED', archivedAt: new Date().toISOString() };
        const pending = request(guards, prior, next); archiveDynamoWrites(pending, saved, expected, authority);
        if (await call(io, () => ports.commit(pending, io), true)) return structuredClone(next);
      }
      return fail('ARCHIVE_CONFLICT');
    },
  };
}
