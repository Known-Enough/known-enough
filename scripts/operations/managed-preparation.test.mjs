import { test } from 'node:test';
import assert from 'node:assert/strict';
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
