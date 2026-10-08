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
