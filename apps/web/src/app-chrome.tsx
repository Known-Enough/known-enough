export function Brand() {
  return <span className="ke-brand"><svg aria-hidden="true" viewBox="0 0 32 32" fill="none">
    <rect width="32" height="32" rx="10" fill="currentColor" />
    <path d="M9 10v12m14-12-9 6 9 6" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg><span>Known Enough</span></span>;
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
