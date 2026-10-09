import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat, access, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { runScopeProbes, managedScope, verifyScopeInput, safeScopeFailure } from './managed-scope.mjs';
import { setupTemplate, JOURNAL_ARN, RECOVERY_ROLE } from './setup.mjs';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const env = { GITHUB_REPOSITORY: 'Known-Enough/known-enough', GITHUB_REF: 'refs/heads/main', GITHUB_ACTOR_ID: '143764700',
  GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_SHA: 'a'.repeat(40), EXPECTED_SOURCE: 'a'.repeat(40), CHECKOUT_SOURCE: 'a'.repeat(40),
  OPERATIONS_RECOVERY_ENABLED: 'true', PROBE_ID: '12345678-1234-4123-8123-123456789abc', EXPECTED_MANIFEST_VERSION_HASH: digest('synthetic-v1') };
const operations = { 'get-item': 'GetItem', 'describe-table': 'DescribeTable', 'get-object': 'GetObject', 'get-role': 'GetRole', 'assume-role': 'AssumeRole' };
const deny = async (_file, args) => {
  const code = args[0] === 'dynamodb' ? 'AccessDeniedException' : 'AccessDenied';
  throw { stderr: `\nAn error occurred (${code}) when calling the ${operations[args[1]]} operation: SYNTHETIC_PRIVATE_MESSAGE` };
};
function fixture(patch = {}, version = 'synthetic-v1') {
  const resources = setupTemplate().Resources; const calls = [];
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, synthetic: true, probeId: env.PROBE_ID }));
  const responses = {
    GetCallerIdentity: { Account: '092954139775', Arn: `arn:aws:sts::092954139775:assumed-role/${RECOVERY_ROLE}/synthetic` },
    DescribeTable: { Table: { TableArn: JOURNAL_ARN, TableStatus: 'ACTIVE', DeletionProtectionEnabled: true,
      BillingModeSummary: { BillingMode: 'PAY_PER_REQUEST' }, SSEDescription: { Status: 'ENABLED' },
      KeySchema: resources.Journal.Properties.KeySchema, AttributeDefinitions: resources.Journal.Properties.AttributeDefinitions } },
    DescribeContinuousBackups: { ContinuousBackupsDescription: { PointInTimeRecoveryDescription: { PointInTimeRecoveryStatus: 'ENABLED' } } },
    DescribeTimeToLive: { TimeToLiveDescription: { TimeToLiveStatus: 'DISABLED' } },
    GetBucketVersioning: { Status: 'Enabled' }, GetBucketEncryption: { ServerSideEncryptionConfiguration: { Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] } },
    GetPublicAccessBlock: { PublicAccessBlockConfiguration: resources.Manifests.Properties.PublicAccessBlockConfiguration },
    GetBucketOwnershipControls: { OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] } },
    GetBucketLifecycleConfiguration: { Rules: [] }, GetBucketPolicy: { Policy: JSON.stringify(resources.ManifestPolicy.Properties.PolicyDocument) },
    GetObject: { Body: bytes, VersionId: version }, ...patch
  };
  return { calls, transport: async (op, input) => {
    calls.push({ op, input }); assert.ok(Object.hasOwn(responses, op), 'No storage or policy mutation allowed'); return responses[op];
  } };
}
test('all source, identity, enablement, recovery and fingerprint inputs fail before AWS', async () => {
  const f = fixture(); let probeCalls = 0;
  for (const patch of [{ GITHUB_ACTOR_ID: 'other' }, { GITHUB_REF: 'refs/heads/other' }, { GITHUB_EVENT_NAME: 'push' },
    { CHECKOUT_SOURCE: 'b'.repeat(40) }, { OPERATIONS_RECOVERY_ENABLED: 'false' }, { PROBE_ID: 'private' },
    { EXPECTED_MANIFEST_VERSION_HASH: '' }, { EXPECTED_MANIFEST_VERSION_HASH: ['a'.repeat(64)] }]) {
    await assert.rejects(managedScope({ ...env, ...patch }, f.transport, async () => { probeCalls++; }));
  }
  assert.deepEqual(f.calls, []); assert.equal(probeCalls, 0);
});
test('inputs are captured once before asynchronous installation readback', async () => {
  let reads = 0;
  const input = { ...env, get PROBE_ID() { reads++; return reads === 1 ? env.PROBE_ID : 'private'; } };
  const f = fixture(); const report = await managedScope(input, f.transport, deny);
  assert.equal(reads, 1); assert.equal(report.result, 'BOUNDED_PROBES_VERIFIED');
  assert.ok(Object.isFrozen(verifyScopeInput(env)));
});
test('non-primitive synthetic identifiers are rejected without conversion or serialization', async () => {
  let coercions = 0; const f = fixture();
  const probe = { toString() { coercions++; return env.PROBE_ID; }, toJSON() { coercions++; return env.PROBE_ID; } };
  for (const value of [probe, new String(env.PROBE_ID), [env.PROBE_ID]]) await assert.rejects(managedScope({ ...env, PROBE_ID: value }, f.transport, deny));
  assert.equal(coercions, 0); assert.deepEqual(f.calls, []);
});
test('installation, immutable content and original version fingerprint reject before diagnostic requests', async () => {
  let requests = 0;
  const failures = [fixture({ GetCallerIdentity: { Account: 'other' } }), fixture({ GetBucketVersioning: { Status: 'Suspended' } }),
    fixture({ GetObject: { Body: Buffer.from('{}'), VersionId: 'synthetic-v1' } }), fixture({}, 'synthetic-v2')];
  for (const f of failures) await assert.rejects(managedScope(env, f.transport, async () => { requests++; }));
  assert.equal(requests, 0);
});
test('five fixed probes use private files, one-byte download range, bounded execution and cleanup', async () => {
  const directories = []; const requests = [];
  const result = await runScopeProbes(async (file, args, options) => {
    assert.equal(file, 'aws'); assert.equal(options.timeout, 30000); assert.equal(options.maxBuffer, 16384);
    assert.equal(options.env.AWS_MAX_ATTEMPTS, '1'); assert.equal(options.env.AWS_CONFIG_FILE, '/dev/null');
    assert.equal(options.env.AWS_SHARED_CREDENTIALS_FILE, '/dev/null');
    assert.ok(args.includes('us-east-1')); assert.ok(!args.join(' ').includes('OUTSIDE#'));
    const paths = args.filter(arg => arg.startsWith('file://')).map(arg => arg.slice(7));
    const directory = dirname(paths[0]); directories.push(directory);
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    for (const path of paths) assert.equal((await stat(path)).mode & 0o777, 0o600);
    if (args[1] === 'get-object') {
      assert.equal(paths.length, 4); assert.equal(await readFile(paths[2], 'utf8'), 'bytes=0-0');
      assert.equal(await readFile(paths[3], 'utf8'), '092954139775'); assert.ok(args.at(-1).startsWith(directory));
      assert.ok(!args.includes('--cli-input-json'));
    } else requests.push(JSON.parse(await readFile(paths[0], 'utf8')));
    return deny(file, args);
  });
  assert.equal(result.length, 5); assert.ok(result.every(probe => probe.outcome === 'DENIED'));
  assert.equal(requests[0].Key.PK.S, 'OUTSIDE#SYNTHETIC_SCOPE_PROBE'); assert.equal(requests[0].ConsistentRead, true);
  assert.equal(requests[1].TableName, 'KnownEnoughGroupsStage'); assert.equal(requests[2].RoleName, RECOVERY_ROLE);
  assert.equal(requests[3].RoleArn, `arn:aws:iam::092954139775:role/${RECOVERY_ROLE}`); assert.equal(requests[3].DurationSeconds, 900);
  assert.equal(new Set(directories).size, 5);
  for (const directory of directories) await assert.rejects(access(directory));
});
test('custom endpoint environment is excluded from every diagnostic request', async () => {
  const key = 'AWS_ENDPOINT_URL_STS'; const previous = process.env[key]; process.env[key] = 'http://synthetic-private';
  try { await runScopeProbes(async (file, args, options) => { assert.ok(!Object.hasOwn(options.env, key)); return deny(file, args); }); }
  finally { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; }
});
test('wrong denial code, wrong operation, absence and local failures never become denied PASS', async () => {
  for (const stderr of ['An error occurred (AccessDenied) when calling the PutItem operation: private',
    'An error occurred (ResourceNotFoundException) when calling the GetItem operation: private',
    'An error occurred (AccessDenied) when calling the GetItem operation: private', 'private\nAccessDenied',
    'x'.repeat(16385), undefined]) {
    const outcomes = await runScopeProbes(async () => { throw { stderr, name: 'AccessDeniedException' }; });
    assert.equal(outcomes[0].outcome, 'UNVERIFIED');
    assert.ok(!JSON.stringify(outcomes).includes('private'));
  }
});
test('stderr is captured once and unreadable diagnostics remain finite', async () => {
  let reads = 0;
  const outcomes = await runScopeProbes(async (_file, args) => { throw { get stderr() {
    reads++; return `An error occurred (${args[0] === 'dynamodb' ? 'AccessDeniedException' : 'AccessDenied'}) when calling the ${operations[args[1]]} operation: private`;
  } }; });
  assert.equal(reads, 5); assert.ok(outcomes.every(probe => probe.outcome === 'DENIED'));
  const unreadable = await runScopeProbes(async () => { throw { get stderr() { throw new Error('private'); } }; });
  assert.ok(unreadable.every(probe => probe.code === 'CLI_FAILURE' && probe.outcome === 'UNVERIFIED'));
});
test('AWS ClientError zero-retry suffix preserves the exact denied code and operation', async () => {
  const outcomes = await runScopeProbes(async (_file, args) => { throw { stderr:
    `\nAn error occurred (${args[0] === 'dynamodb' ? 'AccessDeniedException' : 'AccessDenied'}) when calling the ${operations[args[1]]} operation (reached max retries: 0): SYNTHETIC_PRIVATE_MESSAGE` }; });
  assert.ok(outcomes.every(probe => probe.outcome === 'DENIED'));
  assert.ok(!JSON.stringify(outcomes).includes('SYNTHETIC_PRIVATE'));
});
test('nonzero, malformed retry suffixes and wrong operations remain unverified', async () => {
  for (const suffix of [' (reached max retries: 1)', ' (reached max retries: -1)', ' (reached max retries: private)', ' (private)']) {
    const outcomes = await runScopeProbes(async () => { throw { stderr:
      `An error occurred (AccessDeniedException) when calling the GetItem operation${suffix}: SYNTHETIC_PRIVATE_MESSAGE` }; });
    assert.equal(outcomes[0].outcome, 'UNVERIFIED'); assert.equal(outcomes[0].code, 'CLI_FAILURE');
  }
  const wrong = await runScopeProbes(async () => { throw { stderr:
    'An error occurred (AccessDeniedException) when calling the PutItem operation (reached max retries: 0): private' }; });
  assert.equal(wrong[0].outcome, 'UNVERIFIED');
});
test('real subprocess errors support the canonical CLI wrapper with pinned noninteractive legacy formatting', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ke-fake-cli-'));
  const previous = { PATH: process.env.PATH, AWS_CLI_ERROR_FORMAT: process.env.AWS_CLI_ERROR_FORMAT, AWS_CLI_AUTO_PROMPT: process.env.AWS_CLI_AUTO_PROMPT };
  const script = `#!${process.execPath}\nconst commands = ${JSON.stringify(operations)};
    if (process.env.AWS_CLI_ERROR_FORMAT !== 'legacy' || process.env.AWS_CLI_AUTO_PROMPT !== 'off') {
      process.stderr.write('SYNTHETIC_WRONG_FORMAT_CONFIGURATION'); process.exit(252);
    }
    const code = process.argv[2] === 'dynamodb' ? 'AccessDeniedException' : 'AccessDenied';
    process.stderr.write('\\naws: [ERROR]: An error occurred (' + code + ') when calling the ' + commands[process.argv[3]] + ' operation (reached max retries: 0): SYNTHETIC_PRIVATE_MESSAGE\\n');
    process.exit(254);\n`;
  try {
    await writeFile(join(directory, 'aws'), script, { mode: 0o700 });
    process.env.PATH = `${directory}:${previous.PATH}`;
    process.env.AWS_CLI_ERROR_FORMAT = 'json'; process.env.AWS_CLI_AUTO_PROMPT = 'on';
    const outcomes = await runScopeProbes();
    assert.equal(outcomes.length, 5); assert.ok(outcomes.every(probe => probe.outcome === 'DENIED'));
    assert.ok(!JSON.stringify(outcomes).includes('SYNTHETIC_PRIVATE'));
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(directory, { recursive: true, force: true });
  }
});
test('canonical CLI prefix allows only the same code and operation, never arbitrary banners', async () => {
  const allowed = await runScopeProbes(async (_file, args) => { throw { stderr:
    `\naws: [ERROR]: An error occurred (${args[0] === 'dynamodb' ? 'AccessDeniedException' : 'AccessDenied'}) when calling the ${operations[args[1]]} operation: private` }; });
  assert.ok(allowed.every(probe => probe.outcome === 'DENIED'));
  for (const prefix of ['aws: [WARNING]: ', 'SYNTHETIC_PRIVATE: ', 'aws: [ERROR]: aws: [ERROR]: ']) {
    const outcomes = await runScopeProbes(async () => { throw { stderr: `${prefix}An error occurred (AccessDeniedException) when calling the GetItem operation: private` }; });
    assert.equal(outcomes[0].outcome, 'UNVERIFIED');
  }
});
test('unexpected successful data and credentials are discarded without accessing response properties or retrying', async () => {
  let calls = 0; let outputReads = 0;
  const outcomes = await runScopeProbes(async () => { calls++; return { get stdout() { outputReads++; throw new Error('private credentials'); } }; });
  assert.equal(calls, 5); assert.equal(outputReads, 0); assert.ok(outcomes.every(probe => probe.outcome === 'UNEXPECTED_SUCCESS'));
  assert.ok(!JSON.stringify(outcomes).includes('private'));
});
test('only the tested finite outcomes are published; source/content/version and proof limits stay honest', async () => {
  const f = fixture(); const report = await managedScope(env, f.transport, deny);
  assert.equal(report.result, 'BOUNDED_PROBES_VERIFIED'); assert.equal(report.syntheticManifestVersionHash, env.EXPECTED_MANIFEST_VERSION_HASH);
  assert.equal(f.calls.at(-1).op, 'GetObject'); assert.equal(f.calls.length, 11);
  assert.equal(report.limits.existingOutsideS3ObjectProof, 'NOT_EXECUTED'); assert.equal(report.limits.iamMutationProof, 'NOT_EXECUTED');
  assert.equal(report.limits.denyPolicyAttribution, 'NOT_ESTABLISHED'); assert.equal(report.policyMutation, 'NOT_EXECUTED');
  const published = JSON.stringify(report);
  for (const value of [env.PROBE_ID, 'synthetic-v1', 'SYNTHETIC_PRIVATE', 'Credentials', 'Body', 'VersionId']) assert.ok(!published.includes(value));
});
test('one unexpected success fails the managed run while retaining the exact bounded outcomes', async () => {
  const report = await managedScope(env, fixture().transport, async (file, args) => args[1] === 'assume-role' ? {} : deny(file, args));
  assert.equal(report.result, 'FAILED'); assert.equal(report.probes.at(-1).outcome, 'UNEXPECTED_SUCCESS');
  assert.equal(report.probes.filter(probe => probe.outcome === 'DENIED').length, 4);
});
test('preflight failure summary never serializes untrusted errors', () => {
  const report = safeScopeFailure({ get name() { throw new Error('private'); }, toJSON() { throw new Error('private'); } });
  assert.equal(report.classification, 'OPS_SCOPE_PREFLIGHT_FAILED'); assert.equal(report.probes, 'NOT_COMPLETED');
  assert.ok(!JSON.stringify(report).includes('private'));
});
test('manual workflow shares the owned recovery concurrency and verifies before the fixed role credentials', () => {
  const workflow = readFileSync('.github/workflows/operations-scope.yml', 'utf8');
  assert.ok(workflow.includes("github.actor_id == '143764700'")); assert.ok(workflow.includes('group: known-enough-operations-recovery'));
  assert.ok(workflow.includes('cancel-in-progress: false')); assert.ok(workflow.includes('timeout-minutes: 10'));
  assert.ok(workflow.indexOf('verifyScopeInput(process.env)') < workflow.indexOf('aws-actions/configure-aws-credentials'));
  assert.ok(workflow.includes('role-to-assume: arn:aws:iam::092954139775:role/KnownEnoughGithubOperationsRecovery'));
  assert.ok(!workflow.includes('schedule:') && !workflow.includes('contents: write'));
});
