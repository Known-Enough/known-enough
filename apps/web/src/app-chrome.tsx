import { useEffect, useState, type ReactNode } from 'react';

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

export function Brand({ onNavigate }: { onNavigate?: () => void } = {}) {
  const content = <span className="ke-brand"><img src="/logo.png" alt="" width="38" height="38" decoding="async" /><span>Known Enough</span></span>;
  return <a className="ke-brand-link" href="/" aria-label="Known Enough — your groups" onClick={event => { if (onNavigate && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onNavigate(); } }}>{content}</a>;
}

type LoadingKind = 'auth' | 'groups' | 'group' | 'decision' | 'profile' | 'example' | 'inline';
function SkeletonBar({ shape = '' }: { shape?: string }) {
  return <span className={`ke-skeleton-bar${shape ? ` ${shape}` : ''}`} />;
}

export function LoadingSkeleton({ label, kind, className = '' }: { label: string; kind: LoadingKind; className?: string }) {
  const identity = () => <><SkeletonBar shape="is-avatar" /><span className="ke-skeleton-identity"><SkeletonBar shape="is-copy" /><SkeletonBar shape="is-copy is-short" /></span></>;
  const panel = (type: 'members' | 'decisions' | 'invitations') => <div className={`ke-skeleton-subpanel ke-skeleton-${type}`}>
    <div className="ke-skeleton-panel-heading"><SkeletonBar shape="is-subheading" /><SkeletonBar shape="is-badge" /></div>
    {type === 'members' && <><div className="ke-skeleton-person">{identity()}</div><div className="ke-skeleton-person">{identity()}</div></>}
    {type === 'decisions' && <><SkeletonBar shape="is-copy" /><SkeletonBar shape="is-copy is-short" /><SkeletonBar shape="is-button" /></>}
    {type === 'invitations' && <><SkeletonBar shape="is-input" /><SkeletonBar shape="is-copy is-medium" /><SkeletonBar shape="is-button is-wide" /></>}
  </div>;
  let visual: ReactNode;
  switch (kind) {
    case 'auth': visual = <><SkeletonBar shape="is-heading" /><SkeletonBar shape="is-copy is-medium" /><SkeletonBar shape="is-copy" /><div className="ke-skeleton-auth-actions"><SkeletonBar shape="is-button is-wide" /><SkeletonBar shape="is-button is-wide" /></div></>; break;
    case 'groups': visual = <><div className="ke-skeleton-section-heading"><SkeletonBar shape="is-subheading" /><SkeletonBar shape="is-button" /></div><div className="ke-skeleton-group-list">{[0, 1, 2].map(item => <div className="ke-skeleton-group-row" key={item}><SkeletonBar shape="is-avatar" /><span><SkeletonBar shape="is-subheading is-medium" /><SkeletonBar shape="is-copy is-short" /></span><SkeletonBar shape="is-menu-trigger" /></div>)}</div></>; break;
    case 'group': visual = <><div className="ke-skeleton-group-overview"><div><SkeletonBar shape="is-eyebrow" /><SkeletonBar shape="is-heading is-medium" /><div className="ke-skeleton-summary"><SkeletonBar shape="is-copy is-short" /><SkeletonBar shape="is-copy is-short" /><SkeletonBar shape="is-copy is-short" /></div></div><div className="ke-skeleton-group-actions"><SkeletonBar shape="is-button is-wide" /><SkeletonBar shape="is-button is-wide" /></div></div><div className="ke-skeleton-group-panels">{panel('members')}{panel('decisions')}{panel('invitations')}</div></>; break;
    case 'decision': visual = <><div className="ke-skeleton-decision-heading"><SkeletonBar shape="is-heading is-medium" /><SkeletonBar shape="is-copy" /></div><div className="ke-skeleton-decision-card"><SkeletonBar shape="is-subheading" /><SkeletonBar shape="is-copy" /><SkeletonBar shape="is-copy is-medium" /><SkeletonBar shape="is-copy is-short" /></div><div className="ke-skeleton-decision-card"><SkeletonBar shape="is-subheading is-medium" /><SkeletonBar shape="is-input" /><SkeletonBar shape="is-copy is-short" /></div></>; break;
    case 'profile': visual = <><SkeletonBar shape="is-subheading is-medium" /><SkeletonBar shape="is-copy" /><SkeletonBar shape="is-input" /><SkeletonBar shape="is-copy is-short" /><SkeletonBar shape="is-input" /><SkeletonBar shape="is-button is-wide" /></>; break;
    case 'example': visual = <><div className="ke-skeleton-section-heading"><SkeletonBar shape="is-subheading is-medium" /><SkeletonBar shape="is-badge" /></div><div className="ke-skeleton-example-people">{[0, 1, 2].map(item => <div className="ke-skeleton-person" key={item}>{identity()}</div>)}</div><div className="ke-skeleton-decision-card"><SkeletonBar shape="is-heading is-medium" /><SkeletonBar shape="is-copy" /><SkeletonBar shape="is-copy is-medium" /><SkeletonBar shape="is-copy is-short" /></div></>; break;
    case 'inline': visual = <SkeletonBar shape="is-progress" />; break;
  }
  return <div className={`ke-loading ke-loading-${kind}${className ? ` ${className}` : ''}`} role="status" aria-label={label}>
    <div className="ke-loading-visual" aria-hidden="true">{visual}</div>
  </div>;
}

export function ProfileIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <circle cx="12" cy="8" r="3.5" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" strokeLinecap="round" />
  </svg>;
}

const pageIconShapes = {
  MessageCircle: <><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z" /></>,
  Users: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
  UserRoundPlus: <><path d="M18 21a8 8 0 0 0-16 0" /><circle cx="10" cy="8" r="5" /><path d="M19 8v6M22 11h-6" /></>,
  LogIn: <><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><path d="m10 17 5-5-5-5M15 12H3" /></>,
  ListChecks: <><path d="M11 5h10M11 12h10M11 19h10" /><path d="m3 4 2 2 4-4m-6 10 2 2 4-4m-6 10 2 2 4-4" /></>,
  Mail: <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></>,
  ShieldCheck: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" /><path d="m9 12 2 2 4-4" /></>,
  UsersRound: <><path d="M18 21a8 8 0 0 0-16 0" /><circle cx="10" cy="8" r="5" /><path d="M23 21a8 8 0 0 0-6-7.3M16 3.13a5 5 0 0 1 0 9.75" /></>,
  ArrowLeft: <><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></>,
  RefreshCw: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.64 5.64A9 9 0 0 1 20 12M4 12a9 9 0 0 0 14.36 6.36" /></>,
  ArrowRight: <><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></>,
  ChevronRight: <><path d="m9 18 6-6-6-6" /></>,
  Ellipsis: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  Plus: <><path d="M12 5v14M5 12h14" /></>,
  Link: <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>,
  X: <><path d="m18 6-12 12M6 6l12 12" /></>,
  LogOut: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></>,
  UserRound: <><circle cx="12" cy="8" r="4" /><path d="M5 21a7 7 0 0 1 14 0" /></>,
  FileText: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h8" /></>,
  Camera: <><path d="M14 5h-4l-2 2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" /><circle cx="12" cy="13" r="3" /></>,
  Check: <><path d="m5 12 4 4L19 6" /></>,
  Sparkles: <><path d="m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7L12 3Z" /><path d="M20 2v4m-2-2h4" /></>,
  Lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  Pencil: <><path d="m16 4 4 4M4 20l4-.8L19 8a2.8 2.8 0 0 0-4-4L4 15z" /></>
} as const;

export function PageIcon({ name }: { name: keyof typeof pageIconShapes }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{pageIconShapes[name]}</svg>;
}

export function PrivacyBar() {
  return <details className="ke-privacy-bar"><summary><span className="ke-privacy-label"><span className="ke-heading-icon" aria-hidden="true"><PageIcon name="ShieldCheck" /></span><span>Privacy and preview limits</span></span></summary>
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
