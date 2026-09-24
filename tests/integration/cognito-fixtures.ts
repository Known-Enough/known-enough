import { createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { SimpleJwksCache, type Jwk } from 'aws-jwt-verify/jwk';
import type { CognitoIdentityOptions } from '../../apps/api/src/cognito-identity.ts';

export const cognitoOptions: CognitoIdentityOptions = {
  userPoolId: 'us-east-1_TestPool123',
  participantClientId: 'participant-client-123',
  displayClientId: 'display-client-456',
};
export const cognitoIssuer = `https://cognito-idp.us-east-1.amazonaws.com/${cognitoOptions.userPoolId}`;
export const cognitoJwksUri = `${cognitoIssuer}/.well-known/jwks.json`;
export const signingKeyId = 'test-signing-key';
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const { privateKey: otherPrivateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const signingPublicKey = createPublicKey(privateKey);
const signingJwk = {
  ...signingPublicKey.export({ format: 'jwk' }), kid: signingKeyId, use: 'sig', alg: 'RS256',
} as unknown as Jwk;


export function testJwksCache(): SimpleJwksCache {
  const cache = new SimpleJwksCache();
  cache.addJwks(cognitoJwksUri, { keys: [signingJwk] });
  return cache;
}

export function cognitoToken(
  claims: Record<string, unknown> = {},
  headerPatch: Record<string, unknown> = {},
  signer: 'trusted' | 'other' = 'trusted',
): string {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'RS256', typ: 'JWT', kid: signingKeyId, ...headerPatch });
  const payload = encode({
    iss: cognitoIssuer, sub: 'maya', token_use: 'access', client_id: cognitoOptions.participantClientId,
    iat: now, exp: now + 300, ...claims,
  });
  const input = `${header}.${payload}`;
  const key = signer === 'trusted' ? privateKey : otherPrivateKey;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), key).toString('base64url')}`;
}
