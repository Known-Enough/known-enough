import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';
const themeKey = 'ke-appearance';

function storedTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(themeKey);
    return value === 'light' || value === 'dark' ? value : null;
  } catch { return null; }
}

function systemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function currentTheme(): Theme { return storedTheme() ?? systemTheme(); }

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#111815' : '#F6F7F3');
}

export function initializeTheme() { applyTheme(currentTheme()); }

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => currentTheme());
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const updateSystem = () => {
      if (storedTheme()) return;
      const next = systemTheme();
      setTheme(next);
      applyTheme(next);
    };
    const updateStored = (event: StorageEvent) => {
      if (event.key !== themeKey && event.key !== null) return;
      const next = storedTheme() ?? systemTheme();
      setTheme(next);
      applyTheme(next);
    };
    media?.addEventListener('change', updateSystem);
    window.addEventListener('storage', updateStored);
    return () => {
      media?.removeEventListener('change', updateSystem);
      window.removeEventListener('storage', updateStored);
    };
  }, []);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    try { window.localStorage.setItem(themeKey, next); } catch { /* Keep the choice for this page load. */ }
    setTheme(next);
    applyTheme(next);
  }

  return <button type="button" className="ke-theme-toggle secondary" aria-label="Dark mode"
    aria-pressed={theme === 'dark'} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} onClick={toggle}>
    {theme === 'dark'
      ? <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></svg>
      : <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M20.8 14.1A8.7 8.7 0 0 1 9.9 3.2 8.8 8.8 0 1 0 20.8 14.1Z" /></svg>}
  </button>;
}

export function Brand() {
  return <span className="ke-brand"><img src="/logo.png" alt="" width="38" height="38" decoding="async" /><span>Known Enough</span></span>;
}

export function ProfileIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <circle cx="12" cy="8" r="3.5" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" strokeLinecap="round" />
  </svg>;
}

export function PrivacyBar() {
  return <details className="ke-privacy-bar"><summary><span>Privacy and preview limits</span></summary>
    <p>Known Enough and its authorized AI process your private inputs. Other people see only shared choices, proposals and disclosures you authorize.
      An outcome may still reveal something about people’s needs. Use fictional, non-sensitive data in this preview.</p>
  </details>;
}

export function WelcomeHeading() {
  return <div className="ke-hero"><h1>Decide together.</h1><p>A thoughtful space for decisions that matter.</p></div>;
}

export function GroupIcon() {
  return <svg aria-hidden="true" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.6">
    <circle cx="13" cy="11" r="4" /><path d="M5 26v-3a8 8 0 0 1 16 0v3M22 7a4 4 0 0 1 0 8m3 4a7 7 0 0 1 3 6" strokeLinecap="round" />
  </svg>;
}
