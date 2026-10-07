import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { manifestStore, MANIFEST_BUCKET } from './manifest.mjs';
const bytes = Buffer.from(JSON.stringify({ synthetic: true, recoveryRows: ['fixture-only'] }));
const hash = createHash('sha256').update(bytes).digest('hex');
test('preservation is create-only, exact-version readback and duplicate returns original bytes', async () => {
  let stored; const calls = [];
  const store = manifestStore(async (op, input) => {
    calls.push({ op, input });
    if (op === 'PutObject') {
      if (stored) throw Object.assign(new Error('private'), { name: 'PreconditionFailed' });
      stored = { Body: Buffer.from(input.Body), VersionId: 'fixture-v1' }; return { VersionId: stored.VersionId };
    }
    return stored;
  }, MANIFEST_BUCKET);
  const first = await store.preserve(bytes, hash); const duplicate = await store.preserve(bytes, hash);
  assert.equal(first.versionId, duplicate.versionId); assert.deepEqual(duplicate.bytes, bytes);
  assert.equal(calls[0].input.IfNoneMatch, '*'); assert.equal(calls[1].input.VersionId, 'fixture-v1');
  const restarted = manifestStore(async () => stored, MANIFEST_BUCKET);
  assert.deepEqual((await restarted.read(hash, first.versionId)).bytes, bytes);
});
test('reject missing versioning, altered content, wrong version and oversize before write', async () => {
  for (const response of [{ Body: bytes, VersionId: 'null' }, { Body: Buffer.from('private invalid'), VersionId: 'v1' }, { Body: bytes, VersionId: 'other' }]) {
    await assert.rejects(manifestStore(async () => response, MANIFEST_BUCKET).read(hash, 'v1'));
  }
  let calls = 0; const store = manifestStore(async () => { calls++; }, MANIFEST_BUCKET);
  await assert.rejects(store.preserve(Buffer.alloc(1024 * 1024 + 1), hash));
  await assert.rejects(store.preserve(bytes, 'b'.repeat(64)));
  assert.equal(calls, 0);
  assert.throws(() => manifestStore(async () => ({}), 'unrelated-bucket'));
});
test('storage denial never becomes overwrite or successful recovery', async () => {
  const calls = []; const store = manifestStore(async (op) => { calls.push(op); throw Object.assign(new Error('private data'), { name: 'AccessDenied' }); }, MANIFEST_BUCKET);
  await assert.rejects(store.preserve(bytes, hash), /^Error: OPS_MANIFEST_STORAGE_FAILED$/);
  assert.deepEqual(calls, ['PutObject']);
});
