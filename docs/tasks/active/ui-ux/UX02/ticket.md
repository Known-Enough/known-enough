# UX02 — Fix the basic usability problems

**Coding-first scheduling — user direction, 2026-10-06:** The coding phase follows the checked coding checkpoint of UX01, not deferred administrator installation. Fix and test verified usability issues before administrator setup; preserve current backend behavior and privacy. Follow [the current two-phase queue](../../../../coding-first-plan.md); record CODE_READY and release a checked claim if mandatory cloud proof remains, without calling the whole task DONE. Older administrator-first scheduling dependencies below are superseded; original technical acceptance remains. No new worker or active claim is created by this update.

- Status: BLOCKED / unclaimed until UX01 coding checkpoint; then coding phase eligible. Administrator installation/required managed acceptance deferred to final cloud phase.
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


## B UX02 claim — 2026-10-07T00:06:21.702133+00:00

IN_PROGRESS/B sole task after UX01 CODE_READY release; own Battosai1806/main origin78d831c verified. Scope apps/web/src/email-registration-form.tsx, connected-app.tsx, group-home.tsx, group-decisions.tsx, style.css; necessary tests/e2e and UX02 safe evidence/tracking. No backend/config/IAM/lockfile changes. Preserve min8/allclasses under latest cancellation. Actual root variant/effort unavailable; no helper. A NP00 paused/saved unchanged.


## UX02 local checkpoint — 2026-10-07T00:07:25.531378+00:00

IN_PROGRESS/B. Create account action, cancel/close clears sensitive form values, concise staged guidance, optional provider/display explanation and consistent fieldset CSS implemented locally. Current min8/allclasses preserved; provider completion remains UNKNOWN. Four focused registration checks PASS after initial1FAIL/3PASS caught first-tab regression; optional details moved after primary actions, retry4PASS. Remaining crowded core navigation, rendered before/after and pinned full check. No source commit/push/deployment until required checks; local work preserved.


## UX02 run100 local checkpoint — 2026-10-07T00:37:19.515587+00:00

IN_PROGRESS/B. Loaded decision heading focus added; synthetic desktop/other-owner/CSSzoom2 capture PASS overflow/privacy, root visual inspection. Lint/types PASS; pinned full npmcheck currently running session41688/log /tmp/ke-run100/full.log, inspect no duplicate. Remaining navigation and first-use after evidence; local uncommitted source preserved, no cloud/push.


## UX02 checked coding milestone — 2026-10-07T01:14:26.952828+00:00

REVIEW / CODE_READY; release B claim at synchronized checkpoint. Five UX01 findings mapped to fixes/deferred hosted proof in docs/review-artifacts/UX02/fix-map.md. Clear Create account/cancel recovery, shorter guidance, consistent fieldset, compact membership and loaded heading focus implemented. Provider completion/config and realbrowserzoom remain deferred, not DONE/live PASS. Pinned final full check PASS: refs7/planning/lint/boundaries/types,784app(two optional skips),build,hosted1,browser62. Initial final attempt61PASS/1FAIL assumed membership always visible; updated actual navigation check, rerunfullPASS. Next UX03 source-matching deployment proof; A NP00 paused/saved preserved.
