import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { retentionSetupPreparation, retentionPermissionProfiles, retentionPreparationBytes } from './retention-setup.mjs';
import { retentionVerificationReport } from './retention-verify.mjs';
import { PARTITION_RESOURCES as r } from './partition-setup.mjs';
const env = { GITHUB_REPOSITORY: 'Known-Enough/known-enough', GITHUB_REF: 'refs/heads/main', GITHUB_ACTOR_ID: '143764700',
  GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_SHA: 'a'.repeat(40), EXPECTED_SOURCE: 'a'.repeat(40), CHECKOUT_SOURCE: 'a'.repeat(40) };
const allowed = (profile, action, resource, PK, enclosing) => profile.Statement.some(s => s.Resource === resource && s.Action.includes(`dynamodb:${action}`)
  && s.Condition['ForAllValues:StringLike']['dynamodb:LeadingKeys'].some(pattern => pattern.endsWith('*') ? PK.startsWith(pattern.slice(0, -1)) : PK === pattern)
  && (!s.Condition['ForAnyValue:StringEquals'] || s.Condition['ForAnyValue:StringEquals']['dynamodb:EnclosingOperation'].includes(enclosing)));
test('retention proposal uses existing exact tables, zero raw retention and disabled unapproved real-person policy without resource/action', () => {
  const proposal = retentionSetupPreparation(); assert.equal(proposal.Resources, undefined); assert.equal(proposal.activation, 'DISABLED');
  assert.equal(proposal.installation, 'UNKNOWN'); assert.equal(proposal.policy.enabled, false); assert.equal(proposal.policy.dataClass, 'SYNTHETIC');
  assert.equal(proposal.policy.rawConversationMs, 0); assert.equal(proposal.policy.realPersonPolicy, 'UNAPPROVED');
  assert.equal(proposal.policy.backupMs, null); assert.equal(proposal.policy.providerMs, null);
  assert.ok(proposal.separateManagedObligations.includes('Cognito identity/email')); assert.equal(proposal.limits.rowBatch, 16);
});
test('owner service may write verified self-consents, never an erasure journal, state/delete or retention policy', () => {
  const p = retentionPermissionProfiles().ownerService;
  assert.ok(allowed(p, 'PutItem', r.journal, 'CONSENT#operation', 'TransactWriteItems'));
  for (const [table, PK] of [[r.journal, 'LIFECYCLE#operation'], [r.journal, 'OPERATIONS#RETENTION'], [r.target, 'GROUP#garden'], [r.decisions, 'ROOM#decision']]) {
    assert.ok(!allowed(p, 'PutItem', table, PK, 'TransactWriteItems')); assert.ok(!allowed(p, 'DeleteItem', table, PK, 'TransactWriteItems'));
  }
  assert.ok(!allowed(p, 'PutItem', r.journal, 'CONSENT#operation'));
});
test('erasure executor joins participant grants as conditions and cannot manufacture/revoke grants or delete identifier/account claims', () => {
  const p = retentionPermissionProfiles().erasureExecutor;
  assert.ok(allowed(p, 'ConditionCheckItem', r.journal, 'CONSENT#operation', 'TransactWriteItems'));
  assert.ok(!allowed(p, 'PutItem', r.journal, 'CONSENT#operation', 'TransactWriteItems'));
  assert.ok(allowed(p, 'DeleteItem', r.decisions, 'ROOM#decision', 'TransactWriteItems'));
  assert.ok(allowed(p, 'DeleteItem', r.target, 'GROUP#garden', 'TransactWriteItems'));
  for (const PK of ['ACCOUNT#iris', 'EMAIL#hash', 'INVITATION#hash', 'DECISION#decision', 'MEMBER#iris', 'MIGRATION#CONTROL']) {
    assert.ok(!allowed(p, 'DeleteItem', r.target, PK, 'TransactWriteItems'));
  }
  assert.ok(!allowed(p, 'DeleteItem', r.decisions, 'ROOM#decision')); assert.ok(!allowed(p, 'DeleteItem', r.journal, 'LIFECYCLE#operation', 'TransactWriteItems'));
});
test('profiles retain exact resources/key/enclosing constraints and have no admin, scan, TTL, provider, unrelated table or role attachment', () => {
  for (const profile of Object.values(retentionPermissionProfiles())) for (const s of profile.Statement) {
    assert.notEqual(s.Resource, '*'); assert.ok(s.Action.every(value => !/iam:|sts:|Scan|UpdateTimeToLive|DeleteTable|bedrock:|ses:/.test(value)));
    assert.equal(s.Condition.Null['dynamodb:LeadingKeys'], 'false'); assert.equal(s.Condition.StringEqualsIfExists['dynamodb:ReturnValues'], 'NONE');
    assert.ok(!s.Condition['ForAllValues:StringLike']['dynamodb:LeadingKeys'].includes('*'));
  }
});
test('source/identity-bound offline report verifies generated immutable proposal, not installation or grants', () => {
  const saved = readFileSync('infra/operations/retention-setup.json', 'utf8'); assert.equal(saved, retentionPreparationBytes());
  const report = retentionVerificationReport(env, saved); assert.equal(report.result, 'OFFLINE_VERIFIED'); assert.equal(report.sourceSha, env.GITHUB_SHA);
  assert.equal(report.managedProof, 'UNKNOWN'); assert.equal(report.dataOperations, 'NOT_EXECUTED'); assert.equal(report.participantGrants, 'NOT_GRANTED');
  assert.throws(() => retentionVerificationReport(env, saved + ' '), /RETENTION_PREPARATION_DRIFT/);
  for (const patch of [{ EXPECTED_SOURCE: 'b'.repeat(40) }, { GITHUB_ACTOR_ID: '999999999' }, { GITHUB_EVENT_NAME: 'push' }]) {
    assert.throws(() => retentionVerificationReport({ ...env, ...patch }, saved), /OPS_SOURCE_REJECTED/);
  }
});
test('existing read-only source-pinned verification publishes the retention proposal/report and retains pinned native/full checks', () => {
  const workflow = readFileSync('.github/workflows/operations-verify.yml', 'utf8');
  assert.ok(workflow.includes('node scripts/operations/retention-verify.mjs')); assert.ok(workflow.includes('infra/operations/retention-setup.json'));
  assert.ok(workflow.includes('node --experimental-transform-types --test scripts/operations/*.test.mjs')); assert.ok(workflow.includes('npm run check'));
  assert.ok(!/id-token:|configure-aws-credentials|aws iam|secrets\./.test(workflow));
});
test('bounded policy installer can only conditionally install source-verified retention config/stamps and never operate on user data', () => {
  const p = retentionPermissionProfiles().policyInstallation;
  assert.ok(allowed(p, 'PutItem', r.journal, 'OPERATIONS#RETENTION', 'TransactWriteItems'));
  assert.ok(allowed(p, 'PutItem', r.journal, 'RETENTION#iris', 'TransactWriteItems'));
  for (const PK of ['LIFECYCLE#op', 'CONSENT#op', 'PARTITION#hash']) assert.ok(!allowed(p, 'PutItem', r.journal, PK, 'TransactWriteItems'));
  assert.ok(!allowed(p, 'PutItem', r.target, 'ACCOUNT#iris', 'TransactWriteItems'));
  assert.ok(!allowed(p, 'PutItem', r.journal, 'OPERATIONS#RETENTION'));
});
