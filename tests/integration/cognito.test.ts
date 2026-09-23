import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { Jwk } from 'aws-jwt-verify/jwk';
import { createCognitoIdentityResolver, mapVerifiedCognitoClaims, type CognitoIdentityOptions } from '../../apps/api/src/cognito.ts';

const options: CognitoIdentityOptions = {
  userPoolId: 'us-east-1_TestPool123',
  participantClientId: 'participant-client-123',
  displayClientId: 'display-client-456',
};
const issuer = `https://cognito-idp.us-east-1.amazonaws.com/${options.userPoolId}`;
const keyId = 'test-signing-key';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const testVerifier = CognitoJwtVerifier.create({
  userPoolId: options.userPoolId,
  tokenUse: 'access',
  clientId: [options.participantClientId, options.displayClientId],
  graceSeconds: 0,
});
const signingJwk = { ...publicKey.export({ format: 'jwk' }), kid: keyId, use: 'sig', alg: 'RS256' } as unknown as Jwk;
testVerifier.cacheJwks({ keys: [signingJwk] });
const resolveAuthorization = createCognitoIdentityResolver(options);

function token(claims: Record<string, unknown>, patchHeader: Record<string, unknown> = {}): string {
  const base64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const protectedHeader = base64({ alg: 'RS256', typ: 'JWT', kid: keyId, ...patchHeader });
  const payload = base64({
    iss: issuer, sub: 'maya', token_use: 'access', client_id: options.participantClientId,
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300,
    ...claims,
  });
  const signingInput = `${protectedHeader}.${payload}`;
  return `${signingInput}.${sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url')}`;
}

async function identityFor(claims: Record<string, unknown>) {
  try {
    return mapVerifiedCognitoClaims(await testVerifier.verify(token(claims)), options);
  } catch {
    return null;
  }
}

describe('B04 Cognito identity adapter', () => {
  it('verifies an access token signature and maps only its signed subject to a participant', async () => {
    await expect(identityFor({})).resolves.toEqual({ kind: 'participant', subject: 'maya' });
  });

  it('maps a display identity only from the separate app client and one exact room group', async () => {
    await expect(identityFor({ client_id: options.displayClientId,
      'cognito:groups': ['deal-table-display-room-synthetic'] })).resolves.toEqual({
      kind: 'display', subject: 'maya', roomId: 'room-synthetic',
    });
    await expect(identityFor({ 'cognito:groups': ['deal-table-display-room-synthetic'] }))
      .resolves.toEqual({ kind: 'participant', subject: 'maya' });
  });

  it('fails closed for ambiguous, malformed, or absent display scopes', async () => {
    for (const groups of [undefined, [], ['deal-table-display-room-synthetic', 'deal-table-display-other-room'],
      ['deal-table-display-invalid room']]) {
      await expect(identityFor({ client_id: options.displayClientId, 'cognito:groups': groups })).resolves.toBeNull();
    }
  });

  it('rejects expired, wrong-pool, wrong-client, ID-token, and tampered credentials', async () => {
    const base = { exp: Math.floor(Date.now() / 1000) - 1 };
    await expect(identityFor(base)).resolves.toBeNull();
    await expect(identityFor({ iss: 'https://attacker.example/pool' })).resolves.toBeNull();
    await expect(identityFor({ client_id: 'other-client' })).resolves.toBeNull();
    await expect(identityFor({ token_use: 'id' })).resolves.toBeNull();

    const valid = token({});
    const parts = valid.split('.');
    const signature = parts[2]!;
    parts[2] = `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
    const changed = parts.join('.');
    await expect(testVerifier.verify(changed)).rejects.toThrow();
  });

  it('rejects malformed bearer headers without exposing verifier details', async () => {
    for (const value of [undefined, ['Bearer x'], 'Basic abc', 'Bearer a.b', `Bearer ${'a'.repeat(9000)}.b.c`]) {
      await expect(resolveAuthorization(value)).resolves.toBeNull();
    }
  });
});
