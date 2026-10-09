import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { verifyManagedInput, inspectInstallation } from './managed-preparation.mjs';
import { verificationReport } from './verify.mjs';
import { awsTransport } from './aws-transport.mjs';
import { manifestStore, MANIFEST_BUCKET } from './manifest.mjs';
import { JOURNAL_ARN, RECOVERY_ROLE } from './setup.mjs';

const execute = promisify(execFile);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const roleArn = `arn:aws:iam::092954139775:role/${RECOVERY_ROLE}`;
// No caller-supplied action, resource, key, policy or endpoint is accepted.
// Read-only probes; an unexpectedly successful STS response is discarded.
const probes = [
  { name: 'JOURNAL_OUTSIDE_PREFIX', service: 'dynamodb', command: 'get-item', operation: 'GetItem',
    action: 'dynamodb:GetItem', target: JOURNAL_ARN, denied: 'AccessDeniedException',
    input: { TableName: 'KnownEnoughOperationsJournal', Key: { PK: { S: 'OUTSIDE#SYNTHETIC_SCOPE_PROBE' }, SK: { S: 'JOURNAL' } }, ConsistentRead: true } },
  { name: 'OUTSIDE_TABLE_METADATA', service: 'dynamodb', command: 'describe-table', operation: 'DescribeTable',
    action: 'dynamodb:DescribeTable', target: 'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughGroupsStage', denied: 'AccessDeniedException',
    input: { TableName: 'KnownEnoughGroupsStage' } },
  { name: 'S3_OUTSIDE_PREFIX_ATTEMPT', service: 's3api', command: 'get-object', operation: 'GetObject',
    action: 's3:GetObject', target: `arn:aws:s3:::${MANIFEST_BUCKET}/scope-probes/outside-manifests.json`, denied: 'AccessDenied',
    input: { Bucket: MANIFEST_BUCKET, Key: 'scope-probes/outside-manifests.json', Range: 'bytes=0-0', ExpectedBucketOwner: '092954139775' } },
  { name: 'IAM_ROLE_READ', service: 'iam', command: 'get-role', operation: 'GetRole',
    action: 'iam:GetRole', target: roleArn, denied: 'AccessDenied', input: { RoleName: RECOVERY_ROLE } },
  { name: 'SELF_ASSUME_ROLE', service: 'sts', command: 'assume-role', operation: 'AssumeRole',
    action: 'sts:AssumeRole', target: roleArn, denied: 'AccessDenied',
    input: { RoleArn: roleArn, RoleSessionName: 'KnownEnoughScopeProbe', DurationSeconds: 900 } }
];

export function verifyScopeInput(env) {
  const owned = Object.fromEntries(['GITHUB_REPOSITORY', 'GITHUB_REF', 'GITHUB_ACTOR_ID', 'GITHUB_EVENT_NAME',
    'GITHUB_SHA', 'EXPECTED_SOURCE', 'CHECKOUT_SOURCE', 'OPERATIONS_RECOVERY_ENABLED', 'PROBE_ID',
    'EXPECTED_MANIFEST_VERSION_HASH'].map(key => [key, env[key]]));
  if (typeof owned.PROBE_ID !== 'string') throw new Error('OPS_SCOPE_INPUT_REJECTED');
  const sourceSha = verifyManagedInput(owned);
  if (typeof owned.EXPECTED_MANIFEST_VERSION_HASH !== 'string' || !/^[a-f0-9]{64}$/.test(owned.EXPECTED_MANIFEST_VERSION_HASH)) throw new Error('OPS_SCOPE_INPUT_REJECTED');
  return Object.freeze({ sourceSha, probeId: owned.PROBE_ID, expectedVersionHash: owned.EXPECTED_MANIFEST_VERSION_HASH });
}

function observedCode(error, operation) {
  try {
    // Read once. Raw messages, output, causes and arbitrary error names stay private.
    const stderr = error?.stderr;
    if (typeof stderr !== 'string' || stderr.length > 16384) return 'CLI_FAILURE';
    // ClientError may report zero retries when AWS_MAX_ATTEMPTS is one.
    // An unexpected nonzero retry count remains unverified under this bound.
    const match = stderr.trimStart().match(/^An error occurred \(([A-Za-z0-9]+)\) when calling the ([A-Za-z0-9]+) operation(?: \(reached max retries: 0\))?:/);
    if (match?.[2] !== operation) return 'CLI_FAILURE';
    return ['AccessDenied', 'AccessDeniedException', 'NoSuchKey', 'NoSuchBucket', 'ResourceNotFoundException',
      'ExpiredToken', 'RequestTimeout'].includes(match[1]) ? match[1] : 'CLI_FAILURE';
  } catch { return 'CLI_FAILURE'; }
}

// Separate finite diagnostic path: production awsTransport target guards remain intact.
export async function runScopeProbes(executor = execute) {
  const outcomes = [];
  for (const probe of probes) {
    const directory = await mkdtemp(join(tmpdir(), 'ke-scope-'));
    try {
      const args = [probe.service, probe.command, '--region', 'us-east-1', '--output', 'json',
        '--no-cli-pager', '--cli-connect-timeout', '10', '--cli-read-timeout', '20'];
      if (probe.operation === 'GetObject') {
        // Streaming CLI customization excludes cli-input-json; range caps any body to one byte.
        for (const [field, flag] of [['Bucket', '--bucket'], ['Key', '--key'], ['Range', '--range'], ['ExpectedBucketOwner', '--expected-bucket-owner']]) {
          const path = join(directory, field);
          await writeFile(path, probe.input[field], { mode: 0o600 });
          args.push(flag, `file://${path}`);
        }
        args.push(join(directory, 'download'));
      } else {
        const path = join(directory, 'request.json');
        await writeFile(path, JSON.stringify(probe.input), { mode: 0o600 });
        args.push('--cli-input-json', `file://${path}`);
      }
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AWS_ENDPOINT_URL')));
      Object.assign(env, { AWS_MAX_ATTEMPTS: '1', AWS_PAGER: '', AWS_CONFIG_FILE: '/dev/null', AWS_SHARED_CREDENTIALS_FILE: '/dev/null' });
      let outcome = 'UNEXPECTED_SUCCESS', code = 'NONE';
      try {
        // Never read or serialize stdout: this may contain data or temporary credentials.
        await executor('aws', args, { env, timeout: 30000, maxBuffer: 16384 });
      } catch (error) {
        code = observedCode(error, probe.operation);
        outcome = code === probe.denied ? 'DENIED' : 'UNVERIFIED';
      }
      outcomes.push({ name: probe.name, action: probe.action, target: probe.target, outcome, code });
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  return outcomes;
}

export async function managedScope(env, transport = awsTransport(), executor = execute) {
  const input = verifyScopeInput(env);
  verificationReport(input.sourceSha, readFileSync('infra/operations/setup.json', 'utf8'));
  await inspectInstallation(transport);
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, synthetic: true, probeId: input.probeId }));
  const manifest = await manifestStore(transport, MANIFEST_BUCKET).read(digest(bytes));
  const versionHash = digest(manifest.versionId);
  if (versionHash !== input.expectedVersionHash) throw new Error('OPS_SCOPE_MANIFEST_VERSION_REJECTED');
  const outcomes = await runScopeProbes(executor);
  const allDenied = outcomes.every(probe => probe.outcome === 'DENIED');
  return { schemaVersion: 1, sourceSha: input.sourceSha, result: allDenied ? 'BOUNDED_PROBES_VERIFIED' : 'FAILED',
    installation: 'READBACK_VERIFIED', recoveryPreservation: 'READBACK_VERIFIED', syntheticManifestVersionHash: versionHash,
    probes: outcomes, operationExecution: 'NOT_EXECUTED', participantAccess: 'NOT_EXECUTED', policyMutation: 'NOT_EXECUTED',
    limits: { outsideS3ObjectExistence: 'NOT_ESTABLISHED', existingOutsideS3ObjectProof: 'NOT_EXECUTED',
      iamMutationProof: 'NOT_EXECUTED', denyPolicyAttribution: 'NOT_ESTABLISHED', broaderOperationsCloseout: 'OPEN' } };
}
export function safeScopeFailure() {
  return { result: 'FAILED', classification: 'OPS_SCOPE_PREFLIGHT_FAILED', installation: 'UNKNOWN',
    recoveryPreservation: 'UNKNOWN', probes: 'NOT_COMPLETED', operationExecution: 'NOT_EXECUTED',
    participantAccess: 'NOT_EXECUTED', policyMutation: 'NOT_EXECUTED' };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await managedScope(process.env);
    console.log(JSON.stringify(result));
    if (result.result === 'FAILED') process.exitCode = 1;
  } catch { console.log(JSON.stringify(safeScopeFailure())); process.exitCode = 1; }
}
