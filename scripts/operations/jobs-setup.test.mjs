import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { jobPreparationBytes, jobSetupPreparation, jobPermissionProfiles } from './jobs-setup.mjs';
import { jobVerificationReport } from './jobs-verify.mjs';
const sha = 'a'.repeat(40), env = { EXPECTED_SOURCE: sha, CHECKOUT_SOURCE: sha, GITHUB_SHA: sha, GITHUB_REPOSITORY: 'Known-Enough/known-enough', GITHUB_REF: 'refs/heads/main', GITHUB_ACTOR_ID: '143764700', GITHUB_EVENT_NAME: 'workflow_dispatch' };
test('exact offline proposal bytes bind source, stay disabled and never claim execution', () => {
  assert.equal(readFileSync('infra/operations/jobs-setup.json', 'utf8'), jobPreparationBytes());
  const result = jobVerificationReport(env, jobPreparationBytes()); assert.equal(result.sourceSha, sha);
  assert.equal(result.installation, 'UNKNOWN'); assert.equal(result.providerCalls, 'NOT_EXECUTED'); assert.equal(result.activation, 'DISABLED');
});
test('runtime limits, transient raw turns and no-reset accounting remain explicit', () => {
  const value = jobSetupPreparation(); assert.equal(value.delivery.capacity, 64); assert.equal(value.bounds.slots, 2);
  assert.ok(value.bounds.leaseMs > value.bounds.providerTimeoutMs); assert.equal(value.bounds.safePreCallRetries, 2);
  assert.equal(value.jobs.conversationTurns, 'TRANSIENT_NEVER_PERSISTED'); assert.match(value.accounting.inheritedTotal, /NO_SEED_RESET_OR_REFUND/);
  assert.match(value.accounting.uncertainProvider, /SLOT_QUARANTINED/); assert.match(value.cleanup, /no automatic deletion/);
});
test('permission delta stays fixed-target transactional without scans, wildcard resources, seed AUTH or speculative queues', () => {
  for (const entry of jobPermissionProfiles().worker.Statement) {
    assert.match(entry.Resource, /^arn:aws:dynamodb:us-east-1:092954139775:table\/KnownEnough/);
    assert.ok(!entry.Resource.includes('*')); assert.ok(!entry.Action.some(a => /Scan|Create|Update|Delete|sqs|iam/.test(a)));
    if (entry.Action.some(a => a.endsWith('PutItem') || a.endsWith('ConditionCheckItem'))) assert.deepEqual(entry.Condition['ForAnyValue:StringEquals']['dynamodb:EnclosingOperation'], ['TransactWriteItems']);
  }
  const totals = jobPermissionProfiles().worker.Statement.find(s => s.Sid === 'PreservedCumulativeReservationCAS');
  assert.deepEqual(totals.Condition['ForAllValues:StringLike']['dynamodb:LeadingKeys'], ['TOTAL']);
});
for (const bad of [{ EXPECTED_SOURCE: sha, CHECKOUT_SOURCE: 'b'.repeat(40) }, { EXPECTED_SOURCE: '*', CHECKOUT_SOURCE: '*' }, {}]) {
  test('invalid exact source binding rejected '+JSON.stringify(bad), () => assert.throws(() => jobVerificationReport(bad, jobPreparationBytes())));
}
test('modified proposal never reports verified', () => assert.throws(() => jobVerificationReport(env, jobPreparationBytes().replace('DISABLED', 'ENABLED')), /JOB_PREPARATION_DRIFT/));
