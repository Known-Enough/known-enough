import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { parseCognitoConfig } from './cognito-session';
import { initializeTheme } from './app-chrome';
import './style.css';

initializeTheme();
const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
const render = (component: React.ReactNode) => createRoot(root).render(<StrictMode>{component}</StrictMode>);
let configured;
try { configured = parseCognitoConfig(import.meta.env); } catch { configured = null; }
const search = new URLSearchParams(window.location.search);
// Retired public example links return to the normal app. OAuth query/fragment data is preserved.
if (search.get('guide') === 'decision' && !['code', 'state', 'error'].some(key => search.has(key))) {
  search.delete('guide');
  window.history.replaceState(null, '', window.location.pathname + (search.size ? '?' + search.toString() : '') + window.location.hash);
}
if (configured) {
  const { ConnectedApp } = await import('./connected-app');
  render(<ConnectedApp config={configured} />);
} else if (import.meta.env.DEV) {
  const { App } = await import('./App');
  render(<App />);
} else {
  render(<main><h1>Known Enough is temporarily unavailable</h1><p>Please try again later. If this continues, ask the preview owner for help.</p></main>);
}
