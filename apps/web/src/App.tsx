import { lazy, Suspense } from 'react';
import { PublicScreen, isPublicMockScenario } from './public-screen';
import type { LocalIdentity } from './local-api-client';

const OwnerScreen = lazy(() => import('./owner-screen').then(module => ({ default: module.OwnerScreen })));
export function App() {
  const params = new URLSearchParams(window.location.search);
  const local = params.get('local');
  const localIdentity: LocalIdentity | null = local === 'maya' || local === 'leo' || local === 'nina' || local === 'display' ? local : null;
  if (params.get('view') === 'owner') return <Suspense fallback={<main><p role="status" className="state-card">Loading private owner demo…</p></main>}><OwnerScreen initialScenario={params.get('owner')} localIdentity={localIdentity === 'display' ? null : localIdentity} /></Suspense>;
  const requested = params.get('public');
  return <PublicScreen initialScenario={isPublicMockScenario(requested) ? requested : 'collecting'} local={localIdentity === 'display'} />;
}
