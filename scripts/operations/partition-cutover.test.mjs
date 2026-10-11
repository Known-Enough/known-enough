import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeConfiguration, verifyCodePublication, recoveryBinding } from './partition-cutover.mjs';
const digest = 'a'.repeat(64);
function fixture() {
  return { FunctionArn: 'arn:aws:lambda:us-east-1:092954139775:function:known-enough-stage-api',
    Role: 'arn:aws:iam::092954139775:role/KnownEnoughStageApiRole', State: 'Active', LastUpdateStatus: 'Successful',
    Handler: 'api.handler', RevisionId: 'private-revision', CodeSha256: Buffer.from(digest, 'hex').toString('base64'),
    Runtime: 'nodejs24.x', MemorySize: 512, Timeout: 30, VpcConfig: { SubnetIds: [] }, Environment: { Variables: {
      KE13B_TABLE_NAME: 'KnownEnoughStage', COGNITO_USER_POOL_ID: 'us-east-1_V9OMjd0zx', COGNITO_PARTICIPANT_CLIENT_ID: 'participant',
      COGNITO_DISPLAY_CLIENT_ID: 'display', KE13B_ALLOWED_ORIGIN: 'https://known.example.invalid', KE14_MODEL_MODE: 'DISABLED',
      KE14_PAID_CALLS_APPROVED: 'false', NP_GROUPS_ENABLED: 'true', NP_GROUP_TABLE_NAME: 'KnownEnoughGroupsStage',
      NP_GROUP_EMAIL_KEY: 'PRIVATE_EMAIL_KEY_CANARY'.repeat(3), NP_COGNITO_DOMAIN: 'https://known-primary.auth.us-east-1.amazoncognito.com',
      UNRELATED_PRIVATE: 'PRIVATE_UNRELATED_CANARY' } } };
}
test('code-only readback preserves unrelated private configuration and ignores only legitimate code revision metadata', () => {
  const previous = fixture(); const next = structuredClone(previous); next.RevisionId = 'new';
  assert.equal(verifyCodePublication(previous, next, digest), true);
});
test('wrong code, environment, execution role, handler, layer, memory or unsettled publication cannot permit source freeze', () => {
  const changes = [current => { current.CodeSha256 = Buffer.alloc(32).toString('base64'); },
    current => { current.Environment.Variables.UNRELATED_PRIVATE = 'CHANGED'; }, current => { current.Role += 'other'; },
    current => { current.Handler = 'api.other'; }, current => { current.Layers = [{ Arn: 'other' }]; },
    current => { current.MemorySize++; }, current => { current.LastUpdateStatus = 'InProgress'; }];
  for (const mutate of changes) { const current = fixture(); mutate(current); assert.throws(() => verifyCodePublication(fixture(), current, digest)); }
});
test('private native configuration retains the actual email hash key and identity while generating an independent cursor key', () => {
  const original = fixture(); const first = nativeConfiguration(original); const second = nativeConfiguration(original);
  assert.equal(first.emailKey, original.Environment.Variables.NP_GROUP_EMAIL_KEY); assert.equal(first.userPoolId, 'us-east-1_V9OMjd0zx');
  assert.equal(Buffer.from(first.cursorKeyBase64, 'base64').length, 32); assert.notEqual(first.cursorKeyBase64, second.cursorKeyBase64);
  assert.ok(!JSON.stringify(first).includes('PRIVATE_UNRELATED_CANARY')); assert.equal(original.Environment.Variables.KE14_MODEL_MODE, 'DISABLED');
});
test('foreign source pool/table or enabled provider cannot silently change current model mode or become a deployment', () => {
  for (const field of ['COGNITO_USER_POOL_ID', 'NP_GROUP_TABLE_NAME', 'KE13B_TABLE_NAME']) {
    const current = fixture(); current.Environment.Variables[field] = 'OTHER'; assert.throws(() => nativeConfiguration(current));
  }
  const current = fixture(); current.Environment.Variables.KE14_MODEL_MODE = 'BEDROCK'; assert.throws(() => nativeConfiguration(current));
});

test('restart uses the exact persisted migration anchors and rejects mismatched, active or corrupted records', () => {
  const control = { schemaVersion: 1, account: '092954139775', region: 'us-east-1', table: 'KnownEnoughPartitions',
    revision: 1, active: false, planHash: 'a'.repeat(64) };
  const journal = { schemaVersion: 1, revision: 1, actorId: 44531296, planHash: control.planHash,
    manifestHash: 'b'.repeat(64), manifestVersion: 'private-version', sourceSha: 'c'.repeat(40),
    sourceRevision: 1, sourceHash: 'd'.repeat(64), rowCount: 0, nextBatch: 0, completedRows: 0, state: 'COPIED' };
  const envelope = (PK,SK,value) => ({ PK: { S: PK }, SK: { S: SK }, revision: { N: String(value.revision) }, payload: { S: JSON.stringify(value) } });
  const c = envelope('MIGRATION#CONTROL','STATE',control); const j = envelope(`PARTITION#${control.planHash}`,'JOURNAL',journal);
  const actual = recoveryBinding(c,j); assert.equal(actual.binding.sourceSha,journal.sourceSha); assert.equal(actual.manifestVersion,journal.manifestVersion);
  const foreign = structuredClone(j); foreign.PK.S += 'other'; assert.throws(() => recoveryBinding(c,foreign));
  const stale = structuredClone(j); stale.revision.N = '9'; assert.throws(() => recoveryBinding(c,stale));
  assert.throws(() => recoveryBinding(envelope('MIGRATION#CONTROL','STATE',{...control,active:true}),j));
  assert.throws(() => recoveryBinding(c,envelope(j.PK.S,'JOURNAL',{...journal,planHash:'e'.repeat(64)})));
});
