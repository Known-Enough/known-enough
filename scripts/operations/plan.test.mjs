import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePlan, validateRecovery, advanceRecovery } from './plan.mjs';
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
