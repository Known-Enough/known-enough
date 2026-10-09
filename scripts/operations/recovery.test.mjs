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

function ownedPreparation() {
  const p = ports(); p.args.plan = { ...plan }; p.args.envelope = { ...envelope };
  const calls = []; const created = [];
  const manifestPort = p.args.manifestTransport;
  p.args.manifestTransport = async (op, input) => {
    calls.push({ op, key: input.Key }); return manifestPort(op, input);
  };
  const journalPort = p.args.journalStorage;
  p.args.journalStorage = {
    createIfAbsent: async (key, value) => {
      calls.push({ op: 'create', key }); created.push({ key, value: structuredClone(value) });
      return journalPort.createIfAbsent(key, value);
    },
    read: async key => { calls.push({ op: 'read', key }); return journalPort.read(key); },
    compareAndSwap: async () => { throw new Error('unexpected progression'); }
  };
  return { ...p, calls, created };
}
function changeContract(args) {
  Object.assign(args.envelope, { sourceSha: 'd'.repeat(40), operation: 'ERASE',
    resourceArn: 'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughGroupsAlternate',
    contractHash: 'e'.repeat(64), maxItems: 20 });
  Object.assign(args.plan, args.envelope, { expectedRevision: 7, recoveryManifestHash: 'f'.repeat(64) });
}
for (const stage of ['PutObject', 'GetObject', 'create', 'read']) {
  test(`preparation keeps the checked plan when caller changes it during ${stage}`, async () => {
    const p = ownedPreparation(); const baseline = await prepareRecovery(ownedPreparation().args);
    let entered, release;
    const began = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    if (stage === 'PutObject' || stage === 'GetObject') {
      const original = p.args.manifestTransport;
      p.args.manifestTransport = async (op, input) => {
        if (op === stage) { entered(); await gate; }
        return original(op, input);
      };
    } else {
      const method = stage === 'create' ? 'createIfAbsent' : 'read';
      const original = p.args.journalStorage[method];
      p.args.journalStorage[method] = async (...args) => {
        entered(); await gate; return original(...args);
      };
    }
    const pending = prepareRecovery(p.args);
    await began; changeContract(p.args); release();
    const result = await pending;
    assert.deepEqual(result, baseline);
    assert.equal(p.created.length, 1);
    assert.equal(p.created[0].key, result.planHash);
    assert.equal(p.created[0].value.journal.planHash, result.planHash);
    assert.equal(p.created[0].value.journal.resourceArn, plan.resourceArn);
    assert.equal(p.created[0].value.journal.expectedRevision, plan.expectedRevision);
    assert.deepEqual(p.calls, [
      { op: 'PutObject', key: `manifests/${plan.recoveryManifestHash}.json` },
      { op: 'GetObject', key: `manifests/${plan.recoveryManifestHash}.json` },
      { op: 'create', key: result.planHash }, { op: 'read', key: result.planHash }
    ]);
    assert.equal(result.recoveryPreservation, 'READBACK_VERIFIED');
    assert.equal(result.operationExecution, 'NOT_EXECUTED');
  });
}
test('preparation captures each validated plan and envelope field once before storage', async () => {
  const p = ownedPreparation(); const baseline = await prepareRecovery(ownedPreparation().args);
  const reads = new Map();
  for (const name of ['plan', 'envelope']) {
    const original = p.args[name];
    p.args[name] = Object.fromEntries(Object.keys(original).map(field => [field, original[field]]));
    for (const [field, value] of Object.entries(original)) {
      const label = `${name}.${field}`; reads.set(label, 0);
      Object.defineProperty(p.args[name], field, { enumerable: true, get() {
        const count = reads.get(label) + 1; reads.set(label, count);
        if (count > 1) throw new Error('private changing accessor details');
        assert.deepEqual(p.calls, []); return value;
      } });
    }
  }
  assert.deepEqual(await prepareRecovery(p.args), baseline);
  assert.ok([...reads.values()].every(count => count === 1));
  assert.equal(p.created[0].key, baseline.planHash);
});
test('concurrent preparations own independent plans without modifying caller objects', async () => {
  const first = ownedPreparation(); const second = ownedPreparation();
  second.args.plan.expectedRevision = 4;
  const callers = [first, second].map(p => ({ plan: structuredClone(p.args.plan), envelope: structuredClone(p.args.envelope) }));
  Object.freeze(first.args.plan); Object.freeze(first.args.envelope);
  Object.freeze(second.args.plan); Object.freeze(second.args.envelope);
  const results = await Promise.all([prepareRecovery(first.args), prepareRecovery(second.args)]);
  assert.notEqual(results[0].planHash, results[1].planHash);
  for (const [index, p] of [first, second].entries()) {
    assert.deepEqual(p.args.plan, callers[index].plan); assert.deepEqual(p.args.envelope, callers[index].envelope);
    assert.equal(p.created[0].key, results[index].planHash);
    assert.ok(Object.isFrozen(results[index]));
    assert.deepEqual(Object.keys(results[index]).sort(), ['completedItems', 'contractHash', 'operationExecution',
      'planHash', 'recoveryPreservation', 'sourceSha', 'state', 'storageRevision'].sort());
  }
});
