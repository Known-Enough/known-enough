# FIX01 — Repair decision creation and misleading access errors

**Status:** IN_PROGRESS / B. **Priority:** P0. **Intended worker:** B / Octavio / own `Battosai1806` identity. Exactly one implementation task.

## User problem

Inside an existing group, the Decisions section shows “Retry the same draft request”, “Release this draft request for editing” and “This action is unavailable. Check your account and organizer access.” The user cannot proceed and cannot tell why.

This report concerns drafting a decision inside a group. Group creation is a separate operation: check it during reproduction, but do not label both operations broken without evidence.

## Current evidence and likely cause

- [Group decision UI](../../../../../apps/web/src/group-decisions.tsx) maps almost every non-success response other than 507/409/422 to the account/organizer message. A missing route or unavailable server can therefore look like a permission problem.
- [Native release composition](../../../../../apps/api/src/partition-release.ts) passes `undefined` as the architect argument to `createPartitionDeploymentHandler`. [Group session](../../../../../packages/adapters/src/partition-group-session.ts) rejects draft generation when that port is missing.
- [MVP audit F01](../../../../review-artifacts/MVP01/readiness-review.md) already records this gap. FIX01 is the user-facing priority slice of [OPS03](../../operations/OPS03/ticket.md), not a second concurrent implementation or completion of all OPS03 criteria.
- The actual HTTP response from this user's failed request has NOT been observed. Confirm the cause in the deployed flow before claiming that the missing port explains this particular failure.
- B can use its own GitHub workflows, test artifacts and installed project roles. Main API CloudWatch log-reading access is NOT confirmed. Worker-log access alone does not prove access to the API's logs.

## Authority and intake

The user's FIX01 request assigns the next bounded fix to B and authorizes relevant local/live tests and deployment under [standing project authority](../../../../project-automation-authority.md). This is a FIX01 exception to the preceding manual-review test pause and A-only observer handoff. Preserve other deferred tests, saved NP00 work, participant consent, privacy and source/target controls. No routine human reapproval is required for authorized project work; actual platform/access restrictions still apply.

1. Pull `main` ff-only using B's own account; inspect the board, claim log, handoffs and active GitHub runs. Preserve genuine ongoing work and do not duplicate a test or deployment. Record one FIX01 claim and bounded files before implementing. Continue the existing persistent B chat; leave its monitor/schedule unchanged.
2. Read the current deployed API/worker source binding, manifest, route/JWT configuration and OPS03 evidence. The primary site is `https://main.d143q5ravxp5av.amplifyapp.com/`, API `https://u94iyvt6p9.execute-api.us-east-1.amazonaws.com`, function `known-enough-stage-api`, account `092954139775`, region `us-east-1`. Verify these against current metadata rather than trusting old hashes.
3. Reproduce with an owned synthetic approved organizer and group. Check group creation separately, then submit a new public objective through the actual primary UI. Capture the failing operation, HTTP status, sanitized error category and request reference/time. Do not request the human user's password, token or private inputs.

## Fix plan

1. **Make diagnosis possible.** Read GitHub artifacts and bounded request diagnostics first. Verify whether B can actually read a finite time/request window in `/aws/lambda/known-enough-stage-api`. If a grant is absent, record the exact denied action/role/resource and prepare the smallest concrete read-only setup package; reuse installed project access where possible. Continue independent diagnosis/coding instead of repeatedly checking the same denial. No credential sharing or broad administrator grant. Diagnostics must exclude tokens, passwords, email, objectives and private participant content.
2. **Repair the real backend connection.** Verify required group/draft routes, JWT authorizer, account admission and organizer membership. If the missing architect port is confirmed, connect the real architect through the native source-bound deployment and existing bounded model-job infrastructure. Reuse OPS03 code; preserve current usage, retention/consent controls, strict output validation and public-only frames. Do not replace it with mocks, auto-approve participants, or merely flip legacy model flags rejected by the native entry. Coordinate API/worker/manifest publication and rollback when their contract changes.
3. **Preserve request safety.** Keep the same idempotency key for retries, recover saved results after lost acknowledgments and reload, and reject stale membership/version changes. Ensure retry/release-for-editing cannot silently create duplicate drafts or paid calls. Unknown outcomes require recovery before a new request.
4. **Explain failures honestly.** Distinguish login expiry, actual permission denial, missing routes, unavailable/disabled AI, provider failure, invalid objective, conflicts and capacity limits using trustworthy response categories. Access advice should correspond to an actual access failure. Give one clear recovery action; retain the current premium UI, loading skeletons, profile drawer and responsive styling.

## Checks and acceptance

- Focused tests cover organizer/non-organizer/outsider/display access; successful draft generation/review/save; invalid model output; unavailable provider; accurate client errors; same-key retry, lost acknowledgment, reload and stale roster races. Verify no private data enters public payloads or logs.
- Run the pinned Node/npm focused checks and `npm run check` for executable changes. Then publish the checked exact source and inspect fresh matching GitHub/deployment evidence. Local mocks and isolated QA journeys do not establish primary acceptance.
- From B's own access, complete a real primary flow: approved synthetic organizer → existing/new group → new objective → real draft → review/confirm through the normal creation step → reload the saved decision. Verify an unauthorized account cannot perform organizer actions. Record actual model usage and normal cleanup. Do not count another user's approvals as granted.
- Confirm the demonstrated error is resolved and that failures now give accurate, recoverable explanations. Verify B's debugging path by an actual check; distinguish API log access, workflow logs and newly added safe diagnostics.
- Record UTC/source, actual cause, changed files, test results, deployment links, usage/cleanup and remaining gaps in `docs/review-artifacts/FIX01/decision-draft-repair.md` when implementing. Keep ticket, claim log, B work log/handoff and monitor receipts consistent at natural checkpoints; include a short summary matching B's chat answer. Mark DONE only on the above evidence, otherwise record the exact blocker and next action.

## Scope and boundaries

Expected files: relevant group/decision web components and focused tests; native API/partition architect composition and tests; existing operations/model adapters; exact-source publication/configuration/logging workflows or policies only where needed; FIX01 and related tracking/evidence. Declare the actual bounded list at claim time. Avoid unrelated styling, dependency upgrades and parallel claims.

Preserve primary private configuration, migration state, source-bound runtime packages, participant identity/consent and rollback. No new database, worker, monitor or chat by default. Do not turn deferred [DEBT01](../../technical-debt/DEBT01/ticket.md) mailbox cleanup into a blocker for independent work. Full private interpretation, negotiation/recovery and final MVP proof remain in OPS03/FIN tasks unless directly necessary for this fix; update their F01 evidence without claiming those whole tasks complete.

## Preparation record — 2026-10-13

A created this task from synchronized main `64fc3418114492a2cf1113697bd539ee1612819d`, checked the current UI error mapping and missing architect composition, and recorded the bounded B handoff. Latest repository evidence releases A's ZZ03 loading-polish claim. No implementation, live reproduction, AWS change, test, deployment or B start occurred during task preparation. B must verify its own fresh intake.

[FIX batch](../README.md) · [Task guide](../../../README.md) · [Board](../../../../task-board.md)

## FIX01 B claim — 2026-10-13T23:19:33.313357+00:00

IN_PROGRESS/B ownBattosai1806/143764700, clean ff-only main02b313a9644c9a326b963ad482f8e72bbe205393; latest A claim released, no queued/running jobs observed. User explicitly starts FIX01 under task-specific exception; sole implementation/no helper/new worker/chat/schedule. Initial exact scope: apps/web/src/group-decisions.tsx and new safe draft error/recovery module/tests; apps/api/src/partition-release.ts/test, partition-deployment.ts/test, partition-runtime.ts/test and partition-http.ts/test; packages/adapters/src/partition-group-session.ts/test and existing bounded model/job adapters as specifically amended after inspection; scripts/operations/partition-entry.ts, jobs-package.ts plus exact-source existing publication/inspection fixtures as needed; new scripts/fix01 diagnostics/live proof and .github/workflows/fix01-* workflows, bounded test files and FIX01/report/taskboard/claims/B logs/handoff/monitor. Preserve current UI/styles/assets, private config/migration/signing/source, disabled controls/cumulative usage, saved NP00/DEBT01. No broad cloud/contract/role change inferred; record actual needed runtime/adapters before editing. First reproduce actual primary group/draft response with own synthetic organizer, separately prove group creation; inspect current API/worker/source/JWT/routes/log access. Confirm cause before connection changes, use existing bounded model infrastructure, source/current-identity/output/retry/recovery guards. Actual model identity/effort unexposed.
