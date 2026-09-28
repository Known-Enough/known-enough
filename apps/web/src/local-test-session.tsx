import { useEffect, useState } from 'react';
import { KnownEnough } from '@deal-table/contracts';

export interface LocalTestSession {
  accountId: string;
  displayName: string;
  participantId: string | null;
  kind: 'participant' | 'display';
  token: string;
  expiresAt: string;
}

const SESSION_KEY = 'known-enough-local-test-session';
const LOCAL_API = 'http://127.0.0.1:8788';
const LOCAL_TEST_ACCOUNTS = [
  { id: 'maya', label: 'Maya · organizer' }, { id: 'leo', label: 'Leo' },
  { id: 'nina', label: 'Nina' }, { id: 'ana', label: 'Ana' }, { id: 'raul', label: 'Raul' },
  { id: 'display', label: 'Shared display · view only' },
] as const;

function parseSession(value: unknown): LocalTestSession | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.accountId !== 'string' || typeof raw.displayName !== 'string'
    || (raw.participantId !== null && typeof raw.participantId !== 'string')
    || (raw.kind !== 'participant' && raw.kind !== 'display')
    || typeof raw.token !== 'string' || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(raw.token)
    || typeof raw.expiresAt !== 'string' || !Number.isFinite(Date.parse(raw.expiresAt))
    || Date.parse(raw.expiresAt) <= Date.now()) return null;
  if ((raw.kind === 'participant') !== (typeof raw.participantId === 'string')) return null;
  return raw as unknown as LocalTestSession;
}

export function readLocalTestSession(storage: Storage = window.sessionStorage): LocalTestSession | null {
  try {
    const raw = storage.getItem(SESSION_KEY);
    if (raw === null) return null;
    const session = parseSession(JSON.parse(raw) as unknown);
    if (!session) storage.removeItem(SESSION_KEY);
    return session;
  } catch {
    try { storage.removeItem(SESSION_KEY); } catch { /* unavailable storage means signed out */ }
    return null;
  }
}

export function clearLocalTestSession(storage: Storage = window.sessionStorage): void {
  try { storage.removeItem(SESSION_KEY); } catch { /* unavailable storage means signed out */ }
}

export async function createLocalTestSession(
  accountId: string, fetcher: typeof fetch = fetch,
): Promise<LocalTestSession> {
  const response = await fetcher(`${LOCAL_API}/__test/session`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId }),
  });
  if (!response.ok) throw new Error('Local test sign-in is unavailable. Start the local API and try again.');
  const session = parseSession(await response.json());
  if (!session || session.accountId !== accountId) throw new Error('The local test sign-in response was invalid.');
  window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export async function localTestFetch(
  session: LocalTestSession,
  onExpired: () => void,
  input: RequestInfo | URL,
  init?: RequestInit,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set('authorization', `Bearer ${session.token}`);
  const response = await fetcher(input, { ...init, headers });
  if (response.status === 401) {
    clearLocalTestSession();
    onExpired();
  }
  return response;
}

export function LocalTestSignIn({ onSignedIn, hasInvite = false }: { onSignedIn: (session: LocalTestSession) => void; hasInvite?: boolean }) {
  const [accountId, setAccountId] = useState<string>('maya');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  return <main className="ke-home">
    <header className="masthead ke-masthead"><div><p className="eyebrow">KNOWN ENOUGH</p><h1>Decide together</h1></div></header>
    <section className="ke-card ke-auth-card" aria-labelledby="local-test-sign-in-heading">
      <p className="eyebrow">LOCAL TEST ONLY</p>
      <h2 id="local-test-sign-in-heading">Choose a test user</h2>
      <p>These are fictional test accounts. This is not a real account or password sign-in, and nothing connects to AWS.</p>
      {hasInvite && <p className="local-note" role="status">An invitation link is waiting in this browser tab. Choose the invited test user to continue.</p>}
      <form onSubmit={event => {
        event.preventDefault(); setLoading(true); setError('');
        void createLocalTestSession(accountId).then(onSignedIn).catch(reason => {
          setError(reason instanceof Error ? reason.message : 'Local test sign-in failed.');
        }).finally(() => setLoading(false));
      }}>
        <label htmlFor="local-test-account">Test user</label>
        <select id="local-test-account" value={accountId} onChange={event => setAccountId(event.target.value)}>
          {LOCAL_TEST_ACCOUNTS.map(account => <option key={account.id} value={account.id}>{account.label}</option>)}
        </select>
        <button type="submit" disabled={loading}>{loading ? 'Starting…' : 'Start local test session'}</button>
      </form>
      {error && <p role="alert" className="ke-error">{error}</p>}
      <p className="ke-help">Sessions last 15 minutes and stay in this browser tab. Each test user gets a separate session.</p>
    </section>
  </main>;
}

export function LocalTestDisplay({
  session, onSignOut, onExpired,
}: { session: LocalTestSession; onSignOut: () => void; onExpired: () => void }) {
  const [snapshot, setSnapshot] = useState<KnownEnough.PublicDecisionSnapshot | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void localTestFetch(session, onExpired, `${LOCAL_API}/decisions/christmas-decision/public`)
      .then(async response => {
        if (!response.ok) throw new Error('The shared view is unavailable for this test session.');
        return KnownEnough.PublicDecisionSnapshot.parse(await response.json());
      }).then(value => { if (active) setSnapshot(value); })
      .catch(() => { if (active) setError('The shared view is unavailable for this test session.'); });
    return () => { active = false; };
  }, [onExpired, session]);
  return <main className="ke-home">
    <header className="masthead ke-masthead">
      <div><p className="eyebrow">KNOWN ENOUGH · LOCAL TEST</p><h1>Shared display</h1></div>
      <button type="button" className="secondary" onClick={onSignOut}>Sign out</button>
    </header>
    <section className="ke-card" aria-labelledby="shared-display-heading">
      <h2 id="shared-display-heading">Shared view · read only</h2>
      {error && <p role="alert" className="ke-error">{error}</p>}
      {!snapshot && !error && <p role="status">Loading shared view…</p>}
      {snapshot && <>
        <h3>{snapshot.frame.title}</h3>
        <p>{snapshot.frame.objective}</p>
        <p>Status: {snapshot.status.replaceAll('_', ' ').toLowerCase()}</p>
        <h3>Participants</h3>
        <ul>{snapshot.frame.participants.map(person => <li key={person.id}>{person.displayName}</li>)}</ul>
        <p className="ke-help">This screen receives public information only. It cannot read private inputs or approve changes.</p>
      </>}
    </section>
  </main>;
}
