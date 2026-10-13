import { useRef, useState } from 'react';
import type { CognitoBrowserConfig, CognitoSession } from './cognito-session';
import { EmailRegistration } from './email-registration-form';

export function AuthEntry({ config, signIn, notice }: { config: CognitoBrowserConfig;
  signIn: (kind: CognitoSession['kind']) => Promise<void>; notice: string }) {
  const [registering, setRegistering] = useState(false);
  const create = useRef<HTMLButtonElement>(null);
  const close = () => { setRegistering(false); window.setTimeout(() => create.current?.focus(), 0); };
  return <main className="ke-entry">
    <section className="ke-entry-surface" aria-label="Welcome to Known Enough">
      <p className="eyebrow">KNOWN ENOUGH</p>
      <h1>Decide together.</h1>
      <p className="ke-entry-purpose">Create a group, share your needs privately, and decide together.</p>
      {registering ? <EmailRegistration config={config} startOpen onClose={close} onSignIn={() => void signIn('participant')} />
        : <div className="ke-entry-actions">
          <button ref={create} type="button" onClick={() => setRegistering(true)}>Create account</button>
          <button type="button" className="secondary" onClick={() => void signIn('participant')}>Sign in</button>
        </div>}
      <details className="ke-entry-privacy"><summary>Privacy and preview limits</summary>
        <p>Known Enough and its authorized AI process private inputs. Other people see shared choices and disclosures you authorize.
          Outcomes may still reveal something about your needs. Use fictional, non-sensitive data in this preview.</p>
      </details>
      {notice && <p role="status">{notice}</p>}
    </section>
  </main>;
}
