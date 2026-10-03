# Task guide

Start here to understand what is left. Every task has its own folder: README.md explains the basic idea and next step; ticket.md contains its full requirements, claim and evidence. The [shared board](../task-board.md) decides the current order. One implementation task at a time; a folder move does not release an existing claim.

## Online testing

Installation, GitHub settings and the automatic trigger are verified. Publishing, public website/configuration checks and cleanup passed after the IAM repair; the signup test needs correction and complete live PASS is still pending. After an authorized eligible app deployment succeeds, GitHub runs the qualification automatically; B does not need A's AWS credentials or a manual Run workflow click.

| Task | Basic idea | Status |
| --- | --- | --- |
| [LIVE04](active/live-testing/LIVE04/README.md) | Prove the installed online test environment works from start to finish. Installation and GitHub settings are ready; real test results and cleanup evidence are still needed. | IN_PROGRESS |
| [ASSESS07](active/live-testing/ASSESS07/README.md) | Collect real online proof that all required user journeys, safety checks and cleanup pass automatically after a matching successful deployment. | BLOCKED |

## B's existing monitor

| Task | Basic idea | Status |
| --- | --- | --- |
| [ASSESS10](active/monitoring/ASSESS10/README.md) | Check that B's existing Codex monitor actually runs about every five minutes and reads fresh AWS results. A's monitor has been removed. | READY / unclaimed |

## Remaining technical closeout

| Task | Basic idea | Status |
| --- | --- | --- |
| [NP00](active/closeout/NP00/README.md) | Finish the remaining technical obligations from the previous batch. The model-off safety checkpoint is verified; other closeout evidence still belongs here. | IN_PROGRESS |

## Later, before wider use

These tasks wait for the managed ASSESS07 baseline.

| Task | Basic idea | Status |
| --- | --- | --- |
| [OPS01](active/operations/OPS01/README.md) | Prepare group storage and safe archiving for wider use, after the real online test baseline is verified. | BLOCKED / unclaimed |
| [OPS02](active/operations/OPS02/README.md) | Add clear retention, export and authorized deletion of private data before wider use. | BLOCKED / unclaimed |
| [OPS03](active/operations/OPS03/README.md) | Make AI jobs recover safely across worker restarts and retries, with current permissions and spending limits checked. | BLOCKED / unclaimed |

## Where earlier work went

[Historical tasks](historical/README.md) contain completed work, superseded plans and closed previous batches. They retain original evidence and unfinished obligation mappings. Moving a task there does not mean its missing live checks passed.

New tasks use active/<group>/<TASK-ID>/README.md and ticket.md. When finished or superseded, move the folder into the appropriate historical group, preserve original evidence, update links and record the relocation. Do not keep duplicate live tickets at the old flat paths. [Relocation manifest](relocations.json) maps all 73 original task documents, including the two earlier policy follow-up tickets.
