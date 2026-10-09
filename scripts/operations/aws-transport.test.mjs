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

test('caller serializers cannot retarget the checked table or key or remove a write condition', async () => {
  const key = { PK: { S: `PLAN#${'a'.repeat(64)}` }, SK: { S: 'JOURNAL' } };
  let calls = 0; let hooks = 0;
  const hook = value => function () { hooks++; return value; };
  const transport = awsTransport(async () => { calls++; return { stdout: '{}' }; });
  for (const [op, input] of [
    ['GetItem', { TableName: 'KnownEnoughOperationsJournal', Key: key, ConsistentRead: true,
      toJSON: hook({ TableName: 'SYNTHETIC_OTHER_TABLE', Key: key, ConsistentRead: true }) }],
    ['GetItem', { TableName: 'KnownEnoughOperationsJournal', ConsistentRead: true,
      Key: { ...key, toJSON: hook({ PK: { S: 'SYNTHETIC_OTHER_KEY' }, SK: key.SK }) } }],
    ['PutItem', { TableName: 'KnownEnoughOperationsJournal', Item: key, ConditionExpression: 'attribute_not_exists(PK)',
      toJSON: hook({ TableName: 'KnownEnoughOperationsJournal', Item: key }) }],
    ['PutItem', { TableName: 'KnownEnoughOperationsJournal', ConditionExpression: 'attribute_not_exists(PK)',
      Item: { ...key, PK: { S: { toString: hook(key.PK.S), toJSON: hook('SYNTHETIC_OTHER_KEY') } } } }]
  ]) await assert.rejects(transport(op, input), error => error.message === 'OPS_AWS_REQUEST_REJECTED');
  assert.equal(calls, 0); assert.equal(hooks, 0);
});
test('journal requests own their nested key and conditions before the first await', async () => {
  for (const op of ['GetItem', 'PutItem']) {
    const originalKey = { PK: { S: `PLAN#${'a'.repeat(64)}` }, SK: { S: 'JOURNAL' } };
    const input = { TableName: 'KnownEnoughOperationsJournal', [op === 'GetItem' ? 'Key' : 'Item']: structuredClone(originalKey),
      ...(op === 'GetItem' ? { ConsistentRead: true } : { ConditionExpression: 'revision = :expected', ExpressionAttributeValues: { ':expected': { N: '2' } } }) };
    let directory; let observed;
    const transport = awsTransport(async (_file, args) => {
      const path = args[args.indexOf('--cli-input-json') + 1].slice(7); directory = dirname(path);
      observed = JSON.parse(await readFile(path, 'utf8')); return { stdout: '{}' };
    });
    const pending = transport(op, input);
    input.TableName = 'SYNTHETIC_OTHER_TABLE'; input[op === 'GetItem' ? 'Key' : 'Item'].PK.S = 'SYNTHETIC_OTHER_KEY';
    if (op === 'GetItem') input.ConsistentRead = false;
    else { input.ConditionExpression = 'SYNTHETIC_OTHER_CONDITION'; input.ExpressionAttributeValues[':expected'].N = '99'; }
    await pending;
    assert.equal(observed.TableName, 'KnownEnoughOperationsJournal');
    assert.deepEqual(observed[op === 'GetItem' ? 'Key' : 'Item'], originalKey);
    if (op === 'GetItem') assert.equal(observed.ConsistentRead, true);
    else { assert.equal(observed.ConditionExpression, 'revision = :expected'); assert.deepEqual(observed.ExpressionAttributeValues, { ':expected': { N: '2' } }); }
    await assert.rejects(access(directory));
  }
});
test('manifest upload owns exact bytes and request metadata before caller mutation', async () => {
  const original = Buffer.from('{"synthetic":true}'); const input = { ...object, Body: Buffer.from(original), IfNoneMatch: '*', ContentType: 'application/json' };
  let directory; let request; let bytes;
  const transport = awsTransport(async (_file, args) => {
    const path = args[args.indexOf('--cli-input-json') + 1].slice(7); directory = dirname(path);
    request = JSON.parse(await readFile(path, 'utf8')); bytes = await readFile(args[args.indexOf('--body') + 1]); return { stdout: '{"VersionId":"v1"}' };
  });
  const pending = transport('PutObject', input);
  input.Body.fill(120); input.Body = Buffer.from('{}'); input.Key = `manifests/${'b'.repeat(64)}.json`; input.IfNoneMatch = 'changed'; input.ContentType = 'changed';
  await pending;
  assert.deepEqual(bytes, original); assert.equal(request.Key, object.Key); assert.equal(request.IfNoneMatch, '*');
  assert.equal(request.ContentType, 'application/json'); assert.equal(request.ContentLength, original.length);
  assert.equal(request.ExpectedBucketOwner, '092954139775'); await assert.rejects(access(directory));
});
test('HEAD and download use the same owned object and requested version despite caller mutation', async () => {
  const bytes = Buffer.from('{}'); const input = { ...object, VersionId: 'v1' }; const calls = []; let directory;
  const transport = awsTransport(async (_file, args) => {
    const path = args[args.indexOf('--cli-input-json') + 1].slice(7); directory = dirname(path);
    const request = JSON.parse(await readFile(path, 'utf8')); calls.push(request);
    if (args[1] === 'head-object') {
      input.Key = `manifests/${'b'.repeat(64)}.json`; input.VersionId = 'changed'; input.Bucket = 'SYNTHETIC_OTHER_BUCKET';
      return { stdout: '{"ContentLength":2,"VersionId":"v1"}' };
    }
    await writeFile(args.at(-1), bytes); return { stdout: '{"VersionId":"v1"}' };
  });
  const response = await transport('GetObject', input); assert.deepEqual(response.Body, bytes); assert.equal(calls.length, 2);
  for (const request of calls) { assert.equal(request.Key, object.Key); assert.equal(request.Bucket, object.Bucket); assert.equal(request.VersionId, 'v1'); }
  await assert.rejects(access(directory));
});
test('changing getters are captured once and the same values are checked and sent', async () => {
  let tableReads = 0; let keyReads = 0; let directory;
  const input = { get TableName() { return ++tableReads === 1 ? 'KnownEnoughOperationsJournal' : 'SYNTHETIC_OTHER_TABLE'; },
    Key: { get PK() { keyReads++; return { S: `PLAN#${'a'.repeat(64)}` }; }, SK: { S: 'JOURNAL' } }, ConsistentRead: true };
  await awsTransport(async (_file, args) => {
    const path = args[args.indexOf('--cli-input-json') + 1].slice(7); directory = dirname(path);
    const request = JSON.parse(await readFile(path, 'utf8')); assert.equal(request.TableName, 'KnownEnoughOperationsJournal');
    assert.equal(request.Key.PK.S, `PLAN#${'a'.repeat(64)}`); return { stdout: '{}' };
  })('GetItem', input);
  assert.equal(tableReads, 1); assert.equal(keyReads, 1); await assert.rejects(access(directory));
});
test('unserializable or throwing request data rejects before executor calls with a finite private-safe error', async () => {
  let calls = 0; const transport = awsTransport(async () => { calls++; return { stdout: '{}' }; });
  const base = { TableName: 'KnownEnoughOperationsJournal', Key: { PK: { S: `PLAN#${'a'.repeat(64)}` }, SK: { S: 'JOURNAL' } }, ConsistentRead: true };
  const cyclic = { ...base }; cyclic.SYNTHETIC_PRIVATE_CYCLE = cyclic;
  for (const input of [{ ...base, SYNTHETIC_PRIVATE_BIGINT: 1n }, cyclic,
    { ...base, get SYNTHETIC_PRIVATE_GETTER() { throw new Error('SYNTHETIC_PRIVATE_DETAIL'); } }]) {
    await assert.rejects(transport('GetItem', input), error => error.message === 'OPS_AWS_REQUEST_REJECTED' && error.cause === undefined);
  }
  assert.equal(calls, 0);
});
test('operation identifiers must be primitive strings and never execute coercion hooks', async () => {
  let calls = 0; let hooks = 0;
  const op = { [Symbol.toPrimitive]() { hooks++; return 'GetItem'; } };
  const input = { TableName: 'KnownEnoughOperationsJournal', Key: { PK: { S: `PLAN#${'a'.repeat(64)}` }, SK: { S: 'JOURNAL' } }, ConsistentRead: true };
  await assert.rejects(awsTransport(async () => { calls++; return { stdout: '{}' }; })(op, input), /OPS_AWS_REQUEST_REJECTED/);
  assert.equal(calls, 0); assert.equal(hooks, 0);
});
