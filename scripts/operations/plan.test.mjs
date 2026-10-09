import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validatePlan, validateRecovery, advanceRecovery } from './plan.mjs';
import { prepareRecovery } from './recovery.mjs';
import { MANIFEST_BUCKET } from './manifest.mjs';
const envelope = { sourceSha: 'a'.repeat(40), operation: 'PARTITION', resourceArn: 'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughGroupsStage', contractHash: 'b'.repeat(64), maxItems: 25 };
const plan = { schemaVersion: 1, sourceSha: envelope.sourceSha, account: '092954139775', region: 'us-east-1', operation: envelope.operation, resourceArn: envelope.resourceArn, contractHash: envelope.contractHash, expectedRevision: 3, maxItems: 10, recoveryManifestHash: 'c'.repeat(64) };
test('canonical plan identity is stable across key order and binds recovery manifest', () => {
  const a = validatePlan(plan, envelope);
  assert.equal(a.planHash, validatePlan(Object.fromEntries(Object.entries(plan).reverse()), envelope).planHash);
  assert.notEqual(a.planHash, validatePlan({ ...plan, recoveryManifestHash: 'd'.repeat(64) }, envelope).planHash);
});
test('reject wrong source, account, region, operation, resource, contract, revisions and unbounded batches', () => {
  for (const patch of [{ sourceSha: 'd'.repeat(40) }, { account: '000000000000' }, { region: 'us-west-2' }, { operation: 'IAM_EDIT' }, { resourceArn: '*' }, { contractHash: 'd'.repeat(64) }, { expectedRevision: -1 }, { expectedRevision: 1.5 }, { maxItems: 26 }, { maxItems: 0 }, { rawRecord: 'private' }]) assert.throws(() => validatePlan({ ...plan, ...patch }, envelope), /^Error: OPS_PLAN_REJECTED$/);
});
test('reject unbound envelope and wildcard or other-service delegation', () => {
  for (const patch of [{ resourceArn: '*' }, { resourceArn: 'arn:aws:iam::092954139775:role/Admin' }, { operation: 'RESET_TOTAL' }, { maxItems: 1001 }, { contractHash: '' }]) assert.throws(() => validatePlan(plan, { ...envelope, ...patch }));
});
test('interrupted recovery keeps exact plan/revision/count, duplicate complete stays complete', () => {
  const checked = validatePlan(plan, envelope);
  const journal = { schemaVersion: 1, planHash: checked.planHash, resourceArn: checked.resourceArn, expectedRevision: 3, completedItems: 4, state: 'APPLYING' };
  assert.equal(validateRecovery(journal, plan, envelope).completedItems, 4);
  const complete = { ...journal, state: 'COMPLETE', completedItems: 10 };
  assert.deepEqual(validateRecovery(complete, plan, envelope), validateRecovery(complete, plan, envelope));
  for (const patch of [{ planHash: 'd'.repeat(64) }, { expectedRevision: 4 }, { completedItems: 11 }, { completedItems: -1 }, { state: 'PREPARED' }, { cursor: 'private' }]) assert.throws(() => validateRecovery({ ...journal, ...patch }, plan, envelope));
});

test('recovery revalidates source contract instead of trusting caller-provided checked hash', () => {
  const checked = validatePlan(plan, envelope);
  const journal = { schemaVersion: 1, planHash: checked.planHash, resourceArn: checked.resourceArn, expectedRevision: 3, completedItems: 0, state: 'PREPARED' };
  assert.throws(() => validateRecovery(journal, { ...plan, planHash: checked.planHash }, envelope));
  assert.throws(() => validateRecovery(journal, { ...plan, resourceArn: '*' }, envelope));
  assert.throws(() => validateRecovery(journal, plan, { ...envelope, sourceSha: 'd'.repeat(40) }));
});

test('journal progress rejects stale writers, regressions and terminal reversal', () => {
  const checked = validatePlan(plan, envelope);
  const prepared = { schemaVersion: 1, planHash: checked.planHash, resourceArn: checked.resourceArn, expectedRevision: 3, completedItems: 0, state: 'PREPARED' };
  const applying = { ...prepared, completedItems: 4, state: 'APPLYING' };
  const result = advanceRecovery(prepared, applying, plan, envelope, 0, 0);
  assert.equal(result.storageRevision, 1);
  assert.throws(() => advanceRecovery(applying, { ...applying, completedItems: 5 }, plan, envelope, 1, 0));
  assert.throws(() => advanceRecovery(applying, { ...applying, completedItems: 3 }, plan, envelope, 1, 1));
  assert.throws(() => advanceRecovery(applying, prepared, plan, envelope, 1, 1));
  const complete = { ...applying, state: 'COMPLETE' };
  assert.throws(() => advanceRecovery(complete, applying, plan, envelope, 2, 2));
  assert.throws(() => advanceRecovery(complete, { ...complete, completedItems: 5 }, plan, envelope, 2, 2));
  assert.throws(() => advanceRecovery(prepared, applying, plan, envelope, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER));
});

const malformedSources = {
  array: () => [envelope.sourceSha], boxed: () => new String(envelope.sourceSha),
  toString: hook => ({ toString: () => { hook(); return envelope.sourceSha; } }),
  toPrimitive: hook => ({ [Symbol.toPrimitive]: () => { hook(); return envelope.sourceSha; } }),
  throwing: hook => ({ toString: () => { hook(); throw new Error('private-source-sentinel'); } }),
  bigint: () => BigInt('1'.repeat(40)), symbol: () => Symbol('synthetic-source'),
  undefined: () => undefined, null: () => null, number: () => 0, boolean: () => true, object: () => ({})
};
for (const [name, factory] of Object.entries(malformedSources)) {
  test(`source binding rejects ${name} without coercion or serialization`, () => {
    let hooks = 0; const sourceSha = factory(() => { hooks++; });
    assert.throws(() => validatePlan({ ...plan, sourceSha }, { ...envelope, sourceSha }), /^Error: OPS_PLAN_REJECTED$/);
    assert.equal(hooks, 0);
  });
}

test('recovery cannot revalidate a journal against a boxed source identity', () => {
  const checked = validatePlan(plan, envelope);
  const journal = { schemaVersion: 1, planHash: checked.planHash, resourceArn: checked.resourceArn,
    expectedRevision: plan.expectedRevision, completedItems: 0, state: 'PREPARED' };
  const sourceSha = new String(envelope.sourceSha);
  assert.throws(() => validateRecovery(journal, { ...plan, sourceSha }, { ...envelope, sourceSha }), /^Error: OPS_PLAN_REJECTED$/);
});

test('invalid source identity stops recovery before manifest or journal storage', async () => {
  const manifestBytes = Buffer.from('{"synthetic":true}');
  const recoveryManifestHash = createHash('sha256').update(manifestBytes).digest('hex');
  const sourceSha = [envelope.sourceSha]; const calls = []; let stored, journal;
  const manifestTransport = async (op, input) => {
    calls.push(op); if (op === 'PutObject') stored = { Body: Buffer.from(input.Body), VersionId: 'fixture-v1' };
    return stored;
  };
  const journalStorage = {
    createIfAbsent: async (_key, value) => { calls.push('journal-create'); journal = structuredClone(value); return true; },
    read: async () => { calls.push('journal-read'); return structuredClone(journal); },
    compareAndSwap: async () => { throw new Error('unexpected progression'); }
  };
  await assert.rejects(prepareRecovery({ plan: { ...plan, sourceSha, recoveryManifestHash },
    envelope: { ...envelope, sourceSha }, manifestBytes, manifestTransport, bucket: MANIFEST_BUCKET, journalStorage }),
  /^Error: OPS_PLAN_REJECTED$/);
  assert.deepEqual(calls, []);
});

test('primitive forty-digit hex sources keep canonical identity and immutable recovery binding', () => {
  for (const sourceSha of ['0'.repeat(40), '1'.repeat(40), 'a'.repeat(40), 'f'.repeat(40)]) {
    const submitted = { ...plan, sourceSha }; const trusted = { ...envelope, sourceSha };
    const checked = validatePlan(submitted, trusted);
    assert.equal(checked.sourceSha, sourceSha); assert.equal(typeof checked.sourceSha, 'string');
    assert.equal(Object.isFrozen(checked), true);
    assert.equal(checked.planHash, validatePlan(Object.fromEntries(Object.entries(submitted).reverse()), trusted).planHash);
    const journal = { schemaVersion: 1, planHash: checked.planHash, resourceArn: checked.resourceArn,
      expectedRevision: checked.expectedRevision, completedItems: 0, state: 'PREPARED' };
    assert.equal(validateRecovery(journal, submitted, trusted).planHash, checked.planHash);
  }
});

test('an envelope getter cannot pass a type check then substitute an array source', () => {
  let reads = 0; const sourceSha = [envelope.sourceSha];
  const trusted = { ...envelope };
  Object.defineProperty(trusted, 'sourceSha', { enumerable: true, get() { return ++reads === 1 ? envelope.sourceSha : sourceSha; } });
  assert.throws(() => validatePlan({ ...plan, sourceSha }, trusted), /^Error: OPS_PLAN_REJECTED$/);
  assert.equal(reads, 1);
});

test('a submitted source getter is captured once before canonical hashing', () => {
  let reads = 0; const submitted = { ...plan };
  Object.defineProperty(submitted, 'sourceSha', { enumerable: true, get() { return ++reads === 1 ? envelope.sourceSha : 'd'.repeat(40); } });
  const checked = validatePlan(submitted, envelope);
  assert.equal(reads, 1); assert.equal(checked.sourceSha, envelope.sourceSha);
  assert.equal(checked.planHash, validatePlan(plan, envelope).planHash);
});

test('recovery returns the schema value it checked rather than a second getter value', () => {
  let reads = 0; const checked = validatePlan(plan, envelope);
  const journal = { planHash: checked.planHash, resourceArn: checked.resourceArn,
    expectedRevision: checked.expectedRevision, completedItems: 0, state: 'PREPARED' };
  Object.defineProperty(journal, 'schemaVersion', { enumerable: true, get() { return ++reads === 1 ? 1 : 2; } });
  const recovery = validateRecovery(journal, plan, envelope);
  assert.equal(reads, 1); assert.equal(recovery.schemaVersion, 1); assert.equal(Object.isFrozen(recovery), true);
});

for (const target of ['envelope', 'plan', 'journal']) {
  test(`unreadable ${target} fields cannot expose their private accessor error`, () => {
    const checked = validatePlan(plan, envelope); const trusted = { ...envelope }; const submitted = { ...plan };
    const journal = { schemaVersion: 1, planHash: checked.planHash, resourceArn: checked.resourceArn,
      expectedRevision: checked.expectedRevision, completedItems: 0, state: 'PREPARED' };
    const input = target === 'envelope' ? trusted : target === 'plan' ? submitted : journal;
    Object.defineProperty(input, target === 'journal' ? 'state' : 'sourceSha', {
      enumerable: true, get() { throw new Error('private-accessor-sentinel'); }
    });
    assert.throws(() => validateRecovery(journal, submitted, trusted), /^Error: OPS_PLAN_REJECTED$/);
  });
}

test('unreadable input shape cannot expose its private proxy exception', () => {
  const submitted = new Proxy(plan, { ownKeys() { throw new Error('private-shape-sentinel'); } });
  assert.throws(() => validatePlan(submitted, envelope), /^Error: OPS_PLAN_REJECTED$/);
});
