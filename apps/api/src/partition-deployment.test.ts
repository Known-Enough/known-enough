import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { createPartitionDeploymentHandler, type PartitionDeploymentBinding } from './partition-deployment.ts';
import { createPartitionLambdaHandler } from './partition-lambda.ts';
import type { HttpApiEvent } from './ke13b-lambda.ts';
const mocks = vi.hoisted(() => ({ handler: vi.fn() }));
vi.mock('./partition-lambda.ts', () => ({ createPartitionLambdaHandler: vi.fn(() => mocks.handler) }));
afterEach(() => { vi.clearAllMocks(); mocks.handler.mockReset(); });
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
function fixture() {
  const config = { schemaVersion: 1, account: '092954139775', region: 'us-east-1', userPoolId: 'us-east-1_synthetic',
    participantClientId: 'participant-client', displayClientId: 'display-client',
    cognitoDomain: 'https://synthetic.auth.us-east-1.amazoncognito.com', allowedOrigin: 'https://synthetic.example.invalid',
    emailKey: 'PRIVATE_EMAIL_KEY_'.repeat(3), cursorKeyBase64: Buffer.alloc(32, 7).toString('base64') };
  const source = encode({ accounts: [], groups: [] });
  const manifest = { schemaVersion: 2, sourceSha: 'a'.repeat(40), account: config.account, region: config.region,
    sourceTable: 'KnownEnoughGroupsStage', sourceKey: { PK: 'NP#GROUPS', SK: 'STATE' }, targetTable: 'KnownEnoughPartitions',
    sourceRevision: 3, sourceHash: digest(source), sourcePayloadBase64: source.toString('base64') };
  const configurationBytes = encode(config); const manifestBytes = encode(manifest);
  const release: PartitionDeploymentBinding = { sourceSha: manifest.sourceSha, configurationHash: digest(configurationBytes),
    manifestHash: digest(manifestBytes), sourceHash: manifest.sourceHash, sourceRevision: 3, manifestVersion: 'immutable-version-1' };
  return { config, source, manifest, configurationBytes, manifestBytes, release };
}
function rejects(config: Buffer, manifest: Buffer, release: PartitionDeploymentBinding) {
  expect(() => createPartitionDeploymentHandler(config, manifest, release)).toThrow(/^PARTITION_DEPLOYMENT_INVALID$/);
  expect(createPartitionLambdaHandler).not.toHaveBeenCalled();
}
it('constructs only from private bytes matching the independent release and captures keys/source facts', async () => {
  const f = fixture(); const architect = vi.fn();
  const handler = createPartitionDeploymentHandler(f.configurationBytes, f.manifestBytes, f.release, architect);
  const options = vi.mocked(createPartitionLambdaHandler).mock.calls[0]![0];
  expect(options.mode).toBe('PARTITION_V2'); expect(options.identity.userPoolId).toBe(f.config.userPoolId);
  expect(options.managed.expected).toEqual({ sourceSha: f.release.sourceSha, manifestHash: f.release.manifestHash,
    sourceHash: f.release.sourceHash, sourceRevision: 3 });
  expect(options.managed.manifestVersion).toBe('immutable-version-1');
  expect(options.managed.cursorKey).toEqual(Buffer.alloc(32, 7)); expect(options.draftArchitect).toBe(architect);
  expect(options.clock.now()).toMatch(/^\d{4}-\d\d-\d\dT/); expect(options.ids.next()).toMatch(/^[a-f0-9-]{36}$/);
  f.configurationBytes.fill(0); f.manifestBytes.fill(0); f.release.sourceSha = 'b'.repeat(40);
  expect(options.emailKey).toBe(f.config.emailKey); expect(options.managed.manifestBytes).toEqual(encode(f.manifest));
  expect(options.managed.expected.sourceSha).toBe('a'.repeat(40));
  const event = { headers: { 'x-storage-table': 'FORGED' }, body: '{"configuration":"FORGED"}' } as HttpApiEvent;
  await handler(event); expect(mocks.handler).toHaveBeenCalledExactlyOnceWith(event);
  expect(createPartitionLambdaHandler).toHaveBeenCalledTimes(1);
});
it.each(['configuration', 'manifest'])('rejects a tampered %s even if its own JSON claims are plausible', field => {
  const f = fixture();
  if (field === 'configuration') f.config.emailKey = 'ALTERED_PRIVATE_KEY'.repeat(3); else f.manifest.sourceRevision++;
  rejects(encode(f.config), encode(f.manifest), f.release);
});
it.each([
  { sourceSha: 'b'.repeat(40) }, { configurationHash: 'b'.repeat(64) }, { manifestHash: 'b'.repeat(64) },
  { sourceHash: 'b'.repeat(64) }, { sourceRevision: 4 }, { sourceRevision: 0 }, { sourceRevision: 1.5 },
  { sourceSha: '0'.repeat(40) }, { manifestVersion: 'null' }, { manifestVersion: '' }, { manifestVersion: 'bad\nversion' },
])('rejects invalid or mismatched independent release facts before constructing storage: %j', patch => {
  const f = fixture(); rejects(f.configurationBytes, f.manifestBytes, { ...f.release, ...patch });
});
it.each([
  { account: '000000000000' }, { region: 'us-west-2' }, { schemaVersion: 2 }, { endpoint: 'https://other.invalid' },
  { userPoolId: 'us-west-2_synthetic' }, { displayClientId: 'participant-client' }, { participantClientId: '' },
  { cognitoDomain: 'https://other.invalid' }, { cognitoDomain: 'https://synthetic.auth.us-east-1.amazoncognito.com/path' },
  { allowedOrigin: 'http://synthetic.example.invalid' }, { allowedOrigin: 'https://secret@synthetic.example.invalid' },
  { emailKey: 'short' }, { cursorKeyBase64: Buffer.alloc(31).toString('base64') }, { cursorKeyBase64: '%%%%' },
])('rejects incompatible settings even if the release hash covers those exact bytes: %j', patch => {
  const f = fixture(); const data = encode({ ...f.config, ...patch });
  rejects(data, f.manifestBytes, { ...f.release, configurationHash: digest(data) });
});
it.each([
  { schemaVersion: 1 }, { account: '000000000000' }, { region: 'us-west-2' },
  { sourceTable: 'OtherTable' }, { targetTable: 'OtherTable' }, { sourceKey: { PK: 'NP#OTHER', SK: 'STATE' } },
  { sourcePayloadBase64: '%%%%' }, { sourcePayloadBase64: Buffer.from('ALTERED_PRIVATE_STATE').toString('base64') },
  { unknown: 'PRIVATE_FIELD' },
])('rejects deprecated/foreign/corrupt source snapshots without trusting their self-reported hashes: %j', patch => {
  const f = fixture(); const data = encode({ ...f.manifest, ...patch });
  rejects(f.configurationBytes, data, { ...f.release, manifestHash: digest(data) });
});
it.each([Buffer.alloc(0), Buffer.alloc(16385), Buffer.from('not-json'), Buffer.from([0xff]), encode([]), encode(null)])(
  'bounds and parses private configuration before initialization', data => {
    const f = fixture(); rejects(data, f.manifestBytes, { ...f.release, configurationHash: digest(data) });
  });
it.each([Buffer.alloc(0), Buffer.alloc(1024 * 1024 + 1), Buffer.from('not-json'), Buffer.from([0xff]), encode([])])(
  'bounds and parses private manifests before initialization', data => {
    const f = fixture(); rejects(f.configurationBytes, data, { ...f.release, manifestHash: digest(data) });
  });
it('rejects missing release fields, unexpected directives and getters without executing them', () => {
  const f = fixture(); const getter = vi.fn(() => f.release.sourceSha);
  const crafted = { ...f.release }; Object.defineProperty(crafted, 'sourceSha', { get: getter, enumerable: true });
  rejects(f.configurationBytes, f.manifestBytes, crafted); expect(getter).not.toHaveBeenCalled();
  rejects(f.configurationBytes, f.manifestBytes, { ...f.release, endpoint: 'FORGED' } as PartitionDeploymentBinding);
});
it('does not serialize private settings or attach private construction failure causes', () => {
  const f = fixture(); vi.mocked(createPartitionLambdaHandler).mockImplementationOnce(() => { throw new Error('PRIVATE_SOURCE_AND_KEY'); });
  try { createPartitionDeploymentHandler(f.configurationBytes, f.manifestBytes, f.release); throw new Error('expected failure'); }
  catch (error) {
    expect(error).toBeInstanceOf(Error); expect((error as Error).message).toBe('PARTITION_DEPLOYMENT_INVALID');
    expect(error).not.toHaveProperty('cause'); expect(String(error)).not.toMatch(/PRIVATE_|sourcePayload/);
  }
});

it('the real composition validates group-state semantics after byte binding, without making a network request', async () => {
  const actual = await vi.importActual<typeof import('./partition-lambda.ts')>('./partition-lambda.ts');
  vi.mocked(createPartitionLambdaHandler).mockImplementationOnce(actual.createPartitionLambdaHandler);
  const f = fixture(); const source = Buffer.from('not-json');
  f.manifest.sourcePayloadBase64 = source.toString('base64'); f.manifest.sourceHash = digest(source);
  const manifest = encode(f.manifest); const fetcher = vi.spyOn(globalThis, 'fetch');
  try {
    expect(() => createPartitionDeploymentHandler(f.configurationBytes, manifest,
      { ...f.release, manifestHash: digest(manifest), sourceHash: digest(source) })).toThrow('PARTITION_DEPLOYMENT_INVALID');
    expect(fetcher).not.toHaveBeenCalled();
  } finally { fetcher.mockRestore(); }
});
