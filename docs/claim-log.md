# Known Enough claim log

User direction on 2026-10-03: assign a separate conversation to each B claim using `gpt-6-sol` / `max`, and remove claimed work from availability. The [board](task-board.md) controls priority; each ticket controls its status, claimant, scope and evidence. This log maps claims to conversations and excludes them from new assignments. A disagreement between records blocks assignment until reconciled.

The existing five-minute heartbeat `watch-known-enough-shared-queue` now dispatches work from conversation `01a0fe0d-e89f-7bf3-8004-df79886c616d`. It creates one conversation per eligible claim and resumes that same conversation while the claim remains unfinished. It inspects current claims on every tick, including when the remote revision is unchanged. It reads active workers without interrupting them or writing their checkout. One implementation or review task runs at a time; A's saved NP00 claim and its bounded files remain preserved.

`gpt-6-sol` / `max` is the user-selected direct-worker setting for these B conversations, overriding earlier ticket targets. Record accepted tool settings separately from actual runtime fields if the worker cannot expose those fields. This is a Codex work setting, not new AWS, paid API/email, deployment, budget or publication authorization.

## Current assignments and exclusions

| Task | Ticket status / assignment | Claimant and conversation | Available for a new claim? |
| --- | --- | --- | --- |
| [ASSESS07](tasks/active/live-testing/ASSESS07/ticket.md) | IN_PROGRESS; dedicated worker assigned; evidence reconciliation awaits synchronized start | B / `Battosai1806`; `01a1044b-4cc8-7c00-b5ee-a24a17ded137`; `gpt-6-sol` / `max` requested and accepted by creation tool | No — existing claim; extra receipt expired at 2026-10-04T00:00:00Z |
| [ASSESS10](tasks/active/monitoring/ASSESS10/ticket.md) | READY / unclaimed; after the current ASSESS07 cycle | No conversation assigned | No — prerequisite remains unfinished |
| [OPS00](tasks/active/operations/OPS00/ticket.md) | BLOCKED / unclaimed | No conversation assigned | No — ASSESS07 / ASSESS10 prerequisites |
| [OPS01](tasks/active/operations/OPS01/ticket.md) | BLOCKED / unclaimed | No conversation assigned | No — preceding operations prerequisites |
| [OPS02](tasks/active/operations/OPS02/ticket.md) | BLOCKED / unclaimed | No conversation assigned | No — preceding operations prerequisites |
| [OPS03](tasks/active/operations/OPS03/ticket.md) | BLOCKED / unclaimed | No conversation assigned | No — preceding operations prerequisites |
| [UX01](tasks/active/ui-ux/UX01/ticket.md) | BLOCKED / unclaimed | No conversation assigned | No — after OPS03 |
| [UX02](tasks/active/ui-ux/UX02/ticket.md) | BLOCKED / unclaimed | No conversation assigned | No — after UX01 |
| [UX03](tasks/active/ui-ux/UX03/ticket.md) | BLOCKED / unclaimed | No conversation assigned | No — after UX02 |
| [FIN01](tasks/active/technical-debt/FIN01/ticket.md) | BLOCKED / unclaimed | No conversation assigned | No — after UX03 and required bounded handoff |
| [FIN02](tasks/active/technical-debt/FIN02/ticket.md) | BLOCKED / unclaimed | No conversation assigned | No — after FIN01 |
| [FIN03](tasks/active/technical-debt/FIN03/ticket.md) | BLOCKED / unclaimed | No conversation assigned | No — after FIN02 and required original closeout |
| [NP00](tasks/active/closeout/NP00/ticket.md) | IN_PROGRESS; saved claim retained | A / `martelaxe`, WSL `/home/martelaxe/known-enough`; conversation not verified here | No — preserved A claim; no takeover |
| [LIVE04](tasks/active/live-testing/LIVE04/ticket.md) | IN_PROGRESS; delivery umbrella | Managed evidence through ASSESS07 | No — umbrella does not schedule another worker |

There is no task available for a new B claim at this checkpoint. This does not prevent the assigned ASSESS07 worker from reconciling actual results within its scope. The expired extra receipt does not establish consumption or a live result; inspect actual evidence before deciding what remains. Any later deployment/test must have its own current, specific authorization.

## Claim and completion procedure

1. Fetch and inspect current shared records on every tick. If the assigned worker is active, observe only. If it is idle with unfinished work, inspect its result and resume the same conversation when useful work or a resolved blocker exists. Do not repeat an unchanged authorization blocker.
2. Before a new reservation, require clean `main`, no merge/rebase or unsaved work, a successful `git pull --ff-only origin main`, synchronized heads, satisfied ticket prerequisites and a final claim recheck. Respect preserved claims and the board's sequential route.
3. Record the reservation, account/ID, baseline, exact bounded files, destination and selected model in the ticket, B log/handoff and this log. Check and push the documentation reservation before implementation. RESERVED, assigned, IN_PROGRESS, PAUSED, REVIEW and claimed BLOCKED work are all unavailable. Idle state, silence and elapsed time do not release a claim.
4. Create the one worker conversation with a read-only intake prompt. Save its actual returned `threadId` in these records, check and synchronize the transfer, then explicitly send its task-specific start message. Pending creation or failure retains the reservation; resolve it without creating a duplicate. The user's per-claim delegation authorizes these dispatcher-to-worker start/resume messages.
5. The worker owns only its assigned task and its tracking updates. It performs actual ticket criteria, self-inspection, meaningful focused checks and pinned full checks for executable changes; docs-only work uses links/reference-hash/status checks. It synchronizes verified commits to `origin main` with `[skip ci]` where required and verifies local/remote equality. It reports evidence and stops before claiming anything else.
6. The dispatcher verifies synchronized completion independently before assigning the next eligible task. Record DONE with actual commit/check evidence; preserve the row/history. Release or transfer an unfinished claim only under explicit user/claimant direction, recording the baseline, saved files, checks and remaining work. Fetch/check before every push; a failed or divergent push stops new work and preserves both histories. This log is a coordination record, not an atomic distributed lock.

## Assignment history

- **2026-10-04 UTC — user-directed ASSESS07 worker transfer:** B's original automation claim at 2026-10-03T22:33:43Z / commit `7e6b55d5c1912256b31b278a0593f32e4e26313f` remains the same task and claimant. Clean ff-only setup baseline: `fca5152faaf7fd150ba200377f0aff4b9e263fae`; GitHub `/user` verified `Battosai1806` / ID `143764700`. Old automation conversation becomes dispatcher and stops task implementation. New worker: `01a1044b-4cc8-7c00-b5ee-a24a17ded137`, title “ASSESS07 — Sol Max worker”, created with `gpt-6-sol` / `max`. Its first read-only intake completed; no saved source diff or untracked work exists in this checkout. Worker scope: the ASSESS07 ticket, `docs/work-log-B.md`, `docs/handoff-B.md`, this log and sanitized `docs/review-artifacts/ASSESS07-*.json` results. Source/config/lock/CI and NP00 remain outside the transfer. Extra-run deadline has passed; reconcile results and record any unmet authorization gate without dispatching an expired run. Await checked, synchronized transfer and explicit start.
