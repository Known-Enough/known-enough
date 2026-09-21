# Task execution and collaboration

Effective September 20, 2026, by user instruction. Replaces the earlier Astra-led-every-task policy and mandatory task branches. This is the current authority for execution, ownership transfers and scheduling; imported plans remain unchanged and authoritative for product/security semantics. [Task board](task-board.md) lists parallel work; each ticket owns its requirements and status.

## Start and model selection

1. Open your own clone. Read AGENTS.md, this policy once per session, your current handoff/log, the board and assigned ticket. Read only relevant plan/contract sections and changed requirements; do not repeatedly load the whole history.
2. Check local changes, current commit and shared task claims. Select the ticket's named model/effort as the direct worker. The human selects the session model; Markdown does not change it. If unavailable or different, report the actual model and resolve selection before claiming the assigned model was used.
3. Claim one eligible task, recording developer, model, allowed files and baseline in your log and ticket. READY means eligible to claim, not accepted. Do not start a task already claimed elsewhere.
4. Implement, run focused checks, self-review and produce evidence. Run npm run check before code handoff. Documentation-only work needs link/reference/consistency checks. A full check is required at integration checkpoints. Preserve prior results as dated evidence, never relabel them as a new run.

| Work | Starting choice |
| --- | --- |
| Narrow components, styling, mechanical edits and docs | Luna, low/medium |
| Routine implementation, forms, adapters and tests | Terra, medium |
| Difficult solver/backend work and debugging | Sol, high |
| Architecture, critical consent/auth decisions and checkpoint reviews | Astra, high |

Existing B02 keeps its active Astra assignment; do not restart or downgrade it. No permanent manager, automatic polling, or default subagents. If delegation helps independent work, the current worker may use available same-session agents with bounded file ownership and report their actual model; never start another account's agents. After two substantive failed attempts, log the failure and escalate narrowly. Avoid re-running successful checks without changed code or new evidence. Record usage only when actually exposed; never invent cost/token figures.

## Main and parallel work

Each developer uses a separate clone on main; task IDs identify work, not branches. Never share a writable checkout or synchronized working directory. Use small coherent local commits and keep shared main usable. Before an authorized push, fetch/inspect the shared head, incorporate incoming changes without discarding local work, resolve conflicts and run affected checks. Git history integration/push remains subject to the user's authorization; no force-push. A task request alone does not authorize publishing or merging. Preserve existing task branches; migrate their work only through separately authorized integration, not reset/overwrite.

A and B normally own disjoint subsystems. One implementation writer per task and file set. Shared contracts, root config, lockfile and CI require a named coordinated owner before editing. An approved contract baseline lets A prepare against synthetic responses while B builds enforcement. Missing backend implementation blocks live acceptance, not independent frontend preparation. Internal dependencies still apply; the two queues meet at explicit integration checkpoints.

## B can cover A when capacity changes

The user reports that B has more tokens and explicitly authorizes B to take frontend tasks. Subsystem stewardship stays A/frontend and B/backend; the implementing developer may change. B need not ask again for ordinary eligible A work within this policy.

- B first finishes or safely pauses its active task; B02 is already active and must not be duplicated.
- A READY task with no current claim can be taken by B once both developers' latest shared claims establish it is available. A claim must be visible to the other developer through an authorized shared update or human handoff before concurrent work proceeds. Unsynchronized logs are not a lock; if availability is uncertain, obtain a human ownership clarification instead of guessing.
- For active A work, A or the user explicitly releases it. Record PAUSED, exact baseline plus commit/diff artifact (including untracked files), changed files, tests actually run, remaining work, and destination developer. B records the takeover and becomes the sole writer; A does not resume without a reverse handoff.
- If A has exhausted tokens, the user may release/assign the task and supply its saved work. Silence, an old log or token exhaustion alone does not prove local work is available. Never overwrite missing work or assume another clone can be read.
- B follows the claimed A ticket's model, scope and tests. After finishing, B records its frontend changes in B's log; the A handoff points to them at the next coordinated update. B may then continue the next eligible task. No account sharing or separately billed workflows are authorized.

B should prioritize finishing backend work that unlocks integration, but may take a ready A task while waiting on a review or when A has no capacity. A budget shortage does not require every task to use Astra. If A is unavailable, a separate Astra reviewer may perform technical public-contract compatibility review for B's cross-lane work. Human acceptance and external-action permissions still apply.

## Checkpoints and acceptance

- B02.5: review the current consent/projection/version design at the next reviewable B02 slice; recheck subsequent critical changes before B03 integration acceptance. Does not restart B02 or block unrelated frontend work.
- A03.5: after A02/A03 preparation, inspect client privacy/consent boundaries and evidence before downstream frontend/live integration work. Mock evidence establishes frontend behavior only.
- B04.5: midway through B04, review its design and first implementation before extending the identity/transaction approach. B04.5 requires that slice, not completed B04; B04 resumes after findings are addressed.
- G01: actual local negotiation across UI/API/domain. G02: actual identity/privacy/persistence before external testers. G03: final release evidence. These are direct Astra review tasks.

Use an independent reviewer session/agent for critical code, preferably in B's available budget. Review a named base/head commit or reproducible diff artifact, requirements, focused code, test output and unresolved issues. Logs supplement code inspection. Do not self-certify critical work; if independent review is unavailable, leave the checkpoint pending. Fixes stay with the named implementation owner. Record findings, reviewed artifact, PASS/CHANGES_REQUESTED/BLOCKED, commands and limitations in docs/reviews/<checkpoint>.md. A changed reviewed diff needs follow-up review. Only affected dependent work waits. No model review replaces human acceptance or authorizes publication.

States: READY, IN_PROGRESS, PAUSED, REVIEW, BLOCKED, DONE. DONE needs recorded human acceptance/integration; externally reported progress is labeled REPORTED_DONE/REPORTED_IN_PROGRESS until its artifact is synchronized. A preparation task can reach REVIEW while its separate live-integration ticket stays BLOCKED. Historical F00–F02/A01 evidence remains valid as dated evidence; do not redo accepted work merely to fit the new schedule.

## Compact logs and handoffs

Each developer writes only their own work log. Update at claim, meaningful change/blocker, checkpoint, transfer and handoff, not after every shell command. Include UTC time, task, actual developer/model/effort, baseline or diff, changed files, result/decision, checks with exit/results, limitations and next action. Link to long test output only when useful; no transcript dumps, secrets or participant data. The ticket owns status/claim; the board summarizes it. Update shared board/handoffs in a coordinated batch; do not turn all records into competing status sources.

Logs in separate clones become visible only after an authorized share or human transfer. This workflow creates no live messaging, locks, cross-account access or background agents. A dated report is not proof of another clone's current state.
