import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { parseCognitoConfig } from './cognito-session';
import { App } from './App';
import './style.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
const render = (component: React.ReactNode) => createRoot(root).render(<StrictMode>{component}</StrictMode>);
let configured;
try { configured = parseCognitoConfig(import.meta.env); } catch { configured = null; }
if (configured) {
  const { ConnectedApp } = await import('./connected-app');
  render(<ConnectedApp config={configured} />);
} else if (import.meta.env.DEV) {
  render(<App />);
} else {
  render(<main><h1>Known Enough configuration is incomplete</h1><p>Contact the staging operator.</p></main>);
}
