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
