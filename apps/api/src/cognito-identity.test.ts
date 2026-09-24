import { generateKeyPairSync, sign as signBytes, type KeyObject } from 'node:crypto';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { SimpleJwksCache, type Jwk } from 'aws-jwt-verify/jwk';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCognitoIdentityResolver, createCognitoIdentityResolverFromEnv } from './cognito-identity.ts';

const options = {
  userPoolId: 'us-east-1_testPool',
  participantClientId: 'participant-client',
  displayClientId: 'display-client',
};
const keyId = 'offline-test-key';
const testEnv = (userPoolId = options.userPoolId): NodeJS.ProcessEnv => ({
  COGNITO_USER_POOL_ID: userPoolId,
  COGNITO_PARTICIPANT_CLIENT_ID: options.participantClientId,
  COGNITO_DISPLAY_CLIENT_ID: options.displayClientId,
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
    ...pair.publicKey.export({ format: 'jwk' }), kid: keyId, use: 'sig', alg: 'RS256',
  } as unknown as Jwk;
});

function cachedKeys(userPoolId = options.userPoolId): SimpleJwksCache {
  const cache = new SimpleJwksCache();
  const { jwksUri } = CognitoJwtVerifier.parseUserPoolId(userPoolId);
  cache.addJwks(jwksUri, { keys: [publicJwk] });
  return cache;
}

function signedToken(
  overrides: Record<string, unknown> = {}, signingKey = privateKey,
  userPoolId = options.userPoolId, clientId = options.participantClientId,
): string {
  const now = Math.floor(Date.now() / 1000);
  const issuer = CognitoJwtVerifier.parseUserPoolId(userPoolId).issuer;
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: keyId, typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: 'cognito-subject_1', iss: issuer, token_use: 'access', client_id: clientId,
    iat: now, exp: now + 600, auth_time: now, jti: 'synthetic-jti',
    origin_jti: 'synthetic-origin-jti', version: 2, username: 'synthetic-user', scope: 'openid',
    ...overrides,
  })).toString('base64url');
  const unsignedToken = `${header}.${payload}`;
  const signature = signBytes('RSA-SHA256', Buffer.from(unsignedToken), signingKey).toString('base64url');
  return `${unsignedToken}.${signature}`;
}

describe('B04 Cognito access-token principal mapping', () => {
  it('verifies a signed participant access token with configured pool and client', async () => {
    const resolver = createCognitoIdentityResolverFromEnv(testEnv(), cachedKeys());
    await expect(resolver(`Bearer ${signedToken()}`)).resolves.toEqual({
      kind: 'participant', subject: 'cognito-subject_1',
    });
  });

  it('maps one room-scoped display token only through the separate display client', async () => {
    const resolver = createCognitoIdentityResolver(options, cachedKeys());
    const token = signedToken({ 'cognito:groups': ['unrelated', 'deal-table-display-room_123'] },
      privateKey, options.userPoolId, options.displayClientId);
    await expect(resolver(`Bearer ${token}`)).resolves.toEqual({
      kind: 'display', subject: 'cognito-subject_1', roomId: 'room_123',
    });
    const participantWithGroup = signedToken({ 'cognito:groups': ['deal-table-display-room_123'] });
    await expect(resolver(`Bearer ${participantWithGroup}`)).resolves.toEqual({
      kind: 'participant', subject: 'cognito-subject_1',
    });
  });

  it('fails closed for malformed, ambiguous or invalid claims and bearer headers', async () => {
    const resolver = createCognitoIdentityResolver(options, cachedKeys());
    for (const value of [undefined, ['Bearer x'], 'Basic abc', 'Bearer a.b', `Bearer ${'a'.repeat(9000)}.b.c`])
      await expect(resolver(value)).resolves.toBeNull();
    for (const token of [
      signedToken({ sub: '' }),
      signedToken({ sub: 'invalid subject' }),
      signedToken({ 'cognito:groups': 'deal-table-display-room_123' }),
      signedToken({ client_id: options.displayClientId, 'cognito:groups': [] }, privateKey, options.userPoolId, options.displayClientId),
      signedToken({ client_id: options.displayClientId, 'cognito:groups': ['deal-table-display-'] }, privateKey, options.userPoolId, options.displayClientId),
      signedToken({ client_id: options.displayClientId, 'cognito:groups': ['deal-table-display-room_123', 'deal-table-display-room_456'] }, privateKey, options.userPoolId, options.displayClientId),
      signedToken({ client_id: 'other-client' }),
      signedToken({ token_use: 'id' }),
      signedToken({ exp: Math.floor(Date.now() / 1000) - 60 }),
      signedToken({ nbf: Math.floor(Date.now() / 1000) + 300 }),
      signedToken({}, otherPrivateKey),
    ]) await expect(resolver(`Bearer ${token}`)).resolves.toBeNull();
  });

  it('rejects missing or invalid deployment configuration and wrong pools', async () => {
    expect(() => createCognitoIdentityResolverFromEnv({})).toThrow(/COGNITO_USER_POOL_ID/);
    expect(() => createCognitoIdentityResolverFromEnv({ ...testEnv(), COGNITO_DISPLAY_CLIENT_ID: options.participantClientId }))
      .toThrow(/distinct participant\/display/);
    expect(() => createCognitoIdentityResolverFromEnv(testEnv('invalid-pool'), cachedKeys())).toThrow();
    const valid = createCognitoIdentityResolverFromEnv(testEnv(), cachedKeys());
    const otherPoolId = 'us-east-1_otherPool';
    const wrongPool = createCognitoIdentityResolverFromEnv(testEnv(otherPoolId), cachedKeys(otherPoolId));
    await expect(wrongPool(`Bearer ${signedToken()}`)).resolves.toBeNull();
    await expect(valid(`Bearer ${signedToken({ iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_wrongPool' })}`))
      .resolves.toBeNull();
  });
});
