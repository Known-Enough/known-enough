import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MANIFEST_BUCKET } from './manifest.mjs';
const execute = promisify(execFile);
const limit = 1024 * 1024;
const table = 'KnownEnoughOperationsJournal';
const commands = {
  GetCallerIdentity: ['sts', 'get-caller-identity'],
  DescribeTable: ['dynamodb', 'describe-table'], DescribeContinuousBackups: ['dynamodb', 'describe-continuous-backups'],
  DescribeTimeToLive: ['dynamodb', 'describe-time-to-live'],
  GetItem: ['dynamodb', 'get-item'], PutItem: ['dynamodb', 'put-item'],
  GetBucketVersioning: ['s3api', 'get-bucket-versioning'], GetBucketEncryption: ['s3api', 'get-bucket-encryption'],
  GetPublicAccessBlock: ['s3api', 'get-public-access-block'], GetBucketPolicy: ['s3api', 'get-bucket-policy'],
  GetBucketOwnershipControls: ['s3api', 'get-bucket-ownership-controls'], GetBucketLifecycleConfiguration: ['s3api', 'get-bucket-lifecycle-configuration'],
  PutObject: ['s3api', 'put-object'], HeadObject: ['s3api', 'head-object'], GetObject: ['s3api', 'get-object']
};
const codes = ['ConditionalCheckFailedException', 'PreconditionFailed', 'AccessDenied', 'AccessDeniedException', 'ResourceNotFoundException', 'NoSuchKey', 'NoSuchBucket', 'NoSuchLifecycleConfiguration', 'ExpiredToken', 'RequestTimeout'];
function guard(op, input) {
  if (typeof op !== 'string' || !Object.hasOwn(commands, op) || !input || typeof input !== 'object' || Array.isArray(input)) throw new Error('OPS_AWS_REQUEST_REJECTED');
  if (commands[op][0] === 'dynamodb' && input.TableName !== table) throw new Error('OPS_AWS_TARGET_REJECTED');
  if (['GetItem', 'PutItem'].includes(op)) {
    const item = op === 'GetItem' ? input.Key : input.Item;
    if (!/^PLAN#[a-f0-9]{64}$/.test(item?.PK?.S ?? '') || item?.SK?.S !== 'JOURNAL'
      || (op === 'GetItem' && input.ConsistentRead !== true)
      || (op === 'PutItem' && !['attribute_not_exists(PK)', 'revision = :expected'].includes(input.ConditionExpression))) throw new Error('OPS_AWS_REQUEST_REJECTED');
  }
  if (commands[op][0] === 's3api' && (input.Bucket !== MANIFEST_BUCKET
    || (['PutObject', 'HeadObject', 'GetObject'].includes(op) && !/^manifests\/[a-f0-9]{64}\.json$/.test(input.Key ?? '')))) throw new Error('OPS_AWS_TARGET_REJECTED');
  if (['HeadObject', 'GetObject'].includes(op) && Object.keys(input).some(key => !['Bucket', 'Key', 'VersionId', 'ExpectedBucketOwner'].includes(key))) throw new Error('OPS_AWS_REQUEST_REJECTED');
  if (op === 'PutObject' && (input.IfNoneMatch !== '*' || !Buffer.isBuffer(input.Body) || input.Body.length < 1 || input.Body.length > limit)) throw new Error('OPS_AWS_REQUEST_REJECTED');
}
function ownRequest(op, input) {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error();
    const { Body, ...fields } = input;
    let bytes;
    if (Body !== undefined) {
      if (op !== 'PutObject' || !Buffer.isBuffer(Body) || Body.length < 1 || Body.length > limit) throw new Error();
      bytes = Buffer.from(Body);
    }
    // Clone data before validating; caller serializers cannot rewrite the CLI input.
    const request = JSON.parse(JSON.stringify(structuredClone(fields)));
    if (bytes) request.Body = bytes;
    return request;
  } catch { throw new Error('OPS_AWS_REQUEST_REJECTED'); }
}
// No shell, automatic retry, private argv or raw subprocess diagnostics in output.
// The injected executor is solely for subprocess-shape/failure/cleanup tests.
export function awsTransport(executor = execute) {
  async function command(op, input, directory, outfile) {
    guard(op, input);
    const request = { ...input };
    const binaryArgs = [];
    if (commands[op][0] === 's3api') request.ExpectedBucketOwner = '092954139775';
    if (op === 'PutObject') {
      const bodyPath = join(directory, 'body');
      await writeFile(bodyPath, request.Body, { mode: 0o600 });
      request.ContentLength = request.Body.length; delete request.Body;
      binaryArgs.push('--body', bodyPath);
    }
    const requestPath = join(directory, 'request.json');
    await writeFile(requestPath, JSON.stringify(request), { mode: 0o600 });
    const inputArgs = [];
    if (op === 'GetObject') {
      // Streaming AWS CLI commands do not support --cli-input-json. Individual
      // parameter files preserve private keys/versions without exposing argv.
      for (const [field, flag] of [['Bucket', '--bucket'], ['Key', '--key'], ['VersionId', '--version-id'], ['ExpectedBucketOwner', '--expected-bucket-owner']]) {
        if (typeof request[field] !== 'string' || !request[field].length) throw new Error('OPS_AWS_REQUEST_REJECTED');
        const path = join(directory, field);
        await writeFile(path, request[field], { mode: 0o600 });
        inputArgs.push(flag, `file://${path}`);
      }
    } else inputArgs.push('--cli-input-json', `file://${requestPath}`);
    const args = [...commands[op], ...binaryArgs, '--region', 'us-east-1', '--output', 'json', '--no-cli-pager', ...inputArgs, ...(outfile ? [outfile] : [])];
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AWS_ENDPOINT_URL')));
    Object.assign(env, { AWS_MAX_ATTEMPTS: '1', AWS_PAGER: '', AWS_CONFIG_FILE: '/dev/null', AWS_SHARED_CREDENTIALS_FILE: '/dev/null' });
    try {
      const { stdout } = await executor('aws', args, { env, timeout: 30000, maxBuffer: limit });
      // The CLI suppresses an empty response object for acknowledged writes and
      // missing items. Only these Dynamo calls permit an absent response body;
      // journal callers still require a separate consistent readback.
      if (stdout === '' && ['PutItem', 'GetItem'].includes(op)) return {};
      return JSON.parse(stdout);
    } catch (error) {
      let observed;
      try {
        const stderr = error?.stderr;
        observed = typeof stderr === 'string' ? stderr.match(/An error occurred \(([A-Za-z0-9]+)\)/)?.[1] : undefined;
      } catch { /* Unreadable diagnostics retain the generic failure. */ }
      const failure = new Error('OPS_AWS_FAILED', { cause: error });
      failure.name = codes.includes(observed) ? observed : 'OPS_AWS_FAILED'; throw failure;
    }
  }
  return async (op, input) => {
    input = ownRequest(op, input);
    guard(op, input);
    const directory = await mkdtemp(join(tmpdir(), 'ke-operations-'));
    try {
      if (op !== 'GetObject') return await command(op, input, directory);
      // Pin the HEAD version before downloading: size and bytes cannot race a new version.
      const head = await command('HeadObject', input, directory);
      if (!Number.isSafeInteger(head.ContentLength) || head.ContentLength < 1 || head.ContentLength > limit
        || typeof head.VersionId !== 'string' || head.VersionId === 'null' || !head.VersionId.length
        || (input.VersionId !== undefined && input.VersionId !== head.VersionId)) throw new Error('OPS_MANIFEST_CONTENT_REJECTED');
      const outfile = join(directory, 'download');
      const response = await command('GetObject', { ...input, VersionId: head.VersionId }, directory, outfile);
      const info = await stat(outfile);
      if (info.size !== head.ContentLength || info.size > limit || response.VersionId !== head.VersionId) throw new Error('OPS_MANIFEST_CONTENT_REJECTED');
      return { ...response, Body: await readFile(outfile) };
    } finally { await rm(directory, { recursive: true, force: true }); }
  };
}
