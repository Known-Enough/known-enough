import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ARCHIVE_MANIFEST_BYTES, loadPartitionArchive, PartitionArchiveError, type ArchiveExpected, type PartitionArchivePorts } from './partition-archive.ts';
import type { PartitionIOContext } from './partitioned-group-repository.ts';

const physicalLimit = 1024 * 1024;
const chunkBytes = 700 * 1024;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const version = z.string().min(1).max(1024).refine(value => value !== 'null'
  && ![...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127));
const rootSchema = z.strictObject({ schemaVersion: z.literal(1), kind: z.literal('GROUP_ARCHIVE_CHUNKS'),
  account: z.literal('092954139775'), region: z.literal('us-east-1'), table: z.literal('KnownEnoughPartitions'),
  sourceSha: z.string().regex(/^[a-f0-9]{40}$/), groupId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  sourceHeaderRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), sourceHash: hash,
  manifestHash: hash, byteLength: z.number().int().positive().max(ARCHIVE_MANIFEST_BYTES),
  chunks: z.array(z.strictObject({ hash, versionId: version, byteLength: z.number().int().positive().max(chunkBytes) })).min(2).max(8) });
const chunkSchema = z.strictObject({ schemaVersion: z.literal(1), kind: z.literal('GROUP_ARCHIVE_CHUNK'),
  manifestHash: hash, index: z.number().int().nonnegative().max(7), count: z.number().int().min(2).max(8),
  bodyBase64: z.string() });
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
function invalid(): never { throw new PartitionArchiveError('ARCHIVE_RECOVERY_INVALID'); }
function canonical<T>(bytes: Buffer, schema: z.ZodType<T>): T {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > physicalLimit) return invalid();
  let value: T;
  try { value = schema.parse(JSON.parse(new globalThis.TextDecoder('utf8', { fatal: true }).decode(bytes))); }
  catch { return invalid(); }
  if (JSON.stringify(value) !== bytes.toString('utf8')) return invalid();
  return value;
}
function stored(raw: unknown, expected: Buffer, pinned?: string) {
  const result = z.object({ bytes: z.instanceof(Buffer), versionId: version }).safeParse(raw);
  if (!result.success || !result.data.bytes.equals(expected) || (pinned !== undefined && result.data.versionId !== pinned)) return invalid();
  return { bytes: Buffer.from(result.data.bytes), versionId: result.data.versionId };
}

/** Optional inactive logical recovery port. Caller charges the first request; underlying storage charges its own extras. */
export function createChunkedArchiveRecovery(storage: PartitionArchivePorts['recovery'], manifestBytes: Buffer,
  rawExpected: ArchiveExpected): PartitionArchivePorts['recovery'] {
  if (!Buffer.isBuffer(manifestBytes) || typeof storage?.preserve !== 'function' || typeof storage?.read !== 'function') return invalid();
  const bytes = Buffer.from(manifestBytes); const expected = structuredClone(rawExpected);
  loadPartitionArchive(bytes, expected);
  const large = bytes.length > physicalLimit;
  const count = Math.ceil(bytes.length / chunkBytes);
  const chunks = large ? Array.from({ length: count }, (_, index) => {
    const raw = bytes.subarray(index * chunkBytes, Math.min(bytes.length, (index + 1) * chunkBytes));
    const body = Buffer.from(JSON.stringify(chunkSchema.parse({ schemaVersion: 1, kind: 'GROUP_ARCHIVE_CHUNK',
      manifestHash: expected.manifestHash, index, count, bodyBase64: raw.toString('base64') })));
    if (body.length > physicalLimit) return invalid();
    return { bytes: body, hash: digest(body), byteLength: raw.length };
  }) : [];
  function binding(input: string) { if (input !== expected.manifestHash) invalid(); }
  function calls(context: PartitionIOContext) {
    let first = true;
    return async <T>(work: () => Promise<T>): Promise<T> => {
      if (!first) context.request(); first = false;
      if (context.signal.aborted) throw context.signal.reason;
      return work();
    };
  }
  const root = (versions: string[]) => rootSchema.parse({ schemaVersion: 1, kind: 'GROUP_ARCHIVE_CHUNKS',
    account: '092954139775', region: 'us-east-1', table: 'KnownEnoughPartitions', ...expected,
    byteLength: bytes.length, chunks: chunks.map((chunk, index) => ({ hash: chunk.hash, versionId: versions[index], byteLength: chunk.byteLength })) });
  return {
    async preserve(input, manifestHash, context) {
      binding(manifestHash); if (!Buffer.isBuffer(input) || !input.equals(bytes)) return invalid();
      const call = calls(context);
      if (!large) return stored(await call(() => storage.preserve(Buffer.from(bytes), manifestHash, context)), bytes);
      const versions: string[] = [];
      for (const chunk of chunks) {
        versions.push(stored(await call(() => storage.preserve(Buffer.from(chunk.bytes), chunk.hash, context)), chunk.bytes).versionId);
      }
      const rootBytes = Buffer.from(JSON.stringify(root(versions))); const rootHash = digest(rootBytes);
      const saved = stored(await call(() => storage.preserve(rootBytes, rootHash, context)), rootBytes);
      const versionId = `arch1:${rootHash}:${saved.versionId}`;
      if (!version.safeParse(versionId).success) throw new PartitionArchiveError('ARCHIVE_CAPACITY');
      return { bytes: Buffer.from(bytes), versionId };
    },
    async read(manifestHash, versionId, context) {
      binding(manifestHash); if (!version.safeParse(versionId).success) return invalid();
      const call = calls(context);
      if (!large) return stored(await call(() => storage.read(manifestHash, versionId, context)), bytes, versionId);
      const parts = /^arch1:([a-f0-9]{64}):(.+)$/.exec(versionId);
      if (!parts || !version.safeParse(parts[2]).success) return invalid();
      const rootHash = parts[1]!; const rootVersion = parts[2]!;
      const response = await call(() => storage.read(rootHash, rootVersion, context));
      if (!response || response.versionId !== rootVersion || !Buffer.isBuffer(response.bytes) || response.bytes.length > physicalLimit || digest(response.bytes) !== rootHash) return invalid();
      const index = canonical(response.bytes, rootSchema);
      if (index.chunks.length !== chunks.length) return invalid();
      const rootBytes = Buffer.from(JSON.stringify(root(index.chunks.map(chunk => chunk.versionId))));
      if (!rootBytes.equals(response.bytes)) return invalid();
      const restored: Buffer[] = [];
      for (let position = 0; position < chunks.length; position++) {
        const descriptor = index.chunks[position]!; const chunk = chunks[position]!;
        const result = stored(await call(() => storage.read(descriptor.hash, descriptor.versionId, context)), chunk.bytes, descriptor.versionId);
        const decoded = canonical(result.bytes, chunkSchema);
        const raw = Buffer.from(decoded.bodyBase64, 'base64');
        if (raw.toString('base64') !== decoded.bodyBase64 || raw.length !== descriptor.byteLength) return invalid();
        restored.push(raw);
      }
      const reconstructed = Buffer.concat(restored);
      if (!reconstructed.equals(bytes)) return invalid();
      loadPartitionArchive(reconstructed, expected);
      return { bytes: reconstructed, versionId };
    },
  };
}
