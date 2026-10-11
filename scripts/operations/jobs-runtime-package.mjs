import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { rolldown } from 'rolldown';
import { loadJobsPackage } from './jobs-package.ts';
import { jobRuntimeTemplate } from './jobs-runtime-setup.mjs';
import { verifySource } from './verify.mjs';
const execute = promisify(execFile);
export async function prepareJobRuntime(sourceSha, directory) {
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, sourceSha })); loadJobsPackage(bytes);
  await mkdir(directory, { mode: 0o700 });
  await writeFile(join(directory, 'jobs-private.json'), bytes, { mode: 0o600, flag: 'wx' });
  const build = await rolldown({ input: resolve('scripts/operations/jobs-runtime-entry.ts'), platform: 'node', external: [/^node:/] });
  try { await build.write({ file: join(directory, 'worker.mjs'), format: 'esm', codeSplitting: false }); } finally { await build.close(); }
  await execute('python3', ['-c', "import pathlib,zipfile,sys,os; p=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(p/'model-worker.zip','w'); names=['jobs-private.json','worker.mjs']; [(z.writestr(zipfile.ZipInfo(n,(2026,1,1,0,0,0)),(p/n).read_bytes(),compress_type=zipfile.ZIP_DEFLATED)) for n in names]; z.close(); os.chmod(p/'model-worker.zip',0o600)", directory], { timeout: 10000 });
  const zip = await readFile(join(directory, 'model-worker.zip'));
  if (zip.length < 1 || zip.length > 50 * 1024 * 1024) throw new Error('MODEL_JOB_PACKAGE_INVALID');
  const sha256 = createHash('sha256').update(zip).digest('hex');
  await writeFile(join(directory, 'runtime-template.json'), JSON.stringify(jobRuntimeTemplate(), null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return { sourceSha, result: 'MODEL_JOB_RUNTIME_PREPARED', sha256, bytes: zip.length, workerKey: `${sha256}/model-worker.zip`, schedule: 'DISABLED', deployment: 'NOT_EXECUTED', providerCalls: 0 };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const sourceSha = verifySource(process.env);
    if (!process.env.RUNNER_TEMP) throw new Error('MODEL_JOB_PACKAGE_INVALID');
    console.log(JSON.stringify(await prepareJobRuntime(sourceSha, join(process.env.RUNNER_TEMP, 'model-job-runtime-private'))));
  } catch { console.error('MODEL_JOB_PACKAGE_FAILED'); process.exitCode = 1; }
}
