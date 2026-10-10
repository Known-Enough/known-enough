import test from 'node:test';
import assert from 'node:assert/strict';
import { GetItemCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { probeAccess, accessFailure } from './access-probe.mjs';
import { ACCESS_ROLES } from './access-setup.mjs';

const sha = 'a'.repeat(40);
const env = { GITHUB_REPOSITORY: 'Known-Enough/known-enough', GITHUB_REF: 'refs/heads/main', GITHUB_ACTOR_ID: '44531296',
  GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_SHA: sha, EXPECTED_SOURCE: sha, CHECKOUT_SOURCE: sha,
  PROBE_ID: '12345678-1234-4234-9234-123456789abc' };
function fixture(kind) {
  let item; let puts = 0; let lose = false; let notApplied = false; let boundary = true; const calls = []; const versions = new Map();
  return { identity: { Account: '092954139775', Arn: `arn:aws:sts::092954139775:assumed-role/${ACCESS_ROLES[kind]}/own-ci` },
    async send(command, options) {
      assert.ok(options.abortSignal instanceof globalThis.AbortSignal); calls.push(command.input);
      assert.equal(command.input.TableName ?? command.input.TransactItems[0].Put.TableName,
        'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughOperationsJournal');
      if (command instanceof GetItemCommand) {
        if (command.input.Key.PK.S.startsWith('OPS00_FORBIDDEN#')) {
          if (boundary) { const error = new Error('PRIVATE_AWS_REASON'); error.name = 'AccessDeniedException'; throw error; }
          return {};
        }
        return item ? { Item: structuredClone(item) } : {};
      }
      assert.ok(command instanceof TransactWriteItemsCommand); puts++;
      assert.equal(command.input.TransactItems.length, 1); assert.equal(command.input.TransactItems[0].Put.ConditionExpression, 'attribute_not_exists(PK)');
      if (!notApplied) item = structuredClone(command.input.TransactItems[0].Put.Item);
      if (lose) throw new Error('PRIVATE_LOST_ACK');
      return {};
    },
    recovery: {
      async preserve(bytes, hash) { if (!versions.has(hash)) versions.set(hash, Buffer.from(bytes)); return { bytes: versions.get(hash), versionId: 'pinned-version' }; },
      async read(hash, versionId) { return { bytes: Buffer.from(versions.get(hash)), versionId }; },
    },
    get puts() { return puts; }, get calls() { return calls; }, get versions() { return versions; },
    set lose(value) { lose = value; }, set notApplied(value) { notApplied = value; }, set boundary(value) { boundary = value; },
    set item(value) { item = value; },
  };
}
for (const kind of Object.keys(ACCESS_ROLES)) test(`${kind}: exact synthetic transaction/readback, denied foreign prefix and duplicate resume`, async () => {
  const f = fixture(kind); const first = await probeAccess(env, kind, f.identity, f.send, f.recovery);
  assert.equal(first.result, 'ACCESS_CAPABILITY_PROBE_PASS'); assert.equal(first.resumed, false); assert.equal(first.providerCalls, 0);
  assert.equal(f.puts, 1); assert.equal(first.forbiddenPrefix, 'ACCESS_DENIED');
  assert.equal(first.recovery, ['archive', 'migration'].includes(kind) ? 'VERSIONED_READBACK_PASS' : 'NOT_REQUIRED');
  const resumed = await probeAccess({ ...env, GITHUB_ACTOR_ID: '143764700' }, kind, f.identity, f.send, f.recovery);
  assert.equal(resumed.resumed, true); assert.equal(f.puts, 1);
  assert.ok(!JSON.stringify(first).includes('PRIVATE')); assert.ok(!JSON.stringify(first).includes('pinned-version'));
  assert.ok(f.calls.every(c => !['AUTH', 'TOTAL', 'NP#GROUPS', 'MIGRATION#CONTROL'].includes(c.Key?.PK.S)));
});
test('lost applied write is reconciled by reads; missing outcome stops without retry or overwrite', async () => {
  const f = fixture('jobs'); f.lose = true;
  assert.equal((await probeAccess(env, 'jobs', f.identity, f.send, f.recovery)).resumed, true); assert.equal(f.puts, 1);
  const missing = fixture('jobs'); missing.lose = true; missing.notApplied = true;
  await assert.rejects(probeAccess(env, 'jobs', missing.identity, missing.send, missing.recovery), /ACCESS_WRITE_UNKNOWN/);
  assert.equal(missing.puts, 1);
});
test('unexpected existing probe content and ineffective boundary fail without exposure', async () => {
  const f = fixture('jobs'); f.item = { PRIVATE: 'DO_NOT_PRINT' };
  await assert.rejects(probeAccess(env, 'jobs', f.identity, f.send, f.recovery), /ACCESS_PROBE_CONFLICT/); assert.equal(f.puts, 0);
  const broad = fixture('jobs'); broad.boundary = false;
  await assert.rejects(probeAccess(env, 'jobs', broad.identity, broad.send, broad.recovery), /ACCESS_BOUNDARY_NOT_ENFORCED/);
});
test('foreign source/actor/role/account/probe ID rejected before touching storage', async () => {
  const f = fixture('migration');
  for (const change of [{ GITHUB_ACTOR_ID: '123' }, { EXPECTED_SOURCE: 'b'.repeat(40) }, { PROBE_ID: 'raw-private-name' }])
    await assert.rejects(probeAccess({ ...env, ...change }, 'migration', f.identity, f.send, f.recovery), /ACCESS_INPUT_REJECTED/);
  await assert.rejects(probeAccess(env, 'migration', { ...f.identity, Account: '123456789012' }, f.send, f.recovery), /ACCESS_IDENTITY_REJECTED/);
  await assert.rejects(probeAccess(env, 'jobs', f.identity, f.send, f.recovery), /ACCESS_IDENTITY_REJECTED/);
  assert.equal(f.calls.length, 0);
});
test('only allowlisted error/underlying AWS codes reach the public report', () => {
  const cause = new Error('PRIVATE_DATA'); cause.name = 'AccessDeniedException';
  const result = accessFailure(new Error('ACCESS_STORAGE_FAILED', { cause }));
  assert.equal(result.awsError, 'AccessDeniedException'); assert.ok(!JSON.stringify(result).includes('PRIVATE_DATA'));
});
