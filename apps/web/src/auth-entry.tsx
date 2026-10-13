import { useRef, useState } from 'react';
import type { CognitoBrowserConfig, CognitoSession } from './cognito-session';
import { EmailRegistration } from './email-registration-form';
import { Brand, PageIcon, PrivacyBar, ThemeToggle, WelcomeHeading } from './app-chrome';

export function AuthEntry({ config, signIn, notice }: { config: CognitoBrowserConfig;
  signIn: (kind: CognitoSession['kind']) => Promise<void>; notice: string }) {
  const [registering, setRegistering] = useState(false);
  const create = useRef<HTMLButtonElement>(null);
  const close = () => { setRegistering(false); window.setTimeout(() => create.current?.focus(), 0); };
  return <main className="ke-entry">
    <header className="ke-masthead"><Brand /><div className="ke-header-actions"><ThemeToggle /></div></header>
    <WelcomeHeading />
    <section className="ke-entry-surface" aria-label="Welcome to Known Enough">
      {!registering && <><h2>Get started</h2><p className="ke-entry-purpose">Create a group, share your needs privately, and decide together.</p></>}
      {registering ? <EmailRegistration config={config} startOpen onClose={close} onSignIn={() => void signIn('participant')} />
        : <div className="ke-entry-actions">
          <button ref={create} type="button" className="ke-icon-action" onClick={() => setRegistering(true)}><PageIcon name="UserRoundPlus" />Create account</button>
          <button type="button" className="secondary ke-icon-action" onClick={() => void signIn('participant')}><PageIcon name="LogIn" />Sign in</button>
        </div>}
      {notice && <p role="status">{notice}</p>}
    </section>
    <div className="ke-entry-privacy"><PrivacyBar /></div>
  </main>;
}
