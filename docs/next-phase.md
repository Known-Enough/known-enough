# NP — Next Phase

User-directed batch change, 2026-09-30. This record and the [shared board](task-board.md) supersede the old task sequence. NP means Next Phase. There are five tasks total, including the technical closeout: NP00–NP04.

## Direction and closure

The user closed the previous batch for scheduling and requested technical-debt cleanup before the new product work. Every pre-NP task is now DONE by administrative closure. That label records this scheduling decision; it does not invent passing checks, completed volunteer trials, a review verdict, live qualification, or release acceptance. Each old ticket retains its original body and status as dated history below a closure banner. The [pre-NP status/hash inventory](archive/pre-np-task-statuses.json) and [original board](archive/task-board-before-np-2026-09-30.md.txt) preserve the exact baseline.

The old KE14 integration claim is closed by this explicit user direction, with unfinished technical obligations transferred to NP00. Preserve source commit `5e87543`, exact patch SHA-256 `6160910f39881f39e3fd44e08765d36cd5811ecfdd71a2e4c1c9ba389fd0f66b`, and all prior evidence. Planning began after a clean ff-only pull on `main` at `bafa1d4e21cb6e29008dce76b6b52f8b146d6a5e`, equal to fetched `origin/main`; `5e87543` is already in that synchronized history. Older statements that this commit was local/unpushed are historical. Its staging deployment and clean integration checks are not established by this planning update.

No independent reviewer sessions, human sign-off tasks, volunteer recruitment, or volunteer trials are scheduled in this batch. Use focused automated checks, implementation self-inspection and the pinned full check. Previously requested reviews are deferred, with their original verdicts retained. This override removes those review prerequisites from NP progress; it does not turn a deferred review into PASS or certify release readiness. The user may reinstate review work later.

Participant confirmation, concession permission, disclosure permission and exact final approval remain required application behavior. No administrative batch closure can substitute for them. AWS writes/deployments, paid calls, live email sending, publication and external messages retain their separate authorization requirements. A alone operates with A's AWS credentials; B never receives them.

## Five-task sequence

| Priority | Task | Outcome | Initial status |
| --- | --- | --- | --- |
| 0 | [NP00](tasks/active/closeout/NP00/ticket.md) | Resolve known technical debt, verification limits and remaining existing-scenario integration/operational proof | READY |
| 1 | [NP01](tasks/historical/completed/next-phase/NP01/ticket.md) | Registration, A's approval CLI, groups and invitations | BLOCKED on NP00 |
| 2 | [NP02](tasks/historical/completed/next-phase/NP02/ticket.md) | Create a supported decision from a group's own objective | BLOCKED on NP01 |
| 3 | [NP03](tasks/historical/completed/next-phase/NP03/ticket.md) | Inspect every user-facing screen and make wording clear | BLOCKED on NP02 |
| 4 | [NP04](tasks/historical/completed/next-phase/NP04/ticket.md) | Automated fresh-user/group qualification through a non-prefabricated agreement | BLOCKED on NP03 |

Model targets: `gpt-6-sol` / high for NP00, NP01, NP02 and NP04; `gpt-6-luna` / medium for NP03. The human selects the direct worker. Report the actual session model/effort when exposed; a ticket does not change the runtime. No manager or subagents are required, and no agents are spawned under this batch policy.

## Same next task for A and B

When either user asks what to do next, read the current [workflow](agent-workflow.md#np-batch-policy) and [board](task-board.md) before following a personal handoff's historical next step. On a clean separate clone, successfully run `git pull --ff-only origin main`, recheck the shared claim, and take the first eligible NP task. Initial answer: **NP00**. If it is claimed, report its claimant and next action; do not start NP01 or a parallel task. If an A-only authorized operation is needed, B preserves a bounded handoff within the same task, and A explicitly takes over. Neither user gets a permanent subsystem assignment.

The shared commit communicates these priorities to the other clone when it pulls; it is not a live notification or a claim that the other user has read them. Both handoffs carry a routing notice. The [identity correction](people-and-workers.md) establishes A as Ricardo/martelaxe, B as Octavio/Battosai1806 and the Mac as a separate worker currently using A's account. The original Mac planning note was mistakenly filed in B's log; its exact text is archived and the corrected attribution recorded in A's log. All workers share the same single-active-task queue.

## Unfinished work mapping

| Prior obligation | Current destination |
| --- | --- |
| KE08 local MVP REVIEW and KE14 integration/live-scenario gaps | NP00 for technical baseline and existing-scenario proof; no restart of completed foundation work |
| KE10 stop/commit correction and TD-KE10-01 | NP00 automated technical evidence; former independent follow-up deferred |
| TD-KE10-02 misleading Bedrock permission-set name | NP00; A performs actual IAM cleanup only with the required separate authorization |
| General registration/group membership/recipient onboarding | NP01; this feature was absent from the two-scenario demo |
| Mandatory fixed scenario roster, fields and candidate catalog | NP02 general creation path; existing demo fixtures remain regression/templates |
| All-screen copy/clarity concerns | NP03 |
| New group plus genuinely new supported decision through agreement | NP04 |
| KE15 volunteer trials | Deferred beyond this batch; optional agent simulations later must be labeled as simulations |
| KE16 demo/submission materials and official-rule verification | Deferred release work; not completed by administrative closure |
| KE17 and other unfinished independent/human reviews | Deferred until the user reinstates them; not a release PASS |

Native Alexa, booking, payments, unrestricted rule execution, marketing mail and broad infrastructure redesign are outside this batch. Submission/publication remains a separately authorized future action.

## User scheduling override — 2026-09-30, Windows B worker

The user explicitly directed this chat to work on everything except NP00 and to list AWS or other live checks as a new task. NP00's A/Mac claim and bounded files remain untouched. B may implement NP01–NP04 sequentially alongside that preserved NP00 claim, with no subagents and no overlap with NP00's named runtime/admission/test or tracking files. This is a specific scheduling exception. NP01 no longer waits for NP00 DONE. Automated focused and pinned full checks remain mandatory; required new managed-service/deployment/email/paid-model evidence routes to NP05 rather than blocking local implementation. No live acceptance is invented. B updates NP01–NP05 tickets, its own log/handoff and this override; A-owned existing claim/evidence is preserved. All implementation commits use `[skip ci]` to prevent deployment on authorized repository sync; NP05 owns separately authorized publication.
