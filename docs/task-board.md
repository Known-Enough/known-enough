# Known Enough — shared task queue

Current batch: **NP — Next Phase**, authorized 2026-09-30. [Batch direction and closure mapping](next-phase.md), [workflow](agent-workflow.md#np-batch-policy), and each NP ticket govern current work. Five tasks total, including NP00. All previous tickets are DONE by user-directed administrative closure; their original evidence/statuses remain in their historical bodies and the [pre-NP inventory](archive/pre-np-task-statuses.json). This is not new technical verification or release acceptance.

## Current priority and claim

**Next task for either User A or User B: [NP00 — technical closeout](tasks/NP00.md).** Status READY; unclaimed. No NP implementation or reviewer task is active. This update is documentation planning only.

The old KE14 integration claim is closed by the user's explicit direction; its unfinished technical obligations transfer to NP00. Source commit `5e87543` is present in synchronized `main`/`origin/main` at planning baseline `bafa1d4`. The exact patch and recorded check failures are preserved. Staging deployment, a clean full integration check and complete live-scenario qualification still require NP00 evidence. Preserve any unshared work in the other clone before taking over; do not discard or redo it blindly.

When B asks “what's next?”, pull clean `main` with `git pull --ff-only origin main`, read this board and NP00, and claim NP00 if still unclaimed. A gets the same answer. If a task is claimed, report that claim and continue/handoff within that task; do not start the next task in parallel. A alone handles authorized AWS operations with A's own credentials. B can implement/check code and prepare the CLI handoff without AWS access.

## Sequential NP queue

| Priority | Task | Direct worker target | Prerequisite | Status |
| --- | --- | --- | --- | --- |
| 0 | [NP00 — Technical closeout](tasks/NP00.md) | `gpt-6-sol` / high | User-directed old-batch closure | READY — no technical work claimed yet |
| 1 | [NP01 — Registration, approval CLI, groups and invitations](tasks/NP01.md) | `gpt-6-sol` / high | NP00 DONE | BLOCKED |
| 2 | [NP02 — Create a group's own decision](tasks/NP02.md) | `gpt-6-sol` / high | NP01 DONE | BLOCKED |
| 3 | [NP03 — All-screen clarity and copy](tasks/NP03.md) | `gpt-6-luna` / medium | NP02 DONE | BLOCKED |
| 4 | [NP04 — Fresh-group/non-prefabricated qualification](tasks/NP04.md) | `gpt-6-sol` / high | NP03 DONE | BLOCKED |

No independent reviewer sessions, human sign-off or volunteer trials are scheduled now. Technical self-inspection, focused checks and pinned `npm run check` remain required for implementation. No subagents or parallel project tasks. Participant confirmations/permissions/approvals remain mandatory product behavior. Cloud writes/deployments, paid calls, live email and publication retain separate authorization; documentation sync to `origin main` remains standing-authorized.

## Deferred work and historical evidence

Human trials/optional agent simulations, demo/submission preparation and independent/final release reviews are deferred beyond this queue until the user schedules them. Their old tickets are administratively closed with unfinished scope explicitly preserved. Completing NP does not create those missing results or authorize submission.

The [original pre-NP board](archive/task-board-before-np-2026-09-30.md.txt), old tickets, reviews, source hashes and imported references remain historical evidence. No older A/B, KE or T task is an alternative current priority. The shared commit carries the new priorities to the other clone after its required pull; no automatic notification/read acknowledgment is claimed.

[NP direction](next-phase.md) · [A handoff](handoff-A.md) · [B handoff](handoff-B.md) · [A log](work-log-A.md) · [B log](work-log-B.md) · [technical debt](technical-debt/README.md) · [main integration](main-integration.md)
