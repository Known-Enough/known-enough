# UX02 verified finding-to-fix map

UX01's five findings are recorded in ../UX01/first-use-review.md and ../UX01/core-journey-review.md. Current local implementation:

1. Alternate provider signup ambiguity: app action is Create account, distinct from Sign in; optional provider/display guidance explains returning for email registration. Hosted provider completion remains UNKNOWN/deferred to ASSESS11/UX03; no provider configuration mutation or live PASS.
2. Missing close/stale instruction: Cancel account creation/Close registration clear username/email/password/code/diagnostic, disabled during in-flight request; no stale “below” instruction. Focused cancel check verifies no request and cleared password on reopen.
3. Dense entry guidance: short sign-in/account/verification steps; secondary display/provider details are expandable after primary actions. Sign in retains first keyboard focus.
4. Fieldset inconsistency: shared grid spacing, borderless fieldset, consistent existing form controls. No design system introduced.
5. Crowded core navigation: membership controls under explicit expandable summary; loaded shared decision heading receives focus; saved draft action accurately says Review saved decision draft. Draft recovery remains distinct and available because draft/decision mapping is not safely inferred from snapshots. Further wholesale navigation redesign deferred beyond basic scope.

Before: ../UX01/phone-registration.png, ../UX01/desktop-private.png. After: registration-390.png, registration-1280.png, entry-390.png, entry-1280.png, desktop-private.png and desktop-zoom-private.png. Actual local headless Chromium, synthetic signed API and independent owner/other contexts, no account submission/paid/email/cloud. Root visually inspected phone registration and desktop; CSS zoom2 is simulation. Three core captures no overflow/raw leakage, owner question absent for other participant. Capture helper closed contexts/browser/API/owned Vite. Full check status recorded in task/log; no screenshot proves live acceptance.
