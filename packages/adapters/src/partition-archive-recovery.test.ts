import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { Groups, KnownEnough as KE } from '@deal-table/contracts';
import { partitionSeedRows } from './partitioned-group-repository.ts';
import { partitionDirectoryKey, type PartitionDirectoryClaim } from './partition-directory.ts';
import { preparePartitionArchive, type ArchiveEntry, type PartitionArchivePorts } from './partition-archive.ts';
import { createChunkedArchiveRecovery } from './partition-archive-recovery.ts';
import { migrationIO, migrationCall } from './partition-migration-runner.ts';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const sourceSha = 'a'.repeat(40); const subject = 'iris';
function snapshot(count = 2, large = false) {
  const account: Groups.Account = { subject, emailHash: hash(subject), displayName: 'Iris', status: 'APPROVED', version: 4 };
  const drafts: Groups.GroupDraft[] = Array.from({ length: count }, (_, index) => ({ id: `draft-${index}`, bodyHash: hash(String(index)),
    revision: 2, groupVersion: 3, createdDecisionId: index === 0 ? 'decision-0' : null,
    frame: KE.PublicDecisionFrame.parse({ schemaVersion: 2, decisionId: `draft-${index}`, frameVersion: 1, semanticVersion: 1,
      contextToken: 'c'.repeat(64), title: 'Garden gathering', objective: 'x'.repeat(2000), description: 'x'.repeat(4000),
      participants: [{ id: subject, displayName: 'Iris', requiredForApproval: true }], requiredParticipantIds: [subject],
      variables: large ? Array.from({ length: 8 }, (_, n) => ({ id: `var-${n}`, label: 'Choice', required: true, visibility: 'PUBLIC', type: 'ENUM',
        options: Array.from({ length: 64 }, (_, m) => ({ id: `option-${m}`, label: 'z'.repeat(100) })) })) : [], rules: [] }),
    clarificationQuestions: Array.from({ length: 12 }, () => 'q'.repeat(500)) }));
  const group: Groups.Group = { id: 'garden', name: 'Garden', organizer: subject, version: 3, members: [subject], drafts,
    decisions: [{ id: 'decision-0', version: 2 }], invitations: [{ tokenHash: hash('old-invitation'), recipientHash: hash('recipient'), expiresAt: 1, acceptedBy: null }] };
  const seed = partitionSeedRows({ accounts: [account], groups: [group] }, { accountSubjects: [subject], groupId: group.id });
  const actor = seed.find(row => row.next?.kind === 'ACCOUNT')!.next!;
  const entries: ArchiveEntry[] = seed.filter(row => row.next?.kind !== 'ACCOUNT').map(row => ({ key: row.key, row: row.next! }));
  const claims: PartitionDirectoryClaim[] = [{ type: 'DECISION', decisionId: 'decision-0', groupId: group.id },
    { type: 'INVITATION', tokenHash: group.invitations[0]!.tokenHash, recipientHash: group.invitations[0]!.recipientHash, expiresAt: 1, groupId: group.id }];
  for (const value of claims) entries.push({ key: partitionDirectoryKey(value), row: { schemaVersion: 1, revision: 1, kind: 'DIRECTORY', value } });
  return { entries, actor, group };
}

function expectRecovery(actual: { bytes: Buffer; versionId: string }, expected: { bytes: Buffer; versionId: string }) {
  expect(actual.versionId).toBe(expected.versionId); expect(actual.bytes.equals(expected.bytes)).toBe(true);
}

function fixture(count = 24, large = true) {
  const source = snapshot(count, large);
  source.group.drafts[0]!.frame.description = '🌿'.repeat(1000);
  // The validated seed rows are independent copies; keep the UTF8 fact in the actual source entry too.
  const draft = source.entries.find(entry => entry.row.kind === 'DRAFT')!;
  if (draft.row.kind === 'DRAFT') draft.row.value.frame.description = '🌿'.repeat(1000);
  const plan = preparePartitionArchive(source.entries, 'garden', sourceSha);
  const expected = { sourceSha, groupId: 'garden', sourceHeaderRevision: plan.header.revision,
    sourceHash: plan.sourceHash, manifestHash: plan.manifestHash };
  const objects = new Map<string, { bytes: Buffer; versionId: string }>();
  let lostAt = -1; let override: ((hash: string, value: { bytes: Buffer; versionId: string }) => void) | null = null;
  const storage: PartitionArchivePorts['recovery'] = {
    preserve: vi.fn(async (bytes, digest, io) => {
      io.request(); io.request();
      expect(bytes.length).toBeLessThanOrEqual(1024 * 1024); expect(hash(bytes.toString())).toBe(digest);
      const prior = objects.get(digest);
      if (prior) expect(prior.bytes.equals(bytes)).toBe(true);
      const value = prior ?? { bytes: Buffer.from(bytes), versionId: `immutable-${objects.size + 1}` };
      objects.set(digest, value);
      if (objects.size === lostAt) { lostAt = -1; throw new Error('synthetic lost preservation response'); }
      return { bytes: Buffer.from(value.bytes), versionId: value.versionId };
    }),
    read: vi.fn(async (digest, version, io) => {
      io.request(); const saved = objects.get(digest);
      if (!saved) throw new Error('synthetic missing recovery');
      const value = { bytes: Buffer.from(saved.bytes), versionId: saved.versionId };
      override?.(digest, value); expect(version).toBeDefined(); return value;
    }),
  };
  const port = () => createChunkedArchiveRecovery(storage, plan.manifestBytes, expected);
  const save = (maximum = 64) => { const io = migrationIO({ maxRequests: maximum });
    return migrationCall(io, () => port().preserve(plan.manifestBytes, plan.manifestHash, io)); };
  const read = (version: string, maximum = 64) => { const io = migrationIO({ maxRequests: maximum });
    return migrationCall(io, () => port().read(plan.manifestHash, version, io)); };
  return { source, plan, expected, storage, objects, port, save, read,
    lose: (index: number) => { lostAt = index; }, mutate: (fn: NonNullable<typeof override>) => { override = fn; } };
}

it('preserves >1MiB UTF8 group recovery as exact create-only chunks and a pinned canonical root then reconstructs all bytes', async () => {
  const data = fixture(); expect(data.plan.manifestBytes.length).toBeGreaterThan(1024 * 1024);
  const saved = await data.save(); expect(saved.versionId).toMatch(/^arch1:[a-f0-9]{64}:immutable-/);
  expect(saved.bytes.equals(data.plan.manifestBytes)).toBe(true); expect(data.objects.size).toBeGreaterThan(2);
  const rootHash = saved.versionId.slice(6, 70); const index = JSON.parse(data.objects.get(rootHash)!.bytes.toString());
  expect(index.kind).toBe('GROUP_ARCHIVE_CHUNKS'); expect(index.chunks.length).toBeLessThanOrEqual(8);
  expect(index.chunks.reduce((sum: number, chunk: { byteLength: number }) => sum + chunk.byteLength, 0)).toBe(data.plan.manifestBytes.length);
  expectRecovery(await data.read(saved.versionId), saved);
  for (const object of data.objects.values()) expect(object.bytes.length).toBeLessThan(1024 * 1024);
  expect(index).not.toHaveProperty('accounts');
});

it('keeps <=1MiB recovery bytes/hash/version compatible with the existing direct storage port', async () => {
  const data = fixture(2, false); const saved = await data.save(); expect(data.objects.size).toBe(1);
  expect(saved.versionId).toBe('immutable-1'); expect(data.objects.get(data.plan.manifestHash)!.bytes.equals(data.plan.manifestBytes)).toBe(true);
  expectRecovery(await data.read(saved.versionId), saved);
});

it('reconstructs after partial/lost chunk or root acknowledgements without replacing any saved object/version', async () => {
  for (const at of [2, 4]) {
    const data = fixture(); data.lose(at); await expect(data.save()).rejects.toThrow('MIGRATION_STORAGE_UNAVAILABLE');
    const prior = new Map([...data.objects].map(([hash, value]) => [hash, { bytes: Buffer.from(value.bytes), versionId: value.versionId }])); const saved = await data.save();
    for (const [hash, value] of prior) expectRecovery(data.objects.get(hash)!, value);
    expectRecovery(await data.read(saved.versionId), saved);
  }
});

it('concurrent preservation returns the original immutable chunk versions and one canonical root', async () => {
  const data = fixture(); const saved = await Promise.all([data.save(), data.save()]); expectRecovery(saved[0]!, saved[1]!);
  expectRecovery(await data.read(saved[0]!.versionId), saved[0]!);
});

it('rejects changed physical bytes or versions and a missing chunk before returning a logical snapshot', async () => {
  for (const defect of ['bytes', 'version', 'missing']) {
    const data = fixture(); const saved = await data.save();
    if (defect === 'missing') data.objects.delete(data.objects.keys().next().value!);
    else data.mutate((_, value) => { if (defect === 'bytes') value.bytes[0] = 0; else value.versionId = 'wrong-version'; });
    await expect(data.read(saved.versionId)).rejects.toThrow('MIGRATION_STORAGE_UNAVAILABLE');
  }
});

it('rejects independently rehashed root source/order/length/versions/schema/extra fields with fixed recovery errors', async () => {
  for (const defect of ['source', 'order', 'length', 'versions', 'schema', 'extra', 'uncanonical', 'missing']) {
    const data = fixture(); const saved = await data.save(); const original = data.objects.get(saved.versionId.slice(6, 70))!;
    const root = JSON.parse(original.bytes.toString());
    if (defect === 'source') root.sourceSha = 'b'.repeat(40);
    if (defect === 'order') root.chunks.reverse();
    if (defect === 'length') root.byteLength++;
    if (defect === 'versions') root.chunks[0].versionId = 'foreign-version';
    if (defect === 'schema') root.schemaVersion = 2;
    if (defect === 'extra') root.privateGrant = 'synthetic';
    if (defect === 'missing') root.chunks.pop();
    const bytes = Buffer.from((defect === 'uncanonical' ? ' ' : '') + JSON.stringify(root)); const rootHash = hash(bytes.toString());
    data.objects.set(rootHash, { bytes, versionId: original.versionId });
    await expect(data.read(`arch1:${rootHash}:${original.versionId}`)).rejects.toThrow('MIGRATION_STORAGE_UNAVAILABLE');
  }
});

it('rejects changed logical input/hash/binding and malformed composite versions without any physical I/O', async () => {
  const data = fixture(); const io = migrationIO({});
  await expect(data.port().preserve(Buffer.from('{}'), data.plan.manifestHash, io)).rejects.toThrow('ARCHIVE_RECOVERY_INVALID');
  await expect(data.port().preserve(data.plan.manifestBytes, 'b'.repeat(64), io)).rejects.toThrow('ARCHIVE_RECOVERY_INVALID');
  for (const version of ['null', 'ordinary-version', 'arch1:bad:version', `arch1:${'a'.repeat(64)}:version\n`]) {
    await expect(data.port().read(data.plan.manifestHash, version, io)).rejects.toThrow('ARCHIVE_RECOVERY_INVALID');
  }
  expect(() => createChunkedArchiveRecovery(data.storage, data.plan.manifestBytes, { ...data.expected, groupId: 'other' })).toThrow('ARCHIVE_SOURCE_CHANGED');
  expect(data.storage.preserve).not.toHaveBeenCalled(); expect(data.storage.read).not.toHaveBeenCalled();
});

it('charges all physical chunk/root reads and creates to one bounded request context', async () => {
  const data = fixture(); await expect(data.save(5)).rejects.toThrow('MIGRATION_REQUEST_LIMIT'); expect(data.objects.size).toBe(1);
  const saved = await data.save(); await expect(data.read(saved.versionId, 3)).rejects.toThrow('MIGRATION_REQUEST_LIMIT');
  expectRecovery(await data.read(saved.versionId), saved);
});

it('rejects a root version too long for existing archive journal metadata instead of widening the bound', async () => {
  const data = fixture(); const original = data.storage.preserve;
  data.storage.preserve = async (bytes, hash, io) => {
    const value = await original(bytes, hash, io);
    return JSON.parse(bytes.toString()).kind === 'GROUP_ARCHIVE_CHUNKS' ? { ...value, versionId: 'v'.repeat(1024) } : value;
  };
  await expect(data.save()).rejects.toThrow('MIGRATION_STORAGE_UNAVAILABLE');
});

it('a deadline bounds a held physical read and prevents late subsequent chunk calls', async () => {
  const data = fixture(); const saved = await data.save(); let release: ((value: { bytes: Buffer; versionId: string }) => void) | undefined;
  const original = data.storage.read; data.storage.read = vi.fn(async (hash, version, io) => {
    const value = await original(hash, version, io); return new Promise<{ bytes: Buffer; versionId: string }>(resolve => { release = () => resolve(value); });
  });
  const io = migrationIO({ timeoutMs: 20 }); await expect(migrationCall(io, () => data.port().read(data.plan.manifestHash, saved.versionId, io))).rejects.toThrow('MIGRATION_TIMEOUT');
  release?.({ bytes: Buffer.alloc(0), versionId: 'ignored' }); await new Promise(resolve => setTimeout(resolve, 10));
  expect(data.storage.read).toHaveBeenCalledTimes(1);
});

it('preserves and independently reconstructs all eight physical chunks within the existing 64-request bound', async () => {
  const data = fixture(64, true); expect(data.plan.manifestBytes.length).toBeGreaterThan(7 * 700 * 1024);
  expect(data.plan.manifestBytes.length).toBeLessThanOrEqual(5 * 1024 * 1024);
  const io = migrationIO({ maxRequests: 64 }); const port = data.port();
  const saved = await migrationCall(io, () => port.preserve(data.plan.manifestBytes, data.plan.manifestHash, io));
  expect(data.objects.size).toBe(9);
  expectRecovery(await migrationCall(io, () => port.read(data.plan.manifestHash, saved.versionId, io)), saved);
  expect(data.storage.preserve).toHaveBeenCalledTimes(9); expect(data.storage.read).toHaveBeenCalledTimes(9);
});
