# Known Enough — shared task queue

Current batch: **NP — Next Phase**, authorized 2026-09-30. [Batch direction and closure mapping](next-phase.md), [workflow](agent-workflow.md#np-batch-policy), and each NP ticket govern current work. Original NP00–NP04 batch plus the user-requested [NP05 live-check task](tasks/NP05.md), six tickets total. All previous tickets are DONE by user-directed administrative closure; their original evidence/statuses remain in their historical bodies and the [pre-NP inventory](archive/pre-np-task-statuses.json). This is not new technical verification or release acceptance.

**Current B outcome (2026-10-01): NP01–NP04 local DONE**, with full 464 / 2 optional skips, hosted 1/1 and E2E 53/53. The user scheduling override below governs B's completed work; older NP00-only routing paragraphs are preserved as the prior checkpoint. NP00 remains A's active claim. NP05 requires a separately authorized A/configured-host operations claim; [qualification and limits](np04-qualification.md).

## Current priority and claim

**Who is who:** A = Ricardo / GitHub `martelaxe`; B = Octavio Alatorre / GitHub `Battosai1806`. The Mac is an execution worker currently using A's account. See [verified mapping and status rules](people-and-workers.md). Account names, machines and chat titles are separate; no B activity is inferred from a Mac chat's status. One active task total includes the Mac worker.

**Active task for the shared queue: [NP00 — technical closeout](tasks/NP00.md).** IN_PROGRESS, claimed by A (Ricardo/martelaxe), Mac worker, at 2026-10-01T03:11:45Z; clean synchronized baseline `5d06c6f9bf87271db480998f142d748f7f1689f8`. Claim is published before implementation. B must not start NP00 or NP01 in parallel; inspect the [current checkpoint](np00-technical-closeout.md) after pulling.

User-approved LAT01 scope amendment, 2026-10-01: the same NP00 claim now includes the repository target manifest and public smoke harness in `playwright.live.config.ts` and `tests/live/{targets.json,public-smoke.spec.ts}`, plus a timing-only synchronization of the existing `tests/e2e/np-qualification.spec.ts` retry assertion after a full-check race. NP00/NP05 and A-side tracking/evidence remain included. The claimant and task status are unchanged; exact baselines and limits are in [NP00](tasks/NP00.md). No live test dispatch or AWS operation is implied.

The old KE14 integration claim is closed by the user's explicit direction; its unfinished technical obligations transfer to NP00. Source commit `5e87543` is present in synchronized `main`/`origin/main` at planning baseline `bafa1d4`. The exact patch and recorded check failures are preserved. NP00 now has a clean supported-host full check (440 / 2 optional skips, hosted 1/1, E2E 47/47), all twelve source hashes verified and all five deployed frontend files matching the configured build. Lambda ZIP/configuration readback, actual IAM cleanup and complete managed synthetic qualification still require A-side evidence; see [the checkpoint](np00-technical-closeout.md). The Mac lacks AWS CLI/profile; configured-host selection is pending. NP00 remains claimed; NP01 remains BLOCKED. Preserve any unshared work in the other clone before taking over; do not discard or redo it blindly.

When B asks “what's next?”, pull clean `main` with `git pull --ff-only origin main`, read this board and NP00, and report that A's Mac worker holds NP00. A gets the same queue answer. A takeover requires an explicit recorded transfer; do not open a second task. If a task is claimed, report that claim and continue/handoff within that task; do not start the next task in parallel. A alone handles authorized AWS operations with A's own credentials. B can implement/check code and prepare the CLI handoff without AWS access.

## Sequential NP queue

| Priority | Task | Direct worker target | Prerequisite | Status |
| --- | --- | --- | --- | --- |
| 0 | [NP00 — Technical closeout](tasks/NP00.md) | `gpt-6-sol` / high | User-directed old-batch closure | IN_PROGRESS — A / martelaxe / Mac |
| 1 | [NP01 — Registration, approval CLI, groups and invitations](tasks/NP01.md) | `gpt-6-sol` / high | User exception; local automated criteria | DONE — live evidence NP05 |
| 2 | [NP02 — Create a group's own decision](tasks/NP02.md) | `gpt-6-sol` / high | NP01 local DONE | DONE — live evidence NP05 |
| 3 | [NP03 — All-screen clarity and copy](tasks/NP03.md) | `gpt-6-luna` / medium | NP02 local DONE | DONE — remaining live states NP05 |
| 4 | [NP04 — Fresh-group/non-prefabricated qualification](tasks/NP04.md) | `gpt-6-sol` / high | NP03 local DONE | DONE — live evidence NP05 |
| 5 | [NP05 — Deployment and managed-service checks](tasks/NP05.md) | A / configured host; record selected model | NP01–NP04 local DONE; separate operations authorization | BLOCKED — operations authorization/claim |

No independent reviewer sessions, human sign-off or volunteer trials are scheduled now. Technical self-inspection, focused checks and pinned `npm run check` remain required for implementation. No subagents or parallel project tasks. Participant confirmations/permissions/approvals remain mandatory product behavior. Cloud writes/deployments, paid calls, live email and publication retain separate authorization; documentation sync to `origin main` remains standing-authorized.

## Deferred work and historical evidence

Human trials/optional agent simulations, demo/submission preparation and independent/final release reviews are deferred beyond this queue until the user schedules them. Their old tickets are administratively closed with unfinished scope explicitly preserved. Completing NP does not create those missing results or authorize submission.

The [original pre-NP board](archive/task-board-before-np-2026-09-30.md.txt), old tickets, reviews, source hashes and imported references remain historical evidence. No older A/B, KE or T task is an alternative current priority. The shared commit carries the new priorities to the other clone after its required pull; no automatic notification/read acknowledgment is claimed.

[NP direction](next-phase.md) · [A handoff](handoff-A.md) · [B handoff](handoff-B.md) · [A log](work-log-A.md) · [B log](work-log-B.md) · [technical debt](technical-debt/README.md) · [main integration](main-integration.md)

## User scheduling override — 2026-09-30, Windows B worker

The user explicitly directed this chat to work on everything except NP00 and to list AWS or other live checks as a new task. NP00's A/Mac claim and bounded files remain untouched. B may implement NP01–NP04 sequentially alongside that preserved NP00 claim, with no subagents and no overlap with NP00's named runtime/admission/test or tracking files. This is a specific scheduling exception. NP01 no longer waits for NP00 DONE. Automated focused and pinned full checks remain mandatory; required new managed-service/deployment/email/paid-model evidence routes to NP05 rather than blocking local implementation. No live acceptance is invented. B updates NP01–NP05 tickets, its own log/handoff and this override; A-owned existing claim/evidence is preserved. All implementation commits use `[skip ci]` to prevent deployment on authorized repository sync; NP05 owns separately authorized publication.

**B checkpoint:** NP01 local implementation DONE, 449 / 2 optional skips, hosted 1/1, E2E 48/48. NP02 READY. NP05 BLOCKED on local implementation and separately authorized live operations. NP00 claim unchanged.

**B checkpoint (2026-10-01):** NP02 local DONE; full 456 / 2 optional skips, hosted 1/1, E2E 48/48. NP03 READY under user exception. NP00 claim unchanged; NP05 retains live checks.

**B checkpoint (2026-10-01):** NP03 local DONE, full 457 / 2 optional skips, hosted 1/1, E2E 51/51. NP04 READY; actual screen evidence/limits in NP03 inventory. NP00 claim unchanged.

**B current claim:** NP04 offline qualification at f78ea12; exact files in ticket. NP00 A/Mac claim remains unchanged.

**Final B checkpoint (2026-10-01):** NP01–NP04 local DONE, all B claims finished. NP04 final full check 464 / 2 optional skips, hosted 1/1, E2E 53/53; source sync skips CI. NP05 contains deployment/AWS/signup/operator/email/live-model and remaining actual screen checks. NP00 A/Mac claim untouched; the other clone must pull main ff-only before its next task.
