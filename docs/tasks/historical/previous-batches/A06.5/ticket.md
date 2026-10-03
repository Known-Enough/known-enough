> Historical ticket view. Links follow the current layout; [original bytes](original.md.txt) retain the old paths and evidence. This folder does not schedule work.

# A06.5 — historical task — closed previous batch

- Status: DONE — user-directed administrative closure, 2026-09-30.
- Claim: Closed for scheduling by the user's new-batch direction; preserve all saved work.

This is administrative closure of the old plan. Prior technical results and unfinished criteria are preserved below; no new check, review PASS, volunteer trial, live qualification or release acceptance is claimed. Remaining technical obligations route to [NP00](../../../active/closeout/NP00/ticket.md). Future product work follows [NP00–NP04](../../../../next-phase.md) and the [shared board](../../../../task-board.md). Reviews, human trials and submission preparation are deferred as mapped there. Historical claims and next-step instructions below cannot select current work.

## Historical ticket record

<!-- pre-NP-original-body -->

# A06.5 — historical task

- Status: SUPERSEDED.
- Claim: None; unstarted future work replaced by the user-directed Known Enough pivot on 2026-09-26.
- Replacement: [KE14](../KE14/ticket.md), [KE15](../KE15/ticket.md), [KE16](../KE16/ticket.md).

> **SUPERSEDED — do not restart.** The original ticket below is preserved verbatim, including its then-current status and prerequisites. Only the status above schedules this ticket. See the [authoritative mapping](../../../../known-enough-pivot.md#complete-old-task-mapping) and [current queue](../../../../task-board.md). This is intentional replacement, not failure or completion.

---

# A06.5 — real trials, duty/calendar integration, and recording evidence

> **Before development:** On a clean clone checked out on `main`, run `git pull --ff-only origin main` before any actual development of this task, including code, tests, configuration, or task artifacts. If local changes or an active rebase/merge prevent a clean pull, preserve and resolve/synchronize that state first; do not begin task development until the pull succeeds.


- Direct worker: human selects `gpt-6-luna`, medium effort; record actual model in evidence.
- Pool: Shared; either user may claim eligible unclaimed work. Historical claims below remain evidence; active claims require explicit release.
- Status: BLOCKED.
- Claim: Unclaimed in this scheduling update; synchronize current shared claims before starting.
- Prerequisites: A06, G01, G02, B06 operational completion, and T02 for the final integrated AI recording. Earlier non-AI preparation is not blocked by T02.
- Scope/files: `apps/web/**`, `tests/e2e/**`, `docs/**`, plus the implementing developer’s work log and coordinated task/board/handoff records.
- Acceptance: actual calendar/duty transitions, authorized human trials, and recording/judge-access evidence. Run relevant unit/integration/browser tests and `npm run check`; record actual outcomes. External actions require explicit user authorization; record what was actually performed.
- Handoff: G03.

Follow [agent workflow](../../../../agent-workflow.md) and [task board](../../../../task-board.md). Use a separate clone on `main`; no mandatory subagents.
