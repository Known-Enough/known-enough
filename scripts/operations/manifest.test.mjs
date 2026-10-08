import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { manifestStore, MANIFEST_BUCKET } from './manifest.mjs';
import { prepareRecovery } from './recovery.mjs';
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

const malformedSequences = {
  continuation: [0xc3, 0x28], overlong: [0xc0, 0xaf], surrogate: [0xed, 0xa0, 0x80],
  truncated: [0xe2, 0x82], outOfRange: [0xf4, 0x90, 0x80, 0x80]
};
const contentHash = value => createHash('sha256').update(value).digest('hex');
const malformedBytes = sequence => Buffer.concat([Buffer.from('{"synthetic":"'), Buffer.from(sequence), Buffer.from('"}')]);
for (const [name, sequence] of Object.entries(malformedSequences)) {
  test(`hash-matching malformed UTF-8 ${name} is rejected before preservation`, async () => {
    const inputBytes = malformedBytes(sequence); const calls = []; let stored;
    const store = manifestStore(async (op, input) => {
      calls.push(op);
      if (op === 'PutObject') stored = { Body: Buffer.from(input.Body), VersionId: 'fixture-v1' };
      return stored;
    }, MANIFEST_BUCKET);
    await assert.rejects(store.preserve(inputBytes, contentHash(inputBytes)), /^Error: OPS_MANIFEST_CONTENT_REJECTED$/);
    assert.deepEqual(calls, []);
  });
  test(`hash-matching malformed UTF-8 ${name} cannot be recovered from an exact version`, async () => {
    const inputBytes = malformedBytes(sequence); const calls = [];
    const store = manifestStore(async (op, input) => {
      calls.push({ op, input }); return { Body: inputBytes, VersionId: 'fixture-v1' };
    }, MANIFEST_BUCKET);
    await assert.rejects(store.read(contentHash(inputBytes), 'fixture-v1'), /^Error: OPS_MANIFEST_CONTENT_REJECTED$/);
    assert.equal(calls.length, 1); assert.equal(calls[0].op, 'GetObject');
    assert.equal(calls[0].input.VersionId, 'fixture-v1');
  });
}
test('malformed manifest encoding cannot upload recovery or prepare a journal', async () => {
  const envelope = { sourceSha: 'a'.repeat(40), operation: 'PARTITION',
    resourceArn: 'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughGroupsStage', contractHash: 'b'.repeat(64), maxItems: 10 };
  for (const sequence of Object.values(malformedSequences)) {
    const inputBytes = malformedBytes(sequence); const calls = []; let stored; let journal;
    const plan = { schemaVersion: 1, sourceSha: envelope.sourceSha, account: '092954139775', region: 'us-east-1',
      operation: envelope.operation, resourceArn: envelope.resourceArn, contractHash: envelope.contractHash,
      expectedRevision: 3, maxItems: 10, recoveryManifestHash: contentHash(inputBytes) };
    const manifestTransport = async (op, input) => {
      calls.push(op);
      if (op === 'PutObject') stored = { Body: Buffer.from(input.Body), VersionId: 'fixture-v1' };
      return stored;
    };
    const journalStorage = { read: async () => { calls.push('journal-read'); return journal; },
      createIfAbsent: async (_key, value) => { calls.push('journal-create'); journal = value; return true; },
      compareAndSwap: async () => { calls.push('journal-write'); return true; } };
    await assert.rejects(prepareRecovery({ plan, envelope, manifestBytes: inputBytes, manifestTransport,
      bucket: MANIFEST_BUCKET, journalStorage }), /^Error: OPS_MANIFEST_CONTENT_REJECTED$/);
    assert.deepEqual(calls, []);
  }
});
for (const [name, inputBytes] of Object.entries({
  unicode: Buffer.from(JSON.stringify({ synthetic: true, note: 'ñ東京😀' })),
  replacement: Buffer.from(JSON.stringify({ synthetic: true, note: '\uFFFD' })),
  combining: Buffer.from(' { "synthetic": true, "note": "n\u0303" }\n')
})) {
  test(`valid UTF-8 ${name} preserves exact bytes across duplicate and restart`, async () => {
    const expectedHash = contentHash(inputBytes); const calls = []; let stored;
    const transport = async (op, input) => {
      calls.push(op);
      if (op === 'PutObject') {
        if (stored) throw Object.assign(new Error('duplicate'), { name: 'PreconditionFailed' });
        stored = { Body: Buffer.from(input.Body), VersionId: 'fixture-v1' };
      }
      return stored;
    };
    const store = manifestStore(transport, MANIFEST_BUCKET);
    const first = await store.preserve(inputBytes, expectedHash); const duplicate = await store.preserve(inputBytes, expectedHash);
    const restarted = await manifestStore(transport, MANIFEST_BUCKET).read(expectedHash, first.versionId);
    for (const value of [first, duplicate, restarted]) {
      assert.deepEqual(value.bytes, inputBytes); assert.equal(contentHash(value.bytes), expectedHash);
      assert.equal(value.versionId, 'fixture-v1');
    }
    assert.deepEqual(calls, ['PutObject', 'GetObject', 'PutObject', 'GetObject', 'GetObject']);
  });
}
test('valid UTF-8 still requires JSON syntax before any upload', async () => {
  for (const value of ['{"synthetic":', '{"synthetic":"\n"}', '{"synthetic":NaN}']) {
    const inputBytes = Buffer.from(value); let calls = 0;
    const store = manifestStore(async () => { calls++; }, MANIFEST_BUCKET);
    await assert.rejects(store.preserve(inputBytes, contentHash(inputBytes)), /^Error: OPS_MANIFEST_CONTENT_REJECTED$/);
    assert.equal(calls, 0);
  }
});
test('UTF-8 validation does not silently strip a JSON byte-order mark', async () => {
  const inputBytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]); let calls = 0;
  const store = manifestStore(async () => { calls++; }, MANIFEST_BUCKET);
  await assert.rejects(store.preserve(inputBytes, contentHash(inputBytes)), /^Error: OPS_MANIFEST_CONTENT_REJECTED$/);
  assert.equal(calls, 0);
});
