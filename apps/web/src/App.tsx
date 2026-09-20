import { lazy, Suspense } from 'react';
import { PublicScreen, isPublicMockScenario } from './public-screen';

const OwnerScreen = lazy(() => import('./owner-screen').then(module => ({ default: module.OwnerScreen })));
export function App() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('view') === 'owner') return <Suspense fallback={<main><p role="status" className="state-card">Loading private owner demo…</p></main>}><OwnerScreen initialScenario={params.get('owner')} /></Suspense>;
  const requested = params.get('public');
  return <PublicScreen initialScenario={isPublicMockScenario(requested) ? requested : 'collecting'} />;
}
