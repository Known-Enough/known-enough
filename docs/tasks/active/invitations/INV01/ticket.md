# INV01 — Group invitations and recipient inbox

Status: PUBLISHED — recipient inbox/layout and existing-account username recovery; user manual acceptance pending. Fresh runtime permission readback is INSTALLED. No new CloudShell setup is required for this repair.

## Goal

Inside each group, let its organizer invite an existing approved Known Enough account using its login username or verified email. The main Groups page shows only invitations sent to the signed-in recipient, with explicit acceptance; it has no invitation-sending form.

## Requirements

- Keep the invitation organizer-only, recipient-bound, expiring and replay-safe. The server resolves username/email to a verified account; request fields never select a subject or email hash.
- Keep usernames, email addresses, hashes and invitation capability tokens out of group snapshots and logs. Return only a recipient-owned invitation summary.
- A recipient sees the group name, organizer display name and expiry, and accepts explicitly. Accepting only joins the group; it does not confirm answers or approve a proposal.
- Remove the replacement/lost-link checkbox from the UI. Send the existing non-replacing request (`replace: false`); preserve server expiry/replay safeguards and recipient-bound link acceptance. An optional private link stays collapsed inside the group after a successful send.
- Keep current membership, decision-version, privacy, and identity checks. Do not expose a directory/search endpoint for account enumeration.

## Changed source

The current local implementation adds a private username hash directory entry, recipient-owned pending invitation summaries, an authenticated `GET /invitations` projection, username/email issue handling, and dashboard acceptance. API/IAM source policies include the new username directory key prefix. See source diff and focused checks at handoff.

## Acceptance

Use two existing synthetic accounts. Confirm the main Groups page shows Invitations for you (with accurate empty/error states) and no sending form. Open each group to send by username and by email, without any replacement checkbox; verify only the addressed account sees each item; accept from its dashboard; confirm the group appears and the invitation disappears. A wrong account cannot list or accept another recipient's invitation. Check the original copy-link path, expiry/replacement, and that invitation payloads contain no login/email/hash/token data. Confirm accepting does not confirm or approve any decision.

No live publication or end-user acceptance is claimed until recorded with exact source and route readback.

## Publication checkpoint — 2026-10-16

- Source committed to `main` as `364fb4070bdccc2cd24ff39032a9fed7ebc5fdd6` (subsequent documentation and safe publisher investigation commits followed).
- Local lint, typecheck, production build, four API/adapter suites (177 tests), focused feature suites (96 tests), and existing API-release guard checks passed.
- The legacy profile API publisher is incompatible with the installed `api.handler`; it was not used for deployment.
- The correct coordinated jobs/API package prepared successfully, including a new matching worker archive while the EventBridge worker rule remained disabled. Its read-only preflight refused publication with `DISABLE_AND_RESOLVE_QUEUE_BEFORE_CODE_PUBLICATION`.
- Matching readback confirmed the installed model-job control is `enabled: true`, `active: 0`, `slots: 0`, source `23822677f4b8e9ffd43e09b3971844b2673a78af`. Cumulative totals were read only. No API/worker code, route, or control write occurred in the coordinated attempt.
- Preserve the current control state and worker schedule. Before release, decide a guarded temporary pause/rebind/restore that leaves admission enabled and the EventBridge schedule disabled at the end. Until that is implemented and read back, E2E02 remains NOT STARTED and end-user readiness is not established.

## Deployment and permission checkpoint — 2026-10-16

- Guarded coordinated publication succeeded at [run 38963203435](https://github.com/Known-Enough/known-enough/actions/runs/38963203435): API source `2e5902f44f10f2b68dd3f7905a79ba4c8b7aa95c`, API SHA `9b0badc58d00d3855735bc36cd300ccff6710486510f243d2f357236a1e81a87`, worker SHA `1d20b9a783134d2321d3d0a380bcdf15a81057f5118ea03b7d33774c9dc06cf8`. Admission was restored enabled, totals remained unchanged, schedule stayed disabled, provider calls were zero.
- Frontend Amplify job `111` and route reconciliation succeeded in [run 38963388395](https://github.com/Known-Enough/known-enough/actions/runs/38963388395). Read-only route inspection confirmed `GET /invitations` and `POST /groups/{groupId}/invitations` use JWT; `OPTIONS /invitations` uses NONE.
- Public staging smoke passed after refreshing stale expected asset/heading evidence in [run 38964421870](https://github.com/Known-Enough/known-enough/actions/runs/38964421870). This proves public loading and access-denial checks only; it does not prove authenticated invitation behavior.
- Read-only runtime IAM inspection found no `USERNAME#*`-scoped read or conditional write in `KnownEnoughStageApiRole`. The current `KnownEnoughPartitionParticipant` policy matched baseline SHA `a5c483ca534d34c864543dcebe47cb27657090143a9968932c7a1a645bc70abd`; candidate SHA `95f21ec3a40bd3ef06aabe34907f0304c18002f2d2ac79b4de5f323c68a6aaa5` adds only `USERNAME#*` to the existing scoped partition read/transactional commit statements.
- The guarded policy write attempt [run 38964718851](https://github.com/Known-Enough/known-enough/actions/runs/38964718851) was denied as `iam:put-role-policy/AccessDenied`; `iamWrites: 0`. Independent readback confirmed the candidate was not installed. No IAM change occurred.
- E2E02 remains NOT STARTED under its prerequisite. To complete the narrowly scoped permission repair using the operator's existing same-account CloudShell identity, run `python3 -B scripts/operations/invitation-username-policy.py --cloudshell` from the checked repository at `main`. The script checks the exact prior policy hash, saves mode-0600 prior/candidate files, submits one update, and verifies exact readback; it refuses drift. Then rerun the shared staging inspection and E2E02.


## A dashboard hotfix — 2026-10-16

User evidence: account/groups loading reached HTTP 200, the supplied group snapshots match the shared schema, and no `/invitations` request appeared. Confirmed source defect: `cognitoApiFetch` had not added `/invitations` to its exact client route allowlist, although the new dashboard calls that route after loading groups. Its local `Invalid API path` exception happened before fetch, while the catch retained the groups stage/HTTP200 and mislabeled it RESPONSE_FORMAT.

A's bounded fix adds only that exact path, preserves all existing target/session/path checks, and isolates optional invitation reads so a failure shows an explicit retry notice while validated groups remain usable. Invitation diagnostics set their own stage/status before fetch and distinguish CLIENT_PATH_BLOCKED without logging identity, payloads or tokens. Group/account schema errors remain strict; no fake empty group list or validation bypass.

Pinned Node24.21.0 TypeScript, changed-source lint and production build passed. No application/unit/browser/live tests or model/participant actions were run. Frontend-only publication is next; backend/table/IAM setup and the separate USERNAME permission gap are unchanged. Current E2E02 results remain unverified and must identify the actual frontend version.


The dashboard hotfix is now published: frontend source `75becd1f8ce36bbb3df64c5aac6689eaa7513a43`, Amplify job **112**, [run38977439627](https://github.com/Known-Enough/known-enough/actions/runs/38977439627) SUCCESS. All seven public files matched their release hashes. [Sanitized receipt](../../../../review-artifacts/INV01/groups-dashboard-publication.json). Configuration/data/provider writes were zero; installed API hash `9b0badc58d00d3855735bc36cd300ccff6710486510f243d2f357236a1e81a87` is unchanged. A's bounded hotfix claim is released; user manual acceptance and later authenticated E2E proof remain pending. This publication does not establish that the separate username-directory IAM command was applied. No new test agent or schedule was started.


## User-directed invitation placement — 2026-10-16

Main Groups is a recipient inbox: an always-visible Invitations for you section contains pending invitations, a truthful empty state, or its own load-error/retry notice. Sending exists only inside the selected group for its organizer, with username/email and Send invitation. The group selector and sending card have been removed from the dashboard. The lost-link checkbox/state and obsolete replacement copy are removed. Existing server requests keep `replace: false`; no silent invitation replacement is introduced. A returned private link remains available only in a collapsed group-local fallback so existing copy-link behavior is preserved.

UI/CSS-only change; no API/IAM/storage/schema or real participant action. Static compilation/build allowed, no tests or AI calls; frontend publication and user manual acceptance follow separately.


Placement publication completed on source `3e98c274544be9605468aa2317b311a914d60fad`, Amplify **113**, [run38978248451](https://github.com/Known-Enough/known-enough/actions/runs/38978248451) SUCCESS. [Receipt](../../../../review-artifacts/INV01/invitation-placement-publication.json) records seven verified public file hashes and zero configuration/data/provider writes. API remains `9b0badc58d00d3855735bc36cd300ccff6710486510f243d2f357236a1e81a87`. A claim released; user manual acceptance is pending, not inferred from publication. No tests, invitations or AI calls were executed; the separate historical IAM gap is not reclassified by this UI release.


2026-10-16T22:57:13.601698+00:00 — INV01/A invitation-send repair claimed at direct user request for reference41aac2b2-6753-4ef3-b5df-5dac692fe347, username recipient. Scope existing scoped policy repair/helper/workflow, safe invitation diagnostics/error presentation only if evidenced, and INV01/A records. Read-only exact-reference log query38978646627 returned no matches; installed native invite routes lack the diagnostic events, so this is not proof of no failure. Fresh IAM readback next; do not infer old CloudShell repair applied. No tests/model/provider/participant actions or automatic invitation retries; preserve recipient identity/admission/expiry/replay and current API/runtime. A sole bounded repair writer; no new chat/monitor/B dispatch.


2026-10-16T23:02:45.855813+00:00 — INV01/A missing-username repair CODE_READY. User-supplied failed response is NOT_FOUND/404/reference33265ee5. Fresh inspector38978757882 proves runtime USERNAME permission installed (95f21ec3…). Private recipient inspection38979132054 proves provider confirmed/enabled/verified, app APPROVED/saved username matching, and missing USERNAME directory via complete key-only catalog. Migration role's direct USERNAME read is denied; runtime is correctly scoped, no new IAM needed. Root: insert-only directory compiler never registered existing accounts. Own-account status/verified registration now atomically ensure the missing immutable lookup with account revision and exact-owner conflict checks; existing correct claims are condition-checked, never overwritten. Added native invitation result/failure UUID logs with finite categories only, diagnostic reader support, and specific 404 guidance. No raw identity/token logs. Pinned type/lint/build PASS, Python syntax parsed; no tests, model calls or participant/invitation actions. Compatible runtime/frontend publication next; recipient's first own account refresh completes the lazy backfill. [Diagnosis](../../../../review-artifacts/INV01/username-lookup-diagnosis.json).


2026-10-16T23:06:29.792301+00:00 INV01/A username-lookup repair PUBLISHED / A claim released — source40ec579/API6f2bff59/worker715f8462/frontendAmplify114. [Runtime38979307088](https://github.com/Known-Enough/known-enough/actions/runs/38979307088) and [frontend38979456558](https://github.com/Known-Enough/known-enough/actions/runs/38979456558) SUCCESS; seven public files verified, admission restored enabled/matching, totals unchanged, worker scheduleDISABLED. Fresh diagnosis confirms recipient APPROVED/verified but missing USERNAME lookup; existing runtime permission is installed, no new IAM or CloudShell required. Own-account refresh/verified registration now recover the lookup atomically; exact-owner conflict/version/privacy/admission/expiry/replay guards retained. Added native invitation UUID/category logs and truthful404 guidance. Public target manifest updated from actual release hashes only. Pinned type/lint/build/reference/syntax/link/whitespace PASS; no tests/model/email/participant actions, application data writes0 during publication. User must refresh recipient's own signed-in account once, then manually send/accept; that functional proof remains PENDING. [Receipt](../../../../review-artifacts/INV01/username-lookup-repair-publication.json). No new agent/B dispatch/chat/schedule.


2026-10-16T23:12:15.995249+00:00 — INV01/A empty-inbox visibility correction claimed at direct user request: hide the invitations card for a successfully loaded empty inbox; show pending invitations normally and preserve the existing failure/retry state when the result is unknown. Scope group-home.tsx and INV01/A release records, frontend-only build/publication. No tests/model/participant actions or backend/IAM changes. Supersedes earlier always-visible empty-card direction only.
