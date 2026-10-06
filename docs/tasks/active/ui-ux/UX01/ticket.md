# UX01 — Review screens and the participant journey

**Coding-first scheduling — user direction, 2026-10-06:** The coding phase follows the checked coding checkpoint of ASSESS10, not deferred administrator installation. Review the existing screens and participant journeys before OPS installation; produce the named bounded review and actionable issues. Follow [the current two-phase queue](../../../../coding-first-plan.md); record CODE_READY and release a checked claim if mandatory cloud proof remains, without calling the whole task DONE. Older administrator-first scheduling dependencies below are superseded; original technical acceptance remains. No new worker or active claim is created by this update.

- Status: BLOCKED / unclaimed until ASSESS10 coding checkpoint; then coding phase eligible. Administrator installation/required managed acceptance deferred to final cloud phase.
- Origin: user's 2026-10-03 request to finish the basics and add UI/usability reviews after OPS.
- Direct worker: next eligible worker; current routing B. Record actual model/effort and bounded scope at claim; files do not switch models.
- Review helpers: user direction recorded 2026-10-04 UTC requires one `gpt-6-luna` / medium helper for the first signup/first-use screen review; at most three bounded read-only reviews total inside this one claimed task, per the [roadmap](../../../../basic-completion-plan.md). Report actual helper/model and observations. No helper edits, independent claims, deployments, paid runs or external messages. This ticket prepares that future review; no helper starts before UX01 is eligible and claimed.
- Scope: screen/journey inspection and sanitized findings under `docs/review-artifacts/UX01/`, this ticket, shared board and own log/handoff. No executable change, redesign or cloud operation.

## Review

### First review: signup and first use

Start with the user's reported path: **Sign in or register** → provider page with **Sign up**, competing with **Register with email** in the app. This is the first priority finding to verify, not a speculative defect list. [ASSESS11](../../live-testing/ASSESS11/ticket.md) owns the urgent functional fix before OPS; inspect its actual outcome and record only remaining problems or regressions. Do not reopen a proven fix or assume that the provider's signup screen must be invalid.

The required first Luna helper inspects the rendered first-use screens on desktop and a phone-sized viewport, including the provider page where reachable without submitting personal details. It checks whether a newcomer can clearly distinguish **Sign in**, **Create account**, verification and shared-display access, choose a working path, and recover/back out. Inventory visible actions and repeated instructions/forms; keep distinct participant/display authority clear. Every visible signup path must work or have a supported correction; app CSS cannot change a separately hosted provider page. Record any unavailable page as UNKNOWN.

The user reports both hosted signup and in-app email registration failing; [safe evidence](../../../../review-artifacts/ASSESS11-user-signup-failures.json) includes the screenshot's generic error. Verify both ASSESS11 outcomes and its requested simple-password policy: minimum6, no mandatory character classes, accurate matching help/error text. Do not infer a bad password from a generic failure or claim that isolated QA signup establishes the primary user's path. The review must show where a user gets a useful recovery step rather than another ambiguous error.

Inspect visual consistency in the same pass: spacing, alignment, typography, colors/contrast, button hierarchy, form labels, validation/help text, empty/loading/error states, focus and phone overflow. Identify repeated controls/content or inconsistent CSS that makes the next step unclear. Prefer existing shared styles/components and a short concrete before/after recommendation over a new design system. This is a read-only screen review; the direct worker verifies and deduplicates findings for UX02.

Inspect entry/signup/login, groups/invitations, public draft/clarification, owner-private input/confirmation, negotiation/refusal, disclosure and final approval. Use at least two distinct synthetic participant sessions to compare private and shared surfaces; do not equate test identities with verified human A/B. Include refresh, expired login, empty/loading/error/retry states and rejected/outdated actions.

Inspect current desktop and phone-sized layouts, zoom, keyboard navigation, focus, labels and readable status messages. Separate viewport simulation from an actual device/browser test; name what ran. Reviews may use local synthetic data without spending a live allowance, but cannot establish cloud/B execution or live acceptance that way.

Each actionable finding needs its screen, exact steps, expected/observed behavior, impact and safe screenshot or reproduction evidence. Prioritize blocked completion, misleading authority/privacy and unusable controls first; minor decoration is optional. Never include real personal data, private test login material or secret URLs in screenshots/logs. Helpers return at most five actionable findings each; the direct worker deduplicates and verifies them before recording a single list.

## Completion

One prioritized verified issue list links every affected screen to UX02; observed existing behavior is labeled accurately and any coverage gap remains explicit. The first Luna review has actual screen evidence, an entry-action inventory, the ASSESS11 outcome check and a deduplicated list of navigation/visual issues. Required core screens, participant-view differences and desktop/phone/keyboard checks have actual evidence. No implementation or live PASS is claimed by this review. Update own log/handoff and shared status; verify documentation links/reference hashes/task consistency, then synchronize to `origin main` with `[skip ci]`.
