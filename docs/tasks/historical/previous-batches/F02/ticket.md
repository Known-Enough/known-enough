> Historical ticket view. Links follow the current layout; [original bytes](original.md.txt) retain the old paths and evidence. This folder does not schedule work.

# F02 — validated v1 contracts, public-only mocks, and documented semantics — closed previous batch

- Status: DONE — user-directed administrative closure, 2026-09-30.
- Claim: Closed for scheduling by the user's new-batch direction; preserve all saved work.

This is administrative closure of the old plan. Prior technical results and unfinished criteria are preserved below; no new check, review PASS, volunteer trial, live qualification or release acceptance is claimed. Remaining technical obligations route to [NP00](../../../active/closeout/NP00/ticket.md). Future product work follows [NP00–NP04](../../../../next-phase.md) and the [shared board](../../../../task-board.md). Reviews, human trials and submission preparation are deferred as mapped there. Historical claims and next-step instructions below cannot select current work.

## Historical ticket record

<!-- pre-NP-original-body -->

> **Known Enough migration, 2026-09-26:** retained historical scope; status remains **DONE**. Follow the [current queue](../../../../task-board.md) and [mapping](../../../../known-enough-pivot.md#complete-old-task-mapping) for future work; historical handoffs below do not restart old tasks.

# F02 — validated v1 contracts, public-only mocks, and documented semantics

> **Before development:** On a clean clone checked out on `main`, run `git pull --ff-only origin main` before any actual development of this task, including code, tests, configuration, or task artifacts. If local changes or an active rebase/merge prevent a clean pull, preserve and resolve/synchronize that state first; do not begin task development until the pull succeeds.


- Direct worker: future follow-up assignment is `gpt-6-astra`, high effort; record any actual future model. Historical execution/review evidence is preserved separately.
- Pool: Shared; either user may claim eligible unclaimed work. Historical claims below remain evidence; active claims require explicit release.
- Status: DONE; foundation ca9fb636974030bfd8a620cec2b3d8581b3c8114 was integrated at the user’s direction, as recorded in B01’s shared history.
- Claim: Historical implementation; no new implementation writer assigned by this scheduling update.
- Historical provenance: `task/foundation-review`, baseline `972386395618ec0ed81581d38082ebeb15d66142`; review fixes were pending human integration.
- Scope/files: `packages/contracts/**`, `packages/test-support/fixtures/**`, minimal `apps/web` scaffold, `tests/e2e/scaffold.spec.ts`, `docs/contracts.md`, and coordinated task/board/handoff records.
- Acceptance evidence: historical `npm run check` evidence is in [verification](../../../../verification.md); no fresh result is claimed. F02 contains no solver/application behavior.
- Handoff: A01 and B01.

Follow [agent workflow](../../../../agent-workflow.md) and [task board](../../../../task-board.md). Future work uses a separate clone on `main`; no mandatory branch or subagent.
