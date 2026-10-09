import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, stat, access } from 'node:fs/promises';
import { dirname } from 'node:path';
import { partitionRecoveryStorage } from './partition-recovery.mjs';
import { MANIFEST_BUCKET } from './manifest.mjs';

const bytes = Buffer.from(JSON.stringify({ synthetic: true, recovery: 'fixture-only' }));
const hash = createHash('sha256').update(bytes).digest('hex');
function context(max = 64) {
  const controller = new globalThis.AbortController(); let count = 1;
  return { signal: controller.signal, controller, request() { if (++count > max) throw new Error('synthetic-request-limit'); }, get count() { return count; } };
}
function fixture() {
  let stored; let lose = false; let mutate = () => {}; const calls = []; const directories = new Set();
  const executor = async (command, argv, options) => {
    assert.equal(command, 'aws'); assert.ok(options.signal instanceof globalThis.AbortSignal);
    assert.equal(options.env.AWS_MAX_ATTEMPTS, '1'); assert.equal(options.env.AWS_CONFIG_FILE, '/dev/null');
    const streaming = argv[1] === 'get-object';
    const file = argv[argv.indexOf(streaming ? '--bucket' : '--cli-input-json') + 1].slice(7);
    directories.add(dirname(file));
    const input = streaming ? Object.fromEntries(await Promise.all(
      [['Bucket', '--bucket'], ['Key', '--key'], ['VersionId', '--version-id'], ['ExpectedBucketOwner', '--expected-bucket-owner']].map(async ([key, flag]) => {
        assert.ok(!argv.includes('--cli-input-json') && argv.includes(flag));
        const path = argv[argv.indexOf(flag) + 1]; assert.ok(path.startsWith('file://'));
        assert.equal((await stat(path.slice(7))).mode & 0o777, 0o600);
        const value = await readFile(path.slice(7), 'utf8'); assert.ok(!argv.includes(value)); return [key, value];
      }))) : JSON.parse(await readFile(file, 'utf8'));
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal(input.Bucket, MANIFEST_BUCKET); assert.equal(input.ExpectedBucketOwner, '092954139775');
    assert.equal(input.Key, `manifests/${hash}.json`);
    const op = argv[1]; calls.push({ op, input, options }); mutate(op);
    if (op === 'put-object') {
      assert.equal(input.IfNoneMatch, '*'); assert.equal(input.ServerSideEncryption, 'AES256');
      if (stored) throw { stderr: 'An error occurred (PreconditionFailed) when calling PutObject: private synthetic diagnostics' };
      const body = await readFile(argv[argv.indexOf('--body') + 1]);
      stored = { Body: body, VersionId: 'immutable-version-1' };
      if (lose) { lose = false; throw { stderr: 'private synthetic lost put response' }; }
      return { stdout: JSON.stringify({ VersionId: stored.VersionId }) };
    }
    if (op === 'head-object') return { stdout: JSON.stringify({ VersionId: stored.VersionId, ContentLength: stored.Body.length }) };
    assert.equal(op, 'get-object'); assert.equal(input.VersionId, stored.VersionId);
    await writeFile(argv.at(-1), stored.Body, { mode: 0o600 });
    return { stdout: JSON.stringify({ VersionId: stored.VersionId }) };
  };
  return { executor, calls, directories,
    get stored() { return stored; }, set stored(value) { stored = value; },
    set lose(value) { lose = value; }, set mutate(value) { mutate = value; } };
}
async function clean(storage) { for (const directory of storage.directories) await assert.rejects(access(directory)); }

test('reuses exact create-only encrypted/version-pinned recovery CLI and counts every actual request', async () => {
  const storage = fixture(); const bridge = partitionRecoveryStorage(storage.executor);
  assert.equal(storage.calls.length, 0); const ctx = context();
  const result = await bridge.preserve(bytes, hash, ctx);
  assert.deepEqual(result, { bytes, versionId: 'immutable-version-1' });
  assert.deepEqual(storage.calls.map(call => call.op), ['put-object', 'head-object', 'get-object']);
  assert.equal(ctx.count, 3); assert.ok(storage.calls.every(call => call.options.signal === ctx.signal));
  await clean(storage);
});

test('duplicate preservation and reconstructed bridge read the same immutable version without replacing bytes', async () => {
  const storage = fixture(); const first = await partitionRecoveryStorage(storage.executor).preserve(bytes, hash, context());
  const duplicate = await partitionRecoveryStorage(storage.executor).preserve(bytes, hash, context());
  assert.deepEqual(duplicate, first); assert.equal(storage.stored.VersionId, 'immutable-version-1');
  const ctx = context(); const result = await partitionRecoveryStorage(storage.executor).read(hash, first.versionId, ctx);
  assert.deepEqual(result, first); assert.equal(ctx.count, 2);
  assert.equal(storage.calls.at(-2).input.VersionId, first.versionId);
  await clean(storage);
});

test('lost create acknowledgement fails safely then duplicate recovery resumes original object', async () => {
  const storage = fixture(); storage.lose = true;
  const bridge = partitionRecoveryStorage(storage.executor);
  await assert.rejects(bridge.preserve(bytes, hash, context()), /^Error: OPS_MANIFEST_STORAGE_FAILED$/);
  assert.equal(storage.calls.length, 1); assert.deepEqual(storage.stored.Body, bytes);
  assert.deepEqual(await bridge.preserve(bytes, hash, context()), { bytes, versionId: 'immutable-version-1' });
  await clean(storage);
});

test('shared request exhaustion stops before a third subprocess and removes all private request files', async () => {
  const storage = fixture();
  await assert.rejects(partitionRecoveryStorage(storage.executor).preserve(bytes, hash, context(2)), /^Error: OPS_MANIFEST_STORAGE_FAILED$/);
  assert.deepEqual(storage.calls.map(call => call.op), ['put-object', 'head-object']);
  await clean(storage);
});

test('abort before execution or during a late HEAD cannot start a subsequent download and cleans private files', async () => {
  const storage = fixture(); const bridge = partitionRecoveryStorage(storage.executor); const ctx = context(); ctx.controller.abort();
  await assert.rejects(bridge.preserve(bytes, hash, ctx), /^Error: OPS_MANIFEST_STORAGE_FAILED$/);
  assert.equal(storage.calls.length, 0);
  storage.stored = { Body: bytes, VersionId: 'immutable-version-1' };
  const late = context(); storage.mutate = op => { if (op === 'head-object') late.controller.abort(); };
  await assert.rejects(bridge.read(hash, 'immutable-version-1', late), /^Error: OPS_MANIFEST_STORAGE_FAILED$/);
  assert.deepEqual(storage.calls.map(call => call.op), ['head-object']);
  await clean(storage);
});

test('rejects invalid hash/bytes/version/context without invoking AWS and refuses oversized HEAD before download', async () => {
  const storage = fixture(); const bridge = partitionRecoveryStorage(storage.executor);
  assert.throws(() => bridge.read(hash, 'null', context()), /^Error: OPS_MANIFEST_VERSION_REQUIRED$/);
  assert.throws(() => bridge.read(hash, 'version\ninvalid', context()), /^Error: OPS_MANIFEST_VERSION_REQUIRED$/);
  await assert.rejects(bridge.preserve(bytes, 'b'.repeat(64), context()), /^Error: OPS_MANIFEST_CONTENT_REJECTED$/);
  await assert.rejects(bridge.preserve(bytes, hash, {}), /^Error: OPS_IO_INVALID$/);
  assert.equal(storage.calls.length, 0);
  storage.stored = { Body: Buffer.alloc(1024 * 1024 + 1), VersionId: 'immutable-version-1' };
  await assert.rejects(bridge.read(hash, 'immutable-version-1', context()), /^Error: OPS_MANIFEST_STORAGE_FAILED$/);
  assert.deepEqual(storage.calls.map(call => call.op), ['head-object']); await clean(storage);
});
