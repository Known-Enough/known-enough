import { generateKeyPairSync, sign as signBytes, type KeyObject } from 'node:crypto';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { SimpleJwksCache, type Jwk } from 'aws-jwt-verify/jwk';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createCognitoIdentityResolver, createCognitoIdentityResolverFromEnv } from './cognito-identity.ts';

const options = { userPoolId: 'us-east-1_testPool', clientId: 'test-client' };
const claims = (overrides: Record<string, unknown> = {}) => ({ sub: 'cognito-subject_1', ...overrides });
const keyId = 'offline-test-key';
const testEnv = (userPoolId = options.userPoolId, clientId = options.clientId): NodeJS.ProcessEnv => ({
  COGNITO_USER_POOL_ID: userPoolId,
  COGNITO_CLIENT_ID: clientId,
});

let privateKey: KeyObject;
let otherPrivateKey: KeyObject;
let publicJwk: Jwk;

beforeAll(() => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const otherPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  privateKey = pair.privateKey;
  otherPrivateKey = otherPair.privateKey;
  publicJwk = {
    ...pair.publicKey.export({ format: 'jwk' }),
    kid: keyId,
    use: 'sig',
    alg: 'RS256',
  } as unknown as Jwk;
});

function cachedKeys(userPoolId = options.userPoolId): SimpleJwksCache {
  const cache = new SimpleJwksCache();
  const { jwksUri } = CognitoJwtVerifier.parseUserPoolId(userPoolId);
  cache.addJwks(jwksUri, { keys: [publicJwk] });
  return cache;
}

function signedToken(overrides: Record<string, unknown> = {}, signingKey = privateKey, userPoolId = options.userPoolId): string {
  const now = Math.floor(Date.now() / 1000);
  const issuer = CognitoJwtVerifier.parseUserPoolId(userPoolId).issuer;
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: keyId, typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: 'cognito-subject_1',
    iss: issuer,
    token_use: 'access',
    client_id: options.clientId,
    iat: now,
    exp: now + 600,
    auth_time: now,
    jti: 'synthetic-jti',
    origin_jti: 'synthetic-origin-jti',
    version: 2,
    username: 'synthetic-user',
    scope: 'openid',
    ...overrides,
  })).toString('base64url');
  const unsignedToken = `${header}.${payload}`;
  const signature = signBytes('RSA-SHA256', Buffer.from(unsignedToken), signingKey).toString('base64url');
  return `${unsignedToken}.${signature}`;
}

function resolverWith(payload: unknown) {
  const verify = vi.fn(async (token: string) => token ? payload : null);
  return { resolver: createCognitoIdentityResolver({ ...options, verifier: { verify } }), verify };
}

describe('B04 Cognito access-token principal mapping', () => {
  it('requires one Bearer token and maps a verified subject to a participant candidate', async () => {
    const { resolver, verify } = resolverWith(claims());
    expect(await resolver(undefined)).toBeNull();
    expect(await resolver('Basic token')).toBeNull();
    expect(await resolver('Bearer two tokens')).toBeNull();
    expect(verify).not.toHaveBeenCalled();

    expect(await resolver('Bearer signed-token')).toEqual({ kind: 'participant', subject: 'cognito-subject_1' });
    expect(verify).toHaveBeenCalledWith('signed-token');
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('derives one read-only display room only from a valid signed group scope', async () => {
    const { resolver } = resolverWith(claims({ 'cognito:groups': ['other-group', 'deal-table:display:room_123'] }));
    expect(await resolver('Bearer signed-token')).toEqual({
      kind: 'display', subject: 'cognito-subject_1', roomId: 'room_123',
    });
  });

  it('fails closed for invalid subjects and ambiguous or malformed display claims', async () => {
    for (const payload of [
      claims({ sub: '' }),
      claims({ sub: 'not a valid id' }),
      claims({ 'cognito:groups': 'deal-table:display:room_123' }),
      claims({ 'cognito:groups': ['deal-table:display:'] }),
      claims({ 'cognito:groups': ['deal-table:display:room_123', 'deal-table:display:room_456'] }),
    ]) {
      const { resolver } = resolverWith(payload);
      expect(await resolver('Bearer signed-token')).toBeNull();
    }
  });

  it('fails closed when token verification fails without returning verifier details', async () => {
    const verify = vi.fn(async (token: string) => {
      if (!token) return null;
      throw new Error('private-token-verification-detail');
    });
    const resolver = createCognitoIdentityResolver({ ...options, verifier: { verify } });
    await expect(resolver('Bearer invalid-token')).resolves.toBeNull();
  });

  it('verifies real signed access tokens with the environment pool and client configuration', async () => {
    const resolver = createCognitoIdentityResolverFromEnv(testEnv(), cachedKeys());
    const validToken = signedToken();
    await expect(resolver(`Bearer ${validToken}`)).resolves.toEqual({
      kind: 'participant', subject: 'cognito-subject_1',
    });

    const wrongIssuerToken = signedToken({ iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_wrongPool' });
    await expect(resolver(`Bearer ${wrongIssuerToken}`)).resolves.toBeNull();
    await expect(resolver(`Bearer ${signedToken({ client_id: 'other-client' })}`)).resolves.toBeNull();

    const idTokenClaims = {
      token_use: 'id',
      aud: options.clientId,
      at_hash: 'synthetic-hash',
      'cognito:username': 'synthetic-user',
    };
    await expect(resolver(`Bearer ${signedToken(idTokenClaims)}`)).resolves.toBeNull();
    await expect(resolver(`Bearer ${signedToken({ exp: Math.floor(Date.now() / 1000) - 60 })}`)).resolves.toBeNull();
    await expect(resolver(`Bearer ${signedToken({ nbf: Math.floor(Date.now() / 1000) + 300 })}`)).resolves.toBeNull();
    await expect(resolver(`Bearer ${signedToken({}, otherPrivateKey)}`)).resolves.toBeNull();

    const otherPoolId = 'us-east-1_otherPool';
    const otherPoolResolver = createCognitoIdentityResolverFromEnv(testEnv(otherPoolId), cachedKeys(otherPoolId));
    await expect(otherPoolResolver(`Bearer ${validToken}`)).resolves.toBeNull();
  });

  it('rejects missing and invalid environment configuration before serving requests', () => {
    expect(() => createCognitoIdentityResolverFromEnv({})).toThrow(/COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID/);
    expect(() => createCognitoIdentityResolverFromEnv(testEnv('invalid-pool', 'test-client'), cachedKeys())).toThrow();
    expect(() => createCognitoIdentityResolverFromEnv(testEnv(options.userPoolId, '   '), cachedKeys())).toThrow(/required/);
  });
});
