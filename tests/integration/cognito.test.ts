import { describe, expect, it } from 'vitest';
import { createCognitoIdentityResolver } from '../../apps/api/src/cognito.ts';
import { cognitoOptions, cognitoToken, testJwksCache } from './cognito-fixtures.ts';

const resolveAuthorization = createCognitoIdentityResolver(cognitoOptions, testJwksCache());
const identityFor = (claims: Record<string, unknown>) => resolveAuthorization(`Bearer ${cognitoToken(claims)}`);

describe('B04 Cognito identity adapter', () => {
  it('uses the production resolver to verify a signed access token and maps only its verified subject', async () => {
    await expect(identityFor({})).resolves.toEqual({ kind: 'participant', subject: 'maya' });
  });

  it('maps a display identity only from the separate app client and one exact room group', async () => {
    await expect(identityFor({ client_id: cognitoOptions.displayClientId,
      'cognito:groups': ['deal-table-display-room-synthetic'] })).resolves.toEqual({
      kind: 'display', subject: 'maya', roomId: 'room-synthetic',
    });
    await expect(identityFor({ 'cognito:groups': ['deal-table-display-room-synthetic'] }))
      .resolves.toEqual({ kind: 'participant', subject: 'maya' });
  });

  it('fails closed for ambiguous, malformed, or absent display scopes', async () => {
    for (const groups of [undefined, [], ['deal-table-display-room-synthetic', 'deal-table-display-other-room'],
      ['deal-table-display-invalid room']]) {
      await expect(identityFor({ client_id: cognitoOptions.displayClientId, 'cognito:groups': groups })).resolves.toBeNull();
    }
  });

  it('rejects expired, wrong-issuer, wrong-client, ID-token, and wrong-signature tokens through the production resolver', async () => {
    const expired = Math.floor(Date.now() / 1000) - 1;
    await expect(identityFor({ exp: expired })).resolves.toBeNull();
    await expect(identityFor({ iss: 'https://attacker.example/pool' })).resolves.toBeNull();
    await expect(identityFor({ client_id: 'other-client' })).resolves.toBeNull();
    await expect(identityFor({ token_use: 'id' })).resolves.toBeNull();
    await expect(resolveAuthorization(`Bearer ${cognitoToken({}, {}, 'other')}`)).resolves.toBeNull();

    const parts = cognitoToken({}).split('.');
    parts[2] = `${parts[2]![0] === 'A' ? 'B' : 'A'}${parts[2]!.slice(1)}`;
    await expect(resolveAuthorization(`Bearer ${parts.join('.')}`)).resolves.toBeNull();
  });

  it('rejects malformed bearer headers without exposing verifier details', async () => {
    for (const value of [undefined, ['Bearer x'], 'Basic abc', 'Bearer a.b', `Bearer ${'a'.repeat(9000)}.b.c`]) {
      await expect(resolveAuthorization(value)).resolves.toBeNull();
    }
  });
});
