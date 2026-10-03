# UX01 — Review screens and the participant journey

- Status: BLOCKED / unclaimed; prerequisite OPS03 complete under the shared queue.
- Origin: user's 2026-10-03 request to finish the basics and add UI/usability reviews after OPS.
- Direct worker: next eligible worker; current routing B. Record actual model/effort and bounded scope at claim; files do not switch models.
- Optional review helpers: `gpt-6-luna` / medium; at most three bounded read-only reviews inside this one task, per the [roadmap](../../../../basic-completion-plan.md). No helper edits, independent claims, deployments, paid runs or external messages.
- Scope: screen/journey inspection and sanitized findings under `docs/review-artifacts/UX01/`, this ticket, shared board and own log/handoff. No executable change, redesign or cloud operation.

## Review

Inspect entry/signup/login, groups/invitations, public draft/clarification, owner-private input/confirmation, negotiation/refusal, disclosure and final approval. Use at least two distinct synthetic participant sessions to compare private and shared surfaces; do not equate test identities with verified human A/B. Include refresh, expired login, empty/loading/error/retry states and rejected/outdated actions.

Inspect current desktop and phone-sized layouts, zoom, keyboard navigation, focus, labels and readable status messages. Separate viewport simulation from an actual device/browser test; name what ran. Reviews may use local synthetic data without spending a live allowance, but cannot establish cloud/B execution or live acceptance that way.

Each actionable finding needs its screen, exact steps, expected/observed behavior, impact and safe screenshot or reproduction evidence. Prioritize blocked completion, misleading authority/privacy and unusable controls first; minor decoration is optional. Never include real personal data, private test login material or secret URLs in screenshots/logs. Helpers return at most five actionable findings each; the direct worker deduplicates and verifies them before recording a single list.

## Completion

One prioritized verified issue list links every affected screen to UX02; observed existing behavior is labeled accurately and any coverage gap remains explicit. Required core screens, participant-view differences and desktop/phone/keyboard checks have actual evidence. No implementation or live PASS is claimed by this review. Update own log/handoff and shared status; verify documentation links/reference hashes/task consistency, then synchronize to `origin main` with `[skip ci]`.
