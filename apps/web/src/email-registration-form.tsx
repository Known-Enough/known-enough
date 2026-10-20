import { useEffect, useRef, useState } from 'react';
import type { CognitoBrowserConfig } from './cognito-session';
import { LoadingSkeleton } from './app-chrome';
import { PasswordField } from './password-field';
import { asRegistrationFailure, confirmEmailRegistration, MIN_REGISTRATION_PASSWORD_LENGTH,
  requestEmailRegistration, type RegistrationCode, type RegistrationDiagnostic } from './email-registration';

function recoveryText(code: RegistrationCode): string {
  switch (code) {
    case 'INVALID_DETAILS': return 'Check your username and email, and use a password of at least eight characters with uppercase, lowercase, a number and a symbol.';
    case 'PASSWORD_REJECTED': return 'Choose a different password with at least eight characters, including an uppercase letter, a lowercase letter, a number and a symbol.';
    case 'ACCOUNT_EXISTS_OR_PENDING': return 'This username may already be in use. If you received a verification code, enter it below. Otherwise, try signing in.';
    case 'EMAIL_ALREADY_LINKED': return 'This email already has an account. Sign in with your original username, or use Forgot password on the sign-in screen.';
    case 'ACCOUNT_SETUP_UNAVAILABLE': return 'We couldn’t finish setting up your account. Try signing in to check your account access.';
    case 'SIGNUP_UNAVAILABLE': return 'Account creation is unavailable right now. Ask the preview owner for help.';
    case 'ATTRIBUTES_REJECTED': return 'We couldn’t accept these account details. Ask the preview owner for help and include the reference below.';
    case 'NETWORK_RESULT_UNKNOWN':
    case 'DELIVERY_UNCONFIRMED': return 'We couldn’t confirm whether your account was created. If you received a code, enter it below. Otherwise, ask the preview owner for help before trying again.';
    case 'INVALID_CODE':
    case 'CODE_REJECTED': return 'The verification code was not accepted. Check the code and try again.';
    case 'CODE_EXPIRED': return 'This code has expired. Go back to sign in, choose “Still need to verify your email?”, then request a new code.';
    case 'RATE_LIMITED': return 'Too many requests were made. Wait before trying again.';
    case 'PROVIDER_UNAVAILABLE': return 'The registration service is temporarily unavailable. Try again later.';
    default: return 'We couldn’t complete registration. Ask the preview owner for help and include the reference below.';
  }
}

export function EmailRegistration({ config, startOpen = false, onClose, onSignIn }: { config: CognitoBrowserConfig; startOpen?: boolean; onClose?: () => void; onSignIn?: () => void }) {
  const [stage, setStage] = useState<'closed' | 'details' | 'verify' | 'complete'>(startOpen ? 'details' : 'closed');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (stage !== 'closed') heading.current?.focus(); }, [stage]);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const submitting = useRef(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [diagnostic, setDiagnostic] = useState<RegistrationDiagnostic | null>(null);
  async function submit() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true); setMessage(''); setDiagnostic(null);
    try {
      if (stage === 'details') {
        await requestEmailRegistration(config, { username: username.trim(), email: email.trim(), password });
        setUsername(username.trim()); setPassword(''); setEmail(''); setStage('verify');
        setMessage('Check your email for a six-digit verification code.');
      } else if (stage === 'verify') {
        await confirmEmailRegistration(config, username, code);
        setCode(''); setUsername(''); setStage('complete');
        setMessage('Email verified. You can now sign in.');
      }
    } catch (error) {
      const observed = asRegistrationFailure(error, stage === 'verify' ? 'confirmation' : 'signup').diagnostic;
      setDiagnostic(observed); setMessage(recoveryText(observed.code));
      console.info('Known Enough registration diagnostic', { environment: config.userPoolId, ...observed });
    }
    finally { submitting.current = false; setBusy(false); }
  }
  if (stage === 'closed') return <button type="button" className="secondary ke-auth-link" disabled={busy} onClick={() => setStage('details')}>Create account</button>;
  return <section className="ke-registration ke-auth-form" aria-label="Email registration">
    <h2 ref={heading} tabIndex={-1}>{stage === 'details' ? 'Create your account' : stage === 'verify' ? 'Verify your email' : 'Account created'}</h2>
    <p className="ke-auth-intro">{stage === 'details' ? 'Create an account to join your group’s decisions.' : stage === 'verify' ? 'Check your inbox and enter the six-digit code.' : 'Your email is verified. Sign in to continue.'}</p>
    {stage !== 'complete' && <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <fieldset disabled={busy} aria-busy={busy}>
        {stage === 'details' ? <>
          <label htmlFor="register-username">Username</label><input id="register-username" value={username} required maxLength={128} autoComplete="username" onChange={event => setUsername(event.target.value)} />
          <label htmlFor="register-email">Email</label><input id="register-email" type="email" value={email} required maxLength={320} autoComplete="email" onChange={event => setEmail(event.target.value)} />
          <label htmlFor="register-password">Password</label><PasswordField id="register-password" value={password} minLength={MIN_REGISTRATION_PASSWORD_LENGTH} maxLength={256} autoComplete="new-password" disabled={busy} onChange={setPassword} describedBy="register-password-help" />
          <p id="register-password-help" className="ke-auth-help">At least 8 characters, including an uppercase letter, a lowercase letter, a number and a symbol.</p>
        </> : <><label htmlFor="register-code">Verification code</label><input id="register-code" value={code} required pattern="[0-9]{6}" maxLength={6} inputMode="numeric" autoComplete="one-time-code" onChange={event => setCode(event.target.value)} /></>}
        <button type="submit">{stage === 'details' ? 'Create account' : 'Verify email'}</button>
        {busy && <LoadingSkeleton kind="inline" label={stage === 'details' ? 'Creating your account' : 'Verifying your email'} />}
      </fieldset>
    </form>}
    {stage === 'details' && diagnostic && ['ACCOUNT_EXISTS_OR_PENDING', 'NETWORK_RESULT_UNKNOWN', 'DELIVERY_UNCONFIRMED'].includes(diagnostic.code) && username.trim()
      && <button type="button" className="secondary ke-auth-link" disabled={busy} onClick={() => { setUsername(username.trim()); setPassword(''); setEmail(''); setDiagnostic(null); setMessage('Enter the code sent to your email.'); setStage('verify'); }}>I have a verification code</button>}
    {stage === 'verify' && <button type="button" className="secondary ke-auth-link" disabled={busy} onClick={() => { setCode(''); setDiagnostic(null); setMessage(''); setStage('details'); }}>Back to account details</button>}
    <button type="button" className="secondary ke-auth-link" disabled={busy} onClick={() => { setPassword(''); setEmail(''); setUsername(''); setCode(''); setDiagnostic(null); setMessage(''); setStage('closed'); if (stage === 'details' && onSignIn) onSignIn(); else onClose?.(); }}>{stage === 'details' && onSignIn ? 'Back to sign in' : 'Close registration'}</button>
    {stage === 'complete' && onSignIn && <button type="button" disabled={busy} onClick={onSignIn}>Sign in</button>}
    {stage !== 'complete' && onSignIn && diagnostic && ['ACCOUNT_SETUP_UNAVAILABLE', 'EMAIL_ALREADY_LINKED'].includes(diagnostic.code)
      && <button type="button" disabled={busy} onClick={onSignIn}>Sign in</button>}
    {message && <p role="status">{message}</p>}
    {diagnostic && <p className="ke-help">Reference: {diagnostic.code} at {diagnostic.observedAt}
      {diagnostic.httpStatus ? ` (HTTP ${diagnostic.httpStatus})` : ''}{diagnostic.requestId ? ` (request ${diagnostic.requestId})` : ''}.</p>}
  </section>;
}
