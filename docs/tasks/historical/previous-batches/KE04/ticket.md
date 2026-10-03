> Historical ticket view. Links follow the current layout; [original bytes](original.md.txt) retain the old paths and evidence. This folder does not schedule work.

# KE04 — TeamTable compatibility and regression — closed previous batch

- Status: DONE — user-directed administrative closure, 2026-09-30.
- Claim: Closed for scheduling by the user's new-batch direction; preserve all saved work.

This is administrative closure of the old plan. Prior technical results and unfinished criteria are preserved below; no new check, review PASS, volunteer trial, live qualification or release acceptance is claimed. Remaining technical obligations route to [NP00](../../../active/closeout/NP00/ticket.md). Future product work follows [NP00–NP04](../../../../next-phase.md) and the [shared board](../../../../task-board.md). Reviews, human trials and submission preparation are deferred as mapped there. Historical claims and next-step instructions below cannot select current work.

## Historical ticket record

<!-- pre-NP-original-body -->

# KE04 — TeamTable compatibility and regression

- Status: DONE — 2026-09-27; compatibility criteria and pinned full check passed.
- Claim: 2026-09-27T18:22:56Z; User A / current Codex GPT-6, exact runtime variant/effort unexposed. The user-directed `gpt-6-luna` / high target is not claimed as verified runtime selection. Clean synchronized `main` baseline `5159770`; `git pull --ff-only origin main` succeeded and HEAD/origin were 0/0. Bounded files: `packages/domain/src/**` for the generic/legacy bridge and tests; `packages/test-support/src/{teamtable-fixture.ts,teamtable-fixture.test.ts,known-enough-fixtures.ts,known-enough-fixtures.test.ts}` and fixture boundary checks as needed; focused contract/application/integration tests; `docs/known-enough-architecture.md`, `packages/test-support/README.md`, this ticket, the KE05 prerequisite status line, `docs/task-board.md`, `docs/handoff-A.md` and `docs/work-log-A.md`. Actual edits stayed in `packages/domain/src/known-enough-kernel.test.ts`, `packages/test-support/src/known-enough-fixtures.ts`, the test-support README, architecture, tracking docs and the KE05 status line. No browser product, API, root/package manifest, lockfile, CI, AWS/cloud, deployment, paid-call or external-message changes. No shared contract changes were needed.
- Direct worker: `gpt-6-luna` / high by user direction for the KE01–KE08 MVP; record actual model/effort, never infer it from this file.
- Prerequisite: [KE03](../KE03/ticket.md) is DONE with its acceptance checks recorded; all named earlier gates remain satisfied.
- Scope/files: packages/domain/** compatibility adapters; packages/test-support/**; relevant contract/application/integration tests; migration documentation. Also this ticket, the current board/handoff and claimant’s own log. Name exact files and baseline at claim; coordinate contract/root/lock/CI changes.

## Outcome

Re-express TeamTable using the generic contracts and preserve a known deterministic benchmark. This is a migration safety net, not the default Known Enough experience; no new AI path is required.

## Acceptance

1. Keep exactly 12 structural candidates, zero baseline feasible and two under the valid scoped exception. Preserve inconvenience choosing B and balanced-load choosing A for the historical fixture.
2. Preserve hard-condition, full-interval, grant scope/expiry/revocation, independent disclosure, exact approval and semantic invalidation assertions through the bridge.
3. Retain old tests where practical. For each intentionally replaced test, record old path/assertion and new equivalent, with reason; never relabel old evidence as a fresh Known Enough run.
4. Keep legacy fixture/observer data server/test-only; inspect public projection and browser boundary checks.

## Checks and handoff

Run focused historical and generic bridge checks and pinned npm run check. When criteria and checks pass, record evidence and mark DONE; hand off directly to KE05 without per-task human review.

Before development, use a separate clean clone on `main`, successfully run `git pull --ff-only origin main`, recheck current claims and record the bounded claim. One task at a time. Only reviews explicitly named in this ticket are gates; do not add broad or repeated review sessions. Follow the [token-efficient review policy](../../../../agent-workflow.md#review-scope-and-token-efficiency). No implicit publication, merge, deployment, paid calls/resources or external messages.

Follow the [workflow](../../../../agent-workflow.md), [current queue](../../../../task-board.md), [product](../../../../known-enough-product.md), [architecture](../../../../known-enough-architecture.md) and [migration mapping](../../../../known-enough-pivot.md).

## Completed outcome and evidence — 2026-09-27

- `adaptTeamTableInput` now maps the retained fixture into strict generic v2 variables, owner-scoped hard/negotiable constraints, preferences and the exact permission. Hard availability checks the full meeting and assigned-duty intervals, including contiguous interval unions. Generic hard constraints cannot be overridden by a negotiation permission.
- The generic kernel bridge runs all 12 structural candidates. It returns zero valid candidates without the scoped grant and exactly two with it; public proposal facts contain no legacy grant or private condition IDs. Focused coverage checks a one-minute duty interval gap, a one-minute meeting interval gap, wrong-context, expired and revoked permission.
- Existing legacy solver tests remain unchanged and preserve the historical rankings: inconvenience selects B (Leo lead/Maya follow-up); balanced recent load selects A (Maya lead/Leo follow-up). Generic application tests still cover independent disclosure refusal, exact approval/concurrency and semantic invalidation. No tests were intentionally replaced or relabeled.
- Focused `npm test -- packages/domain packages/test-support`: 86/86 passed. Pinned Node 24.21.0/npm 11.19.0 `npm run check` passed: references 7/7; planning 15/15, including the historical 12/0/2 and A/B rankings; lint and 108 import-boundary references; typecheck; 280 tests passed, 2 opt-in DynamoDB Local tests skipped; production and hosted-preview builds/scans; hosted browser test 1/1; browser E2E 41/41.
- Browser/server boundary remains intact; fixtures stay in `packages/test-support` and are not imported by browser source. This is synthetic/local evidence only; no AWS calls, cloud changes, paid calls or deployments.
- No separate KE04 review is scheduled. KE04's exact artifact is included in KE09's post-MVP review bundle. Next task: KE05, eligible and unclaimed.
