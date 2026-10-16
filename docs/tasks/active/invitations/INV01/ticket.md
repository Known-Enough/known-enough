# INV01 — Dashboard group invitations

Status: IN_PROGRESS / implementation underway, not published or user-tested.

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
