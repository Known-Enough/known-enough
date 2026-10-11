import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { primaryBackupKey, readPrimaryBackup } from './partition-backup.mjs';
const bytes = Buffer.from('PRIVATE_ZIP_FIXTURE_BYTES');
function fixture() { return { FunctionArn: 'arn:aws:lambda:us-east-1:092954139775:function:known-enough-stage-api',
  Role: 'arn:aws:iam::092954139775:role/KnownEnoughStageApiRole', State: 'Active', LastUpdateStatus: 'Successful', Handler: 'api.handler',
  CodeSha256: createHash('sha256').update(bytes).digest('base64') }; }
test('only the fixed current primary checksum can select a backup, with bytes independently verified', async () => {
  const config = fixture();
  const result = await readPrimaryBackup(config, async (command, options) => {
    assert.equal(command.Bucket, 'known-enough-qa-artifacts-092954139775');
    assert.equal(command.Key, primaryBackupKey(config)); assert.ok(options.abortSignal instanceof globalThis.AbortSignal);
    return { ContentLength: bytes.length, Body: Readable.from([bytes.subarray(0, 5), bytes.subarray(5)]) };
  });
  assert.deepEqual(result.bytes, bytes);
});
test('a corrupt or empty backup never authorizes publication even when the object key matches', async () => {
  for (const value of [Buffer.from('PRIVATE_CORRUPT'), Buffer.alloc(0)]) {
    await assert.rejects(readPrimaryBackup(fixture(), async () => ({ Body: Readable.from([value]) })), /PARTITION_BACKUP_INVALID/);
  }
});
test('foreign role/function, unsettled configuration and invalid checksum are rejected before a storage request', async () => {
  for (const change of [{ Role: 'OTHER' }, { FunctionArn: 'OTHER' }, { LastUpdateStatus: 'InProgress' }, { CodeSha256: 'PRIVATE_INVALID' }]) {
    let calls = 0;
    await assert.rejects(readPrimaryBackup({ ...fixture(), ...change }, async () => { calls++; return {}; }), /PARTITION_BACKUP_INVALID/);
    assert.equal(calls, 0);
  }
});
test('declared oversized responses are rejected and missing objects remain failures rather than empty backups', async () => {
  await assert.rejects(readPrimaryBackup(fixture(), async () => ({ ContentLength: 50 * 1024 * 1024 + 1, Body: Readable.from([bytes]) })), /PARTITION_BACKUP_INVALID/);
  await assert.rejects(readPrimaryBackup(fixture(), async () => { throw Object.assign(new Error('PRIVATE_OBJECT'), { name: 'NoSuchKey' }); }), { name: 'NoSuchKey' });
});
