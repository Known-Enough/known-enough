# INV01 — Dashboard group invitations

Status: CODE COMPLETE / publication blocked by the installed job-control transition guard; not deployed or user-tested.

## Goal

Let an organizer invite an existing approved Known Enough account using its login username or verified email. Show each recipient's pending invitations on their own main dashboard and let them explicitly accept.

## Requirements

- Keep the invitation organizer-only, recipient-bound, expiring and replay-safe. The server resolves username/email to a verified account; request fields never select a subject or email hash.
- Keep usernames, email addresses, hashes and invitation capability tokens out of group snapshots and logs. Return only a recipient-owned invitation summary.
- A recipient sees the group name, organizer display name and expiry, and accepts explicitly. Accepting only joins the group; it does not confirm answers or approve a proposal.
- Preserve copy-link acceptance for the existing recipient-bound token flow and existing invitation replacement behavior.
- Keep current membership, decision-version, privacy, and identity checks. Do not expose a directory/search endpoint for account enumeration.

## Changed source

The current local implementation adds a private username hash directory entry, recipient-owned pending invitation summaries, an authenticated `GET /invitations` projection, username/email issue handling, and dashboard acceptance. API/IAM source policies include the new username directory key prefix. See source diff and focused checks at handoff.

## Acceptance

Use two existing synthetic accounts. Invite by username and by email in separate groups; verify only the addressed account sees each item; accept from its dashboard; confirm the group appears and the invitation disappears. A wrong account cannot list or accept another recipient's invitation. Check the original copy-link path, expiry/replacement, and that invitation payloads contain no login/email/hash/token data. Confirm accepting does not confirm or approve any decision.

No live publication or end-user acceptance is claimed until recorded with exact source and route readback.

## Publication checkpoint — 2026-10-16

- Source committed to `main` as `364fb4070bdccc2cd24ff39032a9fed7ebc5fdd6` (subsequent documentation and safe publisher investigation commits followed).
- Local lint, typecheck, production build, four API/adapter suites (177 tests), focused feature suites (96 tests), and existing API-release guard checks passed.
- The legacy profile API publisher is incompatible with the installed `api.handler`; it was not used for deployment.
- The correct coordinated jobs/API package prepared successfully, including a new matching worker archive while the EventBridge worker rule remained disabled. Its read-only preflight refused publication with `DISABLE_AND_RESOLVE_QUEUE_BEFORE_CODE_PUBLICATION`.
- Matching readback confirmed the installed model-job control is `enabled: true`, `active: 0`, `slots: 0`, source `23822677f4b8e9ffd43e09b3971844b2673a78af`. Cumulative totals were read only. No API/worker code, route, or control write occurred in the coordinated attempt.
- Preserve the current control state and worker schedule. Before release, decide a guarded temporary pause/rebind/restore that leaves admission enabled and the EventBridge schedule disabled at the end. Until that is implemented and read back, E2E02 remains NOT STARTED and end-user readiness is not established.
