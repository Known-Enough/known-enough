import { useRef, useState } from 'react';
import type { CognitoBrowserConfig, CognitoSession } from './cognito-session';
import { EmailRegistration } from './email-registration-form';
import { Brand, PrivacyBar, ProfileIcon, WelcomeHeading } from './app-chrome';

export function AuthEntry({ config, signIn, notice }: { config: CognitoBrowserConfig;
  signIn: (kind: CognitoSession['kind']) => Promise<void>; notice: string }) {
  const [registering, setRegistering] = useState(false);
  const create = useRef<HTMLButtonElement>(null);
  const close = () => { setRegistering(false); window.setTimeout(() => create.current?.focus(), 0); };
  return <main className="ke-entry">
    <header className="ke-masthead"><Brand /><button type="button" className="ke-profile-trigger secondary" aria-label="Sign in to your account" title="Sign in" onClick={() => void signIn('participant')}><ProfileIcon /></button></header>
    <WelcomeHeading />
    <PrivacyBar />
    <section className="ke-entry-surface" aria-label="Welcome to Known Enough">
      {!registering && <><h2>Get started</h2><p className="ke-entry-purpose">Create a group, share your needs privately, and decide together.</p></>}
      {registering ? <EmailRegistration config={config} startOpen onClose={close} onSignIn={() => void signIn('participant')} />
        : <div className="ke-entry-actions">
          <button ref={create} type="button" onClick={() => setRegistering(true)}>Create account</button>
          <button type="button" className="secondary" onClick={() => void signIn('participant')}>Sign in</button>
        </div>}
      {notice && <p role="status">{notice}</p>}
    </section>
  </main>;
}
