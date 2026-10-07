import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Groups } from '@deal-table/contracts';
import { partitionDirectoryKey, type PartitionDirectoryClaim } from './partition-directory.ts';
import { partitionMembershipKey } from './partition-membership-contract.ts';
import { partitionSeedRows, partitionDynamoWrites, PartitionStorageError, type PartitionMutation } from './partitioned-group-repository.ts';

// Inactive, server-only preparation. No storage write, resource creation or runtime switch.
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const sha = z.string().regex(/^[a-f0-9]{40}$/).refine(value => !/^0+$/.test(value));
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const sourceLimit = 300_000;
const manifestLimit = 1024 * 1024;
const manifestSchema = z.strictObject({ schemaVersion: z.union([z.literal(1), z.literal(2)]), sourceSha: sha,
  account: z.literal('092954139775'), region: z.literal('us-east-1'),
  sourceTable: z.literal('KnownEnoughGroupsStage'), sourceKey: z.strictObject({ PK: z.literal('NP#GROUPS'), SK: z.literal('STATE') }),
  targetTable: z.literal('KnownEnoughPartitions'), sourceRevision: revision, sourceHash: hash,
  sourcePayloadBase64: z.string().min(4).max(400_000),
});
const expectedSchema = z.strictObject({ sourceSha: sha, sourceRevision: revision, sourceHash: hash, manifestHash: hash });
export type PartitionMigrationExpected = z.infer<typeof expectedSchema>;
export class PartitionMigrationError extends Error {
  constructor(readonly code: 'PARTITION_MIGRATION_INVALID' | 'PARTITION_MIGRATION_CAPACITY' | 'PARTITION_MIGRATION_SOURCE_CHANGED',
    options?: ErrorOptions) { super(code, options); this.name = 'PartitionMigrationError'; }
}
const fail = (code: PartitionMigrationError['code']): never => { throw new PartitionMigrationError(code); };
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
function json(bytes: Buffer): unknown {
  try { return JSON.parse(new globalThis.TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch (error) { throw new PartitionMigrationError('PARTITION_MIGRATION_INVALID', { cause: error }); }
}
function sourceState(bytes: Buffer): Groups.GroupState {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > sourceLimit) return fail('PARTITION_MIGRATION_CAPACITY');
  const parsed = Groups.GroupState.safeParse(json(bytes));
  if (!parsed.success) return fail('PARTITION_MIGRATION_INVALID');
  const state = parsed.data;
  const subjects = new Set(state.accounts.map(item => item.subject));
  if (subjects.size !== state.accounts.length
    || new Set(state.accounts.map(item => item.emailHash)).size !== state.accounts.length
    || new Set(state.groups.map(item => item.id)).size !== state.groups.length) fail('PARTITION_MIGRATION_INVALID');
  for (const group of state.groups) {
    if (group.invitations.some(item => item.acceptedBy !== null && !subjects.has(item.acceptedBy))
      || group.drafts.some(item => item.groupVersion > group.version)
      || new Set(group.drafts.filter(item => item.createdDecisionId).map(item => item.createdDecisionId)).size
        !== group.drafts.filter(item => item.createdDecisionId).length) fail('PARTITION_MIGRATION_INVALID');
  }
  return state;
}
function compileRows(state: Groups.GroupState, manifestHash: string, schemaVersion: 1 | 2) {
  const entries = new Map<string, PartitionMutation>();
  const add = (mutation: PartitionMutation) => {
    const key = `${mutation.key.PK}/${mutation.key.SK}`;
    if (entries.has(key)) fail('PARTITION_MIGRATION_INVALID');
    // Validate key, row/schema/byte/revision conditions against the real inactive writer.
    partitionDynamoWrites('KnownEnoughPartitions', [mutation]);
    entries.set(key, mutation);
    if (entries.size > 1000) fail('PARTITION_MIGRATION_CAPACITY');
  };
  const claim = (value: PartitionDirectoryClaim) => add({ key: partitionDirectoryKey(value), expected: 0,
    next: { schemaVersion: 1, revision: 1, kind: 'DIRECTORY', value } });
  // Each account occurs exactly once, including disabled/pending/unaffiliated accounts.
  for (const account of state.accounts) {
    const rows = partitionSeedRows({ accounts: [account], groups: [] }, { accountSubjects: [account.subject] });
    rows.forEach(add); claim({ type: 'EMAIL', subject: account.subject, emailHash: account.emailHash });
  }
  for (const group of state.groups) {
    const accounts = state.accounts.filter(item => group.members.includes(item.subject));
    const rows = partitionSeedRows({ accounts, groups: [group] }, { accountSubjects: [...group.members], groupId: group.id });
    rows.filter(item => item.next?.kind !== 'ACCOUNT').forEach(add);
    if (schemaVersion === 2) for (const subject of group.members) {
      add({ key: partitionMembershipKey(subject, group.id), expected: 0,
        next: { schemaVersion: 1, kind: 'MEMBERSHIP', revision: 1, value: { subject, groupId: group.id, active: true } } });
    }
    group.invitations.forEach(item => claim({ type: 'INVITATION', groupId: group.id, tokenHash: item.tokenHash,
      recipientHash: item.recipientHash, expiresAt: item.expiresAt }));
    group.decisions.forEach(item => claim({ type: 'DECISION', groupId: group.id, decisionId: item.id }));
  }
  const ordered = [...entries.values()].sort((a, b) => {
    const left = `${a.key.PK}/${a.key.SK}`; const right = `${b.key.PK}/${b.key.SK}`;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const preparation = ordered.filter(item => item.next?.kind !== 'GROUP');
  const publication = ordered.filter(item => item.next?.kind === 'GROUP');
  // Reserve four transaction slots for the journal/source/lease/activation fences.
  // Headers fit one final batch (legacy bound32); this is NOT runtime activation.
  const batches: PartitionMutation[][] = [];
  for (let start = 0; start < preparation.length; start += 96) batches.push(preparation.slice(start, start + 96));
  if (publication.length) batches.push(publication);
  for (const batch of batches) partitionDynamoWrites('KnownEnoughPartitions', batch);
  const body = { manifestHash, rowCount: entries.size, batches };
  return { ...structuredClone(body), planHash: digest(JSON.stringify(body)) };
}
function compile(state: Groups.GroupState, manifestHash: string, schemaVersion: 1 | 2) {
  try { return compileRows(state, manifestHash, schemaVersion); }
  catch (error) {
    if (error instanceof PartitionMigrationError) throw error;
    throw new PartitionMigrationError(error instanceof PartitionStorageError && error.code === 'PARTITION_CAPACITY'
      ? 'PARTITION_MIGRATION_CAPACITY' : 'PARTITION_MIGRATION_INVALID', { cause: error });
  }
}
/** Preserve these exact bytes with OPS00's versioned manifest store before any apply. */
export function preparePartitionMigration(payload: Buffer, sourceRevision: number, sourceSha: string) {
  const state = sourceState(payload);
  const parsed = manifestSchema.safeParse({ schemaVersion: 2, sourceSha, account: '092954139775', region: 'us-east-1',
    sourceTable: 'KnownEnoughGroupsStage', sourceKey: { PK: 'NP#GROUPS', SK: 'STATE' }, targetTable: 'KnownEnoughPartitions',
    sourceRevision, sourceHash: digest(payload), sourcePayloadBase64: payload.toString('base64') });
  if (!parsed.success) return fail('PARTITION_MIGRATION_INVALID');
  const manifestBytes = Buffer.from(JSON.stringify(parsed.data));
  if (manifestBytes.length > manifestLimit) return fail('PARTITION_MIGRATION_CAPACITY');
  const manifestHash = digest(manifestBytes);
  return { manifestBytes, sourceHash: parsed.data.sourceHash, ...compile(state, manifestHash, parsed.data.schemaVersion) };
}
/** Expected source/hash comes from verified storage and immutable recovery readback, not submitted JSON. */
export function loadPartitionMigration(bytes: Buffer, expected: PartitionMigrationExpected) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > manifestLimit) return fail('PARTITION_MIGRATION_CAPACITY');
  const checkedExpected = expectedSchema.safeParse(expected);
  if (!checkedExpected.success) return fail('PARTITION_MIGRATION_INVALID');
  const manifest = manifestSchema.safeParse(json(bytes));
  if (!manifest.success) return fail('PARTITION_MIGRATION_INVALID');
  const prior = manifest.data; const authority = checkedExpected.data;
  if (digest(bytes) !== authority.manifestHash || prior.sourceHash !== authority.sourceHash
    || prior.sourceSha !== authority.sourceSha || prior.sourceRevision !== authority.sourceRevision) fail('PARTITION_MIGRATION_SOURCE_CHANGED');
  const payload = Buffer.from(prior.sourcePayloadBase64, 'base64');
  if (payload.toString('base64') !== prior.sourcePayloadBase64 || digest(payload) !== prior.sourceHash) fail('PARTITION_MIGRATION_INVALID');
  const state = sourceState(payload);
  return { sourceSnapshot: { version: prior.sourceRevision, payload: Buffer.from(payload), state: structuredClone(state) },
    sourceSha: prior.sourceSha, ...compile(state, authority.manifestHash, prior.schemaVersion) };
}
