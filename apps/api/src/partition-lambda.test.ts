import type { RequestListener } from 'node:http';
import { generateKeyPairSync, sign as signBytes } from 'node:crypto';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { SimpleJwksCache, type Jwk } from 'aws-jwt-verify/jwk';
import { afterEach, expect, it, vi } from 'vitest';
import { createPartitionLambdaHandler } from './partition-lambda.ts';
import { createPartitionRuntime, type PartitionRuntimeOptions } from './partition-runtime.ts';
import type { HttpApiEvent } from './ke13b-lambda.ts';

const mock = vi.hoisted(() => ({ listener: vi.fn() }));
vi.mock('./partition-runtime.ts', () => ({ createPartitionRuntime: vi.fn(() => mock.listener) }));
afterEach(() => { vi.clearAllMocks(); mock.listener.mockReset(); });
const options = { mode: 'PARTITION_V2' } as PartitionRuntimeOptions;
function event(patch: Partial<HttpApiEvent> = {}): HttpApiEvent {
  return { version: '2.0', rawPath: '/groups', rawQueryString: '',
    requestContext: { http: { method: 'GET' } }, headers: {}, ...patch };
}
function listener(value: RequestListener) { mock.listener.mockImplementation(value); }
function echo() {
  listener(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    response.setHeader('content-type', 'application/json');
    response.setHeader('cache-control', 'no-store');
    response.setHeader('set-cookie', 'PRIVATE_COOKIE');
    response.setHeader('x-private-debug', 'PRIVATE_DEBUG');
    response.end(JSON.stringify({ path: request.url, method: request.method,
      authorization: request.headers.authorization, origin: request.headers.origin,
      requestId: request.headers['x-request-id'], body: Buffer.concat(chunks).toString('utf8'),
      forbidden: [request.headers.cookie, request.headers['x-owner-id'], request.headers['x-storage-table']] }));
  });
}
it('preserves Gateway raw membership query bytes through the real Node HTTP transport', async () => {
  echo(); const handler = createPartitionLambdaHandler(options);
  const result = await handler(event({ rawQueryString: 'limit=2&cursor=signed%2Bcursor%3D' }));
  expect(result.statusCode).toBe(200);
  expect(JSON.parse(result.body).path).toBe('/groups?limit=2&cursor=signed%2Bcursor%3D');
  expect(result.isBase64Encoded).toBe(false);
  expect(createPartitionRuntime).toHaveBeenCalledExactlyOnceWith(options);
});
it('passes only allowed headers and never forwards Gateway identity/storage claims or private response headers', async () => {
  echo(); const handler = createPartitionLambdaHandler(options);
  const supplied = event({ headers: { Authorization: 'Bearer SYNTHETIC_TOKEN', Origin: 'https://synthetic.example.invalid',
    'X-Request-ID': 'synthetic-request', cookie: 'PRIVATE_COOKIE', 'x-owner-id': 'forged', 'x-storage-table': 'forged',
    'content-type': 'application/json' } });
  Reflect.set(supplied, 'requestContext', { http: { method: 'GET' }, authorizer: { claims: { sub: 'forged', role: 'operator' } } });
  const result = await handler(supplied); const body = JSON.parse(result.body);
  expect(body.authorization).toBe('Bearer SYNTHETIC_TOKEN'); expect(body.origin).toBe('https://synthetic.example.invalid');
  expect(body.requestId).toBe('synthetic-request'); expect(body.forbidden).toEqual([null, null, null]);
  expect(result.headers).not.toHaveProperty('set-cookie'); expect(result.headers).not.toHaveProperty('x-private-debug');
  expect(result.body).not.toMatch(/forged|PRIVATE_COOKIE|PRIVATE_DEBUG/);
});
it('rejects newline-bearing authentication headers rather than forwarding them', async () => {
  echo(); const result = await createPartitionLambdaHandler(options)(event({ headers: { authorization: 'Bearer token\r\nx-owner-id: forged' } }));
  expect(JSON.parse(result.body)).not.toHaveProperty('authorization'); expect(result.body).not.toContain('forged');
});
it.each([undefined, ''])('supports an absent or empty query without adding a separator', async query => {
  echo(); const value = event(); if (query === undefined) delete value.rawQueryString; else value.rawQueryString = query;
  const result = await createPartitionLambdaHandler(options)(value); expect(JSON.parse(result.body).path).toBe('/groups');
});
it.each([
  { rawQueryString: null }, { rawQueryString: [] }, { rawQueryString: 'cursor=bad#fragment' },
  { rawQueryString: 'cursor=bad\nvalue' }, { rawQueryString: 'cursor=bad\\value' },
  { rawPath: '//other.invalid/groups' }, { rawPath: '/groups?cursor=forged' }, { rawPath: '/groups#fragment' },
  { rawPath: '/groups\r\nprivate' }, { rawPath: '/groups\\private' },
  { rawQueryString: 'cursor=' + 'x'.repeat(2048) },
])('rejects malformed or oversized gateway targets before starting an HTTP request: %j', async patch => {
  const result = await createPartitionLambdaHandler(options)(event(patch));
  expect(result.statusCode).toBe(422); expect(JSON.parse(result.body).error.code).toBe('INVALID_COMMAND');
  expect(mock.listener).not.toHaveBeenCalled(); expect(result.body).not.toMatch(/other.invalid|forged|private/);
});
it.each([null, [], {}, { version: '1.0' }])('returns a finite error for invalid event envelopes: %j', async value => {
  const result = await createPartitionLambdaHandler(options)(value as HttpApiEvent);
  expect(result.statusCode).toBe(503); expect(mock.listener).not.toHaveBeenCalled();
});
it('retains existing method/body guards and decodes a valid base64 POST payload', async () => {
  echo(); const handler = createPartitionLambdaHandler(options);
  const body = JSON.stringify({ commandId: 'synthetic-command', text: 'caf\u00e9' });
  const valid = await handler(event({ rawPath: '/account/register', requestContext: { http: { method: 'POST' } },
    body: Buffer.from(body).toString('base64'), isBase64Encoded: true }));
  expect(JSON.parse(valid.body).body).toBe(body);
  const calls = mock.listener.mock.calls.length;
  expect((await handler(event({ body: '%%%%', isBase64Encoded: true }))).statusCode).toBe(422);
  expect((await handler(event({ body: 'x'.repeat(65537) }))).statusCode).toBe(422);
  expect((await handler(event({ requestContext: { http: { method: 'DELETE' } } }))).statusCode).toBe(404);
  expect(mock.listener).toHaveBeenCalledTimes(calls);
});
it('constructs trusted storage/authentication once, while concurrent invocations retain independent targets', async () => {
  echo(); const handler = createPartitionLambdaHandler(options);
  const results = await Promise.all([handler(event({ rawQueryString: 'limit=1' })), handler(event({ rawQueryString: 'limit=2' }))]);
  expect(results.map(r => JSON.parse(r.body).path)).toEqual(['/groups?limit=1', '/groups?limit=2']);
  expect(createPartitionRuntime).toHaveBeenCalledExactlyOnceWith(options);
});
it('propagates invalid trusted construction without falling back to legacy or handling a request', () => {
  vi.mocked(createPartitionRuntime).mockImplementationOnce(() => { throw new Error('PARTITION_RUNTIME_INVALID'); });
  expect(() => createPartitionLambdaHandler(options)).toThrow('PARTITION_RUNTIME_INVALID');
  expect(mock.listener).not.toHaveBeenCalled();
});
it('preserves actual signed Cognito token verification; forged authorizer claims and display tokens cannot authenticate', async () => {
  const pool = 'us-east-1_synthetic'; const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const cache = new SimpleJwksCache(); const kid = 'offline-partition-test';
  cache.addJwks(CognitoJwtVerifier.parseUserPoolId(pool).jwksUri, { keys: [{ ...pair.publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' } as unknown as Jwk] });
  const verifier = CognitoJwtVerifier.create({ userPoolId: pool, tokenUse: 'access', clientId: 'participant-client' }, { jwksCache: cache });
  function token(client: string) {
    const now = Math.floor(Date.now() / 1000);
    const head = Buffer.from(JSON.stringify({ alg: 'RS256', kid })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'verified-iris', iss: CognitoJwtVerifier.parseUserPoolId(pool).issuer,
      token_use: 'access', client_id: client, exp: now + 600, iat: now, auth_time: now, jti: 'synthetic-jti' })).toString('base64url');
    const input = `${head}.${payload}`; return `${input}.${signBytes('RSA-SHA256', Buffer.from(input), pair.privateKey).toString('base64url')}`;
  }
  listener(async (request, response) => {
    response.setHeader('content-type', 'application/json');
    try {
      const claims = await verifier.verify(request.headers.authorization?.replace(/^Bearer /, '') ?? '');
      response.end(JSON.stringify({ subject: claims.sub }));
    } catch { response.statusCode = 401; response.end(JSON.stringify({ error: 'UNAUTHORIZED' })); }
  });
  const handler = createPartitionLambdaHandler(options);
  const forged = event(); Reflect.set(forged, 'requestContext', { http: { method: 'GET' }, authorizer: { claims: { sub: 'forged' } } });
  expect((await handler(forged)).statusCode).toBe(401);
  expect((await handler(event({ headers: { authorization: `Bearer ${token('display-client')}` } }))).statusCode).toBe(401);
  const valid = await handler(event({ headers: { authorization: `Bearer ${token('participant-client')}` } }));
  expect(valid.statusCode).toBe(200); expect(JSON.parse(valid.body)).toEqual({ subject: 'verified-iris' });
});
