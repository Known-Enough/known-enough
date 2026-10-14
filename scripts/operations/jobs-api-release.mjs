import { configureSharedEmailPackage } from '../fix04/shared-email-package.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { rolldown } from 'rolldown';
import { lifecyclePackageBytes, loadLifecyclePackage } from './lifecycle-package.ts';
import { loadJobsPackage } from './jobs-package.ts';
import { prepareJobRuntime } from './jobs-runtime-package.mjs';
import { verifyOwnerPackageConfiguration } from './lifecycle-release.mjs';
import { createPartitionDeploymentHandler } from '../../apps/api/src/partition-deployment.ts';
import { verifySource } from './verify.mjs';
const execute = promisify(execFile);
export function coordinatedPrivatePackages(sourceSha, previousLifecycle) {
  // First installation must keep the recovered key. Do not invent a new one if recovery is absent.
  loadLifecyclePackage(previousLifecycle);
  const lifecycle = lifecyclePackageBytes(sourceSha, previousLifecycle);
  const jobs = Buffer.from(JSON.stringify({ schemaVersion: 1, sourceSha })); loadJobsPackage(jobs);
  return { lifecycle, jobs };
}
export async function prepareJobsApi(sourceSha, runnerTemp) {
  if (!runnerTemp) throw new Error('JOBS_API_PACKAGE_INVALID');
  await execute(process.execPath, ['--experimental-transform-types','scripts/operations/partition-cutover.mjs','recover'], { timeout: 60000, maxBuffer: 16384 });
  const folder = join(runnerTemp, 'partition-cutover-private');
  const previous = JSON.parse(await readFile(join(runnerTemp,'partition-backup-private/previous-lambda.json'),'utf8'));
  let config = await readFile(join(folder,'configuration-private.json'));
  const manifest = await readFile(join(folder,'manifest-private.json'));
  let release = JSON.parse(await readFile(join(folder,'release-private.json'),'utf8'));
  verifyOwnerPackageConfiguration(previous, JSON.parse(config));
  if (process.env.KE_SHARED_TEST_EMAIL) {
    await configureSharedEmailPackage(folder, process.env.KE_SHARED_TEST_EMAIL);
    config = await readFile(join(folder, 'configuration-private.json'));
    release = JSON.parse(await readFile(join(folder, 'release-private.json'), 'utf8'));
  }
  const selectedEmailConfigured = Boolean(process.env.KE_SHARED_TEST_EMAIL);
  const bytes = coordinatedPrivatePackages(sourceSha, await readFile(join(folder,'lifecycle-private.json')));
  createPartitionDeploymentHandler(config, manifest, release, undefined, loadLifecyclePackage(bytes.lifecycle), loadJobsPackage(bytes.jobs));
  await writeFile(join(folder,'lifecycle-private.json'),bytes.lifecycle,{mode:0o600});
  await writeFile(join(folder,'jobs-private.json'),bytes.jobs,{mode:0o600});
  const build = await rolldown({ input:resolve('scripts/operations/partition-entry.ts'),platform:'node',external:[/^node:/] });
  try { await build.write({file:join(folder,'api.mjs'),format:'esm',codeSplitting:false}); } finally { await build.close(); }
  await execute('python3',['-c',"import pathlib,zipfile,sys,os; p=pathlib.Path(sys.argv[1]); names=['api.mjs','configuration-private.json','jobs-private.json','lifecycle-private.json','manifest-private.json','release-private.json']; z=zipfile.ZipFile(p/'api.zip','w'); [(z.writestr(zipfile.ZipInfo(n,(2026,1,1,0,0,0)),(p/n).read_bytes(),compress_type=zipfile.ZIP_DEFLATED)) for n in names]; z.close(); os.chmod(p/'api.zip',0o600)",folder],{timeout:10000});
  const zip = await readFile(join(folder,'api.zip')); if (zip.length > 50*1024*1024) throw new Error('JOBS_API_PACKAGE_INVALID');
  const candidatePath = join(folder,'candidate-private.json'); const candidate = JSON.parse(await readFile(candidatePath,'utf8'));
  const sha256 = createHash('sha256').update(zip).digest('hex');
  await writeFile(candidatePath,JSON.stringify({...candidate,sourceSha,sha256}),{mode:0o600});
  const worker = await prepareJobRuntime(sourceSha,join(runnerTemp,'model-job-runtime-private'));
  return {sourceSha,result:'COORDINATED_JOBS_PACKAGES_PREPARED',apiSha256:sha256,priorApiSha256:Buffer.from(previous.CodeSha256,'base64').toString('hex'),worker,
    sharedTestEmail: selectedEmailConfigured ? 'PRIVATE_SELECTED_EMAIL_CONFIGURED' : 'PRESERVED',
    signingKey:'PRESERVED',migration:'UNCHANGED',modelFlags:'UNCHANGED_DISABLED',controlActivation:'NOT_EXECUTED',providerCalls:0};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await prepareJobsApi(verifySource(process.env),process.env.RUNNER_TEMP))); }
  catch { console.error('JOBS_API_PACKAGE_UNVERIFIED'); process.exitCode=1; }
}
