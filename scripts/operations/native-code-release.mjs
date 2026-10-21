import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { rolldown } from 'rolldown';
import { verifySource } from './verify.mjs';
import { verifyCodePublication } from './partition-cutover.mjs';
import { publicationDisposition, verifyOwnerPackageConfiguration } from './lifecycle-release.mjs';
import { loadLifecyclePackage } from './lifecycle-package.ts';
import { loadJobsPackage } from './jobs-package.ts';
import { createPartitionDeploymentHandler } from '../../apps/api/src/partition-deployment.ts';

// A code-only release explicitly preserves the installed worker binding. Unlike
// a coordinated release it cannot replace the worker, rebind control or reset jobs.
const execute = promisify(execFile);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const privateNames = ['configuration-private.json', 'jobs-private.json', 'lifecycle-private.json', 'manifest-private.json', 'release-private.json'];
const names = ['api.mjs', ...privateNames].sort();
const fail = code => { throw new Error(code); };
const root = process.env.RUNNER_TEMP;
const folder = root && join(root, 'partition-cutover-private');
let operation = 'SOURCE';
async function aws(service, action, ...args) {
  operation = service + ':' + action;
  const { stdout } = await execute('aws', [service, action, ...args, '--region', 'us-east-1', '--output', 'json', '--no-cli-pager'],
    { timeout: 20000, maxBuffer: 131072 });
  return stdout.trim() ? JSON.parse(stdout) : {};
}
async function role(name) {
  const identity = await aws('sts', 'get-caller-identity');
  if (identity.Account !== '092954139775' || !identity.Arn?.startsWith('arn:aws:sts::092954139775:assumed-role/' + name + '/')) fail('NATIVE_CODE_ROLE_INVALID');
}
function expected() {
  const { PREVIOUS_API_HASH: api, PREVIOUS_WORKER_HASH: worker, PREVIOUS_JOB_SOURCE: source } = process.env;
  if (!root || !/^[a-f0-9]{64}$/.test(api ?? '') || !/^[a-f0-9]{64}$/.test(worker ?? '') || !/^[a-f0-9]{40}$/.test(source ?? '')) fail('NATIVE_CODE_BASELINE_REQUIRED');
  return { api, worker, source };
}
async function workerReadback(after) {
  await role('KnownEnoughGithubModelJobRelease');
  const { worker } = expected();
  const config = await aws('lambda', 'get-function-configuration', '--function-name', 'known-enough-stage-model-jobs');
  const rule = await aws('events', 'describe-rule', '--name', 'KnownEnoughModelJobs');
  if (config.FunctionArn !== 'arn:aws:lambda:us-east-1:092954139775:function:known-enough-stage-model-jobs'
    || config.Role !== 'arn:aws:iam::092954139775:role/KnownEnoughModelJobRuntime'
    || config.Handler !== 'worker.handler' || config.Runtime !== 'nodejs24.x' || config.State !== 'Active' || config.LastUpdateStatus !== 'Successful'
    || Buffer.from(config.CodeSha256 ?? '', 'base64').toString('hex') !== worker
    || rule.Arn !== 'arn:aws:events:us-east-1:092954139775:rule/KnownEnoughModelJobs'
    || !['ENABLED', 'DISABLED'].includes(rule.State) || rule.ScheduleExpression !== 'rate(1 minute)') fail('NATIVE_CODE_WORKER_DRIFT');
  const path = join(root, 'native-worker-private.json');
  const snapshot = { config, rule };
  if (after) {
    if (!isDeepStrictEqual(snapshot, JSON.parse(await readFile(path, 'utf8')))) fail('NATIVE_CODE_WORKER_CHANGED');
  } else await writeFile(path, JSON.stringify(snapshot), { mode: 0o600, flag: 'wx' });
  return { result: after ? 'NATIVE_CODE_WORKER_UNCHANGED' : 'NATIVE_CODE_WORKER_BASELINE_PASS', workerSha256: worker, schedule: rule.State, workerWrites: 0 };
}
async function retainedPackage(previous) {
  const { api, source } = expected();
  if (Buffer.from(previous.CodeSha256 ?? '', 'base64').toString('hex') !== api) fail('NATIVE_CODE_API_BASELINE_DRIFT');
  // Prove every private entry is byte-for-byte equal to the verified old ZIP.
  await execute('python3', ['-c',
    "import pathlib,zipfile,sys; p=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(sys.argv[2]); names=['api.mjs','configuration-private.json','jobs-private.json','lifecycle-private.json','manifest-private.json','release-private.json']; assert sorted(z.namelist())==sorted(names); assert all(z.read(n)==(p/n).read_bytes() for n in names if n!='api.mjs')",
    folder, join(root, 'partition-backup-private/previous-api.zip')], { timeout: 10000 });
  const bytes = await Promise.all(privateNames.map(name => readFile(join(folder, name))));
  const [config, jobs, lifecycle, manifest, release] = bytes;
  verifyOwnerPackageConfiguration(previous, JSON.parse(config));
  if (loadJobsPackage(jobs).sourceSha !== source) fail('NATIVE_CODE_WORKER_BINDING_DRIFT');
  createPartitionDeploymentHandler(config, manifest, JSON.parse(release), undefined, loadLifecyclePackage(lifecycle), loadJobsPackage(jobs));
  return Object.fromEntries(privateNames.map((name, i) => [name, digest(bytes[i])]));
}
async function main(action) {
  const sourceSha = verifySource(process.env);
  expected();
  if (action === 'worker-before' || action === 'worker-after') return { sourceSha, ...await workerReadback(action === 'worker-after') };
  if (!['prepare', 'publish'].includes(action)) fail('NATIVE_CODE_ACTION_INVALID');
  await role(action === 'prepare' ? 'KnownEnoughGithubPartitionMigration' : 'KnownEnoughGithubPrimaryRelease');
  const previous = JSON.parse(await readFile(join(root, 'partition-backup-private/previous-lambda.json'), 'utf8'));
  if (action === 'prepare') {
    await execute(process.execPath, ['--experimental-transform-types', 'scripts/operations/partition-cutover.mjs', 'recover'], { timeout: 60000, maxBuffer: 16384 });
    const retained = await retainedPackage(previous);
    const build = await rolldown({ input: resolve('scripts/operations/partition-entry.ts'), platform: 'node', external: [/^node:/] });
    try { await build.write({ file: join(folder, 'api.mjs'), format: 'esm', codeSplitting: false }); } finally { await build.close(); }
    await execute('python3', ['-c',
      "import pathlib,zipfile,sys,os,json; p=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(p/'api.zip','w'); [(z.writestr(zipfile.ZipInfo(n,(2026,1,1,0,0,0)),(p/n).read_bytes(),compress_type=zipfile.ZIP_DEFLATED)) for n in json.loads(sys.argv[2])]; z.close(); os.chmod(p/'api.zip',0o600)",
      folder, JSON.stringify(names)], { timeout: 10000 });
    const zip = await readFile(join(folder, 'api.zip'));
    if (!zip.length || zip.length > 50 * 1024 * 1024) fail('NATIVE_CODE_PACKAGE_INVALID');
    const candidatePath = join(folder, 'candidate-private.json');
    const candidate = JSON.parse(await readFile(candidatePath, 'utf8'));
    const sha256 = digest(zip);
    await writeFile(candidatePath, JSON.stringify({ ...candidate, sourceSha, sha256, retained }), { mode: 0o600 });
    return { sourceSha, result: 'NATIVE_CODE_PACKAGE_PREPARED', apiSha256: sha256, priorApiSha256: expected().api, retainedWorkerSource: expected().source,
      privateConfiguration: 'BYTE_IDENTICAL', workerPublication: 'NOT_EXECUTED', dataChanges: 0, providerCalls: 0 };
  }
  const candidate = JSON.parse(await readFile(join(folder, 'candidate-private.json'), 'utf8'));
  const retained = await retainedPackage(previous);
  if (candidate.sourceSha !== sourceSha || !isDeepStrictEqual(candidate.retained, retained)
    || digest(await readFile(join(folder, 'api.zip'))) !== candidate.sha256) fail('NATIVE_CODE_CANDIDATE_CHANGED');
  const current = await aws('lambda', 'get-function-configuration', '--function-name', 'known-enough-stage-api');
  let writeAcknowledged = false;
  if (publicationDisposition(previous, current, candidate.sha256) === 'UPDATE') {
    try {
      await aws('lambda', 'update-function-code', '--function-name', 'known-enough-stage-api', '--s3-bucket', 'known-enough-qa-artifacts-092954139775',
        '--s3-key', candidate.sha256 + '/api.zip', '--revision-id', current.RevisionId);
      writeAcknowledged = true;
    } catch { /* Reconcile the exact code/configuration readback without replaying a write. */ }
  }
  let published;
  for (let i = 0; i < 30; i++) {
    published = await aws('lambda', 'get-function-configuration', '--function-name', 'known-enough-stage-api');
    if (published.LastUpdateStatus === 'Successful' && published.State === 'Active') break;
    if (published.LastUpdateStatus === 'Failed') fail('NATIVE_CODE_PUBLICATION_FAILED');
    await new Promise(resolve => globalThis.setTimeout(resolve, 1000));
  }
  verifyCodePublication(previous, published, candidate.sha256);
  await writeFile(join(folder, 'published-private.json'), JSON.stringify(published), { mode: 0o600 });
  return { sourceSha, result: 'NATIVE_CODE_READBACK_PASS', apiSha256: candidate.sha256, priorApiSha256: expected().api,
    retainedWorkerSource: expected().source, writeAcknowledged, privateConfiguration: 'BYTE_IDENTICAL', environment: 'UNCHANGED',
    queueConfiguration: 'UNCHANGED', workerPublication: 'NOT_EXECUTED', dataChanges: 0, providerCalls: 0, manualAcceptance: 'PENDING' };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await main(process.argv[2]))); }
  catch (error) {
    const code = /^NATIVE_CODE_[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'NATIVE_CODE_OPERATION_FAILED';
    const observed = String(error?.stderr ?? '').match(/An error occurred \(([A-Za-z0-9]+)\)/)?.[1] ?? null;
    console.error(JSON.stringify({ result: 'NATIVE_CODE_RELEASE_UNVERIFIED', code, operation, awsError: observed, providerCalls: 0, dataChanges: 0 })); process.exitCode = 1;
  }
}
