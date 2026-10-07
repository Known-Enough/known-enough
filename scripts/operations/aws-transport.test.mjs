import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, stat, access } from 'node:fs/promises';
import { dirname } from 'node:path';
import { awsTransport } from './aws-transport.mjs';
import { MANIFEST_BUCKET } from './manifest.mjs';
const object = { Bucket: MANIFEST_BUCKET, Key: `manifests/${'a'.repeat(64)}.json` };
test('CLI keeps JSON/booleans/private bytes out of argv, bounds calls and cleans temporary files', async () => {
  let directory;
  const transport = awsTransport(async (file, args, options) => {
    assert.equal(file, 'aws'); assert.equal(options.timeout, 30000); assert.equal(options.env.AWS_MAX_ATTEMPTS, '1');
    const requestPath = args[args.indexOf('--cli-input-json') + 1].slice(7); directory = dirname(requestPath);
    const request = JSON.parse(await readFile(requestPath, 'utf8'));
    assert.equal((await stat(requestPath)).mode & 0o777, 0o600);
    assert.equal(request.ConsistentRead, true); assert.ok(!args.includes('true')); assert.ok(!args.some(a => a.includes('private fixture')));
    return { stdout: '{}' };
  });
  await transport('GetItem', { TableName: 'KnownEnoughOperationsJournal', Key: { PK: { S: `PLAN#${'a'.repeat(64)}` }, SK: { S: 'JOURNAL' } }, ConsistentRead: true });
  await assert.rejects(access(directory));
});
test('manifest upload uses an exclusive create and binary file; download pins bounded HEAD version', async () => {
  const bytes = Buffer.from('{"synthetic":true}'); const calls = []; const directories = [];
  const transport = awsTransport(async (_file, args) => {
    calls.push(args[1]); const requestPath = args[args.indexOf('--cli-input-json') + 1].slice(7); directories.push(dirname(requestPath));
    const request = JSON.parse(await readFile(requestPath, 'utf8'));
    assert.equal(request.ExpectedBucketOwner, '092954139775');
    if (args[1] === 'put-object') {
      assert.equal(request.IfNoneMatch, '*'); assert.equal(request.ContentLength, bytes.length);
      assert.equal(request.Body, undefined); assert.deepEqual(await readFile(args[args.indexOf('--body') + 1]), bytes);
      return { stdout: '{"VersionId":"v1"}' };
    }
    if (args[1] === 'head-object') return { stdout: JSON.stringify({ ContentLength: bytes.length, VersionId: 'v1' }) };
    assert.equal(request.VersionId, 'v1'); await writeFile(args.at(-1), bytes); return { stdout: '{"VersionId":"v1"}' };
  });
  await transport('PutObject', { ...object, Body: bytes, IfNoneMatch: '*' });
  assert.deepEqual((await transport('GetObject', object)).Body, bytes);
  assert.deepEqual(calls, ['put-object', 'head-object', 'get-object']);
  for (const directory of directories) await assert.rejects(access(directory));
});
test('rejects unrelated targets/actions, oversize bodies and unversioned/oversize downloads', async () => {
  let calls = 0;
  const transport = awsTransport(async () => { calls++; return { stdout: JSON.stringify({ ContentLength: 1024 * 1024 + 1, VersionId: 'v1' }) }; });
  for (const [op, input] of [['DeleteObject', object], ['GetItem', { TableName: 'Unrelated' }], ['GetItem', { TableName: 'KnownEnoughOperationsJournal', Key: { PK: { S: 'AUTH' } }, ConsistentRead: true }], ['PutItem', { TableName: 'KnownEnoughOperationsJournal', Item: { PK: { S: `PLAN#${'a'.repeat(64)}` }, SK: { S: 'JOURNAL' } } }], ['GetObject', { ...object, Bucket: 'other' }], ['PutObject', { ...object, Body: Buffer.alloc(1024 * 1024 + 1), IfNoneMatch: '*' }]]) await assert.rejects(transport(op, input));
  assert.equal(calls, 0); await assert.rejects(transport('GetObject', object)); assert.equal(calls, 1);
  await assert.rejects(awsTransport(async () => ({ stdout: '{"ContentLength":1,"VersionId":"null"}' }))('GetObject', object));
});
test('classifies genuine conditional/denied service errors without exposing stderr or retrying', async () => {
  let calls = 0; let directory;
  const transport = awsTransport(async (_file, args) => {
    calls++; directory = dirname(args[args.indexOf('--cli-input-json') + 1].slice(7));
    throw Object.assign(new Error('private request'), { stderr: 'An error occurred (AccessDenied) when calling PutObject: private fixture' });
  });
  await assert.rejects(transport('PutObject', { ...object, Body: Buffer.from('{}'), IfNoneMatch: '*' }), error => error.name === 'AccessDenied' && error.message === 'OPS_AWS_FAILED');
  assert.equal(calls, 1); await assert.rejects(access(directory));
});
