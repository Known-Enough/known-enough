import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearLocalTestSession, localTestFetch, readLocalTestSession, type LocalTestSession } from './local-test-session.tsx';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

const session: LocalTestSession = {
  accountId: 'leo', displayName: 'Leo', participantId: 'leo', kind: 'participant',
  token: 'header.payload.signature', expiresAt: new Date(Date.now() + 60_000).toISOString(),
};
const sessionKey = 'known-enough-local-test-session';

afterEach(() => vi.unstubAllGlobals());

describe('local browser test session', () => {
  it('accepts a live session and removes an expired or malformed session', () => {
    const storage = new MemoryStorage();
    storage.setItem(sessionKey, JSON.stringify(session));
    expect(readLocalTestSession(storage)).toEqual(session);

    storage.setItem(sessionKey, JSON.stringify({ ...session, expiresAt: new Date(Date.now() - 1).toISOString() }));
    expect(readLocalTestSession(storage)).toBeNull();
    expect(storage.getItem(sessionKey)).toBeNull();

    storage.setItem(sessionKey, '{');
    expect(readLocalTestSession(storage)).toBeNull();
    expect(storage.getItem(sessionKey)).toBeNull();
  });

  it('sends the signed bearer session and clears it after an expired-session response', async () => {
    const storage = new MemoryStorage();
    storage.setItem(sessionKey, JSON.stringify(session));
    vi.stubGlobal('window', { sessionStorage: storage });
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${session.token}`);
      return new Response(null, { status: 401 });
    });
    const expired = vi.fn();
    const response = await localTestFetch(session, expired, 'http://127.0.0.1:8788/decisions/christmas-decision/me', {}, fetcher);

    expect(response.status).toBe(401);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(expired).toHaveBeenCalledOnce();
    expect(storage.getItem(sessionKey)).toBeNull();
  });

  it('clears only the tab-local test session', () => {
    const storage = new MemoryStorage();
    storage.setItem(sessionKey, JSON.stringify(session));
    storage.setItem('another-value', 'preserved');
    clearLocalTestSession(storage);
    expect(storage.getItem(sessionKey)).toBeNull();
    expect(storage.getItem('another-value')).toBe('preserved');
  });
});
