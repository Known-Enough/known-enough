import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifySource } from './verify.mjs';
const execute = promisify(execFile); const maximum = 50 * 1024 * 1024;
const bucket = 'known-enough-qa-artifacts-092954139775';
const invalid = () => { throw new Error('PARTITION_BACKUP_INVALID'); };
export function primaryBackupKey(configuration) {
  if (configuration?.FunctionArn !== 'arn:aws:lambda:us-east-1:092954139775:function:known-enough-stage-api'
    || configuration.Role !== 'arn:aws:iam::092954139775:role/KnownEnoughStageApiRole'
    || configuration.State !== 'Active' || configuration.LastUpdateStatus !== 'Successful'
    || configuration.Handler !== 'api.handler' || typeof configuration.CodeSha256 !== 'string'
    || !/^[A-Za-z0-9+/]{43}=$/.test(configuration.CodeSha256)) return invalid();
  return Buffer.from(configuration.CodeSha256, 'base64').toString('hex') + '/api.zip';
}
export async function readPrimaryBackup(configuration, get) {
  if (typeof get !== 'function') return invalid();
  const key = primaryBackupKey(configuration); const signal = globalThis.AbortSignal.timeout(20_000);
  const object = await get({ Bucket: bucket, Key: key }, { abortSignal: signal });
  if (!object.Body || (object.ContentLength !== undefined && (!Number.isSafeInteger(object.ContentLength)
    || object.ContentLength < 1 || object.ContentLength > maximum))) { object.Body?.destroy?.(); return invalid(); }
  const parts = []; let length = 0;
  const abort = () => object.Body.destroy?.(new Error('PARTITION_BACKUP_INVALID'));
  signal.addEventListener('abort', abort, { once: true });
  try {
    for await (const part of object.Body) {
      if (signal.aborted) return invalid();
      length += part.length; if (length > maximum) return invalid(); parts.push(Buffer.from(part));
    }
  } finally { signal.removeEventListener('abort', abort); object.Body.destroy?.(); }
  const bytes = Buffer.concat(parts);
  if (!bytes.length || createHash('sha256').update(bytes).digest('base64') !== configuration.CodeSha256) return invalid();
  return { bytes, key };
}
async function main() {
  const sourceSha = verifySource(process.env);
  const aws = async (service, action, ...args) => {
    const { stdout } = await execute('aws', [service, action, ...args, '--region', 'us-east-1',
      '--endpoint-url', `https://${service === 's3api' ? 's3' : service}.us-east-1.amazonaws.com`, '--output', 'json', '--no-cli-pager'],
    { timeout: 10_000, maxBuffer: 131072 }); return JSON.parse(stdout);
  };
  const identity = await aws('sts', 'get-caller-identity');
  if (identity.Account !== '092954139775' || typeof identity.Arn !== 'string'
    || !identity.Arn.startsWith('arn:aws:sts::092954139775:assumed-role/KnownEnoughGithubPrimaryRelease/')) return invalid();
  const current = await aws('lambda', 'get-function-configuration', '--function-name', 'known-enough-stage-api');
  const directory = join(process.env.RUNNER_TEMP, 'partition-backup-private'); await mkdir(directory, { mode: 0o700 });
  const download = join(directory, 'download-private.zip');
  const backup = await readPrimaryBackup(current, async input => {
    const result = await aws('s3api', 'get-object', '--bucket', input.Bucket, '--key', input.Key,
      '--range', `bytes=0-${maximum}`, download);
    return { ContentLength: result.ContentLength, Body: createReadStream(download) };
  });
  await writeFile(join(directory, 'previous-api.zip'), backup.bytes, { mode: 0o600, flag: 'wx' });
  await writeFile(join(directory, 'previous-lambda.json'), JSON.stringify(current), { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ sourceSha, account: '092954139775', region: 'us-east-1', result: 'PARTITION_PRIOR_CODE_BACKUP_VERIFIED',
    privateBackupBytes: backup.bytes.length, codeUpdate: 'NOT_EXECUTED', sourceFreeze: 'NOT_EXECUTED', activation: 'NOT_EXECUTED' }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch (error) {
    const observed = typeof error.stderr === 'string' ? error.stderr.match(/An error occurred \(([A-Za-z0-9]+)\)/)?.[1] : error.name;
    console.error(JSON.stringify({ result: 'BLOCKED', code: ['NoSuchKey', 'AccessDenied', 'NoSuchBucket'].includes(observed)
      ? observed : 'PARTITION_BACKUP_UNVERIFIED', codeUpdate: 'NOT_EXECUTED', sourceFreeze: 'NOT_EXECUTED' })); process.exitCode = 1;
  }
}
