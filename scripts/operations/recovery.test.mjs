import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { prepareRecovery } from './recovery.mjs';
import { MANIFEST_BUCKET } from './manifest.mjs';
import { dynamoJournal } from './dynamo-journal.mjs';
const envelope = { sourceSha: 'a'.repeat(40), operation: 'PARTITION', resourceArn: 'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughGroupsStage', contractHash: 'b'.repeat(64), maxItems: 10 };
const manifestBytes = Buffer.from(JSON.stringify({ syntheticRecovery: 'private fixture' }));
const plan = { schemaVersion: 1, sourceSha: envelope.sourceSha, account: '092954139775', region: 'us-east-1', operation: envelope.operation,
  resourceArn: envelope.resourceArn, contractHash: envelope.contractHash, expectedRevision: 3, maxItems: 10,
  recoveryManifestHash: createHash('sha256').update(manifestBytes).digest('hex') };
function ports() {
  let manifest; let journal; let loseResponse = false; const order = [];
  const manifestTransport = async (op, input) => {
    order.push(op);
    if (op === 'PutObject') {
      if (manifest) throw Object.assign(new Error('duplicate'), { name: 'PreconditionFailed' });
      manifest = { VersionId: 'v1', Body: Buffer.from(input.Body) };
      if (loseResponse) { loseResponse = false; throw new Error('lost response'); }
    }
    return manifest;
  };
  const journalStorage = dynamoJournal(async (op, input) => {
    order.push(op);
    if (op === 'PutItem') {
      if (journal) throw Object.assign(new Error('duplicate'), { name: 'ConditionalCheckFailedException' });
      journal = structuredClone(input.Item);
    }
    return { Item: journal };
  }, 'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughOperationsJournal');
  return { args: { plan, envelope, manifestBytes, manifestTransport, bucket: MANIFEST_BUCKET, journalStorage }, order,
    loseResponse() { loseResponse = true; } };
}
test('preserve/readback precedes journal and repeated preparation publishes only allowlisted facts', async () => {
  const p = ports(); const first = await prepareRecovery(p.args); const duplicate = await prepareRecovery(p.args);
  assert.deepEqual(duplicate, first); assert.deepEqual(p.order.slice(0, 4), ['PutObject', 'GetObject', 'PutItem', 'GetItem']);
  assert.equal(first.state, 'PREPARED'); assert.equal(first.operationExecution, 'NOT_EXECUTED');
  assert.ok(!JSON.stringify(first).includes('private fixture'));
  assert.ok(!Object.hasOwn(first, 'versionId'));
});
test('lost manifest write response resumes original version before journal, never recreates data', async () => {
  const p = ports(); p.loseResponse(); await assert.rejects(prepareRecovery(p.args), /OPS_MANIFEST_STORAGE_FAILED/);
  assert.deepEqual(p.order, ['PutObject']);
  const resumed = await prepareRecovery(p.args); assert.equal(resumed.state, 'PREPARED');
  assert.deepEqual(p.order.slice(1), ['PutObject', 'GetObject', 'PutItem', 'GetItem']);
});
test('wrong source or recovery hash cannot create journal or submit a manifest', async () => {
  const p = ports();
  await assert.rejects(prepareRecovery({ ...p.args, plan: { ...plan, sourceSha: 'd'.repeat(40) } }));
  await assert.rejects(prepareRecovery({ ...p.args, plan: { ...plan, recoveryManifestHash: 'd'.repeat(64) } }));
  assert.deepEqual(p.order, []);
});
