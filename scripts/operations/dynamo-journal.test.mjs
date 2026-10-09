import { test } from 'node:test';
import assert from 'node:assert/strict';
import { journalService } from './journal.mjs';
import { dynamoJournal } from './dynamo-journal.mjs';
const arn = 'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughOperationsJournal';
const hash = 'a'.repeat(64); const record = { revision: 0, journal: { planHash: hash } };
test('exact target, consistent reads, exclusive create and conditional revision write', async () => {
  const calls = []; let item;
  const port = dynamoJournal(async (operation, input) => { calls.push({ operation, input }); if (operation === 'PutItem') item = input.Item; return { Item: item }; }, arn);
  await port.createIfAbsent(hash, record);
  assert.equal(calls[0].input.ConditionExpression, 'attribute_not_exists(PK)');
  assert.deepEqual(await port.read(hash), record);
  assert.equal(calls[1].input.ConsistentRead, true);
  await port.compareAndSwap(hash, 0, { ...record, revision: 1 });
  assert.equal(calls[2].input.ConditionExpression, 'revision = :expected');
  assert.deepEqual(calls[2].input.ExpressionAttributeValues, { ':expected': { N: '0' } });
  assert.equal(calls[2].input.TableName, 'KnownEnoughOperationsJournal');
});
test('conditional conflict is false; unknown storage errors sanitized', async () => {
  const conflict = dynamoJournal(async () => { throw Object.assign(new Error('private'), { name: 'ConditionalCheckFailedException' }); }, arn);
  assert.equal(await conflict.createIfAbsent(hash, record), false);
  const denied = dynamoJournal(async () => { throw new Error('private provider payload'); }, arn);
  await assert.rejects(denied.read(hash), /^Error: OPS_JOURNAL_STORAGE_FAILED$/);
});
test('reject unrelated target, malformed key/record and revision skip', async () => {
  assert.throws(() => dynamoJournal(async () => ({}), '*'));
  const port = dynamoJournal(async () => ({ Item: { PK: { S: 'wrong' } } }), arn);
  await assert.rejects(port.read(hash), /OPS_JOURNAL_RECORD_REJECTED/);
  assert.throws(() => port.compareAndSwap(hash, 0, { ...record, revision: 2 }), /OPS_JOURNAL_REVISION_REJECTED/);
  await assert.rejects(port.createIfAbsent('bad', record));
});

test('journal service resumes through conditional Dynamo transport and rejects a competing write', async () => {
  let stored;
  const port = dynamoJournal(async (operation, input) => {
    if (operation === 'GetItem') return { Item: structuredClone(stored) };
    const expected = input.ExpressionAttributeValues?.[':expected'].N;
    if ((input.ConditionExpression === 'attribute_not_exists(PK)' && stored)
      || (expected !== undefined && stored?.revision.N !== expected)) {
      throw Object.assign(new Error('conditional conflict'), { name: 'ConditionalCheckFailedException' });
    }
    stored = structuredClone(input.Item); return {};
  }, arn);
  const envelope = { sourceSha: 'a'.repeat(40), operation: 'PARTITION', resourceArn: 'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughGroupsStage', contractHash: 'b'.repeat(64), maxItems: 10 };
  const plan = { schemaVersion: 1, sourceSha: envelope.sourceSha, account: '092954139775', region: 'us-east-1', operation: envelope.operation, resourceArn: envelope.resourceArn, contractHash: envelope.contractHash, expectedRevision: 3, maxItems: 10, recoveryManifestHash: 'c'.repeat(64) };
  const service = journalService(port); const initial = await service.prepare(plan, envelope);
  const results = await Promise.allSettled([1, 2].map(completedItems => service.advance(plan, envelope, 0, { ...initial.journal, completedItems, state: 'APPLYING' })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const resumed = await journalService(port).prepare(plan, envelope);
  assert.equal(resumed.revision, 1);
  assert.ok(resumed.journal.completedItems > 0);
});

function encodedItem(revision = '0') {
  return { PK: { S: `PLAN#${hash}` }, SK: { S: 'JOURNAL' }, revision: { N: revision },
    journal: { S: JSON.stringify(record.journal) } };
}
function readPort(response) {
  const calls = [];
  const port = dynamoJournal(async (operation, input) => { calls.push({ operation, input }); return response; }, arn);
  return { port, calls };
}
for (const [name, response] of Object.entries({ undefined: undefined, null: null, false: false,
  zero: 0, empty: '', array: [], number: 123, string: 'private provider payload' })) {
  test(`malformed GetItem response ${name} is rejected rather than absence`, async () => {
    const { port, calls } = readPort(response);
    await assert.rejects(port.read(hash), /^Error: OPS_JOURNAL_RECORD_REJECTED$/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].operation, 'GetItem');
    assert.equal(calls[0].input.ConsistentRead, true);
  });
}
for (const [name, item] of Object.entries({ null: null, false: false, zero: 0, empty: '', array: [],
  string: 'private journal payload' })) {
  test(`present malformed journal item ${name} is not a missing record`, async () => {
    const { port, calls } = readPort({ Item: item });
    await assert.rejects(port.read(hash), /^Error: OPS_JOURNAL_RECORD_REJECTED$/);
    assert.equal(calls.length, 1);
  });
}
for (const name of ['zero', 'one', 'array', 'boxed', 'null', 'undefined', 'true', 'toString', 'toPrimitive']) {
  test(`revision attribute ${name} is rejected without coercion or mutation`, async () => {
    let conversions = 0;
    const values = { zero: 0, one: 1, array: ['0'], boxed: new String('0'), null: null,
      undefined: undefined, true: true, toString: { toString() { conversions++; return '0'; } },
      toPrimitive: { [Symbol.toPrimitive]() { conversions++; return '0'; } } };
    const item = encodedItem(); item.revision.N = values[name];
    const { port, calls } = readPort({ Item: item });
    await assert.rejects(port.read(hash), /^Error: OPS_JOURNAL_RECORD_REJECTED$/);
    assert.equal(calls.length, 1);
    assert.equal(conversions, 0);
  });
}
test('only a missing Item on a valid response establishes journal absence', async () => {
  for (const response of [{}, { Item: undefined, $metadata: { httpStatusCode: 200 } }]) {
    const { port, calls } = readPort(response);
    assert.equal(await port.read(hash), null);
    assert.equal(calls.length, 1);
  }
});
test('canonical revision strings retain zero and the maximum safe revision', async () => {
  for (const revision of [0, 1, Number.MAX_SAFE_INTEGER]) {
    const { port, calls } = readPort({ Item: encodedItem(String(revision)) });
    assert.deepEqual(await port.read(hash), { ...record, revision });
    assert.equal(calls.length, 1);
  }
});
test('invalid numeric strings and unsafe revisions remain rejected', async () => {
  for (const revision of ['00', '-1', '1.0', '1e0', '0 ', 'NaN', 'Infinity', '9007199254740992']) {
    const { port, calls } = readPort({ Item: encodedItem(revision) });
    await assert.rejects(port.read(hash), /^Error: OPS_JOURNAL_RECORD_REJECTED$/);
    assert.equal(calls.length, 1);
  }
});
test('a malformed response accessor cannot expose its private exception', async () => {
  const response = { get Item() { throw new Error('private response payload'); } };
  const { port, calls } = readPort(response);
  await assert.rejects(port.read(hash), /^Error: OPS_JOURNAL_RECORD_REJECTED$/);
  assert.equal(calls.length, 1);
});

for (const method of ['createIfAbsent', 'compareAndSwap']) {
  test(`${method} captures record getters once before validating and serializing`, async () => {
    const counts = { revision: 0, journal: 0, planHash: 0 }; const calls = [];
    const journal = { get planHash() { return ++counts.planHash === 1 ? hash : 'b'.repeat(64); }, state: 'APPLYING' };
    const input = { get revision() { return ++counts.revision === 1 ? (method === 'compareAndSwap' ? 1 : 0) : 99; },
      get journal() { counts.journal++; return counts.journal === 1 ? journal : { planHash: 'b'.repeat(64) }; } };
    const port = dynamoJournal(async (operation, request) => { calls.push({ operation, request }); return {}; }, arn);
    assert.equal(await (method === 'compareAndSwap' ? port[method](hash, 0, input) : port[method](hash, input)), true);
    assert.deepEqual(counts, { revision: 1, journal: 1, planHash: 1 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].request.Item.revision.N, method === 'compareAndSwap' ? '1' : '0');
    assert.deepEqual(JSON.parse(calls[0].request.Item.journal.S), { planHash: hash, state: 'APPLYING' });
    assert.equal(calls[0].request.Item.PK.S, `PLAN#${hash}`);
  });
}
test('caller serializers are rejected without execution or a storage request', async () => {
  let serializers = 0, calls = 0;
  const rewrite = () => { serializers++; return { planHash: 'b'.repeat(64) }; };
  const port = dynamoJournal(async () => { calls++; return {}; }, arn);
  for (const input of [
    { ...record, toJSON: rewrite },
    { revision: 0, journal: { planHash: hash, toJSON: rewrite } },
    { revision: 0, journal: { planHash: hash, private: { toJSON: rewrite } } },
    { revision: 0, journal: { planHash: hash, private: [rewrite] } }
  ]) await assert.rejects(async () => port.createIfAbsent(hash, input), /^Error: OPS_JOURNAL_RECORD_REJECTED$/);
  assert.equal(serializers, 0); assert.equal(calls, 0);
});
test('inherited and nonenumerable serializers cannot rewrite owned journal data', async () => {
  let serializers = 0; const requests = [];
  for (const inherited of [true, false]) {
    const rewrite = () => { serializers++; return { planHash: 'b'.repeat(64) }; };
    const journal = inherited ? Object.assign(Object.create({ toJSON: rewrite }), record.journal) : { ...record.journal };
    if (!inherited) Object.defineProperty(journal, 'toJSON', { value: rewrite });
    const port = dynamoJournal(async (_operation, request) => { requests.push(request); return {}; }, arn);
    assert.equal(await port.createIfAbsent(hash, { revision: 0, journal }), true);
    assert.deepEqual(JSON.parse(requests.at(-1).Item.journal.S), record.journal);
    assert.equal(journal.toJSON, rewrite);
  }
  assert.equal(serializers, 0); assert.equal(requests.length, 2);
});
test('unreadable and nonserializable records fail privately before storage', async () => {
  let calls = 0; const port = dynamoJournal(async () => { calls++; return {}; }, arn);
  const cyclic = { planHash: hash }; cyclic.self = cyclic;
  const privateError = () => { throw new Error('private journal value'); };
  const inputs = [null, [], { revision: -1, journal: record.journal }, { revision: Number.MAX_SAFE_INTEGER + 1, journal: record.journal },
    { revision: 0, journal: { planHash: 'b'.repeat(64) } }, { revision: 0, journal: cyclic },
    { revision: 0, journal: { planHash: hash, value: 1n } }, { revision: 0, journal: { planHash: hash, value() {} } },
    { get revision() { return privateError(); }, journal: record.journal },
    { revision: 0, get journal() { return privateError(); } },
    { revision: 0, journal: { get planHash() { return privateError(); } } }];
  for (const input of inputs) {
    await assert.rejects(async () => port.createIfAbsent(hash, input), error => {
      assert.equal(error.message, 'OPS_JOURNAL_RECORD_REJECTED'); assert.equal(error.cause, undefined); return true;
    });
  }
  assert.equal(calls, 0);
});
test('the 4096-byte payload bound is exact and survives caller mutation during transport', async () => {
  const journal = { planHash: hash, padding: '' }; const overhead = Buffer.byteLength(JSON.stringify(journal));
  journal.padding = 'x'.repeat(4096 - overhead); const input = { revision: 0, journal }; const requests = [];
  const port = dynamoJournal(async (_operation, request) => {
    requests.push(request); input.revision = 99; journal.padding = 'changed'; await Promise.resolve(); return {};
  }, arn);
  assert.equal(await port.createIfAbsent(hash, input), true);
  assert.equal(Buffer.byteLength(requests[0].Item.journal.S), 4096); assert.equal(requests[0].Item.revision.N, '0');
  assert.equal(input.revision, 99); assert.equal(journal.padding, 'changed');
  for (const padding of ['x'.repeat(4097 - overhead), 'é'.repeat(Math.ceil((4097 - overhead) / 2))]) {
    await assert.rejects(async () => port.createIfAbsent(hash, { revision: 0, journal: { planHash: hash, padding } }), /^Error: OPS_JOURNAL_RECORD_REJECTED$/);
  }
  assert.equal(requests.length, 1);
});
test('the actual CLI request retains the checked revision and cleans private files', async () => {
  const { awsTransport } = await import('./aws-transport.mjs');
  const { readFile, access } = await import('node:fs/promises');
  const requests = []; let revisions = 0;
  const port = dynamoJournal(awsTransport(async (_command, args) => {
    const file = args[args.indexOf('--cli-input-json') + 1].slice(7);
    requests.push({ file, data: JSON.parse(await readFile(file, 'utf8')) }); return { stdout: '{}' };
  }), arn);
  const input = { get revision() { return ++revisions === 1 ? 1 : 99; }, journal: { planHash: hash } };
  assert.equal(await port.compareAndSwap(hash, 0, input), true);
  assert.equal(revisions, 1); assert.equal(requests.length, 1);
  assert.equal(requests[0].data.Item.revision.N, '1');
  assert.deepEqual(requests[0].data.ExpressionAttributeValues, { ':expected': { N: '0' } });
  assert.equal(requests[0].data.ConditionExpression, 'revision = :expected');
  assert.deepEqual(JSON.parse(requests[0].data.Item.journal.S), record.journal);
  await assert.rejects(access(requests[0].file), { code: 'ENOENT' });
});
test('record and journal arrays cannot lose named identity fields in JSON', async () => {
  let calls = 0; const port = dynamoJournal(async () => { calls++; return {}; }, arn);
  for (const method of ['createIfAbsent', 'compareAndSwap']) {
    const revision = method === 'compareAndSwap' ? 1 : 0;
    for (const input of [Object.assign([], { revision, journal: record.journal }),
      { revision, journal: Object.assign([], { planHash: hash }) }]) {
      await assert.rejects(async () => method === 'compareAndSwap' ? port[method](hash, 0, input) : port[method](hash, input), /^Error: OPS_JOURNAL_RECORD_REJECTED$/);
    }
  }
  assert.equal(calls, 0);
});
