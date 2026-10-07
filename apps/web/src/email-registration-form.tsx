import { useState } from 'react';
import type { CognitoBrowserConfig } from './cognito-session';
import { asRegistrationFailure, confirmEmailRegistration, MIN_REGISTRATION_PASSWORD_LENGTH,
  requestEmailRegistration, type RegistrationCode, type RegistrationDiagnostic } from './email-registration';

function recoveryText(code: RegistrationCode): string {
  switch (code) {
    case 'INVALID_DETAILS': return 'Check your username and email, and use a password of at least eight characters with uppercase, lowercase, a number and a symbol.';
    case 'PASSWORD_REJECTED': return 'This site rejected the password under its current policy. Try a different password or contact the app operator.';
    case 'ACCOUNT_EXISTS_OR_PENDING': return 'An account may already exist or await verification. If you have a code, enter it below; otherwise try signing in.';
    case 'SIGNUP_UNAVAILABLE': return 'Email registration is unavailable on this site. Contact the app operator.';
    case 'ATTRIBUTES_REJECTED': return 'Your details or this site’s registration settings were rejected. Contact the app operator with the reference below.';
    case 'NETWORK_RESULT_UNKNOWN':
    case 'DELIVERY_UNCONFIRMED': return 'The account request result is uncertain. Avoid repeating it now. If a code arrived, enter it below; otherwise contact the app operator.';
    case 'INVALID_CODE':
    case 'CODE_REJECTED': return 'The verification code was not accepted. Check the code and try again.';
    case 'CODE_EXPIRED': return 'The verification code expired. Contact the app operator to recover registration.';
    case 'RATE_LIMITED': return 'Too many requests were made. Wait before trying again.';
    case 'PROVIDER_UNAVAILABLE': return 'The registration service is temporarily unavailable. Try again later.';
    default: return 'Registration failed. Contact the app operator with the reference below.';
  }
}

export function EmailRegistration({ config }: { config: CognitoBrowserConfig }) {
  const [stage, setStage] = useState<'closed' | 'details' | 'verify' | 'complete'>('closed');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [diagnostic, setDiagnostic] = useState<RegistrationDiagnostic | null>(null);
  async function submit() {
    if (busy) return;
    setBusy(true); setMessage(''); setDiagnostic(null);
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
    } catch (error) {
      const observed = asRegistrationFailure(error, stage === 'verify' ? 'confirmation' : 'signup').diagnostic;
      setDiagnostic(observed); setMessage(recoveryText(observed.code));
      console.info('Known Enough registration diagnostic', { environment: config.userPoolId, ...observed });
    }
    finally { setBusy(false); }
  }
  if (stage === 'closed') return <button type="button" className="secondary" onClick={() => setStage('details')}>Create account</button>;
  return <section className="ke-registration" aria-label="Email registration">
    <h3>{stage === 'details' ? 'Create your account' : stage === 'verify' ? 'Verify your email' : 'Account created'}</h3>
    {stage !== 'complete' && <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <fieldset disabled={busy}>
        {stage === 'details' ? <>
          <label htmlFor="register-username">Username</label><input id="register-username" value={username} required maxLength={128} autoComplete="username" onChange={event => setUsername(event.target.value)} />
          <label htmlFor="register-email">Email</label><input id="register-email" type="email" value={email} required maxLength={320} autoComplete="email" onChange={event => setEmail(event.target.value)} />
          <label htmlFor="register-password">Password</label><input id="register-password" type="password" value={password} required minLength={MIN_REGISTRATION_PASSWORD_LENGTH} maxLength={256} autoComplete="new-password" onChange={event => setPassword(event.target.value)} />
          <p>Use at least eight characters, including uppercase, lowercase, a number and a symbol.</p>
        </> : <><label htmlFor="register-code">Verification code</label><input id="register-code" value={code} required pattern="[0-9]{6}" maxLength={6} inputMode="numeric" autoComplete="one-time-code" onChange={event => setCode(event.target.value)} /></>}
        <button type="submit">{busy ? 'Please wait…' : stage === 'details' ? 'Create account' : 'Verify email'}</button>
      </fieldset>
    </form>}
    {stage === 'details' && diagnostic && ['ACCOUNT_EXISTS_OR_PENDING', 'NETWORK_RESULT_UNKNOWN', 'DELIVERY_UNCONFIRMED'].includes(diagnostic.code) && username.trim()
      && <button type="button" className="secondary" onClick={() => { setUsername(username.trim()); setPassword(''); setEmail(''); setDiagnostic(null); setMessage('Enter the code sent to your email.'); setStage('verify'); }}>I have a verification code</button>}
    {stage === 'verify' && <button type="button" className="secondary" onClick={() => { setCode(''); setDiagnostic(null); setMessage(''); setStage('details'); }}>Back to account details</button>}
    <button type="button" className="secondary" disabled={busy} onClick={() => { setPassword(''); setEmail(''); setUsername(''); setCode(''); setDiagnostic(null); setMessage(''); setStage('closed'); }}>{stage === 'details' ? 'Cancel account creation' : 'Close registration'}</button>
    {message && <p role="status">{message}</p>}
    {diagnostic && <p className="ke-help">Reference: {diagnostic.code} at {diagnostic.observedAt}
      {diagnostic.httpStatus ? ` (HTTP ${diagnostic.httpStatus})` : ''}{diagnostic.requestId ? ` (request ${diagnostic.requestId})` : ''}.</p>}
  </section>;
}
