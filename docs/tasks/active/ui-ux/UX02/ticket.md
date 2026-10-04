# UX02 — Fix the basic usability problems

- Status: BLOCKED / unclaimed; prerequisite UX01 complete.
- Direct worker: next eligible worker; current routing B. Select/report actual model and effort at claim. One direct worker implements; no helper writes or parallel project task.
- Scope: only verified UX01 basics in existing `apps/web/` screens/styles and necessary focused browser checks, safe UX02 evidence and tracking. Record exact files before editing. Backend contracts/IAM/root config/lockfiles/new features require their own explicit bounded scope; never silently widen this task.

## Implement

**First fixes — user direction recorded 2026-10-04 UTC:** Apply UX01's verified signup/first-use findings, reusing ASSESS11's completed functional work. Make account creation and sign-in unambiguous; prefer clear **Sign in** and **Create account** actions when separate flows remain. Check the provider's visible **Sign up** path as well as the app's form; do not merely rename one button while leaving a misleading or broken alternate path. Provider configuration changes belong to a specifically coordinated, authorized scope, not an app CSS workaround.

Improve the existing CSS and component consistency where review shows a problem: shared spacing/type/color rules, aligned form fields, readable help/error text, consistent buttons and loading/disabled/focus states, and phone layouts. Remove redundant same-purpose controls, repeated instructions and duplicated presentation code where a shared component/style fits. Preserve genuinely different participant/shared-display roles and necessary verification/admission steps; simplifying the screen must not merge their authority. Record visual before/after evidence and check that a newcomer knows what to click next.

Reuse ASSESS11's user-requested simple password rules: at least six characters, no mandatory capitals/numbers/symbols. Ensure displayed help and validation agree with the verified service policy; remove remaining sixteen-character/mixed-class instructions when the new policy is implemented. Check both signup paths and clear recovery messages. This task does not reapply or widen a cloud policy itself; retain ASSESS11's actual fix/readback evidence.

Fix core-flow blockers first: clear labels and next actions, owner/private/shared distinctions, independent confirmations/disclosure/final approval, understandable progress and recovery messages. Include invitation/empty states, login expiry, outdated changes, keyboard focus and phone-sized overflow/controls where the review establishes a problem. Show only genuine server-confirmed progress; UI wording or animations cannot claim a saved result.

Preserve owner authorization, hard-condition confirmation, refusal without pressure, exact version/context approval, disclosure boundaries and spending/CLEAN gates. A retry must not create another decision, consent or charge. Keep developer/AWS/model/policy details out of ordinary user flows except when needed for a meaningful decision. No new feature, design system, visual rebrand or cloud provisioning is part of basic polish.

## Completion

Each required UX01 finding links to a verified fix and before/after evidence; any deferred minor finding has an explicit reason. Signup/first-use checks verify every affected visible entry action and the clear next step; inspect actual rendered desktop/phone CSS, repeated controls/content and keyboard behavior. Local/provider-mocked checks do not establish a real hosted signup PASS; deployed proof remains with ASSESS11/UX03. Run meaningful focused checks for behavior changes and pinned `npm run check`; use visual inspection and existing checks for simple styling/text changes rather than implementation-mirroring tests. Maintain own log/handoff, update the board and synchronize checked source with `[skip ci]`.

Repository synchronization is not publication. UX03 owns the later matching deployed proof; do not consume a live test or deploy merely because source is pushed. This ticket adds no AWS, paid-model/email, participant or budget authorization.
