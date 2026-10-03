> Historical ticket view. Links follow the current layout; [original bytes](original.md.txt) retain the old paths and evidence. This folder does not schedule work.

# B06 — historical task — closed previous batch

- Status: DONE — user-directed administrative closure, 2026-09-30.
- Claim: Closed for scheduling by the user's new-batch direction; preserve all saved work.

This is administrative closure of the old plan. Prior technical results and unfinished criteria are preserved below; no new check, review PASS, volunteer trial, live qualification or release acceptance is claimed. Remaining technical obligations route to [NP00](../../../active/closeout/NP00/ticket.md). Future product work follows [NP00–NP04](../../../../next-phase.md) and the [shared board](../../../../task-board.md). Reviews, human trials and submission preparation are deferred as mapped there. Historical claims and next-step instructions below cannot select current work.

## Historical ticket record

<!-- pre-NP-original-body -->

# B06 — historical task

- Status: SUPERSEDED.
- Claim: None; unstarted future work replaced by the user-directed Known Enough pivot on 2026-09-26.
- Replacement: [KE13](../KE13/ticket.md).

> **SUPERSEDED — do not restart.** The original ticket below is preserved verbatim, including its then-current status and prerequisites. Only the status above schedules this ticket. See the [authoritative mapping](../../../../known-enough-pivot.md#complete-old-task-mapping) and [current queue](../../../../task-board.md). This is intentional replacement, not failure or completion.

---

# B06 — CDK deployment, bounded operations, and synthetic judge accounts

> **Before development:** On a clean clone checked out on `main`, run `git pull --ff-only origin main` before any actual development of this task, including code, tests, configuration, or task artifacts. If local changes or an active rebase/merge prevent a clean pull, preserve and resolve/synchronize that state first; do not begin task development until the pull succeeds.


- Direct worker: human selects `gpt-6-sol`, high effort; record actual model in evidence.
- Pool: Shared; either user may claim eligible unclaimed work. Historical claims below remain evidence; active claims require explicit release.
- Status: BLOCKED.
- Claim: Unclaimed in this scheduling update; synchronize current shared claims before starting.
- Prerequisite: B05. Infrastructure preparation may proceed; operational completion is BLOCKED until explicit cloud/deployment authorization.
- Scope/files: `infra/**`, `packages/adapters/**`, `apps/api/**`, `apps/workers/**`, plus the implementing developer’s work log and coordinated task/board/handoff records; coordinate contracts/root changes.
- Acceptance: prepare CDK deployment plus bounded retries/concurrency, redacted metrics, expiry, and synthetic judge accounts; retain operational checks. Run relevant unit/integration tests and `npm run check`; record actual outcomes. Completion further requires authorized real deployment and actual deployment/access/retry/redaction/expiry evidence. Do not deploy, spend, or claim cloud results not run without explicit authorization.
- Handoff: A06.5 and G03 only after operational completion.

Follow [agent workflow](../../../../agent-workflow.md) and [task board](../../../../task-board.md). Future work uses a separate clone on `main`; no mandatory branch or subagent.
