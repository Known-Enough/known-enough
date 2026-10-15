# FF01 — Premium registration and sign-in UI

Status: READY / unclaimed
Intended worker: B, at the next eligible idle intake after the current claim.
Scope: focused frontend styling, authentication presentation and navigation only. Preserve Cognito authentication, validation, security, password recovery and verification. Avoid unrelated refactoring, new dependencies and AWS changes. This extends the existing FIX03 UI rather than replacing its authentication implementation.

## Registration

- Use a centered card approximately 480–520px wide, responsive on small screens, with tighter vertical spacing.
- Keep “Decide together.” above the form, with a smaller balanced heading and muted subtitle.
- Refine username, email and password inputs: consistent heights, rounded borders, accessible labels and clear focus states.
- Add an accessible show/hide password icon and concise requirements matching the actual existing password policy. Do not weaken or change that policy.
- Use a prominent dark-green “Create account” action.
- Replace the oversized cancel button with a subtle “Back to sign in” text link while preserving navigation behavior.
- Keep the compact collapsible privacy notice beneath the form, with all existing privacy information.

## Sign-in

- Match registration with a compact centered card around 480px, balanced spacing and consistent typography/inputs.
- Username and password fields use subtle Lucide icons if already available; otherwise reuse existing icons without adding a dependency. Place a small accessible visibility toggle inside the password field.
- One prominent dark-green “Sign in” action.
- Present “Forgot password” as a small text link below the password field, preserving the recovery flow.
- Remove “Enter verification code” from the default form. Show verification as a dedicated contextual step when required; preserve a discreet route to confirm an existing unverified account.
- Replace the oversized Back button with a subtle text link.
- Include “Don't have an account? Create one” where appropriate, linking only to the existing app registration flow. This latest user direction supersedes the earlier request to omit all signup navigation; do not reintroduce the broken hosted signup route or a second registration implementation.
- Improve validation/error presentation, keyboard focus and browser autofill styling in light/dark modes. Preserve safe error references and prevent duplicate submissions.
- Keep the compact collapsible privacy notice below the form.

## Completion and handoff

Both screens should share consistent alignment, responsive sizing, polished light/dark colors and accessible labels, focus and toggle states. Existing sign-in, registration, confirmation, resend, forgotten-password and back/close navigation must remain reachable. Do not expose passwords or verification codes in logs.

Record changed files, publication status, known limitations and a short manual checklist for the user covering both themes and mobile sizing, registration/confirmation, sign-in, verification recovery and password reset. The user's current A-chat instruction is no agent testing; do not dispatch tests from A for task preparation. B follows its applicable session instructions and records actual checks honestly; source readiness and publication are separate milestones. Never claim a test or live result that was not performed.

No code, test, deployment, AWS configuration or worker dispatch was performed when creating this task. Preserve the existing B claim and schedule.


2026-10-15 user-directed takeover: IN_PROGRESS/A, auth presentation only; no tests, user manual acceptance after build/publication. Preserve existing auth functionality.

FF01 implementation checkpoint: compact auth forms/password toggle/contextual verification and recovery links implemented. Build completed, tests intentionally not run. Publication and user manual review pending.

2026-10-15 FF01/A publication complete: source7fc3786, GitHub38761806414 SUCCESS/Amplify95. Tests not run at user direction; manual acceptance pending. A releases implementation claim and continues FF02.
Manual check: sign out, open Create account and Sign in; check narrow/mobile layout, both themes, password eye buttons, Back/Create one, discreet existing-account verification and password reset.
