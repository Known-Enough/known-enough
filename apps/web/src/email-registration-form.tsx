import { useState } from 'react';
import type { CognitoBrowserConfig } from './cognito-session';
import { confirmEmailRegistration, requestEmailRegistration } from './email-registration';

export function EmailRegistration({ config }: { config: CognitoBrowserConfig }) {
  const [stage, setStage] = useState<'closed' | 'details' | 'verify' | 'complete'>('closed');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function submit() {
    if (busy) return;
    setBusy(true); setMessage('');
    try {
      if (stage === 'details') {
        await requestEmailRegistration(config, { username: username.trim(), email: email.trim(), password });
        setUsername(username.trim()); setPassword(''); setEmail(''); setStage('verify');
        setMessage('Check your email for a six-digit verification code.');
      } else if (stage === 'verify') {
        await confirmEmailRegistration(config, username, code);
        setCode(''); setUsername(''); setStage('complete');
        setMessage('Email verified. Sign in to continue and request access.');
      }
    } catch { setMessage(stage === 'verify' ? 'Email verification failed. Check the code and try again.'
      : 'Registration failed. Check your details, including password requirements, and try again.'); }
    finally { setBusy(false); }
  }
  if (stage === 'closed') return <button type="button" className="secondary" onClick={() => setStage('details')}>Register with email</button>;
  return <section aria-label="Email registration">
    <h3>{stage === 'details' ? 'Create your account' : stage === 'verify' ? 'Verify your email' : 'Account created'}</h3>
    {stage !== 'complete' && <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <fieldset disabled={busy}>
        {stage === 'details' ? <>
          <label htmlFor="register-username">Username</label><input id="register-username" value={username} required maxLength={128} autoComplete="username" onChange={event => setUsername(event.target.value)} />
          <label htmlFor="register-email">Email</label><input id="register-email" type="email" value={email} required maxLength={320} autoComplete="email" onChange={event => setEmail(event.target.value)} />
          <label htmlFor="register-password">Password</label><input id="register-password" type="password" value={password} required minLength={16} maxLength={256} autoComplete="new-password" onChange={event => setPassword(event.target.value)} />
          <p>Use at least 16 characters, including uppercase and lowercase letters, a number and a symbol.</p>
        </> : <><label htmlFor="register-code">Verification code</label><input id="register-code" value={code} required pattern="[0-9]{6}" maxLength={6} inputMode="numeric" autoComplete="one-time-code" onChange={event => setCode(event.target.value)} /></>}
        <button type="submit">{busy ? 'Please wait…' : stage === 'details' ? 'Create account' : 'Verify email'}</button>
      </fieldset>
    </form>}
    {message && <p role="status">{message}</p>}
  </section>;
}
