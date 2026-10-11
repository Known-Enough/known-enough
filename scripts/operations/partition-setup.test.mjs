import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { partitionSetupTemplate, partitionPermissionProfiles, PARTITION_RESOURCES as r } from './partition-setup.mjs';
import { partitionVerificationReport } from './partition-verify.mjs';
const env = { GITHUB_REPOSITORY: 'Known-Enough/known-enough', GITHUB_REF: 'refs/heads/main', GITHUB_ACTOR_ID: '143764700',
  GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_SHA: 'a'.repeat(40), EXPECTED_SOURCE: 'a'.repeat(40), CHECKOUT_SOURCE: 'a'.repeat(40) };
function permitted(profile, action, resource, pk, enclosing) {
  return profile.Statement.some(statement => statement.Resource === resource && statement.Action.includes(action)
    && statement.Condition['ForAllValues:StringLike']['dynamodb:LeadingKeys'].some(pattern => {
      const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : null; return prefix === null ? pattern === pk : pk.startsWith(prefix);
    }) && (!statement.Condition['ForAnyValue:StringEquals'] || statement.Condition['ForAnyValue:StringEquals']['dynamodb:EnclosingOperation'].includes(enclosing)));
}
test('retained encrypted/PITR table has no IAM attachment, TTL, replacement, data seed or runtime action', () => {
  const template = partitionSetupTemplate(); assert.deepEqual(Object.keys(template.Resources), ['Partitions']);
  const table = template.Resources.Partitions;
  assert.equal(table.DeletionPolicy, 'Retain'); assert.equal(table.UpdateReplacePolicy, 'Retain');
  assert.equal(table.Properties.TableName, 'KnownEnoughPartitions'); assert.equal(table.Properties.DeletionProtectionEnabled, true);
  assert.equal(table.Properties.SSESpecification.SSEEnabled, true); assert.equal(table.Properties.PointInTimeRecoverySpecification.PointInTimeRecoveryEnabled, true);
  assert.equal(table.Properties.TimeToLiveSpecification, undefined); assert.equal(template.Metadata.Activation, 'DISABLED');
  assert.equal(template.Metadata.RoleAttachment, 'EXISTING_ROLE_READBACK_REQUIRED');
});
test('participant profile supports joined read/commit and discovery while denying migration/control/journal writes', () => {
  const { participant: p } = partitionPermissionProfiles();
  assert.ok(permitted(p, 'dynamodb:PutItem', r.target, 'GROUP#garden', 'TransactWriteItems'));
  assert.ok(permitted(p, 'dynamodb:UpdateItem', r.decisions, 'ROOM#decision', 'TransactWriteItems'));
  assert.ok(permitted(p, 'dynamodb:Query', r.target, 'MEMBER#iris'));
  for (const [resource, pk] of [[r.source, 'NP#GROUPS'], [r.target, 'MIGRATION#CONTROL'], [r.journal, 'PARTITION#hash']]) {
    assert.ok(permitted(p, 'dynamodb:GetItem', resource, pk, 'TransactGetItems'));
    assert.ok(permitted(p, 'dynamodb:ConditionCheckItem', resource, pk, 'TransactWriteItems'));
    assert.ok(!permitted(p, 'dynamodb:PutItem', resource, pk, 'TransactWriteItems'));
  }
  assert.ok(!permitted(p, 'dynamodb:PutItem', r.target, 'GROUP#garden'));
  assert.ok(!permitted(p, 'dynamodb:GetItem', r.decisions, 'ROOM#decision'));
});
test('migration and archive deltas differ on write authority and preserve unrelated/replay/private history', () => {
  const { migration: m, archive: a } = partitionPermissionProfiles();
  assert.ok(permitted(m, 'dynamodb:PutItem', r.source, 'NP#GROUPS', 'TransactWriteItems'));
  assert.ok(permitted(m, 'dynamodb:PutItem', r.journal, 'PARTITION#hash', 'TransactWriteItems'));
  assert.ok(!permitted(m, 'dynamodb:PutItem', r.journal, 'PLAN#hash', 'TransactWriteItems'));
  assert.ok(!permitted(m, 'dynamodb:PutItem', r.decisions, 'ROOM#decision', 'TransactWriteItems'));
  assert.ok(permitted(a, 'dynamodb:PutItem', r.target, 'GROUP#garden', 'TransactWriteItems'));
  assert.ok(permitted(a, 'dynamodb:PutItem', r.journal, 'ARCHIVE#garden', 'TransactWriteItems'));
  for (const key of ['ACCOUNT#iris', 'OPERATIONS#ARCHIVE', 'MIGRATION#CONTROL', 'MEMBER#iris']) assert.ok(!permitted(a, 'dynamodb:PutItem', r.target, key, 'TransactWriteItems'));
  assert.ok(!permitted(a, 'dynamodb:PutItem', r.source, 'NP#GROUPS', 'TransactWriteItems'));
});
test('profiles use underlying transaction IAM actions, exact resources, present leading keys and bounded return values', () => {
  for (const profile of Object.values(partitionPermissionProfiles())) for (const s of profile.Statement) {
    assert.notEqual(s.Resource, '*'); assert.equal(s.Effect, 'Allow');
    assert.ok(s.Action.every(action => !/^(iam:|sts:|dynamodb:Transact|.*Delete|.*Scan)/.test(action)));
    if (s.Condition?.['ForAllValues:StringLike']) {
      assert.equal(s.Condition.Null['dynamodb:LeadingKeys'], 'false');
      assert.equal(s.Condition.StringEqualsIfExists['dynamodb:ReturnValues'], 'NONE');
      assert.ok(!s.Condition['ForAllValues:StringLike']['dynamodb:LeadingKeys'].includes('*'));
    }
  }
});
test('source-bound offline verification rejects edited templates and foreign provenance without credentials', () => {
  const saved = readFileSync('infra/operations/partition-setup.json', 'utf8');
  const report = partitionVerificationReport(env, saved); assert.equal(report.result, 'OFFLINE_VERIFIED');
  assert.equal(report.installation, 'UNKNOWN'); assert.equal(report.activation, 'DISABLED'); assert.equal(report.migration, 'NOT_EXECUTED');
  assert.throws(() => partitionVerificationReport(env, saved + ' '), /PARTITION_SETUP_DRIFT/);
  for (const patch of [{ GITHUB_ACTOR_ID: '999999999' }, { EXPECTED_SOURCE: 'b'.repeat(40) }, { GITHUB_EVENT_NAME: 'push' }]) {
    assert.throws(() => partitionVerificationReport({ ...env, ...patch }, saved), /OPS_SOURCE_REJECTED/);
  }
  const workflow = readFileSync('.github/workflows/operations-verify.yml', 'utf8');
  assert.ok(workflow.includes('node --experimental-transform-types --test scripts/operations/*.test.mjs'));
  assert.ok(workflow.includes('node scripts/operations/partition-verify.mjs'));
  assert.ok(workflow.includes('infra/operations/partition-setup.json'));
  assert.ok(!/id-token:|configure-aws-credentials|secrets\./.test(workflow));
});
test('managed synthetic recovery verifies source and installs pinned dependencies before native tests and credentials', () => {
  const workflow = readFileSync('.github/workflows/operations-recovery.yml', 'utf8');
  const source = workflow.indexOf('node scripts/operations/verify.mjs');
  const install = workflow.indexOf('npm ci');
  const tests = workflow.indexOf('node --experimental-transform-types --test scripts/operations/*.test.mjs');
  const credentials = workflow.indexOf('aws-actions/configure-aws-credentials@');
  assert.ok(source >= 0 && source < install && install < tests && tests < credentials);
  assert.ok(workflow.includes('node scripts/operations/managed-preparation.mjs'));
  assert.ok(workflow.includes('known-enough-operations-recovery'));
  assert.ok(!/aws (?:iam|cloudformation)|node .*partition.*(?:apply|activate)/.test(workflow));
});

test('archive reads and conditions retain required immutable invitation/decision references without granting their mutation or foreign access', () => {
  const { archive } = partitionPermissionProfiles();
  for (const pk of ['INVITATION#' + 'a'.repeat(64), 'DECISION#owned-synthetic']) {
    for (const action of ['dynamodb:GetItem', 'dynamodb:BatchGetItem']) assert.equal(permitted(archive, action, r.target, pk), true);
    assert.equal(permitted(archive, 'dynamodb:ConditionCheckItem', r.target, pk, 'TransactWriteItems'), true);
    for (const action of ['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem'])
      assert.equal(permitted(archive, action, r.target, pk, 'TransactWriteItems'), false);
  }
  assert.equal(permitted(archive, 'dynamodb:GetItem', r.target, 'FOREIGN#private'), false);
  assert.equal(permitted(archive, 'dynamodb:ConditionCheckItem', r.target, 'INVITATION#owned', 'PutItem'), false);
});
