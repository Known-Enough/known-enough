import { useState } from 'react';

/** Shared presentation only; authentication and validation stay with the caller. */
export function PasswordField({ id, value, onChange, disabled, autoComplete, minLength = 8, maxLength, describedBy }: {
  id: string; value: string; onChange: (value: string) => void; disabled: boolean;
  autoComplete: 'current-password' | 'new-password'; minLength?: number; maxLength?: number; describedBy?: string;
}) {
  const [visible, setVisible] = useState(false);
  return <div className="ke-auth-input ke-auth-password">
    <svg className="ke-auth-field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
    <input id={id} type={visible ? 'text' : 'password'} value={value} onChange={event => onChange(event.target.value)}
      autoComplete={autoComplete} required minLength={minLength} maxLength={maxLength} disabled={disabled} aria-describedby={describedBy} />
    <button type="button" className="secondary ke-password-toggle" aria-label={visible ? 'Hide password' : 'Show password'}
      aria-controls={id} aria-pressed={visible} disabled={disabled} onClick={() => setVisible(!visible)}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{visible && <path d="m3 3 18 18" />}</svg>
    </button>
  </div>;
}
