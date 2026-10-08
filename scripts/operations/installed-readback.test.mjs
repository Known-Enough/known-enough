import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installedReadback } from './installed-readback.mjs';
import { setupTemplate, JOURNAL_ARN, RECOVERY_ROLE } from './setup.mjs';
import { MANIFEST_BUCKET } from './manifest.mjs';

const env = { GITHUB_REPOSITORY: 'Known-Enough/known-enough', GITHUB_REF: 'refs/heads/main',
  GITHUB_ACTOR_ID: '143764700', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_SHA: 'a'.repeat(40),
  EXPECTED_SOURCE: 'a'.repeat(40), CHECKOUT_SOURCE: 'a'.repeat(40) };
const account = '092954139775';
const roleArn = `arn:aws:iam::${account}:role/${RECOVERY_ROLE}`;
const stackArn = `arn:aws:cloudformation:us-east-1:${account}:stack/KnownEnoughOperationsRecovery/synthetic`;
function denied(code, secret = 'SYNTHETIC_PRIVATE_DIAGNOSTIC') {
  return Object.assign(new Error(secret), { stderr: `An error occurred (${code}) when calling a read: ${secret}` });
}
function fixture(patch = {}) {
  const r = setupTemplate().Resources;
  const values = {
    'get-caller-identity': { Account: account, Arn: `arn:aws:sts::${account}:assumed-role/KnownEnoughGithubStagingInspector/synthetic`, UserId: 'SYNTHETIC_PRIVATE_SUBJECT' },
    'describe-stacks': { Stacks: [{ StackName: 'KnownEnoughOperationsRecovery', StackId: stackArn, StackStatus: 'CREATE_COMPLETE', Outputs: [{ OutputValue: 'SYNTHETIC_PRIVATE_OUTPUT' }] }] },
    'get-template': { TemplateBody: JSON.stringify(setupTemplate()) },
    'get-role': { Role: { Arn: roleArn, RoleName: RECOVERY_ROLE, MaxSessionDuration: 3600, AssumeRolePolicyDocument: r.RecoveryRole.Properties.AssumeRolePolicyDocument } },
    'list-role-policies': { PolicyNames: ['ExactRecoveryStorage'], IsTruncated: false },
    'get-role-policy': { RoleName: RECOVERY_ROLE, PolicyName: 'ExactRecoveryStorage', PolicyDocument: r.RecoveryRole.Properties.Policies[0].PolicyDocument },
    'list-attached-role-policies': { AttachedPolicies: [], IsTruncated: false },
    'describe-table': { Table: { TableArn: JOURNAL_ARN, TableStatus: 'ACTIVE', DeletionProtectionEnabled: true,
      BillingModeSummary: { BillingMode: 'PAY_PER_REQUEST' }, SSEDescription: { Status: 'ENABLED' },
      KeySchema: r.Journal.Properties.KeySchema, AttributeDefinitions: r.Journal.Properties.AttributeDefinitions } },
    'describe-continuous-backups': { ContinuousBackupsDescription: { PointInTimeRecoveryDescription: { PointInTimeRecoveryStatus: 'ENABLED' } } },
    'describe-time-to-live': { TimeToLiveDescription: { TimeToLiveStatus: 'DISABLED' } },
    'get-bucket-versioning': { Status: 'Enabled' },
    'get-bucket-encryption': { ServerSideEncryptionConfiguration: { Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' }, BucketKeyEnabled: false }] } },
    'get-public-access-block': { PublicAccessBlockConfiguration: r.Manifests.Properties.PublicAccessBlockConfiguration },
    'get-bucket-ownership-controls': { OwnershipControls: r.Manifests.Properties.OwnershipControls },
    'get-bucket-lifecycle-configuration': denied('NoSuchLifecycleConfiguration'),
    'get-bucket-policy': { Policy: JSON.stringify(r.ManifestPolicy.Properties.PolicyDocument) }, ...patch
  };
  const calls = [];
  const executor = async (command, args, options) => {
    calls.push({ command, args, options });
    const value = values[args[1]];
    assert.notEqual(value, undefined, args[1]);
    if (value instanceof Error) throw value;
    return { stdout: JSON.stringify(value), stderr: '' };
  };
  return { executor, calls, values };
}
test('fixed positive control-plane readback has sixteen bounded sequential calls and never proves effective scope or recovery', async () => {
  const f = fixture(); let active = 0;
  const result = await installedReadback(env, async (...args) => {
    assert.equal(active++, 0); try { return await f.executor(...args); } finally { active--; }
  });
  assert.equal(result.result, 'READBACK_COMPLETE'); assert.equal(result.installation, 'CONFIGURATION_MATCH');
  assert.equal(result.ownOidcIdentity, 'VERIFIED'); assert.equal(result.effectivePermissions, 'UNKNOWN');
  assert.equal(result.managedRecovery, 'NOT_EXECUTED'); assert.equal(result.mutations, 0);
  assert.equal(result.requests, 16); assert.equal(f.calls.length, 16);
  assert.ok(Object.values(result.configuration).every(value => value === 'MATCH'));
  for (const { command, args, options } of f.calls) {
    assert.equal(command, 'aws'); assert.match(args[1], /^(get-|describe-|list-role-policies$|list-attached-role-policies$)/);
    assert.ok(args.includes('--no-paginate')); assert.ok(args.includes('us-east-1'));
    assert.equal(options.timeout, 30000); assert.equal(options.maxBuffer, 131072);
    assert.equal(options.env.AWS_MAX_ATTEMPTS, '1'); assert.equal(options.env.AWS_EC2_METADATA_DISABLED, 'true');
    assert.equal(options.env.AWS_CONFIG_FILE, '/dev/null'); assert.equal(options.env.AWS_SHARED_CREDENTIALS_FILE, '/dev/null');
    if (args[0] === 's3api') assert.equal(args[args.indexOf('--expected-bucket-owner') + 1], account);
  }
  const output = JSON.stringify(result);
  for (const marker of ['SYNTHETIC_PRIVATE', 'AssumeRolePolicyDocument', 'PolicyDocument', 'Outputs', 'UserId']) assert.ok(!output.includes(marker));
});
test('source, actor, event, repository and branch drift rejects before credentials or any subprocess', async () => {
  const f = fixture();
  for (const patch of [{ GITHUB_ACTOR_ID: '44531296' }, { GITHUB_REF: 'refs/heads/other' },
    { GITHUB_REPOSITORY: 'other/known-enough' }, { GITHUB_EVENT_NAME: 'push' },
    { GITHUB_SHA: 'unverified' }, { EXPECTED_SOURCE: 'b'.repeat(40) }, { CHECKOUT_SOURCE: 'b'.repeat(40) }])
    await assert.rejects(installedReadback({ ...env, ...patch }, f.executor), /OPS_SOURCE_REJECTED/);
  assert.deepEqual(f.calls, []);
});
test('wrong account, different role, malformed identity or STS denial blocks before resource reads', async () => {
  for (const identity of [{ Account: '000000000000' },
    { Account: account, Arn: `arn:aws:sts::${account}:assumed-role/OtherRole/synthetic` },
    { Account: account, Arn: `arn:aws:iam::${account}:role/KnownEnoughGithubStagingInspector` },
    denied('ExpiredToken')]) {
    const f = fixture({ 'get-caller-identity': identity }); const result = await installedReadback(env, f.executor);
    assert.equal(result.result, 'BLOCKED'); assert.equal(result.ownOidcIdentity, 'UNKNOWN'); assert.equal(f.calls.length, 1);
  }
});
test('actual access denial is UNKNOWN rather than ABSENT; dependent reads are not blindly retried', async () => {
  const f = fixture(Object.fromEntries(['describe-stacks', 'get-role', 'describe-table', 'get-bucket-versioning']
    .map(op => [op, denied('AccessDenied', 'SYNTHETIC_PRIVATE_DENIAL')])));
  const result = await installedReadback(env, f.executor);
  assert.equal(result.result, 'BLOCKED'); assert.equal(f.calls.length, 5);
  assert.equal(result.reads.filter(read => read.status === 'UNKNOWN' && read.code === 'AccessDenied').length, 4);
  assert.ok(!result.reads.some(read => read.status === 'ABSENT')); assert.ok(!JSON.stringify(result).includes('SYNTHETIC_PRIVATE'));
  assert.ok(Object.values(result.configuration).every(value => value === 'UNKNOWN'));
});
test('only unambiguous missing codes prove exact absence; generic CloudFormation ValidationError remains UNKNOWN', async () => {
  const f = fixture({ 'describe-stacks': denied('ValidationError'), 'get-role': denied('NoSuchEntity'),
    'describe-table': denied('ResourceNotFoundException'), 'get-bucket-versioning': denied('NoSuchBucket') });
  const result = await installedReadback(env, f.executor);
  assert.equal(f.calls.length, 5); assert.equal(result.reads.filter(read => read.status === 'ABSENT').length, 3);
  assert.equal(result.reads[1].status, 'UNKNOWN'); assert.equal(result.reads[1].code, 'ValidationError');
  assert.equal(result.installation, 'UNKNOWN');
});
test('resource drift, trust expansion, extra effective-policy surfaces and retention loss reject matching configuration', async () => {
  for (const [op, change, field] of [
    ['describe-stacks', value => value.Stacks[0].StackId = stackArn.replace(account, '000000000000'), 'stack'],
    ['get-template', value => value.TemplateBody = '{}', 'template'],
    ['get-role', value => value.Role.AssumeRolePolicyDocument.Statement[0].Condition = {}, 'role'],
    ['get-role', value => value.Role.PermissionsBoundary = { PermissionsBoundaryArn: 'synthetic' }, 'role'],
    ['list-role-policies', value => value.IsTruncated = true, 'inlineNames'],
    ['get-role-policy', value => value.PolicyDocument.Statement.push({ Effect: 'Allow', Action: 'iam:*', Resource: '*' }), 'inlinePolicy'],
    ['list-attached-role-policies', value => value.AttachedPolicies.push({ PolicyArn: 'synthetic-extra' }), 'attachedPolicies'],
    ['describe-table', value => value.Table.TableArn = JOURNAL_ARN + '-other', 'table'],
    ['describe-table', value => value.Table.DeletionProtectionEnabled = false, 'table'],
    ['describe-continuous-backups', value => value.ContinuousBackupsDescription.PointInTimeRecoveryDescription.PointInTimeRecoveryStatus = 'DISABLED', 'backups'],
    ['describe-time-to-live', value => value.TimeToLiveDescription.TimeToLiveStatus = 'ENABLED', 'ttl'],
    ['get-bucket-versioning', value => value.Status = 'Suspended', 'versioning'],
    ['get-public-access-block', value => value.PublicAccessBlockConfiguration.BlockPublicPolicy = false, 'publicAccess'],
    ['get-bucket-ownership-controls', value => value.OwnershipControls.Rules = [], 'ownership'],
    ['get-bucket-lifecycle-configuration', value => value.Rules.push({ Expiration: { Days: 1 } }), 'lifecycle'],
    ['get-bucket-policy', value => value.Policy = '{"Statement":[]}', 'bucketPolicy']
  ]) {
    const f = fixture({ 'get-bucket-lifecycle-configuration': { Rules: [] } }); change(f.values[op]);
    const result = await installedReadback(env, f.executor);
    assert.equal(result.result, 'BLOCKED', op); assert.equal(result.configuration[field], 'MISMATCH', op);
  }
});
test('valid key ordering and ordinary AWS serialization preserve configuration comparison', async () => {
  const f = fixture(); f.values['describe-table'].Table.AttributeDefinitions.reverse();
  const role = f.values['get-role'].Role;
  role.AssumeRolePolicyDocument = JSON.stringify(Object.fromEntries(Object.entries(role.AssumeRolePolicyDocument).reverse()));
  f.values['get-template'].TemplateBody = setupTemplate();
  const result = await installedReadback(env, f.executor); assert.equal(result.result, 'READBACK_COMPLETE');
});
test('lifecycle absence is configured preservation, while lifecycle access denial remains UNKNOWN', async () => {
  const f = fixture({ 'get-bucket-lifecycle-configuration': denied('AccessDeniedException') });
  const result = await installedReadback(env, f.executor);
  assert.equal(result.configuration.lifecycle, 'UNKNOWN'); assert.equal(result.result, 'BLOCKED');
});
test('malformed and oversized responses never become absence or leak private values', async () => {
  for (const stdout of ['SYNTHETIC_PRIVATE_INVALID_JSON', '[]', 'null', ' '.repeat(131073)]) {
    const f = fixture(); const result = await installedReadback(env, async (...args) =>
      args[1][1] === 'describe-stacks' ? { stdout } : f.executor(...args));
    assert.equal(result.result, 'BLOCKED'); assert.equal(result.reads[1].status, 'UNKNOWN');
    assert.equal(result.reads[1].code, 'AWS_READ_FAILED'); assert.ok(!JSON.stringify(result).includes('SYNTHETIC_PRIVATE'));
  }
});
test('unlisted diagnostics and local missing CLI/timeout failures expose only finite codes', async () => {
  for (const [error, expected] of [[denied('SECRET_CANARY', 'SYNTHETIC_PRIVATE_DETAIL'), 'AWS_READ_FAILED'],
    [Object.assign(new Error('SYNTHETIC_PRIVATE_DETAIL'), { code: 'ENOENT' }), 'AWS_CLI_UNAVAILABLE'],
    [Object.assign(new Error('SYNTHETIC_PRIVATE_DETAIL'), { killed: true }), 'AWS_READ_TIMEOUT']]) {
    const result = await installedReadback(env, async () => { throw error; });
    assert.equal(result.reads[0].code, expected); assert.equal(result.requests, 1);
    assert.ok(!JSON.stringify(result).includes('SYNTHETIC_PRIVATE')); assert.ok(!JSON.stringify(result).includes('SECRET_CANARY'));
  }
});
test('physical deadline closes remaining reads rather than launching late requests', async () => {
  const f = fixture(); let now = 0;
  const result = await installedReadback(env, async (...args) => {
    const value = await f.executor(...args); now += 480001; return value;
  }, () => now);
  assert.equal(result.requests, 1); assert.equal(f.calls.length, 1); assert.equal(result.result, 'BLOCKED');
  assert.equal(result.reads.filter(read => read.code === 'READ_BUDGET_EXHAUSTED').length, 4);
});
test('AWS endpoint/profile overrides cannot retarget the fixed read-only requests or use local credential files', async () => {
  const keys = ['AWS_ENDPOINT_URL', 'AWS_ENDPOINT_URL_IAM', 'AWS_PROFILE', 'AWS_ROLE_ARN', 'AWS_CONTAINER_CREDENTIALS_FULL_URI'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) process.env[key] = 'SYNTHETIC_PRIVATE_OVERRIDE';
    const f = fixture(); await installedReadback(env, f.executor);
    for (const { args, options } of f.calls) {
      for (const key of keys) assert.equal(options.env[key], undefined);
      assert.ok(!args.includes('SYNTHETIC_PRIVATE_OVERRIDE'));
    }
  } finally { for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } }
});
test('workflow uses the existing inspector with source and own-B guards before OIDC; no recovery enablement or deployment', () => {
  const source = readFileSync(new URL('../../.github/workflows/operations-intake.yml', import.meta.url), 'utf8');
  assert.ok(source.includes("github.actor_id == '143764700'")); assert.ok(source.includes("github.ref == 'refs/heads/main'"));
  assert.ok(source.includes('KnownEnoughGithubStagingInspector')); assert.ok(source.indexOf('verify.mjs') < source.indexOf('configure-aws-credentials'));
  assert.ok(source.includes('cancel-in-progress: false')); assert.ok(source.includes('if: always()'));
  assert.ok(!source.includes('OPERATIONS_RECOVERY_ENABLED')); assert.ok(!source.includes('live-qa-release'));
  assert.ok(!source.includes('secrets.')); assert.ok(source.includes('operations-intake-result'));
  assert.equal(MANIFEST_BUCKET, 'known-enough-operations-recovery-092954139775-us-east-1');
});
