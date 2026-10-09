import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { setupTemplate, JOURNAL_ARN, RECOVERY_ROLE } from './setup.mjs';
import { MANIFEST_BUCKET } from './manifest.mjs';
import { verificationReport, verifySource } from './verify.mjs';

const execute = promisify(execFile);
const account = '092954139775';
const inspector = 'KnownEnoughGithubStagingInspector';
const stack = 'KnownEnoughOperationsRecovery';
const roleArn = `arn:aws:iam::${account}:role/${RECOVERY_ROLE}`;
const bucketArn = `arn:aws:s3:::${MANIFEST_BUCKET}`;
const stackArn = `arn:aws:cloudformation:us-east-1:${account}:stack/${stack}/`;
const limits = Object.freeze({ requests: 16, timeoutMs: 30000, deadlineMs: 480000, responseBytes: 131072 });
const codes = new Set(['AccessDenied', 'AccessDeniedException', 'UnauthorizedOperation',
  'ResourceNotFoundException', 'NoSuchEntity', 'NoSuchBucket', 'NoSuchLifecycleConfiguration',
  'ValidationError', 'ExpiredToken', 'ExpiredTokenException', 'InvalidClientTokenId',
  'RequestTimeout', 'Throttling', 'ThrottlingException']);
const requests = {
  identity: ['sts', 'get-caller-identity'],
  stack: ['cloudformation', 'describe-stacks', '--stack-name', stack],
  template: ['cloudformation', 'get-template', '--stack-name', stack, '--template-stage', 'Original'],
  role: ['iam', 'get-role', '--role-name', RECOVERY_ROLE],
  inline: ['iam', 'list-role-policies', '--role-name', RECOVERY_ROLE],
  policy: ['iam', 'get-role-policy', '--role-name', RECOVERY_ROLE, '--policy-name', 'ExactRecoveryStorage'],
  attached: ['iam', 'list-attached-role-policies', '--role-name', RECOVERY_ROLE],
  table: ['dynamodb', 'describe-table', '--table-name', 'KnownEnoughOperationsJournal'],
  backups: ['dynamodb', 'describe-continuous-backups', '--table-name', 'KnownEnoughOperationsJournal'],
  ttl: ['dynamodb', 'describe-time-to-live', '--table-name', 'KnownEnoughOperationsJournal'],
  versioning: ['s3api', 'get-bucket-versioning', '--bucket', MANIFEST_BUCKET],
  encryption: ['s3api', 'get-bucket-encryption', '--bucket', MANIFEST_BUCKET],
  publicAccess: ['s3api', 'get-public-access-block', '--bucket', MANIFEST_BUCKET],
  ownership: ['s3api', 'get-bucket-ownership-controls', '--bucket', MANIFEST_BUCKET],
  lifecycle: ['s3api', 'get-bucket-lifecycle-configuration', '--bucket', MANIFEST_BUCKET],
  bucketPolicy: ['s3api', 'get-bucket-policy', '--bucket', MANIFEST_BUCKET]
};
const actions = {
  identity: 'sts:GetCallerIdentity', stack: 'cloudformation:DescribeStacks', template: 'cloudformation:GetTemplate',
  role: 'iam:GetRole', inline: 'iam:ListRolePolicies', policy: 'iam:GetRolePolicy', attached: 'iam:ListAttachedRolePolicies',
  table: 'dynamodb:DescribeTable', backups: 'dynamodb:DescribeContinuousBackups', ttl: 'dynamodb:DescribeTimeToLive',
  versioning: 's3:GetBucketVersioning', encryption: 's3:GetEncryptionConfiguration', publicAccess: 's3:GetBucketPublicAccessBlock',
  ownership: 's3:GetBucketOwnershipControls', lifecycle: 's3:GetLifecycleConfiguration', bucketPolicy: 's3:GetBucketPolicy'
};
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
function document(value) { return typeof value === 'string' ? JSON.parse(value) : value; }
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
function failure(error) {
  try {
    const localCode = error?.code;
    if (localCode === 'ENOENT') return 'AWS_CLI_UNAVAILABLE';
    if (error?.killed || localCode === 'ETIMEDOUT') return 'AWS_READ_TIMEOUT';
    const stderr = error?.stderr;
    const code = typeof stderr === 'string'
      ? stderr.match(/An error occurred \(([A-Za-z0-9]+)\)/)?.[1] : undefined;
    return codes.has(code) ? code : 'AWS_READ_FAILED';
  } catch { return 'AWS_READ_FAILED'; }
}
function credentialEnvironment() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AWS_ENDPOINT_URL')
    && !['AWS_PROFILE', 'AWS_DEFAULT_PROFILE', 'AWS_ROLE_ARN', 'AWS_WEB_IDENTITY_TOKEN_FILE',
      'AWS_CONTAINER_CREDENTIALS_FULL_URI', 'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI'].includes(key)));
  return { ...env, AWS_MAX_ATTEMPTS: '1', AWS_RETRY_MODE: 'standard', AWS_PAGER: '',
    AWS_CONFIG_FILE: '/dev/null', AWS_SHARED_CREDENTIALS_FILE: '/dev/null', AWS_EC2_METADATA_DISABLED: 'true' };
}

// Fixed control-plane reads only. Neither the disabled recovery flag nor an
// assumed existence of the new role is needed to observe missing installation.
export async function installedReadback(env, executor = execute, clock = Date.now) {
  const sourceSha = verifySource(env);
  const report = { schemaVersion: 1, sourceSha, account, region: 'us-east-1',
    observedAt: new Date(clock()).toISOString(), result: 'BLOCKED', ownOidcIdentity: 'UNKNOWN',
    installation: 'UNKNOWN', effectivePermissions: 'UNKNOWN', managedRecovery: 'NOT_EXECUTED',
    mutations: 0, requests: 0, limits, reads: [], configuration: {} };
  const start = clock();
  async function read(id, target, missingCode) {
    const [service, operation, ...args] = requests[id];
    const record = { action: actions[id], target, status: 'UNKNOWN', code: null };
    report.reads.push(record);
    const remainingMs = limits.deadlineMs - (clock() - start);
    if (report.requests >= limits.requests || remainingMs <= 0) {
      record.code = 'READ_BUDGET_EXHAUSTED'; return null;
    }
    report.requests++;
    try {
      const result = await executor('aws', [service, operation, ...args,
        ...(service === 's3api' ? ['--expected-bucket-owner', account] : []),
        '--region', 'us-east-1', '--output', 'json', '--no-cli-pager', '--no-paginate'],
      { env: credentialEnvironment(), timeout: Math.min(limits.timeoutMs, remainingMs),
        maxBuffer: limits.responseBytes });
      // Check and parse the same owned output, even when executor properties change.
      const stdout = result?.stdout;
      if (typeof stdout !== 'string' || Buffer.byteLength(stdout) > limits.responseBytes)
        throw new Error('invalid read size');
      const value = JSON.parse(stdout);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid read shape');
      const hasFlag = Object.hasOwn(value, 'IsTruncated');
      const cursors = ['NextToken', 'Marker', 'NextMarker'].map(key => value[key]);
      // A bounded single page cannot establish configuration completeness.
      if ((hasFlag && typeof value.IsTruncated !== 'boolean')
        || (['inline', 'attached'].includes(id) && !hasFlag)
        || cursors.some(cursor => cursor != null && typeof cursor !== 'string')) {
        record.code = 'AWS_RESPONSE_REJECTED'; return null;
      }
      if (value.IsTruncated === true || cursors.some(cursor => typeof cursor === 'string' && cursor.length > 0)) {
        record.code = 'AWS_INCOMPLETE_RESPONSE'; return null;
      }
      record.status = 'READ'; return value;
    } catch (error) {
      record.code = failure(error);
      if (record.code === missingCode) record.status = 'ABSENT';
      return null;
    }
  }
  function check(name, value, predicate) {
    if (!value) { report.configuration[name] = 'UNKNOWN'; return; }
    try { report.configuration[name] = predicate(value) === true ? 'MATCH' : 'MISMATCH'; }
    catch { report.configuration[name] = 'MISMATCH'; }
  }
  const identity = await read('identity', `arn:aws:iam::${account}:role/${inspector}`);
  if (!identity || identity.Account !== account || typeof identity.Arn !== 'string'
    || !new RegExp(`^arn:aws:sts::${account}:assumed-role/${inspector}/[A-Za-z0-9+=,.@_-]+$`).test(identity.Arn)) {
    report.identityFailure = identity ? 'IDENTITY_REJECTED' : 'IDENTITY_UNAVAILABLE'; return report;
  }
  report.ownOidcIdentity = 'VERIFIED';
  const proposed = setupTemplate().Resources;
  const currentStack = await read('stack', stackArn + '*');
  check('stack', currentStack, value => value.Stacks?.length === 1
    && value.Stacks[0].StackName === stack && value.Stacks[0].StackId?.startsWith(stackArn)
    && ['CREATE_COMPLETE', 'UPDATE_COMPLETE', 'UPDATE_ROLLBACK_COMPLETE'].includes(value.Stacks[0].StackStatus));
  const template = currentStack ? await read('template', stackArn + '*') : null;
  check('template', template, value => equal(document(value.TemplateBody), setupTemplate()));
  const role = await read('role', roleArn, 'NoSuchEntity');
  check('role', role, value => value.Role?.Arn === roleArn && value.Role.RoleName === RECOVERY_ROLE
    && value.Role.MaxSessionDuration === 3600
    && value.Role.PermissionsBoundary === undefined
    && equal(document(value.Role.AssumeRolePolicyDocument), proposed.RecoveryRole.Properties.AssumeRolePolicyDocument));
  const inline = role ? await read('inline', roleArn) : null;
  check('inlineNames', inline, value => value.IsTruncated !== true && equal(value.PolicyNames, ['ExactRecoveryStorage']));
  const policy = role ? await read('policy', roleArn) : null;
  check('inlinePolicy', policy, value => value.RoleName === RECOVERY_ROLE && value.PolicyName === 'ExactRecoveryStorage'
    && equal(document(value.PolicyDocument), proposed.RecoveryRole.Properties.Policies[0].PolicyDocument));
  const attached = role ? await read('attached', roleArn) : null;
  check('attachedPolicies', attached, value => value.IsTruncated !== true && equal(value.AttachedPolicies, []));
  const table = await read('table', JOURNAL_ARN, 'ResourceNotFoundException');
  check('table', table, value => value.Table?.TableArn === JOURNAL_ARN && value.Table.TableStatus === 'ACTIVE'
    && value.Table.DeletionProtectionEnabled === true && value.Table.BillingModeSummary?.BillingMode === 'PAY_PER_REQUEST'
    && value.Table.SSEDescription?.Status === 'ENABLED'
    && equal(value.Table.KeySchema, proposed.Journal.Properties.KeySchema)
    && Array.isArray(value.Table.AttributeDefinitions)
    && equal([...value.Table.AttributeDefinitions].sort((a, b) => a.AttributeName.localeCompare(b.AttributeName)),
      proposed.Journal.Properties.AttributeDefinitions));
  const backups = table ? await read('backups', JOURNAL_ARN) : null;
  check('backups', backups, value => value.ContinuousBackupsDescription?.PointInTimeRecoveryDescription?.PointInTimeRecoveryStatus === 'ENABLED');
  const ttl = table ? await read('ttl', JOURNAL_ARN) : null;
  check('ttl', ttl, value => value.TimeToLiveDescription?.TimeToLiveStatus === 'DISABLED');
  const versioning = await read('versioning', bucketArn, 'NoSuchBucket');
  check('versioning', versioning, value => value.Status === 'Enabled');
  for (const [id, predicate] of [
    ['encryption', value => value.ServerSideEncryptionConfiguration?.Rules?.length === 1
      && value.ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault?.SSEAlgorithm === 'AES256'],
    ['publicAccess', value => equal(value.PublicAccessBlockConfiguration, proposed.Manifests.Properties.PublicAccessBlockConfiguration)],
    ['ownership', value => equal(value.OwnershipControls?.Rules, proposed.Manifests.Properties.OwnershipControls.Rules)],
    ['lifecycle', value => equal(value.Rules, [])],
    ['bucketPolicy', value => equal(document(value.Policy), proposed.ManifestPolicy.Properties.PolicyDocument)]
  ]) {
    const value = versioning ? await read(id, bucketArn, id === 'lifecycle' ? 'NoSuchLifecycleConfiguration' : undefined) : null;
    if (id === 'lifecycle' && versioning && report.reads.at(-1)?.code === 'NoSuchLifecycleConfiguration')
      report.configuration[id] = 'MATCH';
    else check(id, value, predicate);
  }
  // This describes exact metadata only, never workload success/effective scope.
  if (Object.values(report.configuration).every(value => value === 'MATCH')) {
    report.installation = 'CONFIGURATION_MATCH'; report.result = 'READBACK_COMPLETE';
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const source = verifySource(process.env);
    verificationReport(source, readFileSync('infra/operations/setup.json', 'utf8'));
    const report = await installedReadback(process.env);
    console.log(JSON.stringify(report));
    if (report.result !== 'READBACK_COMPLETE') process.exitCode = 1;
  } catch { console.log(JSON.stringify({ result: 'BLOCKED', classification: 'OPS_INTAKE_REJECTED', mutations: 0 })); process.exitCode = 1; }
}
