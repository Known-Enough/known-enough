import type { IncomingMessage } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { createPartitionRuntime, type PartitionRuntimeOptions } from './partition-runtime.ts';
import { createCognitoIdentityResolver } from './cognito-identity.ts';
import { createPartitionManagedDriver } from '@deal-table/adapters/partition-request';
import { createPartitionParticipantApiHandler } from './partition-http.ts';
import { createManagedDurableEnqueue } from './durable-enqueue.ts';

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), listener: vi.fn(), discovery: vi.fn(), groups: {}, decisions: {}, lifecycle: vi.fn((config: { sourceSha: string; signingKey: Buffer }) => { void config; return { exportOwn: vi.fn(), loadOwnPlan: vi.fn(), consent: vi.fn(), status: vi.fn(), assertRetained: vi.fn() }; }) }));
vi.mock('./cognito-identity.ts', () => ({ createCognitoIdentityResolver: vi.fn(() => mocks.resolve) }));
vi.mock('./partition-http.ts', () => ({ createPartitionParticipantApiHandler: vi.fn(() => mocks.listener) }));
vi.mock('./durable-enqueue.ts', () => ({ createManagedDurableEnqueue: vi.fn(() => vi.fn()) }));
vi.mock('@deal-table/adapters/partition-request', () => ({ createPartitionManagedDriver: vi.fn(() => ({
  groups: mocks.groups, decisions: mocks.decisions, membershipDiscovery: mocks.discovery,
  decisionArn: 'synthetic-decision-arn', partitionArn: 'synthetic-partition-arn', archivePorts: vi.fn(), lifecycle: mocks.lifecycle,
})) }));
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); mocks.resolve.mockReset(); });
function configuration(): PartitionRuntimeOptions {
  return { mode: 'PARTITION_V2', managed: {} as PartitionRuntimeOptions['managed'],
    identity: { userPoolId: 'us-east-1_synthetic', participantClientId: 'participant-client', displayClientId: 'display-client' },
    cognitoDomain: 'https://synthetic.auth.us-east-1.amazoncognito.com', allowedOrigin: 'https://synthetic.example.invalid',
    emailKey: 'synthetic-'.repeat(8), clock: { now: () => '2026-10-08T00:00:00Z' }, ids: { next: () => 'synthetic-id' } };
}
function capture(value = configuration()) {
  const listener = createPartitionRuntime(value);
  const options = vi.mocked(createPartitionParticipantApiHandler).mock.calls.at(-1)![0];
  return { value, listener, options };
}
const request = (authorization: string | string[] | undefined = 'Bearer synthetic.jwt.token') => ({ headers: { authorization } }) as IncomingMessage;
const signal = () => new AbortController().signal;
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const valid = { sub: 'iris', email: 'iris@example.invalid', email_verified: true };

const directToken = 'header.' + Buffer.from(JSON.stringify({ scope: 'aws.cognito.signin.user.admin' })).toString('base64url') + '.signature';
const directProfile = () => ({ Username: 'synthetic-login', UserAttributes: [
  { Name: 'sub', Value: 'iris' }, { Name: 'email', Value: 'iris@example.invalid' }, { Name: 'email_verified', Value: 'true' }] });
it('recovers direct SRP registrations through token-authorized GetUser instead of hosted userInfo', async () => {
  const { options } = capture(); mocks.resolve.mockResolvedValue({ kind: 'participant', subject: 'iris' });
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(directProfile()), { headers: { 'content-type': 'application/x-amz-json-1.1' } }));
  vi.stubGlobal('fetch', fetcher);
  await expect(options.registrationProfile!(request('Bearer ' + directToken), signal())).resolves.toEqual({
    subject: 'iris', email: 'iris@example.invalid', verified: true, username: 'synthetic-login' });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]![0]).toBe('https://cognito-idp.us-east-1.amazonaws.com/');
  expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({ AccessToken: directToken });
});
it('requires current verified identity and rejects duplicate/unverified or mismatched GetUser attributes', async () => {
  const { options } = capture(); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  mocks.resolve.mockResolvedValue(null);
  await expect(options.registrationProfile!(request('Bearer ' + directToken), signal())).resolves.toBeNull(); expect(fetcher).not.toHaveBeenCalled();
  mocks.resolve.mockResolvedValue({ kind: 'participant', subject: 'iris' });
  for (const field of [{ Name: 'sub', Value: 'other' }, { Name: 'email_verified', Value: 'false' }]) {
    const value = directProfile(); value.UserAttributes = value.UserAttributes.map(old => old.Name === field.Name ? field : old);
    fetcher.mockResolvedValue(response(value)); await expect(options.registrationProfile!(request('Bearer ' + directToken), signal())).resolves.toBeNull();
  }
  const value = directProfile(); value.UserAttributes.push({ Name: 'sub', Value: 'other' });
  fetcher.mockResolvedValue(response(value)); await expect(options.registrationProfile!(request('Bearer ' + directToken), signal())).resolves.toBeNull();
});

it.each([
  ['mode', 'LEGACY'], ['allowedOrigin', 'http://synthetic.example.invalid'], ['allowedOrigin', 'https://synthetic.example.invalid/path'],
  ['allowedOrigin', 'https://secret@synthetic.example.invalid'], ['cognitoDomain', 'https://evil.example.invalid'],
  ['cognitoDomain', 'https://synthetic.auth.us-east-1.amazoncognito.com.evil.invalid'],
  ['cognitoDomain', 'https://synthetic.auth.us-east-1.amazoncognito.com:8443'],
  ['cognitoDomain', 'https://synthetic.auth.us-east-1.amazoncognito.com/path'], ['emailKey', 'short'],
] as const)('rejects invalid %s before constructing authentication/storage', (name, value) => {
  expect(() => createPartitionRuntime({ ...configuration(), [name]: value } as PartitionRuntimeOptions)).toThrow('PARTITION_RUNTIME_INVALID');
  expect(createPartitionManagedDriver).not.toHaveBeenCalled(); expect(createCognitoIdentityResolver).not.toHaveBeenCalled();
});
it('requires the pinned pool region, distinct client IDs and actual trusted ports', () => {
  for (const change of [{ userPoolId: 'us-west-2_synthetic' }, { displayClientId: 'participant-client' }, { participantClientId: '' }])
    expect(() => createPartitionRuntime({ ...configuration(), identity: { ...configuration().identity, ...change } })).toThrow('PARTITION_RUNTIME_INVALID');
  expect(() => createPartitionRuntime({ ...configuration(), clock: {} } as PartitionRuntimeOptions)).toThrow('PARTITION_RUNTIME_INVALID');
  expect(createPartitionManagedDriver).not.toHaveBeenCalled();
});
it('composes only the managed transports with captured identity/origin/clock and exposes only a listener', async () => {
  const { value, listener, options } = capture();
  expect(listener).toBe(mocks.listener);
  expect(createPartitionManagedDriver).toHaveBeenCalledWith(value.managed);
  const identity = vi.mocked(createCognitoIdentityResolver).mock.calls[0]![0];
  Reflect.set(value.identity, 'participantClientId', 'changed'); value.allowedOrigin = 'https://changed.invalid'; value.clock.now = () => 'changed';
  expect(identity.participantClientId).toBe('participant-client'); expect(options.allowedOrigins).toEqual(['https://synthetic.example.invalid']);
  expect(options.clock.now()).toBe('2026-10-08T00:00:00Z');
  expect(options.groups).toBe(mocks.groups); expect(options.decisions).toBe(mocks.decisions); expect(options.membershipDiscovery).toBe(mocks.discovery);
  expect(Object.keys(options)).not.toEqual(expect.arrayContaining(['archivePorts', 'recovery', 'manifestBytes', 'cursorKey']));
  mocks.resolve.mockResolvedValue({ kind: 'participant', subject: 'iris' });
  await expect(options.authenticate(request(), signal())).resolves.toEqual({ kind: 'participant', subject: 'iris' });
  expect(mocks.resolve).toHaveBeenCalledWith('Bearer synthetic.jwt.token');
});
it('rejects cancellation before and after an unsettled identity lookup', async () => {
  const { options } = capture(); const controller = new AbortController(); controller.abort();
  await expect(options.authenticate(request(), controller.signal)).resolves.toBeNull(); expect(mocks.resolve).not.toHaveBeenCalled();
  const second = new AbortController(); let finish!: (value: unknown) => void;
  mocks.resolve.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const pending = options.authenticate(request(), second.signal); second.abort(); finish({ kind: 'participant', subject: 'iris' });
  await expect(pending).resolves.toBeNull();
});
it('retrieves only the verified participant profile from the captured HTTPS endpoint without forwarding cookie/identity headers', async () => {
  const { value, options } = capture(); value.cognitoDomain = 'https://changed.invalid'; value.emailKey = 'changed';
  mocks.resolve.mockResolvedValue({ kind: 'participant', subject: 'iris' });
  const fetcher = vi.fn().mockResolvedValue(response({ ...valid, name: 'private name', access_token: 'private-token' })); vi.stubGlobal('fetch', fetcher);
  await expect(options.registrationProfile!(request(), signal())).resolves.toEqual({ subject: 'iris', email: 'iris@example.invalid', verified: true });
  expect(fetcher.mock.calls[0]![0]).toBe('https://synthetic.auth.us-east-1.amazoncognito.com/oauth2/userInfo');
  expect(fetcher.mock.calls[0]![1]).toMatchObject({ headers: { authorization: 'Bearer synthetic.jwt.token' }, redirect: 'error', credentials: 'omit' });
  expect(options.emailKey).toBe(configuration().emailKey);
});
it.each([null, { kind: 'display', subject: 'iris', roomId: 'decision' }])('does not fetch a profile for an invalid or display principal', async principal => {
  const { options } = capture(); mocks.resolve.mockResolvedValue(principal); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  await expect(options.registrationProfile!(request(), signal())).resolves.toBeNull(); expect(fetcher).not.toHaveBeenCalled();
});
it.each([
  { ...valid, sub: 'other' }, { ...valid, email_verified: false }, { ...valid, email_verified: 'false' },
  { ...valid, email: 1 }, { ...valid, email: 'a'.repeat(321) }, [], null,
])('denies unmatched/unverified/malformed profiles without leaking their values', async value => {
  const { options } = capture(); mocks.resolve.mockResolvedValue({ kind: 'participant', subject: 'iris' });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(value)));
  await expect(options.registrationProfile!(request(), signal())).resolves.toBeNull();
});
it('bounds declared and chunked profile bytes, HTTP errors and malformed JSON', async () => {
  const { options } = capture(); mocks.resolve.mockResolvedValue({ kind: 'participant', subject: 'iris' });
  for (const value of [new Response('private error', { status: 500 }),
    new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '65537' } }),
    new Response('a'.repeat(65537), { headers: { 'content-type': 'application/json' } }),
    new Response('malformed private', { headers: { 'content-type': 'application/json' } }),
    new Response(JSON.stringify(valid), { headers: { 'content-type': 'text/html' } })]) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(value));
    await expect(options.registrationProfile!(request(), signal())).resolves.toBeNull(); expect(value.body?.locked).toBe(false);
  }
});
it('cancels an unsettled profile stream and never publishes partial profile bytes', async () => {
  const { options } = capture(); const controller = new AbortController(); mocks.resolve.mockResolvedValue({ kind: 'participant', subject: 'iris' });
  const cancel = vi.fn(); const stream = new ReadableStream<Uint8Array>({ cancel });
  const value = new Response(stream, { headers: { 'content-type': 'application/json' } });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(value)); const pending = options.registrationProfile!(request(), controller.signal);
  await vi.waitFor(() => expect(value.body!.locked).toBe(true)); controller.abort();
  await expect(pending).resolves.toBeNull(); expect(cancel).toHaveBeenCalled(); expect(value.body!.locked).toBe(false);
});

it('private source/key composition exposes only a listener and fails malformed lifecycle configuration before storage construction', () => {
 const options = configuration(); options.lifecycle = { sourceSha: 'a'.repeat(40), signingKeyBase64: Buffer.alloc(32, 5).toString('base64') };
 const listener = createPartitionRuntime(options); expect(typeof listener).toBe('function');
 expect(mocks.lifecycle).toHaveBeenCalledWith({ sourceSha: 'a'.repeat(40), signingKey: Buffer.alloc(32, 5) });
 expect(listener).not.toHaveProperty('runner'); expect(listener).not.toHaveProperty('publishPlan');
 options.lifecycle.sourceSha = 'b'.repeat(40); expect(mocks.lifecycle.mock.calls.at(-1)?.[0].sourceSha).toBe('a'.repeat(40));
 const before = vi.mocked(createPartitionManagedDriver).mock.calls.length;
 expect(() => createPartitionRuntime({ ...configuration(), lifecycle: { sourceSha: '0'.repeat(40), signingKeyBase64: 'bad' } })).toThrow('PARTITION_RUNTIME_INVALID');
 expect(vi.mocked(createPartitionManagedDriver).mock.calls.length).toBe(before);
});


it('the private jobs binding exposes only enqueue with the captured source and retained-owner gate', async () => {
 const options=configuration();options.lifecycle={sourceSha:'a'.repeat(40),signingKeyBase64:Buffer.alloc(32,5).toString('base64')};options.jobs={sourceSha:'b'.repeat(40)};
 const listener=createPartitionRuntime(options);expect(typeof listener).toBe('function');
 const queueOptions=vi.mocked(createManagedDurableEnqueue).mock.calls.at(-1)![0];
 options.jobs.sourceSha='c'.repeat(40);expect(queueOptions.sourceSha).toBe('b'.repeat(40));
 const config=vi.mocked(createPartitionParticipantApiHandler).mock.calls.at(-1)![0];
 expect(config.requestNegotiation).toBe(vi.mocked(createManagedDurableEnqueue).mock.results.at(-1)!.value);
 const service=mocks.lifecycle.mock.results.at(-1)!.value;await queueOptions.assertRetained({kind:'participant',subject:'iris'});
 expect(service.assertRetained).toHaveBeenCalledWith({kind:'participant',subject:'iris'});
 expect(Object.keys(config)).not.toEqual(expect.arrayContaining(['process','invoke','provider','deliveries']));
});
it('missing lifecycle or invalid private job source is rejected before building transports',()=>{
 for(const change of [{sourceSha:'0'.repeat(40)},{sourceSha:'short'}]){
  const before=vi.mocked(createPartitionManagedDriver).mock.calls.length;
  expect(()=>createPartitionRuntime({...configuration(),jobs:change})).toThrow('PARTITION_RUNTIME_INVALID');
  expect(vi.mocked(createPartitionManagedDriver).mock.calls.length).toBe(before);
 }
 const options=configuration();options.jobs={sourceSha:'b'.repeat(40)};
 expect(()=>createPartitionRuntime(options)).toThrow('PARTITION_RUNTIME_INVALID');
});
