import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { KnownEnoughHome } from './known-enough-home';
import { PublicScreen, isPublicMockScenario } from './public-screen';
import type { LocalIdentity } from './local-api-client';
import {
  clearLocalTestSession, LocalTestDisplay, LocalTestSignIn, readLocalTestSession,
  type LocalTestSession,
} from './local-test-session';

const OwnerScreen = lazy(() => import('./owner-screen').then(module => ({ default: module.OwnerScreen })));
export function App() {
  const [session, setSession] = useState<LocalTestSession | null>(() => readLocalTestSession());
  const [pendingInviteToken, setPendingInviteToken] = useState<string | null>(() => {
    const fragment = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
    const values = new URLSearchParams(fragment);
    const token = values.get('invite');
    if (values.has('invite')) window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
    return token && /^[A-Za-z0-9_-]{1,80}$/.test(token) ? token : null;
  });
  const signOut = useCallback(() => { clearLocalTestSession(); setSession(null); }, []);
  const sessionExpired = useCallback(() => { clearLocalTestSession(); setSession(null); }, []);
  const inviteHandled = useCallback(() => setPendingInviteToken(null), []);
  useEffect(() => {
    if (!session) return;
    const timeout = window.setTimeout(sessionExpired, Math.max(0, Date.parse(session.expiresAt) - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [session, sessionExpired]);

  const params = new URLSearchParams(window.location.search);
  const local = params.get('local');
  const localIdentity: LocalIdentity | null = local === 'maya' || local === 'leo' || local === 'nina' || local === 'display' ? local : null;
  if (params.get('view') === 'owner') return <Suspense fallback={<main><p role="status" className="state-card">Loading private owner demo…</p></main>}><OwnerScreen initialScenario={params.get('owner')} localIdentity={localIdentity === 'display' ? null : localIdentity} /></Suspense>;
  if (params.has('legacy') || params.has('public') || params.has('local')) {
    const requested = params.get('public');
    return <PublicScreen initialScenario={isPublicMockScenario(requested) ? requested : 'collecting'} local={localIdentity === 'display'} />;
  }
  if (!session) return <LocalTestSignIn onSignedIn={setSession} hasInvite={pendingInviteToken !== null} />;
  if (session.kind === 'display') return <LocalTestDisplay session={session} onSignOut={signOut} onExpired={sessionExpired} />;
  return <KnownEnoughHome session={session} onSignOut={signOut} onSessionExpired={sessionExpired}
    pendingInviteToken={pendingInviteToken} onInviteHandled={inviteHandled} />;
}
