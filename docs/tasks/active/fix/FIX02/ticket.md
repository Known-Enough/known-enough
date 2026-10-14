# FIX02 — Publish compatible profile API and verify descriptions/photos

**Status:** READY / unclaimed. **Priority:** P1. **Intended worker:** B / Octavio / own `Battosai1806` identity. Queue after FIX01; do not interrupt its active claim.

## Problem and evidence

The user reports profile description/photo problems after UI publication. [ZZ03 publication receipt](../../../../review-artifacts/ZZ03/profile-modal-publication.json) records frontend source `75baad6506ea6920644858c2ee1cec990089ef8b` and successful [frontend run38494657209](https://github.com/Known-Enough/known-enough/actions/runs/38494657209): all seven public files served HTTP200 with matching hashes.

The new authenticated member-profile read was not published or verified. [API run38494669869](https://github.com/Known-Enough/known-enough/actions/runs/38494669869) stopped at `LAMBDA_HANDLER_MISMATCH`: installed handler `api.handler`, proposed `ke13b-lambda.handler`. It made zero Lambda code/route writes and stopped before route inspection; the route's current presence is UNKNOWN. This is a package compatibility failure, not proof of a user-access failure.

The installed [partition entry](../../../../../scripts/operations/partition-entry.ts) loads private configuration, manifest/release and optional lifecycle/jobs packages. The proposed [profile release](../../../../../scripts/zz/profile-api-release.py) instead creates a one-file `ke13b-lambda.mjs` ZIP. Changing the handler or removing the guard would not preserve the installed package. Description saving/photo uploading are separate existing operations: reproduce their actual behavior rather than assuming the missing member-read route explains every symptom.

## Intake and authority

At the next eligible intake after FIX01, pull main ff-only, check claims/running jobs, read FIX01's published runtime/worker handoff and record one bounded FIX02 claim. Use B's own GitHub credentials and installed project roles. Reuse the existing persistent chat/idle-only monitor; no new worker or schedule. This user-requested fix includes relevant testing, compatible deployment and necessary narrow configuration repair under [standing authority](../../../../project-automation-authority.md); the earlier manual-test pause does not prevent FIX02 verification. Preserve participant privacy/consent and actual source/target protections.

A's published UI checkpoint and failed API attempt become the source handoff for FIX02. A performs no profile/backend implementation alongside B; do not mark the whole ZZ03 task DONE or discard its historical evidence.

## Implementation plan

1. **Identify each failing operation.** With owned synthetic accounts, separately test reading/editing one's own profile, saving the description, uploading/replacing/removing a photo, and opening another current group member's profile. Capture HTTP status and safe error categories/request references; never log tokens, emails, bios, images or private API bodies.
2. **Verify actual installed routes and package.** Read current API handler/hash/role/runtime, source binding, JWT integration and required routes. The primary function is `known-enough-stage-api`, API `u94iyvt6p9`, account `092954139775`, region `us-east-1`; verify against current metadata. Own profile paths are `/account/profile` and `/account/profile/image`; member read is `GET /groups/{groupId}/members/{memberId}/profile`. Inspect needed CORS/OPTIONS behavior; do not add redundant routes or assume prior profile5/5 readback proves this new route.
3. **Integrate through the operations package.** Reuse the checked native implementation in [partition HTTP](../../../../../apps/api/src/partition-http.ts), [group session](../../../../../packages/adapters/src/partition-group-session.ts) and [group contracts](../../../../../packages/contracts/src/groups.ts). Publish the new read through the compatible native operations build/release, carrying current private configuration, manifest, lifecycle/jobs modules, migrations and any FIX01 runtime changes. Coordinate worker/API bindings when required. Preserve `api.handler` and compatibility guards; retire or constrain the incompatible profile-only publication path so it cannot overwrite the native package. Keep exact-source/revision guards, private rollback and truthful readback.
4. **Install only demonstrated missing connections.** Use existing application-configuration access for supported authenticated routes. If effective scope is insufficient, finish a concrete smallest repair package and record the exact denied action/resource; no broad grant, borrowed credentials or repeated unchanged CloudShell requests. No new database or parallel backend deployment by default.
5. **Preserve profile privacy and UI.** Only the owner edits/uploads; only current approved members of the same group can view the shared display name/description/avatar projection. Exclude email, login/provider identifiers, account status, internal avatar identifiers and private participant data. Recheck membership after removal/revocation. Keep image MIME/size validation, safe rendering, accessible modal focus and current responsive light/dark styles. Never substitute a mock successful save for persistence; show a useful error when read/save/upload fails.

## Checks and DONE criteria

- Focused API/contract/browser tests verify owner writes, same-group member reads, unrelated/removed/pending/display denial, safe response fields, image validation/removal, persistence after refresh/new session, accurate errors and keyboard/mobile modal behavior.
- Run pinned focused checks and `npm run check` for executable changes. The preceding release had 69/76 browser tests passing, including all six profile cases, but seven failures elsewhere. Keep those failures visible; reconcile current failures with FIX01/source changes, do not weaken assertions or call the old full check PASS.
- Publish a compatible exact-source API/configuration package, verify its actual handler/hash/source/role and authenticated routes, then verify the matching frontend. Do not replace the installed runtime with the legacy one-file ZIP or bypass the preflight.
- From B's own access, demonstrate a real primary save/reload of description and photo, photo replacement/removal, and allowed same-group member viewing with owner-only editing. Verify unrelated/removed members cannot read it. Use synthetic data, record actual usage/cleanup, and require no human password or manual browser session.
- Save UTC/source, root cause per operation, changed files, checks, GitHub links, readback, real profile results and remaining blockers in `docs/review-artifacts/FIX02/profile-integration.md` during implementation. Update ticket, batch/board, claim log, B work log/handoff and monitor receipts at natural checkpoints, with the same concise summary as B's chat response.
- DONE requires the live compatible integration and the profile behaviors above. Frontend publication, local mocks and route configuration alone are not complete acceptance. If genuinely blocked, record the exact remaining dependency/action and release at a safe checked checkpoint without claiming DONE.

Expected scope: existing profile/group web components and focused tests; native profile contracts/session/HTTP tests; compatible operations build/release and exact route configuration; the profile release workflow/guards only as needed; FIX02/ZZ03 evidence and tracking. Record actual files when claiming. Avoid unrelated styling, dependencies, account approval changes and ongoing FIX01 files before its handoff. Saved NP00/private work and deferred old mailbox debt remain preserved.

## Preparation — 2026-10-14

A created this queued B task from clean synchronized main `9e098c8`, the current publication receipt and checked route/package sources. FIX01 remains IN_PROGRESS/B. No new implementation, test, cloud write, deployment, automation or B FIX02 execution occurred during task creation.

[FIX batch](../README.md) · [Task guide](../../../README.md) · [Board](../../../../task-board.md)
