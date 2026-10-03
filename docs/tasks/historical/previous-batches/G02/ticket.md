> Historical ticket view. Links follow the current layout; [original bytes](original.md.txt) retain the old paths and evidence. This folder does not schedule work.

# G02 — historical task — closed previous batch

- Status: DONE — user-directed administrative closure, 2026-09-30.
- Claim: Closed for scheduling by the user's new-batch direction; preserve all saved work.

This is administrative closure of the old plan. Prior technical results and unfinished criteria are preserved below; no new check, review PASS, volunteer trial, live qualification or release acceptance is claimed. Remaining technical obligations route to [NP00](../../../active/closeout/NP00/ticket.md). Future product work follows [NP00–NP04](../../../../next-phase.md) and the [shared board](../../../../task-board.md). Reviews, human trials and submission preparation are deferred as mapped there. Historical claims and next-step instructions below cannot select current work.

## Historical ticket record

<!-- pre-NP-original-body -->

# G02 — historical task

- Status: SUPERSEDED.
- Claim: None; unstarted future work replaced by the user-directed Known Enough pivot on 2026-09-26.
- Replacement: [KE09](../KE09/ticket.md). KE09 follow-up after model/session/cloud changes remains required before external testers.

> **SUPERSEDED — do not restart.** The original ticket below is preserved verbatim, including its then-current status and prerequisites. Only the status above schedules this ticket. See the [authoritative mapping](../../../../known-enough-pivot.md#complete-old-task-mapping) and [current queue](../../../../task-board.md). This is intentional replacement, not failure or completion.

---

# G02 — privacy and security checkpoint before external testers

> **Before development:** On a clean clone checked out on `main`, run `git pull --ff-only origin main` before any actual development of this task, including code, tests, configuration, or task artifacts. If local changes or an active rebase/merge prevent a clean pull, preserve and resolve/synchronize that state first; do not begin task development until the pull succeeds.


- Direct worker: human selects `gpt-6-astra`, high effort; record actual model in evidence.
- Pool: Shared; either user may claim eligible unclaimed work. Historical claims below remain evidence; active claims require explicit release.
- Status: BLOCKED.
- Claim: Unclaimed in this scheduling update; synchronize current shared claims before starting.
- Prerequisites: A04.5, B04, and B04.5, and therefore G01.
- Scope/files: `tests/**`, `docs/**`, this ticket, `docs/reviews/G02.md`, and coordinated task/board/handoff records. Route fixes to the named implementation claimant.
- Acceptance: independently assess privacy/security before inviting external testers, including actual authentication evidence, identity/isolation, transaction/IAM findings, public snapshots/logs, and unresolved risks. Run relevant checks and `npm run check`, recording actual outcomes; do not claim unrun cloud/auth tests passed.
- Handoff: T02, A06.5 and G03. T02 requires follow-up independent review of its changed model/tool boundaries before release; initial G02 does not depend on T02.

Follow [agent workflow](../../../../agent-workflow.md) and [task board](../../../../task-board.md). Future work uses a separate clone on `main`; no mandatory branch or subagent.
