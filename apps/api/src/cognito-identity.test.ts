import { describe, expect, it, vi } from 'vitest';
import { createCognitoIdentityResolver } from './cognito-identity.ts';

const options = { userPoolId: 'us-east-1_testPool', clientId: 'test-client' };
const claims = (overrides: Record<string, unknown> = {}) => ({ sub: 'cognito-subject_1', ...overrides });

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
});
