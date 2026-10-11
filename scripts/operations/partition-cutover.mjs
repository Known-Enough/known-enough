import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { rolldown } from 'rolldown';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { createDynamoPartitionMigrationPorts, createPartitionMigrationRunner, loadPartitionMigration } from '@deal-table/adapters/partition-operations';
import { MigrationControlSchema, MigrationJournalSchema } from '../../packages/adapters/src/partition-migration-runner.ts';
import { readKe13bConfig } from '../../apps/api/src/ke13b-lambda.ts';
import { createPartitionDeploymentHandler } from '../../apps/api/src/partition-deployment.ts';
import { partitionTransfer, transferSourceSnapshot, transferAuthority, transferError } from './partition-transfer.mjs';
import { partitionRecoveryStorage } from './partition-recovery.mjs';
import { primaryBackupKey } from './partition-backup.mjs';
import { verifySource } from './verify.mjs';
const execute = promisify(execFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const bucket = 'known-enough-qa-artifacts-092954139775';
const primary = 'known-enough-stage-api';
const invalid = () => { throw new Error('PARTITION_CUTOVER_GUARD_FAILED'); };
export function verifyCodePublication(previous, current, candidateHash) {
  primaryBackupKey(previous); primaryBackupKey(current);
  if (!/^[a-f0-9]{64}$/.test(candidateHash) || !previous.RevisionId || !current.RevisionId
    || current.CodeSha256 !== Buffer.from(candidateHash, 'hex').toString('base64')
    || !isDeepStrictEqual(previous.Environment, current.Environment)
    || previous.Runtime !== current.Runtime || previous.Role !== current.Role || previous.Handler !== current.Handler
    || previous.Timeout !== current.Timeout || previous.MemorySize !== current.MemorySize
    || !isDeepStrictEqual(previous.Layers, current.Layers) || !isDeepStrictEqual(previous.VpcConfig, current.VpcConfig)) return invalid();
  return true;
}
export function nativeConfiguration(previous) {
  primaryBackupKey(previous);
  const config = readKe13bConfig({ ...previous.Environment?.Variables, AWS_REGION: 'us-east-1' });
  if (config.models || config.region !== 'us-east-1' || config.tableName !== 'KnownEnoughStage'
    || config.userPoolId !== 'us-east-1_V9OMjd0zx' || config.groups?.tableName !== 'KnownEnoughGroupsStage') return invalid();
  return { schemaVersion: 1, account: '092954139775', region: 'us-east-1', userPoolId: config.userPoolId,
    participantClientId: config.participantClientId, displayClientId: config.displayClientId,
    cognitoDomain: config.groups.cognitoDomain, allowedOrigin: config.allowedOrigin, emailKey: config.groups.emailKey,
    cursorKeyBase64: randomBytes(32).toString('base64') };
}
export function recoveryBinding(controlItem, journalItem) {
  if (controlItem?.PK?.S !== 'MIGRATION#CONTROL' || controlItem.SK?.S !== 'STATE'
    || typeof controlItem.payload?.S !== 'string' || typeof journalItem?.payload?.S !== 'string') return invalid();
  const control = MigrationControlSchema.parse(JSON.parse(controlItem.payload.S));
  const journal = MigrationJournalSchema.parse(JSON.parse(journalItem.payload.S));
  if (!control.planHash || control.active || controlItem.revision?.N !== String(control.revision)
    || journalItem.PK?.S !== `PARTITION#${control.planHash}` || journalItem.SK?.S !== 'JOURNAL'
    || journalItem.revision?.N !== String(journal.revision) || journal.planHash !== control.planHash) return invalid();
  return { binding: { sourceSha: journal.sourceSha, sourceRevision: journal.sourceRevision,
    sourceHash: journal.sourceHash, manifestHash: journal.manifestHash }, manifestVersion: journal.manifestVersion };
}
async function aws(service, action, ...args) {
  const { stdout } = await execute('aws', [service, action, ...args, '--region', 'us-east-1',
    '--endpoint-url', `https://${service === 's3api' ? 's3' : service}.us-east-1.amazonaws.com`,
    '--output', 'json', '--no-cli-pager', '--cli-connect-timeout', '5', '--cli-read-timeout', '10'],
  { timeout: 15_000, maxBuffer: 131072 });
  return stdout.trim() ? JSON.parse(stdout) : null;
}
async function ownRole(name) {
  const identity = await aws('sts', 'get-caller-identity');
  if (identity.Account !== '092954139775' || typeof identity.Arn !== 'string'
    || !identity.Arn.startsWith(`arn:aws:sts::092954139775:assumed-role/${name}/`)) return invalid();
  return identity;
}
async function privateWrite(path, value) { await writeFile(path, value, { mode: 0o600, flag: 'wx' }); }
async function settled() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const config = await aws('lambda', 'get-function-configuration', '--function-name', primary);
    if (config.State === 'Active' && config.LastUpdateStatus === 'Successful') return config;
    if (config.LastUpdateStatus === 'Failed') return invalid();
    await new Promise(resolve => globalThis.setTimeout(resolve, 1000));
  }
  return invalid();
}
async function main(action) {
  const sourceSha = verifySource(process.env);
  if (!['prepare', 'recover', 'upload', 'publish', 'activate', 'status'].includes(action)) return invalid();
  const directory = join(process.env.RUNNER_TEMP, 'partition-cutover-private');
  const priorPath = join(process.env.RUNNER_TEMP, 'partition-backup-private/previous-lambda.json');
  if (action === 'prepare') {
    const identity = await ownRole('KnownEnoughGithubPartitionMigration');
    const authority = transferAuthority(sourceSha, identity);
    const client = new DynamoDBClient({ region: 'us-east-1', endpoint: 'https://dynamodb.us-east-1.amazonaws.com', maxAttempts: 1 });
    const source = async () => transferSourceSnapshot((await client.send(new GetItemCommand({ TableName: 'KnownEnoughGroupsStage',
      Key: { PK: { S: 'NP#GROUPS' }, SK: { S: 'STATE' } }, ConsistentRead: true }),
    { abortSignal: globalThis.AbortSignal.timeout(10_000) })).Item);
    const recovery = partitionRecoveryStorage();
    const get = async (table, PK, SK) => (await client.send(new GetItemCommand({ TableName: table,
      Key: { PK: { S: PK }, SK: { S: SK } }, ConsistentRead: true }),
    { abortSignal: globalThis.AbortSignal.timeout(10_000) })).Item;
    const controlItem = await get('KnownEnoughPartitions', 'MIGRATION#CONTROL', 'STATE');
    let manifest; let binding;
    if (controlItem) {
      const control = MigrationControlSchema.parse(JSON.parse(controlItem.payload.S));
      const journalItem = await get('KnownEnoughOperationsJournal', `PARTITION#${control.planHash}`, 'JOURNAL');
      const saved = recoveryBinding(controlItem, journalItem); binding = saved.binding;
      const context = { signal: globalThis.AbortSignal.timeout(20_000), request() {} };
      manifest = (await recovery.read(binding.manifestHash, saved.manifestVersion, context)).bytes;
      loadPartitionMigration(manifest, binding);
      await mkdir(directory, { mode: 0o700 });
      await privateWrite(join(directory, 'manifest-private.json'), manifest);
      await privateWrite(join(directory, 'binding-private.json'), JSON.stringify(binding));
    } else {
      await partitionTransfer({ action: 'plan', sourceSha, directory, authority, source, recovery, ports: createDynamoPartitionMigrationPorts });
      await partitionTransfer({ action: 'prepare', sourceSha, directory, authority, source, recovery, ports: createDynamoPartitionMigrationPorts });
      manifest = await readFile(join(directory, 'manifest-private.json'));
      binding = JSON.parse(await readFile(join(directory, 'binding-private.json'), 'utf8'));
    }
    const plan = loadPartitionMigration(manifest, binding);
    const ports = createDynamoPartitionMigrationPorts(manifest, binding, { account: '092954139775', region: 'us-east-1' }, recovery);
    const journal = await ports.journal(plan.planHash, { signal: globalThis.AbortSignal.timeout(10_000), request() {} });
    if (!journal || journal.sourceSha !== binding.sourceSha || journal.manifestHash !== binding.manifestHash) return invalid();
    await createPartitionMigrationRunner(ports, manifest, binding, { actorId: authority.actorId, sourceSha: binding.sourceSha }).inspect();
    const previous = JSON.parse(await readFile(priorPath, 'utf8'));
    const configBytes = Buffer.from(JSON.stringify(nativeConfiguration(previous)));
    const release = { ...binding, configurationHash: hash(configBytes), manifestVersion: journal.manifestVersion };
    createPartitionDeploymentHandler(configBytes, manifest, release);
    await privateWrite(join(directory, 'configuration-private.json'), configBytes);
    await privateWrite(join(directory, 'release-private.json'), JSON.stringify(release));
    const build = await rolldown({ input: resolve('scripts/operations/partition-entry.ts'), platform: 'node', external: [/^node:/] });
    try { await build.write({ file: join(directory, 'api.mjs'), format: 'es', codeSplitting: false }); } finally { await build.close(); }
    await execute('python3', ['-c', "import pathlib,zipfile,sys; p=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(p/'api.zip','w',zipfile.ZIP_DEFLATED); names=['api.mjs','configuration-private.json','manifest-private.json','release-private.json']; [(z.writestr(n,(p/n).read_bytes())) for n in names]; z.close()", directory], { timeout: 10_000 });
    const zip = await readFile(join(directory, 'api.zip'));
    if (!zip.length || zip.length > 50 * 1024 * 1024) return invalid();
    await privateWrite(join(directory, 'candidate-private.json'), JSON.stringify({ sourceSha, sha256: hash(zip), priorKey: primaryBackupKey(previous) }));
    return { sourceSha, result: 'PARTITION_STANDBY_PACKAGE_PREPARED', recovery: 'VERIFIED', plannedRows: plan.rowCount,
      sourceFreeze: 'NOT_EXECUTED', deployment: 'NOT_EXECUTED', activation: 'NOT_EXECUTED' };
  }
  if (action === 'recover') {
    await ownRole('KnownEnoughGithubPartitionMigration');
    const previous = JSON.parse(await readFile(priorPath, 'utf8'));
    const currentZip = join(process.env.RUNNER_TEMP, 'partition-backup-private/previous-api.zip');
    await mkdir(directory, { mode: 0o700 });
    await execute('python3', ['-c', "import pathlib,zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); p=pathlib.Path(sys.argv[2]); names=['api.mjs','configuration-private.json','manifest-private.json','release-private.json']; assert sorted(z.namelist())==sorted(names); assert all(z.getinfo(n).file_size <= (40000000 if n=='api.mjs' else 1048576) for n in names); [(p/n).write_bytes(z.read(n)) for n in names if n!='api.mjs']", currentZip, directory], { timeout: 10_000 });
    const manifest = await readFile(join(directory, 'manifest-private.json'));
    const config = await readFile(join(directory, 'configuration-private.json'));
    const release = JSON.parse(await readFile(join(directory, 'release-private.json'), 'utf8'));
    createPartitionDeploymentHandler(config, manifest, release);
    const actual = nativeConfiguration(previous); const packaged = JSON.parse(config);
    for (const field of ['userPoolId','participantClientId','displayClientId','cognitoDomain','allowedOrigin','emailKey'])
      if (actual[field] !== packaged[field]) return invalid();
    const binding = { sourceSha: release.sourceSha, sourceRevision: release.sourceRevision, sourceHash: release.sourceHash, manifestHash: release.manifestHash };
    await privateWrite(join(directory, 'binding-private.json'), JSON.stringify(binding));
    await privateWrite(join(directory, 'candidate-private.json'), JSON.stringify({ sourceSha, sha256: Buffer.from(previous.CodeSha256,'base64').toString('hex'), priorKey: primaryBackupKey(previous) }));
    await privateWrite(join(directory, 'published-private.json'), JSON.stringify(previous));
    return { sourceSha, result: 'PARTITION_INSTALLED_PACKAGE_RECOVERED', deployment: 'UNCHANGED', activation: 'NOT_EXECUTED' };
  }
  const candidate = JSON.parse(await readFile(join(directory, 'candidate-private.json'), 'utf8'));
  if (candidate.sourceSha !== sourceSha || !/^[a-f0-9]{64}$/.test(candidate.sha256)) return invalid();
  const previous = JSON.parse(await readFile(priorPath, 'utf8'));
  if (action === 'upload') {
    await ownRole('KnownEnoughGithubQaRelease');
    const bytes = await readFile(join(directory, 'api.zip')); if (hash(bytes) !== candidate.sha256) return invalid();
    await aws('s3api', 'put-object', '--bucket', bucket, '--key', `${candidate.sha256}/api.zip`,
      '--body', join(directory, 'api.zip'), '--server-side-encryption', 'AES256', '--if-none-match', '*');
    return { sourceSha, result: 'PARTITION_PRIVATE_PACKAGE_UPLOADED', deployment: 'NOT_EXECUTED', activation: 'NOT_EXECUTED' };
  }
  if (action === 'publish') {
    await ownRole('KnownEnoughGithubPrimaryRelease');
    const current = await settled();
    if (current.CodeSha256 !== previous.CodeSha256 || current.RevisionId !== previous.RevisionId
      || !isDeepStrictEqual(current.Environment, previous.Environment)) return invalid();
    await aws('lambda', 'update-function-code', '--function-name', primary, '--s3-bucket', bucket,
      '--s3-key', `${candidate.sha256}/api.zip`, '--revision-id', current.RevisionId);
    const published = await settled(); verifyCodePublication(previous, published, candidate.sha256);
    const origin = nativeConfiguration(previous).allowedOrigin;
    const smoke = await globalThis.fetch('https://u94iyvt6p9.execute-api.us-east-1.amazonaws.com/groups', { method: 'OPTIONS',
      headers: { origin, 'access-control-request-method': 'GET' }, redirect: 'error', signal: globalThis.AbortSignal.timeout(10_000) });
    if (!smoke.ok || smoke.headers.get('access-control-allow-origin') !== origin) return invalid();
    await privateWrite(join(directory, 'published-private.json'), JSON.stringify(published));
    return { sourceSha, result: 'PARTITION_STANDBY_CODE_READBACK_PASS', environment: 'UNCHANGED', sourceFreeze: 'NOT_EXECUTED', activation: 'NOT_EXECUTED' };
  }
  const identity = await ownRole('KnownEnoughGithubPartitionMigration');
  const authority = transferAuthority(sourceSha, identity);
  const manifest = await readFile(join(directory, 'manifest-private.json'));
  const binding = JSON.parse(await readFile(join(directory, 'binding-private.json'), 'utf8'));
  const release = JSON.parse(await readFile(join(directory, 'release-private.json'), 'utf8'));
  const published = JSON.parse(await readFile(join(directory, 'published-private.json'), 'utf8'));
  verifyCodePublication(previous, published, candidate.sha256);
  const ports = createDynamoPartitionMigrationPorts(manifest, binding, { account: '092954139775', region: 'us-east-1' }, partitionRecoveryStorage());
  const runner = createPartitionMigrationRunner(ports, manifest, binding, { actorId: authority.actorId, sourceSha: binding.sourceSha });
  if (action === 'status') {
    const control = await ports.control({ signal: globalThis.AbortSignal.timeout(10_000), request() {} });
    if (!control.active) return invalid();
    const active = await ports.activate();
    return { sourceSha, result: 'PARTITION_ACTIVE_RESUME_READBACK_PASS', activation: active.active ? 'ACTIVE' : 'INVALID' };
  }
  const currentControl = await ports.control({ signal: globalThis.AbortSignal.timeout(10_000), request() {} });
  if (currentControl.active) {
    await ports.activate();
    return { sourceSha, result: 'PARTITION_ACTIVE_ALREADY_VERIFIED', activation: 'ACTIVE', deployment: 'UNCHANGED' };
  }
  let journal = await runner.inspect(); if (!journal || journal.manifestVersion !== release.manifestVersion) return invalid();
  if (action === 'activate') {
    await ports.freeze();
    for (let attempt = 0; journal.state !== 'COPIED' && attempt < 16; attempt++) journal = await runner.step();
    if (journal.state !== 'COPIED') return invalid();
    const active = await ports.activate(); if (!active.active) return invalid();
    return { sourceSha, result: 'PARTITION_ACTIVE_READBACK_PASS', recovery: 'VERIFIED', completedRows: journal.completedRows,
      deployment: 'STANDBY_CODE_VERIFIED', activation: 'ACTIVE', environment: 'UNCHANGED' };
  }
  return invalid();
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await main(process.argv[2]))); }
  catch (error) { console.error(JSON.stringify({ ...transferError(error), code: error.message === 'PARTITION_CUTOVER_GUARD_FAILED'
    ? error.message : transferError(error).code, deployment: 'INSPECT_STEP', activation: 'INSPECT_NATIVE_JOURNAL' })); process.exitCode = 1; }
}
