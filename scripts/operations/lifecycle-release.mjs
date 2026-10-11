import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { rolldown } from 'rolldown';
import { lifecyclePackageBytes, loadLifecyclePackage } from './lifecycle-package.ts';
import { nativeConfiguration, verifyCodePublication } from './partition-cutover.mjs';
import { createPartitionDeploymentHandler } from '../../apps/api/src/partition-deployment.ts';
import { verifySource } from './verify.mjs';
const execute = promisify(execFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const invalid = () => { throw new Error('LIFECYCLE_RELEASE_INVALID'); };
export function publicationDisposition(previous, current, candidateHash) {
  // The complete non-code configuration must still match even when reconciling a lost response.
  verifyCodePublication(previous, { ...current, CodeSha256: Buffer.from(candidateHash, 'hex').toString('base64') }, candidateHash);
  if (current.CodeSha256 === Buffer.from(candidateHash, 'hex').toString('base64')) return 'INSTALLED';
  if (current.CodeSha256 === previous.CodeSha256 && current.RevisionId === previous.RevisionId) return 'UPDATE';
  return invalid();
}
export function verifyOwnerPackageConfiguration(previous, packaged) {
  const current = nativeConfiguration(previous);
  if (['userPoolId','participantClientId','displayClientId','cognitoDomain','allowedOrigin','emailKey']
    .some(field => !isDeepStrictEqual(current[field], packaged[field]))) return invalid();
  return true;
}
export function verifyOwnerOnlyPackage(names) {
  if (names.includes('jobs-private.json')) throw new Error('COORDINATED_JOB_RELEASE_REQUIRED');
  return true;
}
async function main(action) {
  const sourceSha = verifySource(process.env);
  if (!['prepare','publish'].includes(action)) return invalid();
  const role = action === 'prepare' ? 'KnownEnoughGithubPartitionMigration' : 'KnownEnoughGithubPrimaryRelease';
  const aws = async (service, operation, ...args) => {
    const { stdout } = await execute('aws', [service, operation, ...args, '--region','us-east-1','--output','json','--no-cli-pager'],
      { timeout: 20000, maxBuffer: 131072 }); return stdout.trim() ? JSON.parse(stdout) : {};
  };
  const identity = await aws('sts','get-caller-identity');
  if (identity.Account !== '092954139775' || !identity.Arn?.startsWith('arn:aws:sts::092954139775:assumed-role/'+role+'/')) return invalid();
  const directory = join(process.env.RUNNER_TEMP, 'partition-cutover-private');
  const previous = JSON.parse(await readFile(join(process.env.RUNNER_TEMP,'partition-backup-private/previous-lambda.json'),'utf8'));
  if (action === 'prepare') {
    // Recover the exact installed activation anchors; never re-plan or migrate existing data.
    await execute(process.execPath, ['--experimental-transform-types','scripts/operations/partition-cutover.mjs','recover'],
      { timeout: 60000, maxBuffer: 16384 });
    // Owner-only publication must not remove a previously installed queued-runtime binding.
    try { await readFile(join(directory,'jobs-private.json')); verifyOwnerOnlyPackage(['jobs-private.json']); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const configurationBytes = await readFile(join(directory,'configuration-private.json'));
    const manifestBytes = await readFile(join(directory,'manifest-private.json'));
    const release = JSON.parse(await readFile(join(directory,'release-private.json'),'utf8'));
    verifyOwnerPackageConfiguration(previous, JSON.parse(configurationBytes));
    let prior;
    try { prior = await readFile(join(directory,'lifecycle-private.json')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const lifecycleBytes = lifecyclePackageBytes(sourceSha, prior);
    createPartitionDeploymentHandler(configurationBytes, manifestBytes, release, undefined, loadLifecyclePackage(lifecycleBytes));
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(join(directory,'lifecycle-private.json'), lifecycleBytes, { mode: 0o600 });
    const build = await rolldown({ input: resolve('scripts/operations/partition-entry.ts'), platform:'node', external:[/^node:/] });
    try { await build.write({ file:join(directory,'api.mjs'), format:'es', codeSplitting:false }); } finally { await build.close(); }
    await execute('python3',['-c',"import pathlib,zipfile,sys; p=pathlib.Path(sys.argv[1]); names=['api.mjs','configuration-private.json','manifest-private.json','release-private.json','lifecycle-private.json']; z=zipfile.ZipFile(p/'api.zip','w',zipfile.ZIP_DEFLATED); [(z.writestr(n,(p/n).read_bytes())) for n in names]; z.close()",directory],{timeout:10000});
    const bytes = await readFile(join(directory,'api.zip'));
    if (!bytes.length || bytes.length > 50*1024*1024) return invalid();
    const candidate = JSON.parse(await readFile(join(directory,'candidate-private.json'),'utf8'));
    await writeFile(join(directory,'candidate-private.json'),JSON.stringify({...candidate,sourceSha,sha256:hash(bytes)}),{mode:0o600});
    return { sourceSha, result:'LIFECYCLE_PRIVATE_PACKAGE_PREPARED', deployment:'NOT_EXECUTED', migration:'UNCHANGED', dataChanges:0 };
  }
  const candidate = JSON.parse(await readFile(join(directory,'candidate-private.json'),'utf8'));
  const lifecycle = loadLifecyclePackage(await readFile(join(directory,'lifecycle-private.json')));
  if (candidate.sourceSha !== sourceSha || lifecycle.sourceSha !== sourceSha || hash(await readFile(join(directory,'api.zip'))) !== candidate.sha256) return invalid();
  const current = await aws('lambda','get-function-configuration','--function-name','known-enough-stage-api');
  if (publicationDisposition(previous,current,candidate.sha256) === 'UPDATE') {
    await aws('lambda','update-function-code','--function-name','known-enough-stage-api','--s3-bucket','known-enough-qa-artifacts-092954139775',
      '--s3-key',candidate.sha256+'/api.zip','--revision-id',current.RevisionId);
  }
  let published;
  for (let attempt=0;attempt<25;attempt++) {
    published = await aws('lambda','get-function-configuration','--function-name','known-enough-stage-api');
    if (published.LastUpdateStatus === 'Successful' && published.State === 'Active') break;
    if (published.LastUpdateStatus === 'Failed') return invalid();
    await new Promise(resolve => globalThis.setTimeout(resolve,1000));
  }
  verifyCodePublication(previous,published,candidate.sha256);
  await writeFile(join(directory,'published-private.json'),JSON.stringify(published),{mode:0o600});
  return { sourceSha, result:'LIFECYCLE_OWNER_CODE_READBACK_PASS', environment:'UNCHANGED', migration:'UNCHANGED',
    modelCalls:0, dataChanges:0, managedOwnerProof:'PENDING' };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await main(process.argv[2]))); }
  catch { console.error(JSON.stringify({result:'LIFECYCLE_RELEASE_NOT_VERIFIED',deployment:'UNKNOWN',migration:'UNCHANGED',dataChanges:0}));process.exitCode=1; }
}
