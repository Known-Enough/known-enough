import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { managedPreparation, inspectInstallation, safeFailure } from './managed-preparation.mjs';
import { setupTemplate, JOURNAL_ARN, RECOVERY_ROLE } from './setup.mjs';
const env = { GITHUB_REPOSITORY: 'Known-Enough/known-enough', GITHUB_REF: 'refs/heads/main', GITHUB_ACTOR_ID: '143764700', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_SHA: 'a'.repeat(40), EXPECTED_SOURCE: 'a'.repeat(40), CHECKOUT_SOURCE: 'a'.repeat(40), OPERATIONS_RECOVERY_ENABLED: 'true', PROBE_ID: '12345678-1234-4123-8123-123456789abc' };
function fixture(patch = {}) {
  let manifest; let journal; const calls = [];
  const resources = setupTemplate().Resources;
  const responses = {
    GetCallerIdentity: { Account: '092954139775', Arn: `arn:aws:sts::092954139775:assumed-role/${RECOVERY_ROLE}/synthetic` },
    DescribeTable: { Table: { TableArn: JOURNAL_ARN, TableStatus: 'ACTIVE', DeletionProtectionEnabled: true, BillingModeSummary: { BillingMode: 'PAY_PER_REQUEST' }, SSEDescription: { Status: 'ENABLED' }, KeySchema: resources.Journal.Properties.KeySchema, AttributeDefinitions: resources.Journal.Properties.AttributeDefinitions } },
    DescribeContinuousBackups: { ContinuousBackupsDescription: { PointInTimeRecoveryDescription: { PointInTimeRecoveryStatus: 'ENABLED' } } },
    DescribeTimeToLive: { TimeToLiveDescription: { TimeToLiveStatus: 'DISABLED' } },
    GetBucketVersioning: { Status: 'Enabled' }, GetBucketEncryption: { ServerSideEncryptionConfiguration: { Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] } },
    GetPublicAccessBlock: { PublicAccessBlockConfiguration: resources.Manifests.Properties.PublicAccessBlockConfiguration },
    GetBucketOwnershipControls: { OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] } }, GetBucketLifecycleConfiguration: { Rules: [] },
    GetBucketPolicy: { Policy: JSON.stringify(resources.ManifestPolicy.Properties.PolicyDocument) }, ...patch
  };
  const transport = async (op, input) => {
    calls.push(op);
    if (Object.hasOwn(responses, op)) return responses[op];
    if (op === 'PutObject') { if (manifest) throw Object.assign(new Error('private duplicate'), { name: 'PreconditionFailed' }); manifest = { VersionId: 'v1', Body: Buffer.from(input.Body) }; return { VersionId: 'v1' }; }
    if (op === 'GetObject') return manifest;
    if (op === 'PutItem') { if (journal) throw Object.assign(new Error('duplicate'), { name: 'ConditionalCheckFailedException' }); journal = structuredClone(input.Item); return {}; }
    if (op === 'GetItem') return { Item: journal };
    throw new Error('unexpected operation');
  };
  return { transport, calls };
}
test('source, installed flag and synthetic identifier reject before any AWS access', async () => {
  const f = fixture();
  for (const patch of [{ GITHUB_ACTOR_ID: 'other' }, { CHECKOUT_SOURCE: 'b'.repeat(40) }, { OPERATIONS_RECOVERY_ENABLED: 'false' }, { PROBE_ID: 'private arbitrary input' }]) await assert.rejects(managedPreparation({ ...env, ...patch }, f.transport));
  assert.deepEqual(f.calls, []);
});
test('installed identity/storage/preservation checks precede mutation and fail closed', async () => {
  for (const patch of [{ GetCallerIdentity: { Account: 'different' } }, { GetBucketVersioning: { Status: 'Suspended' } }, { GetPublicAccessBlock: { PublicAccessBlockConfiguration: {} } }, { GetBucketPolicy: { Policy: '{"Statement":[]}' } }, { DescribeContinuousBackups: {} }, { DescribeTimeToLive: { TimeToLiveDescription: { TimeToLiveStatus: 'ENABLED' } } }, { GetBucketLifecycleConfiguration: { Rules: [{ Expiration: { Days: 1 } }] } }]) {
    const f = fixture(patch); await assert.rejects(managedPreparation(env, f.transport));
    assert.ok(!f.calls.includes('PutObject') && !f.calls.includes('PutItem'));
  }
});
test('representative preparation and rerun resume durable simulated recovery without participant apply', async () => {
  const f = fixture(); const first = await managedPreparation(env, f.transport); const second = await managedPreparation(env, f.transport);
  assert.deepEqual(first, second); assert.equal(first.operationExecution, 'NOT_EXECUTED'); assert.equal(first.storageRevision, 0);
  assert.ok(f.calls.indexOf('GetBucketPolicy') < f.calls.indexOf('PutObject'));
  assert.ok(!JSON.stringify(first).includes(env.PROBE_ID)); assert.equal(first.state, 'PREPARED');
});
test('IAM policy JSON key order does not cause a false configuration mismatch', async () => {
  const original = setupTemplate().Resources.ManifestPolicy.Properties.PolicyDocument;
  original.Statement = original.Statement.map(s => Object.fromEntries(Object.entries(s).reverse()));
  await inspectInstallation(fixture({ GetBucketPolicy: { Policy: JSON.stringify(original) } }).transport);
});
test('absent S3 lifecycle is accepted while other service denials remain failures', async () => {
  const f = fixture();
  await inspectInstallation(async (op, input) => {
    if (op === 'GetBucketLifecycleConfiguration') throw Object.assign(new Error('no lifecycle'), { name: 'NoSuchLifecycleConfiguration' });
    return f.transport(op, input);
  });
  await assert.rejects(inspectInstallation(async (op, input) => {
    if (op === 'GetBucketLifecycleConfiguration') throw Object.assign(new Error('private denial'), { name: 'AccessDenied' });
    return f.transport(op, input);
  }), { name: 'AccessDenied' });
});
test('safe failed result preserves only exact allowlisted classification and never private cause', () => {
  const inner = Object.assign(new Error('private payload'), { name: 'AccessDenied' });
  const result = safeFailure(new Error('OPS_MANIFEST_STORAGE_FAILED', { cause: inner }));
  assert.equal(result.classification, 'AccessDenied'); assert.ok(!JSON.stringify(result).includes('private'));
});

const failure = classification => ({ result: 'FAILED', classification,
  storagePreparation: 'UNKNOWN', operationExecution: 'NOT_EXECUTED' });
const genericFailure = failure('OPS_PREPARATION_FAILED');
test('failure names are captured once before publishing each allowed classification', () => {
  for (const code of ['AccessDenied', 'AccessDeniedException', 'ResourceNotFoundException', 'NoSuchKey',
    'NoSuchBucket', 'ExpiredToken', 'RequestTimeout']) {
    let reads = 0;
    const error = { get name() { return ++reads === 1 ? code : 'synthetic-private-name'; },
      get cause() { throw new Error('synthetic-private-unused-cause'); } };
    assert.deepEqual(safeFailure(error), failure(code));
    assert.equal(reads, 1);
  }
});
test('unreadable error names return a finite result without reading more properties', () => {
  let causeReads = 0;
  const unreadable = { get name() { throw new Error('synthetic-private-name'); },
    get cause() { causeReads++; return { name: 'AccessDenied' }; } };
  for (const error of [unreadable, new Error('wrapper', { cause: unreadable })]) {
    assert.deepEqual(safeFailure(error), genericFailure);
  }
  assert.equal(causeReads, 0);
});
test('unreadable causes cannot escape root or nested failure sanitization', () => {
  let reads = 0;
  const unreadable = { name: 'Unrecognized', get cause() { reads++; throw new Error('synthetic-private-cause'); } };
  for (const error of [unreadable, new Error('wrapper', { cause: unreadable })]) {
    assert.deepEqual(safeFailure(error), genericFailure);
  }
  assert.equal(reads, 2);
});
test('only primitive allowlisted names reach the public result without coercion or serialization', () => {
  let invoked = 0;
  const object = { toString() { invoked++; return 'AccessDenied'; },
    toJSON() { invoked++; return 'synthetic-private-json'; } };
  for (const name of [object, new String('AccessDenied'), ['AccessDenied'], Symbol('private'),
    1, null, undefined, () => 'AccessDenied', 'AccessDenied\nsynthetic-private']) {
    const report = safeFailure({ name });
    assert.deepEqual(report, genericFailure);
    assert.equal(JSON.stringify(report), JSON.stringify(genericFailure));
  }
  assert.equal(invoked, 0);
});
test('nested classification retains the five-level bound and terminates cycles', () => {
  const nested = depth => Array.from({ length: depth }).reduce(error => ({ name: 'Wrapper', cause: error }),
    { name: 'AccessDenied' });
  assert.deepEqual(safeFailure(nested(4)), failure('AccessDenied'));
  assert.deepEqual(safeFailure(nested(5)), genericFailure);
  let reads = 0;
  const cycle = { name: 'Wrapper', get cause() { reads++; return cycle; } };
  assert.deepEqual(safeFailure(cycle), genericFailure);
  assert.equal(reads, 5);
});
test('actual preparation failure publishes the captured code before any synthetic mutation', async () => {
  const calls = []; let reads = 0;
  const error = { get name() { return ++reads === 1 ? 'AccessDenied' : 'synthetic-private-provider'; } };
  let observed;
  try { await managedPreparation(env, async operation => { calls.push(operation); throw error; }); }
  catch (caught) { observed = safeFailure(caught); }
  assert.deepEqual(observed, failure('AccessDenied'));
  assert.deepEqual(calls, ['GetCallerIdentity']);
  assert.equal(reads, 1);
});
test('the command-line reporting pattern emits finite JSON with empty stderr for unreadable errors', () => {
  const url = new URL('./managed-preparation.mjs', import.meta.url).href;
  const script = `import { safeFailure } from ${JSON.stringify(url)};
    try { throw { name: 'Unknown', get cause() { throw new Error('synthetic-private-subprocess'); } }; }
    catch (error) { console.log(JSON.stringify(safeFailure(error))); }`;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script],
    { encoding: 'utf8', timeout: 5000, maxBuffer: 8192 });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), genericFailure);
});
