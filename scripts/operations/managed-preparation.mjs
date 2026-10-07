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
  if (identity.Account !== '092954139775' || !identity.Arn?.startsWith(`arn:aws:sts::092954139775:assumed-role/${RECOVERY_ROLE}/`)) throw new Error('OPS_IDENTITY_REJECTED');
  const { Table } = await transport('DescribeTable', { TableName: 'KnownEnoughOperationsJournal' });
  if (Table?.TableArn !== JOURNAL_ARN || Table.TableStatus !== 'ACTIVE' || Table.DeletionProtectionEnabled !== true
    || Table.BillingModeSummary?.BillingMode !== 'PAY_PER_REQUEST' || Table.SSEDescription?.Status !== 'ENABLED'
    || JSON.stringify(Table.KeySchema) !== JSON.stringify(setupTemplate().Resources.Journal.Properties.KeySchema)
    || Table.AttributeDefinitions?.length !== 2 || new Set(Table.AttributeDefinitions.map(a => a.AttributeName)).size !== 2
    || !Table.AttributeDefinitions.every(a => ['PK', 'SK'].includes(a.AttributeName) && a.AttributeType === 'S')) throw new Error('OPS_INSTALLATION_REJECTED');
  const backups = await transport('DescribeContinuousBackups', { TableName: 'KnownEnoughOperationsJournal' });
  if (backups.ContinuousBackupsDescription?.PointInTimeRecoveryDescription?.PointInTimeRecoveryStatus !== 'ENABLED') throw new Error('OPS_INSTALLATION_REJECTED');
  if ((await transport('DescribeTimeToLive', { TableName: 'KnownEnoughOperationsJournal' })).TimeToLiveDescription?.TimeToLiveStatus !== 'DISABLED') throw new Error('OPS_INSTALLATION_REJECTED');
  const input = { Bucket: MANIFEST_BUCKET };
  if ((await transport('GetBucketVersioning', input)).Status !== 'Enabled') throw new Error('OPS_INSTALLATION_REJECTED');
  const encryption = await transport('GetBucketEncryption', input);
  const rules = encryption.ServerSideEncryptionConfiguration?.Rules;
  if (!Array.isArray(rules) || rules.length !== 1 || rules[0].ApplyServerSideEncryptionByDefault?.SSEAlgorithm !== 'AES256') throw new Error('OPS_INSTALLATION_REJECTED');
  const block = (await transport('GetPublicAccessBlock', input)).PublicAccessBlockConfiguration;
  if (!block || ['BlockPublicAcls', 'IgnorePublicAcls', 'BlockPublicPolicy', 'RestrictPublicBuckets'].some(key => block[key] !== true)) throw new Error('OPS_INSTALLATION_REJECTED');
  const ownership = (await transport('GetBucketOwnershipControls', input)).OwnershipControls?.Rules;
  if (!Array.isArray(ownership) || ownership.length !== 1 || ownership[0].ObjectOwnership !== 'BucketOwnerEnforced') throw new Error('OPS_INSTALLATION_REJECTED');
  try {
    const lifecycle = await transport('GetBucketLifecycleConfiguration', input);
    if (!Array.isArray(lifecycle.Rules) || lifecycle.Rules.length !== 0) throw new Error('OPS_INSTALLATION_REJECTED');
  } catch (error) { if (error.name !== 'NoSuchLifecycleConfiguration') throw error; }
  const policy = JSON.parse((await transport('GetBucketPolicy', input)).Policy);
  const required = setupTemplate().Resources.ManifestPolicy.Properties.PolicyDocument.Statement;
  if (!Array.isArray(policy.Statement) || !required.every(expected => policy.Statement.some(actual => JSON.stringify(canonical(actual)) === JSON.stringify(canonical(expected))))) throw new Error('OPS_INSTALLATION_REJECTED');
}
// Representative storage preparation only. No arbitrary plan input, participant
// data, operation apply, model call or terminal journal transition is reachable.
export async function managedPreparation(env, transport) {
  const sourceSha = verifyManagedInput(env);
  const manifestBytes = Buffer.from(JSON.stringify({ schemaVersion: 1, synthetic: true, probeId: env.PROBE_ID }));
  const contractHash = digest('KnownEnough synthetic recovery preparation v1; no participant operation; maxItems=1');
  const envelope = { sourceSha, operation: 'JOB_RECOVERY', resourceArn: JOURNAL_ARN, contractHash, maxItems: 1 };
  const plan = { schemaVersion: 1, sourceSha, account: '092954139775', region: 'us-east-1', operation: envelope.operation,
    resourceArn: JOURNAL_ARN, contractHash, expectedRevision: 0, maxItems: 1, recoveryManifestHash: digest(manifestBytes) };
  await inspectInstallation(transport);
  const prepared = await prepareRecovery({ plan, envelope, manifestBytes, manifestTransport: transport, bucket: MANIFEST_BUCKET, journalStorage: dynamoJournal(transport, JOURNAL_ARN) });
  return { ...prepared, result: 'PREPARATION_VERIFIED', installation: 'READBACK_VERIFIED' };
}
export function safeFailure(error) {
  const codes = ['AccessDenied', 'AccessDeniedException', 'ResourceNotFoundException', 'NoSuchKey', 'NoSuchBucket', 'ExpiredToken', 'RequestTimeout'];
  let current = error;
  for (let depth = 0; current && depth < 5; depth++, current = current.cause) {
    if (codes.includes(current.name)) return { result: 'FAILED', classification: current.name, storagePreparation: 'UNKNOWN', operationExecution: 'NOT_EXECUTED' };
  }
  return { result: 'FAILED', classification: 'OPS_PREPARATION_FAILED', storagePreparation: 'UNKNOWN', operationExecution: 'NOT_EXECUTED' };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const source = verifySource(process.env);
    verificationReport(source, readFileSync('infra/operations/setup.json', 'utf8'));
    console.log(JSON.stringify(await managedPreparation(process.env, awsTransport())));
  } catch (error) { console.log(JSON.stringify(safeFailure(error))); process.exitCode = 1; }
}
