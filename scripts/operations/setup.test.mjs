import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setupTemplate, JOURNAL_ARN } from './setup.mjs';
import { verificationReport, verifySource } from './verify.mjs';
const env = { GITHUB_REPOSITORY: 'Known-Enough/known-enough', GITHUB_REF: 'refs/heads/main', GITHUB_ACTOR_ID: '143764700', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_SHA: 'a'.repeat(40), EXPECTED_SOURCE: 'a'.repeat(40), CHECKOUT_SOURCE: 'a'.repeat(40) };
test('reject foreign actor/ref/repository and changed source before credentials', () => {
  assert.equal(verifySource(env), env.GITHUB_SHA);
  for (const patch of [{ GITHUB_ACTOR_ID: 'other' }, { GITHUB_REF: 'refs/heads/other' }, { EXPECTED_SOURCE: 'b'.repeat(40) }, { CHECKOUT_SOURCE: 'b'.repeat(40) }, { GITHUB_REPOSITORY: 'unrelated/repo' }, { GITHUB_EVENT_NAME: 'push' }]) assert.throws(() => verifySource({ ...env, ...patch }), /OPS_SOURCE_REJECTED/);
});
test('reviewed storage proposal preserves private recovery and prevents self delegation', () => {
  const { Journal, Manifests, ManifestPolicy, RecoveryRole } = setupTemplate().Resources;
  for (const resource of [Journal, Manifests]) { assert.equal(resource.DeletionPolicy, 'Retain'); assert.equal(resource.UpdateReplacePolicy, 'Retain'); }
  assert.equal(Journal.Properties.PointInTimeRecoverySpecification.PointInTimeRecoveryEnabled, true);
  assert.equal(Journal.Properties.DeletionProtectionEnabled, true);
  assert.equal(Manifests.Properties.VersioningConfiguration.Status, 'Enabled');
  assert.ok(Object.values(Manifests.Properties.PublicAccessBlockConfiguration).every(value => value === true));
  assert.equal(ManifestPolicy.Properties.PolicyDocument.Statement.find(s => s.Sid === 'RequireExclusiveManifestCreate').Condition.Null['s3:if-none-match'], 'true');
  const statements = RecoveryRole.Properties.Policies[0].PolicyDocument.Statement;
  const allowed = statements.filter(s => s.Effect === 'Allow');
  assert.ok(allowed.every(s => s.Resource !== '*' && !s.Action.some(action => /^(iam:|sts:|.*Delete)/.test(action))));
  assert.ok(allowed.find(s => s.Action.includes('dynamodb:PutItem') && s.Resource === JOURNAL_ARN));
  assert.ok(statements.find(s => s.Effect === 'Deny' && s.Action.includes('iam:*')));
});
test('checked generated template and credential-free workflow publish no installed PASS', () => {
  const actual = readFileSync('infra/operations/setup.json', 'utf8');
  const report = verificationReport(env.GITHUB_SHA, actual);
  assert.equal(report.installation, 'UNKNOWN'); assert.equal(report.apply, 'DISABLED');
  assert.throws(() => verificationReport(env.GITHUB_SHA, actual + ' '), /OPS_TEMPLATE_DRIFT/);
  const workflow = readFileSync('.github/workflows/operations-verify.yml', 'utf8');
  assert.ok(workflow.includes('node scripts/operations/verify.mjs'));
  assert.ok(!/id-token:|configure-aws-credentials|secrets\./.test(workflow));
});
