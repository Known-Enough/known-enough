# Task execution and collaboration

Effective September 22, 2026, by user instruction. One shared task pool supersedes the September 20 A/B ownership and coverage rules. Replaces the earlier Astra-led-every-task policy and mandatory task branches. This is the current authority for execution, ownership transfers and scheduling; imported plans remain unchanged and authoritative for product/security semantics. [Task board](task-board.md) lists parallel work; each ticket owns its requirements and status.

## Start and model selection

1. Open your own clone. Read AGENTS.md, this policy once per session, your current handoff/log, the shared board and selected ticket. Read only relevant plan/contract sections and changed requirements; do not repeatedly load the whole history.
2. Check local changes, current commit and shared task claims. Select the ticket's named model/effort as the direct worker. The human selects the session model; Markdown does not change it. If unavailable or different, report the actual model and resolve selection before claiming the assigned model was used.
3. Claim one eligible task, recording developer, model, allowed files and baseline in your log and ticket. READY means eligible to claim, not accepted. Do not start a task already claimed elsewhere.
4. Implement, run focused checks, self-review and produce evidence. Run npm run check before code handoff. Documentation-only work needs link/reference/consistency checks. A full check is required at integration checkpoints. Preserve prior results as dated evidence, never relabel them as a new run.

| Work | Starting choice |
| --- | --- |
| Narrow components, styling, mechanical edits and docs | Luna, low/medium |
| Routine implementation, forms, adapters and tests | Terra, medium |
| Difficult solver/backend work and debugging | Sol, high |
| Architecture, critical consent/auth decisions and checkpoint reviews | Astra, high |

B02’s original Astra execution is preserved in its history; it is now included on main and must not be restarted. No permanent manager, automatic polling, or default subagents. If delegation helps independent work, the current worker may use available same-session agents with bounded file ownership and report their actual model; never start another account's agents. After two substantive failed attempts, log the failure and escalate narrowly. Avoid re-running successful checks without changed code or new evidence. Record usage only when actually exposed; never invent cost/token figures.

## Main and parallel work

Each developer uses a separate clone on main; task IDs identify work, not branches. A01/workflow, B01 and B02 are now consolidated; [main integration](main-integration.md) records verification/publication state and safe synchronization for both clones. Never share a writable checkout or synchronized working directory. Use small coherent local commits and keep shared main usable. Before an authorized push, fetch/inspect the shared head, incorporate incoming changes without discarding local work, resolve conflicts and run affected checks. Git history integration/push remains subject to the user's authorization; no force-push. A task request alone does not authorize publishing or merging. Preserve existing task branches; migrate their work only through separately authorized integration, not reset/overwrite.

All tasks belong to one shared pool. Either user can work on frontend, backend, infrastructure, documentation or review tasks when eligible. Existing A/B task IDs remain stable references, not user assignments. Model, prerequisite, file scope, review and acceptance requirements still apply. An approved contract baseline permits frontend preparation against synthetic responses while another worker builds enforcement; missing backend implementation blocks live acceptance, not independent preparation.

## Shared pool claims and transfers

- Choose an eligible unclaimed READY task from the board after checking its authoritative ticket and both users' latest shared claims. Finish or safely pause your current implementation task first. Prefer work that unlocks the next integration gate; either user may take independent ready work while a gate waits.
- Record the actual claimant, model/effort, baseline, bounded files and status in the ticket and your own log. Make the claim visible through an authorized shared update or human handoff before concurrent work proceeds. Separate-clone logs are not a lock; if availability is uncertain, clarify ownership instead of guessing. Publication still requires authorization.
- One implementation writer per task and overlapping file set. Coordinate contracts, root config, lockfile, CI and shared tracking files before editing; neither user has permanent ownership of these files. Parallel tasks require disjoint agreed scopes.
- Existing active claims survive this policy change. Transfer active work only after the claimant or user explicitly releases it. Record PAUSED, exact baseline and commit/diff including untracked files, changed files, actual checks, remaining work and destination worker. The receiving worker records the takeover; the previous writer stops until a reverse handoff.
- Silence, old logs and exhausted tokens do not release work. Preserve all saved artifacts and never assume access to the other user's clone or credentials. Completed work is not restarted merely because the pool changed.
- Keep the existing A/B log and handoff filenames as personal history. Write only your own log, regardless of task prefix. The board and tickets provide the common queue; new task IDs use neutral T numbers. No automatic external messages or cross-account agents.

## Checkpoints and acceptance

- B02.5: reconcile the supplied independent final B02 review with the integrated contract/browser checks. See its recorded verdict; recheck later critical changes before B03 integration acceptance. Do not restart B02 or block unrelated frontend work.
- A03.5: after A02/A03 preparation, inspect client privacy/consent boundaries and evidence before downstream frontend/live integration work. Mock evidence establishes frontend behavior only.
- B04.5: midway through B04, review its design and first implementation before extending the identity/transaction approach. B04.5 requires that slice, not completed B04; B04 resumes after findings are addressed.
- G01: actual local negotiation across UI/API/domain. G02: actual identity/privacy/persistence before external testers. G03: final release evidence. These are direct Astra review tasks.

Use an independent reviewer session/agent for critical code, regardless of which user implemented the task. Review a named base/head commit or reproducible diff artifact, requirements, focused code, test output and unresolved issues. Logs supplement code inspection. Do not self-certify critical work; if independent review is unavailable, leave the checkpoint pending. Fixes stay with the named implementation owner. Record findings, reviewed artifact, PASS/CHANGES_REQUESTED/BLOCKED, commands and limitations in docs/reviews/<checkpoint>.md. A changed reviewed diff needs follow-up review. Only affected dependent work waits. No model review replaces human acceptance or authorizes publication.

States: READY, IN_PROGRESS, PAUSED, REVIEW, BLOCKED, DONE. DONE needs recorded human acceptance/integration; externally reported progress is labeled REPORTED_DONE/REPORTED_IN_PROGRESS until its artifact is synchronized. A preparation task can reach REVIEW while its separate live-integration ticket stays BLOCKED. Historical F00–F02/A01 evidence remains valid as dated evidence; do not redo accepted work merely to fit the new schedule.

## Compact logs and handoffs

Each developer writes only their own work log. Update at claim, meaningful change/blocker, checkpoint, transfer and handoff, not after every shell command. Include UTC time, task, actual developer/model/effort, baseline or diff, changed files, result/decision, checks with exit/results, limitations and next action. Link to long test output only when useful; no transcript dumps, secrets or participant data. The ticket owns status/claim; the board summarizes it. Update shared board/handoffs in a coordinated batch; do not turn all records into competing status sources.

Logs in separate clones become visible only after an authorized share or human transfer. This workflow creates no live messaging, locks, cross-account access or background agents. A dated report is not proof of another clone's current state.
