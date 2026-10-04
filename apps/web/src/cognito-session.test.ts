import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  beginCognitoSignIn, clearCognitoSession, clearPendingCognitoInvitation, cognitoApiFetch, cognitoLogoutUrl,
  finishCognitoSignIn, parseCognitoConfig, readCognitoSession, readPendingCognitoInvitation, type CognitoSession,
} from './cognito-session';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}
const config = parseCognitoConfig({ VITE_COGNITO_REGION: 'us-east-1', VITE_COGNITO_USER_POOL_ID: 'us-east-1_fixture',
  VITE_COGNITO_DOMAIN: 'https://ke11-fixture.auth.us-east-1.amazoncognito.com', VITE_COGNITO_PARTICIPANT_CLIENT_ID: 'participant-client',
  VITE_COGNITO_DISPLAY_CLIENT_ID: 'display-client', VITE_API_BASE_URL: 'https://api.example.test' })!;
const place = (search = '') => ({ origin: 'https://app.example.test', pathname: '/', search, hash: '' }) as Location;
const jwt = 'header.payload.signature';
const session: CognitoSession = { accessToken: jwt, expiresAt: Date.now() + 60_000, kind: 'participant' };
afterEach(() => vi.restoreAllMocks());

describe('KE11 Cognito browser client', () => {
  it('permits the exact authenticated creation endpoint while rejecting foreign and unrelated paths', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));
    await cognitoApiFetch(config, session, '/decisions', () => {}, { method: 'POST' }, fetcher);
    expect(fetcher).toHaveBeenCalledOnce();
    for (const path of ['/decisions-other', '//evil.test/decisions', '/decisions/../admin', '/admin'])
      await expect(cognitoApiFetch(config, session, path, () => {}, {}, fetcher)).rejects.toThrow('Invalid API path');
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('requires all non-secret settings and rejects insecure endpoints', () => {
    expect(parseCognitoConfig({})).toBeNull();
    expect(() => parseCognitoConfig({ VITE_COGNITO_REGION: 'us-east-1', VITE_COGNITO_USER_POOL_ID: 'us-east-1_fixture',
      VITE_COGNITO_DOMAIN: 'http://login.example.test', VITE_COGNITO_PARTICIPANT_CLIENT_ID: 'one',
      VITE_COGNITO_DISPLAY_CLIENT_ID: 'two', VITE_API_BASE_URL: 'https://api.example.test' })).toThrow();
  });

  it('creates independent participant/display code challenges with state and no client secret', async () => {
    const storage = new MemoryStorage();
    const participant = new URL(await beginCognitoSignIn(config, 'participant', storage, place()));
    expect(participant.pathname).toBe('/oauth2/authorize');
    expect(participant.searchParams.get('client_id')).toBe('participant-client');
    expect(participant.searchParams.get('code_challenge_method')).toBe('S256');
    expect(participant.searchParams.get('client_secret')).toBeNull();
    expect(participant.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]+$/);
    const display = new URL(await beginCognitoSignIn(config, 'display', storage, place()));
    expect(display.searchParams.get('client_id')).toBe('display-client');
    expect(display.searchParams.get('state')).not.toBe(participant.searchParams.get('state'));
  });

  it('consumes a matching callback once and posts the PKCE verifier', async () => {
    const storage = new MemoryStorage();
    const authorization = new URL(await beginCognitoSignIn(config, 'participant', storage, place()));
    const state = authorization.searchParams.get('state')!;
    const history = { state: null, replaceState: vi.fn() } as unknown as History;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://ke11-fixture.auth.us-east-1.amazoncognito.com/oauth2/token');
      const body = new URLSearchParams(init?.body as string);
      expect(body.get('client_id')).toBe('participant-client');
      expect(body.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(body.get('client_secret')).toBeNull();
      return Response.json({ token_type: 'Bearer', access_token: jwt, expires_in: 300 });
    });
    const result = await finishCognitoSignIn(config, storage, place(`?code=abc&state=${state}`), history, fetcher);
    expect(result?.kind).toBe('participant');
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '/');
    expect(readCognitoSession(storage)).toEqual(result);
    expect(storage.getItem('known-enough-cognito-pending')).toBeNull();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('rejects mismatched, expired, reused and provider-error callbacks without token exchange', async () => {
    const storage = new MemoryStorage();
    await beginCognitoSignIn(config, 'participant', storage, place());
    const history = { state: null, replaceState: vi.fn() } as unknown as History;
    const fetcher = vi.fn();
    await expect(finishCognitoSignIn(config, storage, place('?code=abc&state=wrong'), history, fetcher)).rejects.toThrow();
    await expect(finishCognitoSignIn(config, storage, place('?code=abc&state=wrong'), history, fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    const expiredUrl = new URL(await beginCognitoSignIn(config, 'participant', storage, place()));
    const pending = JSON.parse(storage.getItem('known-enough-cognito-pending')!) as { createdAt: number };
    storage.setItem('known-enough-cognito-pending', JSON.stringify({ ...pending, createdAt: Date.now() - 6 * 60_000 }));
    await expect(finishCognitoSignIn(config, storage,
      place(`?code=abc&state=${expiredUrl.searchParams.get('state')}`), history, fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    await beginCognitoSignIn(config, 'participant', storage, place());
    await expect(finishCognitoSignIn(config, storage,
      place('?error=access_denied&error_description=PRIVATE_EMAIL_TOKEN&state=anything'), history, fetcher))
      .rejects.toMatchObject({ code: 'HOSTED_ACCESS_DENIED' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps hosted and token exchange failures within safe fixed diagnostic codes', async () => {
    const storage = new MemoryStorage();
    const history = { state: null, replaceState: vi.fn() } as unknown as History;
    await beginCognitoSignIn(config, 'participant', storage, place());
    await expect(finishCognitoSignIn(config, storage,
      place('?error=invalid_scope&error_description=PRIVATE_QUERY_VALUE&state=anything'), history, vi.fn()))
      .rejects.toMatchObject({ code: 'HOSTED_CONFIGURATION_REJECTED' });
    const authorization = new URL(await beginCognitoSignIn(config, 'participant', storage, place()));
    const fetcher = vi.fn(async () => new Response('PRIVATE_PROVIDER_BODY', { status: 400 }));
    let rejected: unknown;
    try {
      await finishCognitoSignIn(config, storage,
        place(`?code=abc&state=${authorization.searchParams.get('state')}`), history, fetcher);
    } catch (error) { rejected = error; }
    expect(rejected).toMatchObject({ code: 'TOKEN_REJECTED', httpStatus: 400 });
    expect(JSON.stringify(rejected)).not.toContain('PRIVATE_PROVIDER_BODY');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('retains a one-time invitation only in the same tab across a Cognito redirect', () => {
    const storage = new MemoryStorage();
    const history = { state: null, replaceState: vi.fn() } as unknown as History;
    const arrival = { ...place(), hash: '#invite=abc_123' } as Location;
    expect(readPendingCognitoInvitation(storage, arrival, history)).toBe('abc_123');
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '/');
    expect(readPendingCognitoInvitation(storage, place(), history)).toBe('abc_123');
    clearPendingCognitoInvitation(storage);
    expect(readPendingCognitoInvitation(storage, place(), history)).toBeNull();
  });

  it('attaches access token only to configured decision API and clears a denied session', async () => {
    const storage = new MemoryStorage();
    storage.setItem('known-enough-cognito-session', JSON.stringify(session));
    expect(readCognitoSession(storage)).toEqual(session);
    const denied = vi.fn();
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.example.test/decisions/christmas-decision/me');
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${jwt}`);
      expect(init?.credentials).toBe('omit');
      return new Response(null, { status: 401 });
    });
    expect((await cognitoApiFetch(config, session, '/decisions/christmas-decision/me', denied, {}, fetcher)).status).toBe(401);
    expect(denied).toHaveBeenCalledOnce();
    await expect(cognitoApiFetch(config, session, '//evil.test/', denied, {}, fetcher)).rejects.toThrow();
    clearCognitoSession(storage);
    expect(readCognitoSession(storage)).toBeNull();
    const logout = new URL(cognitoLogoutUrl(config, session, place()));
    expect(logout.searchParams.get('client_id')).toBe('participant-client');
    expect(logout.searchParams.get('logout_uri')).toBe('https://app.example.test/');
  });
  it.each(['deadline', 'caller'])('bounded API fetch respects %s cancellation without clearing a valid session', async kind => {
    const deadline = new AbortController(); const caller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    const unauthorized = vi.fn();
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init!.signal!; signal.addEventListener('abort', () => reject(new Error('Request aborted')), {once:true});
    }));
    try {
      const request = cognitoApiFetch(config, session, '/account', unauthorized, {signal:caller.signal}, fetcher);
      expect(timeout).toHaveBeenCalledWith(45000); (kind === 'deadline' ? deadline : caller).abort();
      await expect(request).rejects.toThrow('Request aborted'); expect(unauthorized).not.toHaveBeenCalled();
    } finally {timeout.mockRestore();}
  });

});
