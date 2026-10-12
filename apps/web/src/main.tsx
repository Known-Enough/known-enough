import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { parseCognitoConfig } from './cognito-session';
import './style.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
const render = (component: React.ReactNode) => createRoot(root).render(<StrictMode>{component}</StrictMode>);
let configured;
try { configured = parseCognitoConfig(import.meta.env); } catch { configured = null; }
if (configured) {
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('demo') === 'legacy') {
    const { ConnectedDemo } = await import('./connected-demo'); render(<ConnectedDemo config={configured} />);
  } else { const { ConnectedApp } = await import('./connected-app'); render(<ConnectedApp config={configured} />); }
} else if (import.meta.env.DEV) {
  const { App } = await import('./App');
  render(<App />);
} else {
  render(<main><h1>Known Enough configuration is incomplete</h1><p>Contact the staging operator.</p></main>);
}
