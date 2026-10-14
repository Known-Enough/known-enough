import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { withSharedEmailConfiguration, verifySharedEmailConfigured } from './shared-email-package.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture() {
  const configurationBytes = Buffer.from(JSON.stringify({ schemaVersion: 1, account: '092954139775', region: 'us-east-1',
    userPoolId: 'us-east-1_V9OMjd0zx', participantClientId: 'participant', displayClientId: 'display',
    cognitoDomain: 'https://synthetic.auth.us-east-1.amazoncognito.com', allowedOrigin: 'https://main.d143q5ravxp5av.amplifyapp.com',
    emailKey: 'PRIVATE_SYNTHETIC_KEY'.repeat(3), cursorKeyBase64: Buffer.alloc(32, 7).toString('base64') }));
  const source = Buffer.from(JSON.stringify({ accounts: [], groups: [] }));
  const manifestBytes = Buffer.from(JSON.stringify({ schemaVersion: 2, sourceSha: 'a'.repeat(40), account: '092954139775',
    region: 'us-east-1', sourceTable: 'KnownEnoughGroupsStage', sourceKey: { PK: 'NP#GROUPS', SK: 'STATE' },
    targetTable: 'KnownEnoughPartitions', sourceRevision: 3, sourceHash: hash(source), sourcePayloadBase64: source.toString('base64') }));
  const release = { sourceSha: 'a'.repeat(40), configurationHash: hash(configurationBytes), manifestHash: hash(manifestBytes),
    sourceHash: hash(source), sourceRevision: 3, manifestVersion: 'immutable-v1' };
  return { configurationBytes, manifestBytes, release };
}
test('exact normalized private email exception preserves existing private keys and migration, with a checked new config anchor', () => {
  const f = fixture();
  const next = withSharedEmailConfiguration(f.configurationBytes, f.manifestBytes, f.release, 'TEST@example.invalid');
  const config = JSON.parse(next.configurationBytes), before = JSON.parse(f.configurationBytes);
  assert.equal(config.sharedTestEmailHashes.length, 1);
  const { sharedTestEmailHashes: privateHashes, ...rest } = config;
  assert.match(privateHashes[0], /^[a-f0-9]{64}$/);
  assert.deepEqual(rest, before);
  assert.doesNotMatch(next.configurationBytes.toString(), /TEST@example.invalid/);
  assert.deepEqual(next.release, { ...f.release, configurationHash: hash(next.configurationBytes) });
  const again = withSharedEmailConfiguration(next.configurationBytes, f.manifestBytes, next.release, 'test@example.invalid');
  assert.deepEqual(again, next);
  assert.equal(verifySharedEmailConfigured(next.configurationBytes, f.manifestBytes, next.release, 'test@example.invalid'), true);
  assert.throws(() => verifySharedEmailConfigured(next.configurationBytes, f.manifestBytes, next.release, 'different@example.invalid')); 
  const other = withSharedEmailConfiguration(next.configurationBytes, f.manifestBytes, next.release, 'different@example.invalid');
  assert.equal(JSON.parse(other.configurationBytes).sharedTestEmailHashes.length, 2);
});
test('rejects invalid email, stale private anchors and tampered config before packaging', () => {
  const f = fixture();
  for (const email of ['', 'bad', 'test@example.invalid\n']) {
    assert.throws(() => withSharedEmailConfiguration(f.configurationBytes, f.manifestBytes, f.release, email));
  }
  assert.throws(() => withSharedEmailConfiguration(f.configurationBytes, f.manifestBytes,
    { ...f.release, configurationHash: 'b'.repeat(64) }, 'test@example.invalid'));
  const foreign = Buffer.from(JSON.stringify({ ...JSON.parse(f.configurationBytes), userPoolId: 'us-east-1_other' }));
  assert.throws(() => withSharedEmailConfiguration(foreign, f.manifestBytes,
    { ...f.release, configurationHash: hash(foreign) }, 'test@example.invalid'));
});
