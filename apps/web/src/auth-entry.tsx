import { useRef, useState } from 'react';
import type { CognitoBrowserConfig, CognitoSession } from './cognito-session';
import { SignInForm } from './sign-in-form';
import type { DirectCognito } from './cognito-direct';
import { EmailRegistration } from './email-registration-form';
import { Brand, LoadingSkeleton, PageIcon, PrivacyBar, ThemeToggle, WelcomeHeading } from './app-chrome';

export function AuthEntry({ config, notice, callbackPending = false, direct, onSession, signIn }: { config: CognitoBrowserConfig;
  direct?: DirectCognito; onSession?: (session:CognitoSession)=>void; signIn?: (kind:CognitoSession['kind'])=>Promise<void>;  notice: string; callbackPending?: boolean }) {
  const [signing,setSigning]=useState(false);
  const [registering, setRegistering] = useState(false);
  const create = useRef<HTMLButtonElement>(null);
  const close = () => { setRegistering(false); window.setTimeout(() => create.current?.focus(), 0); };
  return <main className="ke-entry">
    <header className="ke-masthead"><Brand /><div className="ke-header-actions"><ThemeToggle /></div></header>
    <WelcomeHeading />
    {callbackPending ? <LoadingSkeleton kind="auth" label="Completing sign in" className="ke-entry-surface" /> : <section className="ke-entry-surface ke-load-reveal" aria-label="Welcome to Known Enough">
      {!registering && !signing && <><h2>Get started</h2><p className="ke-entry-purpose">Create a group, share your needs privately, and decide together.</p></>}
      {registering ? <EmailRegistration config={config} startOpen onClose={close} onSignIn={() => {setRegistering(false);if(direct)setSigning(true);else void signIn?.('participant');}} />
        : signing && direct && onSession ? <SignInForm client={direct} onSession={onSession} onBack={()=>{setSigning(false);close();}} /> : <div className="ke-entry-actions">
          <button ref={create} type="button" className="ke-icon-action" onClick={() => setRegistering(true)}><PageIcon name="UserRoundPlus" />Create account</button>
          <button type="button" className="secondary ke-icon-action" onClick={() => {if(direct)setSigning(true);else void signIn?.('participant');}}><PageIcon name="LogIn" />Sign in</button>
        </div>}
      {notice && <p role="status">{notice}</p>}
    </section>}
    <div className="ke-entry-privacy"><PrivacyBar /></div>
  </main>;
}
