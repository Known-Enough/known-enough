import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { constants } from 'node:fs';
import { mkdir, lstat, open, unlink } from 'node:fs/promises';
import { resolve, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { preparePartitionMigration, loadPartitionMigration, createDynamoPartitionMigrationPorts,
  createPartitionMigrationRunner, PARTITION_MIGRATION_RESOURCES as target } from '@deal-table/adapters/partition-operations';
import { partitionRecoveryStorage } from './partition-recovery.mjs';
import { verifySource } from './verify.mjs';

const execute = promisify(execFile);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sourcePattern = /^[a-f0-9]{40}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const actions = ['plan', 'status', 'prepare', 'step'];
const codes = new Set(['TRANSFER_INPUT_INVALID', 'TRANSFER_AUTHORITY_INVALID', 'TRANSFER_CHECKOUT_INVALID',
  'TRANSFER_STATE_INVALID', 'TRANSFER_STATE_INCOMPLETE', 'TRANSFER_STATE_LOCKED', 'TRANSFER_SOURCE_INVALID',
  'TRANSFER_SOURCE_ABSENT', 'TRANSFER_SOURCE_SHAPE_INVALID', 'TRANSFER_SOURCE_REVISION_INVALID', 'TRANSFER_SOURCE_PAYLOAD_INVALID',
  'TRANSFER_STORAGE_FAILED', 'TRANSFER_ACCOUNT_INVALID', 'TRANSFER_ROLE_INVALID', 'TRANSFER_FREEZE_REQUIRED']);
function fail(code) { throw new Error(code); }
const validSource = value => typeof value === 'string' && sourcePattern.test(value) && !/^0+$/.test(value);
const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value)
  && isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort());

export function verifyTransferCheckout(sourceSha, checkout) {
  if (!validSource(sourceSha) || !checkout || !['head', 'branch', 'remote', 'dirty'].every(key => typeof checkout[key] === 'string')
    || checkout.head.trim() !== sourceSha || checkout.branch.trim() !== 'main' || checkout.dirty.trim()
    || !['https://github.com/Known-Enough/known-enough', 'https://github.com/Known-Enough/known-enough.git',
      'git@github.com:Known-Enough/known-enough.git'].includes(checkout.remote.trim())) fail('TRANSFER_CHECKOUT_INVALID');
  return sourceSha;
}

// This verifies execution provenance; an operator ID in an argument is not a login.
export function transferAuthority(sourceSha, identity, env = process.env) {
  if (!validSource(sourceSha) || identity?.Account !== target.account || typeof identity.Arn !== 'string') fail('TRANSFER_ACCOUNT_INVALID');
  if (env.GITHUB_ACTIONS === 'true') {
    try { if (verifySource(env) !== sourceSha) fail('TRANSFER_AUTHORITY_INVALID'); }
    catch { fail('TRANSFER_AUTHORITY_INVALID'); }
    if (!identity.Arn.startsWith(`arn:aws:sts::${target.account}:assumed-role/KnownEnoughGithubPartitionMigration/`)
      || identity.Arn.length <= `arn:aws:sts::${target.account}:assumed-role/KnownEnoughGithubPartitionMigration/`.length) fail('TRANSFER_ROLE_INVALID');
    return { actorId: Number(env.GITHUB_ACTOR_ID), sourceSha };
  }
  // A explicitly operates their own staging root CloudShell. No chosen actor/profile flag.
  if (env.AWS_EXECUTION_ENV !== 'CloudShell' || identity.Arn !== `arn:aws:iam::${target.account}:root`) fail('TRANSFER_AUTHORITY_INVALID');
  return { actorId: 44531296, sourceSha };
}

async function ownedFile(path, maximum) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || (info.mode & 0o777) !== 0o600 || info.uid !== process.getuid()
      || info.size < 1 || info.size > maximum) fail('TRANSFER_STATE_INVALID');
    const bytes = await handle.readFile();
    if (bytes.length !== info.size || bytes.length > maximum) fail('TRANSFER_STATE_INVALID');
    return bytes;
  } finally { await handle.close(); }
}
async function exists(path) {
  try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function createFile(path, bytes) {
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
async function saved(directory, sourceSha) {
  const bytes = await ownedFile(join(directory, 'manifest-private.json'), 1024 * 1024);
  let binding;
  try { binding = JSON.parse((await ownedFile(join(directory, 'binding-private.json'), 2048)).toString('utf8')); }
  catch { fail('TRANSFER_STATE_INVALID'); }
  if (!keys(binding, ['sourceSha', 'sourceRevision', 'sourceHash', 'manifestHash']) || binding.sourceSha !== sourceSha
    || !Number.isSafeInteger(binding.sourceRevision) || binding.sourceRevision < 1
    || typeof binding.sourceHash !== 'string' || !hashPattern.test(binding.sourceHash)
    || typeof binding.manifestHash !== 'string' || !hashPattern.test(binding.manifestHash)
    || digest(bytes) !== binding.manifestHash) fail('TRANSFER_STATE_INVALID');
  const plan = loadPartitionMigration(bytes, binding);
  return { bytes, binding, plan };
}
function snapshot(raw) {
  if (!keys(raw, ['version', 'payload']) || !Number.isSafeInteger(raw.version) || raw.version < 1
    || raw.version > Number.MAX_SAFE_INTEGER - 2 || !Buffer.isBuffer(raw.payload)
    || raw.payload.length < 1 || raw.payload.length > 300_000) fail('TRANSFER_SOURCE_INVALID');
  return { version: raw.version, payload: Buffer.from(raw.payload) };
}
export function transferSourceSnapshot(item) {
  if (item === undefined) fail('TRANSFER_SOURCE_ABSENT');
  if (!keys(item, ['PK', 'SK', 'version', 'payload']) || item.PK?.S !== 'NP#GROUPS' || item.SK?.S !== 'STATE') fail('TRANSFER_SOURCE_SHAPE_INVALID');
  if (!keys(item.version, ['N']) || typeof item.version.N !== 'string' || !/^[1-9][0-9]*$/.test(item.version.N)
    || !Number.isSafeInteger(Number(item.version.N)) || Number(item.version.N) > Number.MAX_SAFE_INTEGER - 2) fail('TRANSFER_SOURCE_REVISION_INVALID');
  if (!keys(item.payload, ['S']) || typeof item.payload.S !== 'string'
    || Buffer.byteLength(item.payload.S) < 1 || Buffer.byteLength(item.payload.S) > 300_000) fail('TRANSFER_SOURCE_PAYLOAD_INVALID');
  return snapshot({ version: Number(item.version.N), payload: Buffer.from(item.payload.S) });
}
function summary(sourceSha, plan, phase, journal = null) {
  return { schemaVersion: 1, sourceSha, account: target.account, region: target.region, result: phase,
    plannedRows: plan.rowCount, plannedBatches: plan.batches.length,
    completedRows: journal?.completedRows ?? 0, nextBatch: journal?.nextBatch ?? 0,
    state: journal?.state ?? 'NOT_PREPARED', activation: 'NOT_EXECUTED', deployment: 'NOT_EXECUTED' };
}

/** Explicit forward-copy job. Never freezes source, activates partitions or selects a public runtime. */
export async function partitionTransfer({ action, sourceSha, directory, authority, source, recovery, ports }) {
  if (!actions.includes(action) || !validSource(sourceSha) || !isAbsolute(directory)
    || !keys(authority, ['actorId', 'sourceSha']) || authority.sourceSha !== sourceSha
    || ![44531296, 143764700].includes(authority.actorId) || typeof source !== 'function' || typeof ports !== 'function'
    || typeof recovery?.preserve !== 'function' || typeof recovery?.read !== 'function') fail('TRANSFER_INPUT_INVALID');
  // Trusted authority must have been verified by the caller; keep it independent of later caller mutations.
  authority = structuredClone(authority);
  recovery = { preserve: recovery.preserve.bind(recovery), read: recovery.read.bind(recovery) };
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || (info.mode & 0o777) !== 0o700 || info.uid !== process.getuid()) fail('TRANSFER_STATE_INVALID');
  const lock = join(directory, 'transfer.lock'); let locked = false;
  try {
    try { await createFile(lock, Buffer.from('exclusive transfer operation\n')); locked = true; }
    catch (error) { if (error.code === 'EEXIST') fail('TRANSFER_STATE_LOCKED'); throw error; }
    const hasManifest = await exists(join(directory, 'manifest-private.json'));
    const hasBinding = await exists(join(directory, 'binding-private.json'));
    if (hasManifest !== hasBinding) fail('TRANSFER_STATE_INCOMPLETE');
    if (!hasManifest) {
      if (action !== 'plan') fail('TRANSFER_STATE_INCOMPLETE');
      const prior = snapshot(await source());
      const prepared = preparePartitionMigration(prior.payload, prior.version, sourceSha);
      const binding = { sourceSha, sourceRevision: prior.version, sourceHash: prepared.sourceHash, manifestHash: prepared.manifestHash };
      // Publish the immutable binding last. A partial write stops rather than silently re-snapshotting.
      await createFile(join(directory, 'manifest-private.json'), prepared.manifestBytes);
      await createFile(join(directory, 'binding-private.json'), Buffer.from(JSON.stringify(binding)));
      const folder = await open(directory, constants.O_RDONLY); try { await folder.sync(); } finally { await folder.close(); }
    }
    const state = await saved(directory, sourceSha);
    if (action === 'plan') return summary(sourceSha, state.plan, 'TRANSFER_PLAN_READY');
    const managed = ports(state.bytes, state.binding, { account: target.account, region: target.region }, recovery);
    const runner = createPartitionMigrationRunner(managed, state.bytes, state.binding, authority);
    if (action === 'status') {
      const journal = await runner.inspect();
      return summary(sourceSha, state.plan, journal ? 'TRANSFER_STATUS_VERIFIED' : 'TRANSFER_NOT_PREPARED', journal);
    }
    if (action === 'step') {
      const journal = await runner.inspect();
      if (!journal) fail('TRANSFER_FREEZE_REQUIRED');
      // Copy transactions require the exact source fence installed by a separately verified compatible cutover.
      // This command never installs that fence: doing so would stop the existing group writer.
      const prior = snapshot(await source());
      const marker = { schemaVersion: 1, kind: 'PARTITION_MIGRATION', phase: 'FROZEN', planHash: state.plan.planHash,
        manifestHash: state.binding.manifestHash, manifestVersion: journal.manifestVersion, sourceSha,
        sourceRevision: state.binding.sourceRevision, sourceHash: state.binding.sourceHash,
        account: target.account, region: target.region, table: 'KnownEnoughPartitions' };
      if (prior.version !== state.binding.sourceRevision + 1 || !prior.payload.equals(Buffer.from(JSON.stringify(marker)))) fail('TRANSFER_FREEZE_REQUIRED');
    }
    const journal = action === 'prepare' ? await runner.prepare() : await runner.step();
    return summary(sourceSha, state.plan, journal.state === 'COPIED' ? 'TRANSFER_COPY_VERIFIED' : 'TRANSFER_PROGRESS', journal);
  } finally { if (locked) await unlink(lock); }
}

export function transferError(error) {
  const value = typeof error?.code === 'string' ? error.code : error?.message;
  const migration = new Set(['MIGRATION_RUN_INVALID', 'MIGRATION_SOURCE_CHANGED', 'MIGRATION_TARGET_CONFLICT',
    'MIGRATION_RECOVERY_INVALID', 'MIGRATION_JOURNAL_INVALID', 'MIGRATION_TARGET_CORRUPT', 'MIGRATION_CONFLICT',
    'MIGRATION_TIMEOUT', 'MIGRATION_REQUEST_LIMIT', 'MIGRATION_STORAGE_UNAVAILABLE', 'MIGRATION_COMMIT_UNKNOWN',
    'PARTITION_MIGRATION_INVALID', 'PARTITION_MIGRATION_CAPACITY', 'PARTITION_MIGRATION_SOURCE_CHANGED']);
  const awsCodes = new Set(['AccessDenied', 'AccessDeniedException', 'ResourceNotFoundException', 'ExpiredToken',
    'ExpiredTokenException', 'UnrecognizedClientException', 'CredentialsProviderError', 'RequestTimeout', 'TimeoutError',
    'TransactionConflictException', 'TransactionCanceledException', 'NoSuchBucket', 'NoSuchKey', 'PreconditionFailed']);
  let cause = error; let awsError;
  for (let depth = 0; depth < 5 && cause; depth++, cause = cause.cause) {
    if (awsCodes.has(cause.name)) { awsError = cause.name; break; }
    if (typeof cause.stderr === 'string') {
      const observed = cause.stderr.match(/An error occurred \(([A-Za-z0-9]+)\)/)?.[1];
      if (awsCodes.has(observed)) { awsError = observed; break; }
      if (cause.stderr.toLowerCase().includes('unable to locate credentials')) { awsError = 'NO_CREDENTIALS'; break; }
    }
  }
  return { result: 'BLOCKED', code: codes.has(value) || migration.has(value) ? value : 'TRANSFER_STORAGE_FAILED',
    ...(awsError ? { awsError } : {}),
    activation: 'NOT_EXECUTED', deployment: 'NOT_EXECUTED' };
}

async function main(argv) {
  if (argv.length !== 5 || argv[1] !== '--source' || argv[3] !== '--state' || !actions.includes(argv[0])
    || !validSource(argv[2]) || !isAbsolute(argv[4])) fail('TRANSFER_INPUT_INVALID');
  const [action, , sourceSha, , directory] = argv;
  if (process.versions.node !== '24.21.0') fail('TRANSFER_INPUT_INVALID');
  const cliOptions = { timeout: 10_000, maxBuffer: 8192 };
  const [{ stdout: checkout }, { stdout: branch }, { stdout: remote }, { stdout: dirty }] = await Promise.all([
    execute('git', ['rev-parse', 'HEAD'], cliOptions), execute('git', ['branch', '--show-current'], cliOptions),
    execute('git', ['remote', 'get-url', 'origin'], cliOptions), execute('git', ['status', '--porcelain'], cliOptions)]);
  verifyTransferCheckout(sourceSha, { head: checkout, branch, remote, dirty });
  if (resolve('scripts/operations/partition-transfer.mjs') !== fileURLToPath(import.meta.url)) fail('TRANSFER_CHECKOUT_INVALID');
  const { stdout } = await execute('aws', ['sts', 'get-caller-identity', '--region', target.region,
    '--output', 'json', '--no-cli-pager'], cliOptions);
  const authority = transferAuthority(sourceSha, JSON.parse(stdout));
  const client = new DynamoDBClient({ region: target.region, endpoint: 'https://dynamodb.us-east-1.amazonaws.com', maxAttempts: 1 });
  const source = async () => {
    const response = await client.send(new GetItemCommand({ TableName: target.source,
      Key: { PK: { S: 'NP#GROUPS' }, SK: { S: 'STATE' } }, ConsistentRead: true }), { abortSignal: globalThis.AbortSignal.timeout(10_000) });
    return transferSourceSnapshot(response.Item);
  };
  return partitionTransfer({ action, sourceSha, directory, authority, source, recovery: partitionRecoveryStorage(), ports: createDynamoPartitionMigrationPorts });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await main(process.argv.slice(2)))); }
  catch (error) { console.error(JSON.stringify(transferError(error))); process.exitCode = 1; }
}
