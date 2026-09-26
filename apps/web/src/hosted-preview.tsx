import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PublicScreen } from './public-screen';
import './style.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');

// This entry intentionally ignores location.search. A hosted URL cannot select
// the private owner screen, a local identity, or a different fixture.
createRoot(root).render(<StrictMode><PublicScreen initialScenario="collecting" hostedPreview /></StrictMode>);
