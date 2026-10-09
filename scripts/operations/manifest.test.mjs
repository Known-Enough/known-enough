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

test('delayed upload preserves its original bytes after the caller changes its buffer', async () => {
  const original = Buffer.from('{"synthetic":true,"marker":"before"}');
  const supplied = Buffer.from(original); const expectedHash = contentHash(original); const calls = [];
  let entered, release, stored;
  const began = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const transport = async (op, input) => {
    calls.push(op);
    if (op === 'PutObject') {
      if (stored) throw Object.assign(new Error('duplicate'), { name: 'PreconditionFailed' });
      entered(); await gate;
      stored = { Body: Buffer.from(input.Body), VersionId: 'fixture-v1' };
    }
    return stored;
  };
  const store = manifestStore(transport, MANIFEST_BUCKET);
  const pending = store.preserve(supplied, expectedHash); await began;
  Buffer.from('{"synthetic":true,"marker":"after!"}').copy(supplied); release();
  const first = await pending;
  assert.deepEqual(stored.Body, original); assert.deepEqual(first.bytes, original);
  first.bytes.fill(0);
  const duplicate = await store.preserve(original, expectedHash);
  const restarted = await manifestStore(transport, MANIFEST_BUCKET).read(expectedHash, duplicate.versionId);
  assert.deepEqual(duplicate.bytes, original); assert.deepEqual(restarted.bytes, original);
  assert.equal(restarted.versionId, 'fixture-v1');
  assert.deepEqual(calls, ['PutObject', 'GetObject', 'PutObject', 'GetObject', 'GetObject']);
});

test('concurrent duplicate uploads keep one immutable version when both callers change buffers', async () => {
  const original = Buffer.from('{"synthetic":true,"marker":"before"}');
  const supplied = [Buffer.from(original), Buffer.from(original)]; const expectedHash = contentHash(original);
  let entered, release, stored, waiting = 0; const calls = [];
  const began = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const transport = async (op, input) => {
    calls.push(op);
    if (op === 'PutObject') {
      if (++waiting === 2) entered(); await gate;
      if (stored) throw Object.assign(new Error('duplicate'), { name: 'PreconditionFailed' });
      stored = { Body: Buffer.from(input.Body), VersionId: 'fixture-v1' };
    }
    return stored;
  };
  const pending = supplied.map(value => manifestStore(transport, MANIFEST_BUCKET).preserve(value, expectedHash));
  await began; supplied[0].fill(0); supplied[1].fill(1); release();
  const outcomes = await Promise.allSettled(pending);
  assert.ok(outcomes.every(value => value.status === 'fulfilled'));
  for (const value of outcomes) {
    assert.deepEqual(value.value.bytes, original); assert.equal(value.value.versionId, 'fixture-v1');
  }
  assert.deepEqual(stored.Body, original);
  assert.deepEqual(calls, ['PutObject', 'PutObject', 'GetObject', 'GetObject']);
});

test('recovery journal preparation uses the original manifest despite later caller mutation', async () => {
  const original = Buffer.from('{"synthetic":true,"marker":"before"}'); const supplied = Buffer.from(original);
  const envelope = { sourceSha: 'a'.repeat(40), operation: 'PARTITION',
    resourceArn: 'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughGroupsStage', contractHash: 'b'.repeat(64), maxItems: 10 };
  const plan = { schemaVersion: 1, sourceSha: envelope.sourceSha, account: '092954139775', region: 'us-east-1',
    operation: envelope.operation, resourceArn: envelope.resourceArn, contractHash: envelope.contractHash,
    expectedRevision: 3, maxItems: 10, recoveryManifestHash: contentHash(original) };
  let entered, release, stored, journal; const calls = [];
  const began = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const manifestTransport = async (op, input) => {
    calls.push(op);
    if (op === 'PutObject') {
      entered(); await gate; stored = { Body: Buffer.from(input.Body), VersionId: 'fixture-v1' };
    }
    return stored;
  };
  const journalStorage = {
    createIfAbsent: async (_key, value) => { calls.push('journal-create'); journal = structuredClone(value); return true; },
    read: async () => { calls.push('journal-read'); return structuredClone(journal); },
    compareAndSwap: async () => { throw new Error('unexpected progression'); }
  };
  const pending = prepareRecovery({ plan, envelope, manifestBytes: supplied, manifestTransport, bucket: MANIFEST_BUCKET, journalStorage });
  await began; supplied.fill(0); release(); const result = await pending;
  assert.deepEqual(stored.Body, original); assert.equal(result.state, 'PREPARED');
  assert.equal(result.operationExecution, 'NOT_EXECUTED');
  assert.deepEqual(calls, ['PutObject', 'GetObject', 'journal-create', 'journal-read']);
  assert.ok(!JSON.stringify(result).includes('marker'));
});

function withPrivateDecoder(original, behavior) {
  const supplied = Buffer.from(original); let hooks = 0;
  const decode = () => {
    hooks++;
    if (behavior === 'mutate') supplied.fill(0);
    if (behavior === 'throw') throw new Error('private decoder details');
    return original.toString('utf8');
  };
  if (behavior === 'getter') Object.defineProperty(supplied, 'toString', { get() { hooks++; throw new Error('private getter details'); } });
  else supplied.toString = decode;
  return { supplied, hooks: () => hooks };
}

for (const behavior of ['mutate', 'throw', 'getter']) {
  test(`preservation validates actual bytes without invoking a ${behavior} decoder hook`, async () => {
    const original = Buffer.from('{"synthetic":true,"marker":"before"}');
    const input = withPrivateDecoder(original, behavior); const expectedHash = contentHash(original);
    let stored; const calls = [];
    const transport = async (op, args) => {
      calls.push(op);
      if (op === 'PutObject') {
        assert.notEqual(args.Body, input.supplied);
        assert.equal(Object.hasOwn(args.Body, 'toString'), false);
        if (stored) throw Object.assign(new Error('duplicate'), { name: 'PreconditionFailed' });
        stored = { Body: Buffer.from(args.Body), VersionId: 'fixture-v1' };
      }
      return stored;
    };
    const store = manifestStore(transport, MANIFEST_BUCKET);
    const first = await store.preserve(input.supplied, expectedHash);
    assert.equal(input.hooks(), 0); assert.deepEqual(stored.Body, original);
    assert.deepEqual(first.bytes, original); assert.equal(contentHash(first.bytes), expectedHash);
    first.bytes.fill(0);
    const duplicate = await store.preserve(original, expectedHash);
    const restarted = await manifestStore(transport, MANIFEST_BUCKET).read(expectedHash, 'fixture-v1');
    assert.deepEqual(duplicate.bytes, original); assert.deepEqual(restarted.bytes, original);
    assert.deepEqual(calls, ['PutObject', 'GetObject', 'PutObject', 'GetObject', 'GetObject']);
  });
  test(`read validates actual bytes without invoking a ${behavior} decoder hook`, async () => {
    const original = Buffer.from('{"synthetic":true,"marker":"before"}');
    const input = withPrivateDecoder(original, behavior); const calls = [];
    const store = manifestStore(async (op, args) => {
      calls.push({ op, args }); return { Body: input.supplied, VersionId: 'fixture-v1' };
    }, MANIFEST_BUCKET);
    const result = await store.read(contentHash(original), 'fixture-v1');
    assert.equal(input.hooks(), 0); assert.deepEqual(result.bytes, original);
    assert.equal(contentHash(result.bytes), contentHash(original));
    result.bytes.fill(0); assert.deepEqual(Buffer.from(input.supplied), original);
    assert.equal(calls.length, 1); assert.equal(calls[0].op, 'GetObject');
    assert.equal(calls[0].args.VersionId, 'fixture-v1');
  });
}

for (const path of ['preserve', 'read']) {
  test(`a forged JSON decoder cannot admit invalid physical JSON through ${path}`, async () => {
    const input = Buffer.from('{"synthetic":'); const expectedHash = contentHash(input);
    let hooks = 0; input.toString = () => { hooks++; return '{"synthetic":true}'; };
    const calls = []; let stored;
    const store = manifestStore(async (op, args) => {
      calls.push(op);
      if (op === 'PutObject') stored = { Body: Buffer.from(args.Body), VersionId: 'fixture-v1' };
      return stored ?? { Body: input, VersionId: 'fixture-v1' };
    }, MANIFEST_BUCKET);
    await assert.rejects(path === 'preserve' ? store.preserve(input, expectedHash) : store.read(expectedHash, 'fixture-v1'),
      /^Error: OPS_MANIFEST_CONTENT_REJECTED$/);
    assert.equal(hooks, 0); assert.deepEqual(calls, path === 'preserve' ? [] : ['GetObject']);
  });
}

function recoveryFixture(input) {
  const envelope = { sourceSha: 'a'.repeat(40), operation: 'PARTITION',
    resourceArn: 'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughGroupsStage', contractHash: 'b'.repeat(64), maxItems: 10 };
  const plan = { schemaVersion: 1, sourceSha: envelope.sourceSha, account: '092954139775', region: 'us-east-1',
    operation: envelope.operation, resourceArn: envelope.resourceArn, contractHash: envelope.contractHash,
    expectedRevision: 3, maxItems: 10, recoveryManifestHash: contentHash(input) };
  return { plan, envelope };
}

test('forged JSON validation cannot upload recovery or prepare its journal', async () => {
  const input = Buffer.from('{"synthetic":'); let hooks = 0;
  input.toString = () => { hooks++; return '{"synthetic":true}'; };
  let stored, journal; const calls = [];
  const manifestTransport = async (op, args) => {
    calls.push(op); if (op === 'PutObject') stored = { Body: Buffer.from(args.Body), VersionId: 'fixture-v1' };
    return stored;
  };
  const journalStorage = {
    createIfAbsent: async (_key, value) => { calls.push('journal-create'); journal = structuredClone(value); return true; },
    read: async () => { calls.push('journal-read'); return structuredClone(journal); },
    compareAndSwap: async () => { throw new Error('unexpected progression'); }
  };
  await assert.rejects(prepareRecovery({ ...recoveryFixture(input), manifestBytes: input, manifestTransport,
    bucket: MANIFEST_BUCKET, journalStorage }), /^Error: OPS_MANIFEST_CONTENT_REJECTED$/);
  assert.equal(hooks, 0); assert.deepEqual(calls, []);
});

test('recovery validates owned manifest bytes before any decoder hook or journal write', async () => {
  const original = Buffer.from('{"synthetic":true,"marker":"before"}');
  const input = withPrivateDecoder(original, 'mutate'); let stored, journal; const calls = [];
  const manifestTransport = async (op, args) => {
    calls.push(op); if (op === 'PutObject') stored = { Body: Buffer.from(args.Body), VersionId: 'fixture-v1' };
    return stored;
  };
  const journalStorage = {
    createIfAbsent: async (_key, value) => { calls.push('journal-create'); journal = structuredClone(value); return true; },
    read: async () => { calls.push('journal-read'); return structuredClone(journal); },
    compareAndSwap: async () => { throw new Error('unexpected progression'); }
  };
  const result = await prepareRecovery({ ...recoveryFixture(original), manifestBytes: input.supplied, manifestTransport,
    bucket: MANIFEST_BUCKET, journalStorage });
  assert.equal(input.hooks(), 0); assert.deepEqual(stored.Body, original);
  assert.equal(contentHash(stored.Body), contentHash(original));
  assert.equal(result.state, 'PREPARED'); assert.equal(result.operationExecution, 'NOT_EXECUTED');
  assert.ok(!JSON.stringify(result).includes('marker'));
  assert.deepEqual(calls, ['PutObject', 'GetObject', 'journal-create', 'journal-read']);
});
