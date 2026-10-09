import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { verifySource, verificationReport } from './verify.mjs';
import { awsTransport } from './aws-transport.mjs';
import { dynamoJournal } from './dynamo-journal.mjs';
import { prepareRecovery } from './recovery.mjs';
import { MANIFEST_BUCKET } from './manifest.mjs';
import { JOURNAL_ARN, RECOVERY_ROLE, setupTemplate } from './setup.mjs';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
// Context is produced by this fixed workload, never copied from provider errors.
const failures = new WeakMap();
const bucketArn = `arn:aws:s3:::${MANIFEST_BUCKET}`;
const targets = Object.freeze({ GetCallerIdentity: `arn:aws:iam::092954139775:role/${RECOVERY_ROLE}`,
  DescribeTable: JOURNAL_ARN, DescribeContinuousBackups: JOURNAL_ARN, DescribeTimeToLive: JOURNAL_ARN,
  GetBucketVersioning: bucketArn, GetBucketEncryption: bucketArn, GetPublicAccessBlock: bucketArn,
  GetBucketOwnershipControls: bucketArn, GetBucketLifecycleConfiguration: bucketArn, GetBucketPolicy: bucketArn,
  PutObject: `${bucketArn}/manifests/*`, HeadObject: `${bucketArn}/manifests/*`, GetObject: `${bucketArn}/manifests/*`,
  PutItem: JOURNAL_ARN, GetItem: JOURNAL_ARN });
function context(op, phase, check) {
  const service = op === 'GetCallerIdentity' ? 'sts' : ['DescribeTable', 'DescribeContinuousBackups', 'DescribeTimeToLive', 'PutItem', 'GetItem'].includes(op) ? 'dynamodb' : 's3';
  const action = ({ GetPublicAccessBlock: 'GetBucketPublicAccessBlock', GetBucketEncryption: 'GetEncryptionConfiguration',
    HeadObject: 'GetObject', GetObject: 'GetObjectVersion' })[op] ?? op;
  return Object.freeze({ phase, action: `${service}:${action}`, target: targets[op], ...(check ? { check } : {}) });
}
function requireInstalled(condition, op, check) {
  if (!condition) {
    const error = new Error('OPS_INSTALLATION_REJECTED');
    failures.set(error, context(op, 'INSTALLATION_READBACK', check));
    throw error;
  }
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export function verifyManagedInput(env) {
  const source = verifySource(env);
  if (env.OPERATIONS_RECOVERY_ENABLED !== 'true' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(env.PROBE_ID ?? '')) throw new Error('OPS_INSTALLATION_REQUIRED');
  return source;
}
export async function inspectInstallation(transport) {
  const identity = await transport('GetCallerIdentity', {});
  requireInstalled(identity.Account === '092954139775' && identity.Arn?.startsWith(`arn:aws:sts::092954139775:assumed-role/${RECOVERY_ROLE}/`), 'GetCallerIdentity', 'IDENTITY');
  const { Table } = await transport('DescribeTable', { TableName: 'KnownEnoughOperationsJournal' });
  requireInstalled(Table?.TableArn === JOURNAL_ARN && Table.TableStatus === 'ACTIVE', 'DescribeTable', 'TABLE_IDENTITY_STATUS');
  requireInstalled(Table.DeletionProtectionEnabled === true && Table.BillingModeSummary?.BillingMode === 'PAY_PER_REQUEST', 'DescribeTable', 'TABLE_PROTECTION_BILLING');
  requireInstalled(Table.SSEDescription?.Status === 'ENABLED', 'DescribeTable', 'TABLE_ENCRYPTION');
  requireInstalled(JSON.stringify(Table.KeySchema) === JSON.stringify(setupTemplate().Resources.Journal.Properties.KeySchema), 'DescribeTable', 'TABLE_KEY_SCHEMA');
  requireInstalled(Table.AttributeDefinitions?.length === 2 && new Set(Table.AttributeDefinitions.map(a => a.AttributeName)).size === 2
    && Table.AttributeDefinitions.every(a => ['PK', 'SK'].includes(a.AttributeName) && a.AttributeType === 'S'), 'DescribeTable', 'TABLE_ATTRIBUTES');
  const backups = await transport('DescribeContinuousBackups', { TableName: 'KnownEnoughOperationsJournal' });
  requireInstalled(backups.ContinuousBackupsDescription?.PointInTimeRecoveryDescription?.PointInTimeRecoveryStatus === 'ENABLED', 'DescribeContinuousBackups', 'TABLE_BACKUPS');
  requireInstalled((await transport('DescribeTimeToLive', { TableName: 'KnownEnoughOperationsJournal' })).TimeToLiveDescription?.TimeToLiveStatus === 'DISABLED', 'DescribeTimeToLive', 'TABLE_TTL');
  const input = { Bucket: MANIFEST_BUCKET };
  requireInstalled((await transport('GetBucketVersioning', input)).Status === 'Enabled', 'GetBucketVersioning', 'MANIFEST_VERSIONING');
  const encryption = await transport('GetBucketEncryption', input);
  const rules = encryption.ServerSideEncryptionConfiguration?.Rules;
  requireInstalled(Array.isArray(rules) && rules.length === 1 && rules[0].ApplyServerSideEncryptionByDefault?.SSEAlgorithm === 'AES256', 'GetBucketEncryption', 'MANIFEST_ENCRYPTION');
  const block = (await transport('GetPublicAccessBlock', input)).PublicAccessBlockConfiguration;
  requireInstalled(block && ['BlockPublicAcls', 'IgnorePublicAcls', 'BlockPublicPolicy', 'RestrictPublicBuckets'].every(key => block[key] === true), 'GetPublicAccessBlock', 'MANIFEST_PUBLIC_ACCESS');
  const ownership = (await transport('GetBucketOwnershipControls', input)).OwnershipControls?.Rules;
  requireInstalled(Array.isArray(ownership) && ownership.length === 1 && ownership[0].ObjectOwnership === 'BucketOwnerEnforced', 'GetBucketOwnershipControls', 'MANIFEST_OWNERSHIP');
  try {
    const lifecycle = await transport('GetBucketLifecycleConfiguration', input);
    requireInstalled(Array.isArray(lifecycle.Rules) && lifecycle.Rules.length === 0, 'GetBucketLifecycleConfiguration', 'MANIFEST_LIFECYCLE');
  } catch (error) { if (error.name !== 'NoSuchLifecycleConfiguration') throw error; }
  const policyResponse = await transport('GetBucketPolicy', input);
  let policy;
  try { policy = JSON.parse(policyResponse.Policy); }
  catch { requireInstalled(false, 'GetBucketPolicy', 'MANIFEST_POLICY_FORMAT'); }
  const required = setupTemplate().Resources.ManifestPolicy.Properties.PolicyDocument.Statement;
  requireInstalled(Array.isArray(policy?.Statement) && required.every(expected => policy.Statement.some(actual => JSON.stringify(canonical(actual)) === JSON.stringify(canonical(expected)))), 'GetBucketPolicy', 'MANIFEST_POLICY');
}
// Representative storage preparation only. No arbitrary plan input, participant
// data, operation apply, model call or terminal journal transition is reachable.
export async function managedPreparation(env, transport) {
  const sourceSha = verifyManagedInput(env);
  const originalTransport = transport;
  let phase = 'INSTALLATION_READBACK';
  let manifestVersion;
  transport = async (op, input) => {
    try {
      const response = await originalTransport(op, input);
      if (op === 'GetObject' && phase === 'STORAGE_PREPARATION') {
        // Capture the exact response subsequently validated by manifestStore.
        // Only this synthetic probe publishes its opaque version fingerprint.
        const owned = { VersionId: response?.VersionId, Body: response?.Body };
        manifestVersion = owned.VersionId;
        return owned;
      }
      return response;
    }
    catch (error) {
      if (error && (typeof error === 'object' || typeof error === 'function') && Object.hasOwn(targets, op)) failures.set(error, context(op, phase));
      throw error;
    }
  };
  const manifestBytes = Buffer.from(JSON.stringify({ schemaVersion: 1, synthetic: true, probeId: env.PROBE_ID }));
  const contractHash = digest('KnownEnough synthetic recovery preparation v1; no participant operation; maxItems=1');
  const envelope = { sourceSha, operation: 'JOB_RECOVERY', resourceArn: JOURNAL_ARN, contractHash, maxItems: 1 };
  const plan = { schemaVersion: 1, sourceSha, account: '092954139775', region: 'us-east-1', operation: envelope.operation,
    resourceArn: JOURNAL_ARN, contractHash, expectedRevision: 0, maxItems: 1, recoveryManifestHash: digest(manifestBytes) };
  await inspectInstallation(transport);
  phase = 'STORAGE_PREPARATION';
  const prepared = await prepareRecovery({ plan, envelope, manifestBytes, manifestTransport: transport, bucket: MANIFEST_BUCKET, journalStorage: dynamoJournal(transport, JOURNAL_ARN) });
  return { ...prepared, syntheticManifestVersionHash: digest(manifestVersion),
    result: 'PREPARATION_VERIFIED', installation: 'READBACK_VERIFIED' };
}
export function safeFailure(error) {
  const codes = ['AccessDenied', 'AccessDeniedException', 'ResourceNotFoundException', 'NoSuchKey', 'NoSuchBucket', 'ExpiredToken', 'RequestTimeout'];
  let current = error;
  let diagnostic;
  try {
    for (let depth = 0; current && depth < 5; depth++, current = current.cause) {
      diagnostic ??= failures.get(current);
      if (diagnostic?.check) return { result: 'FAILED', classification: 'OPS_INSTALLATION_REJECTED', storagePreparation: 'UNKNOWN', operationExecution: 'NOT_EXECUTED', ...diagnostic };
      // Publish the same finite name that was checked, without rereading getters.
      const name = current.name;
      if (typeof name === 'string' && codes.includes(name)) return { result: 'FAILED', classification: name, storagePreparation: 'UNKNOWN', operationExecution: 'NOT_EXECUTED', ...diagnostic };
    }
  } catch { /* Unreadable error properties cannot escape the public reporter. */ }
  return { result: 'FAILED', classification: 'OPS_PREPARATION_FAILED', storagePreparation: 'UNKNOWN', operationExecution: 'NOT_EXECUTED', ...diagnostic };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const source = verifySource(process.env);
    verificationReport(source, readFileSync('infra/operations/setup.json', 'utf8'));
    console.log(JSON.stringify(await managedPreparation(process.env, awsTransport())));
  } catch (error) { console.log(JSON.stringify(safeFailure(error))); process.exitCode = 1; }
}
