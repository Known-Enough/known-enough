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

test('recovery trust matches current immutable repository subject without broadening main or audience', () => {
  const trust = setupTemplate().Resources.RecoveryRole.Properties.AssumeRolePolicyDocument;
  const expected = JSON.parse(readFileSync('infra/permissions/shared-staging-github-inspect-trust.json', 'utf8')).Statement[0];
  assert.equal(trust.Statement.length, 1);
  const only = trust.Statement[0];
  assert.deepEqual(only.Principal, expected.Principal);
  assert.equal(only.Action, 'sts:AssumeRoleWithWebIdentity');
  assert.deepEqual(only.Condition, expected.Condition);
  assert.equal(only.Condition.StringEquals['token.actions.githubusercontent.com:sub'],
    'repo:Known-Enough@331386621/known-enough@1377587215:ref:refs/heads/main');
  assert.equal(only.Condition.StringEquals['token.actions.githubusercontent.com:aud'], 'sts.amazonaws.com');
  assert.ok(!JSON.stringify(trust).includes('StringLike'));
});


test('workflow verification rejects nonprimitive sources without coercion or report serialization', () => {
  const template = readFileSync('infra/operations/setup.json', 'utf8');
  let hooks = 0;
  for (const source of [[env.GITHUB_SHA], new String(env.GITHUB_SHA),
    { toString() { hooks++; return env.GITHUB_SHA; } },
    { [Symbol.toPrimitive]() { hooks++; return env.GITHUB_SHA; } },
    { toString() { hooks++; throw new Error('private-source-sentinel'); } },
    BigInt('1'.repeat(40)), Symbol('synthetic-source'), undefined, null, 0, true, {}]) {
    assert.throws(() => verifySource({ ...env, GITHUB_SHA: source, EXPECTED_SOURCE: source, CHECKOUT_SOURCE: source }), /^Error: OPS_SOURCE_REJECTED$/);
    assert.throws(() => verificationReport(source, template), /^Error: OPS_SOURCE_REJECTED$/);
  }
  assert.equal(hooks, 0);
});

test('workflow source is captured once and remains bound to expected and checkout identities', () => {
  for (const later of ['b'.repeat(40), [env.GITHUB_SHA], undefined]) {
    let reads = 0;
    const submitted = { ...env };
    Object.defineProperty(submitted, 'GITHUB_SHA', { enumerable: true, get() { return ++reads === 1 ? env.GITHUB_SHA : later; } });
    assert.equal(verifySource(submitted), env.GITHUB_SHA);
    assert.equal(reads, 1);
  }
  for (const field of ['EXPECTED_SOURCE', 'CHECKOUT_SOURCE']) {
    assert.throws(() => verifySource({ ...env, [field]: 'b'.repeat(40) }), /^Error: OPS_SOURCE_REJECTED$/);
  }
});

test('unreadable workflow context returns the finite source rejection', () => {
  for (const field of Object.keys(env)) {
    for (const thrown of [new Error('private-workflow-sentinel'), 'private-workflow-sentinel', undefined]) {
      const submitted = { ...env }; let reads = 0;
      Object.defineProperty(submitted, field, { enumerable: true, get() { reads++; throw thrown; } });
      assert.throws(() => verifySource(submitted), /^Error: OPS_SOURCE_REJECTED$/);
      assert.equal(reads, 1);
    }
  }
  for (const submitted of [undefined, null]) assert.throws(() => verifySource(submitted), /^Error: OPS_SOURCE_REJECTED$/);
});

test('valid primitive sources retain exact offline report and template binding', () => {
  const template = readFileSync('infra/operations/setup.json', 'utf8');
  for (const source of ['0'.repeat(40), '1'.repeat(40), 'a'.repeat(40), 'f'.repeat(40)]) {
    assert.equal(verifySource({ ...env, GITHUB_SHA: source, EXPECTED_SOURCE: source, CHECKOUT_SOURCE: source }), source);
    const report = verificationReport(source, template);
    assert.equal(report.sourceSha, source); assert.equal(typeof report.sourceSha, 'string');
    assert.equal(report.result, 'OFFLINE_VERIFIED'); assert.equal(report.installation, 'UNKNOWN');
    assert.equal(report.managedRecovery, 'UNKNOWN'); assert.equal(report.apply, 'DISABLED');
    assert.match(report.templateHash, /^[a-f0-9]{64}$/);
    assert.throws(() => verificationReport(source, template + ' '), /^Error: OPS_TEMPLATE_DRIFT$/);
  }
  for (const source of ['', 'a'.repeat(39), 'a'.repeat(41), 'A'.repeat(40), env.GITHUB_SHA + '\n']) {
    assert.throws(() => verificationReport(source, template), /^Error: OPS_SOURCE_REJECTED$/);
    assert.throws(() => verifySource({ ...env, GITHUB_SHA: source, EXPECTED_SOURCE: source, CHECKOUT_SOURCE: source }), /^Error: OPS_SOURCE_REJECTED$/);
  }
});

test('malformed source stops managed preparation before installation or storage requests', async () => {
  const { managedPreparation } = await import('./managed-preparation.mjs');
  for (const source of [[env.GITHUB_SHA], new String(env.GITHUB_SHA)]) {
    const calls = [];
    await assert.rejects(managedPreparation({ ...env, GITHUB_SHA: source, EXPECTED_SOURCE: source, CHECKOUT_SOURCE: source,
      OPERATIONS_RECOVERY_ENABLED: 'true', PROBE_ID: '12345678-1234-4123-8123-123456789abc' }, async op => { calls.push(op); throw new Error('unexpected-provider-call'); }),
      /^Error: OPS_SOURCE_REJECTED$/);
    assert.deepEqual(calls, []);
  }
});
