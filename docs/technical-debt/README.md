> **Current routing, 2026-10-02:** Local assessment corrections belong to B's sequential ASSESS01–06/08 scope, managed acceptance to ASSESS07/LIVE04, and NP00 to A. [OPS01](../tasks/active/operations/OPS01/ticket.md), [OPS02](../tasks/active/operations/OPS02/ticket.md) and [OPS03](../tasks/active/operations/OPS03/ticket.md) record wider-use capacity/archive, retention/erasure and distributed-job work. A's latest [NP00 checkpoint](../np00-technical-closeout.md) records model-off and temporary permission cleanup; older "cleanup awaits host" text below is historical, not fresh inspection. Preserve named evidence; no NP00 status is changed here.

# Technical debt — current routing

All existing technical obligations route through [NP00](../tasks/active/closeout/NP00/ticket.md), the first task in the [NP queue](../task-board.md). Do not claim a TD/KE task in parallel. The old independent review prerequisite is deferred by the [current user direction](../next-phase.md); actual technical checks remain required, and old review verdicts are preserved.

| Item | Current work | Status |
| --- | --- | --- |
| [TD-KE10-01](TD-KE10-01-stop-commit-race.md) | Stop/admission/newer-job inspection and delayed-storage regressions pass on unchanged supported-host source; [NP00 evidence](../np00-technical-closeout.md) | Deterministic technical scope resolved; no live-race claim; former independent follow-up deferred |
| [TD-KE10-02](TD-KE10-02-bedrock-permission-set-name.md) | [Guarded A-only CLI plan](../../infra/np00-permission-set-cleanup.md) prepared; actual cleanup/readback awaits A's configured AWS host and separate authorization | Open; NP00 |
| KE14 source/staging/check gaps | Source hashes and supported-host full check pass; frontend bytes verified. Lambda/IAM/complete managed synthetic qualification still pending | Open for remaining live scope; NP00 |

The task batch is administratively closed; these technical obligations are not erased or called verified. Update items only with actual NP00 evidence. Human trials, reviewer sessions and submission materials are outside technical-debt cleanup.

## Historical debt queue

# Technical debt

This folder tracks intentionally deferred defects that still matter for a stated boundary.

`READY` means the debt is recorded and can be scheduled when its trigger is reached. It does not mean the affected implementation passed review or is safe for live or release use. Each item names the work allowed during deferral and the conditions that require closure.

## Queue

| ID | Status | Item | Required before |
| --- | --- | --- | --- |
| [TD-KE10-01](TD-KE10-01-stop-commit-race.md) | READY | Stop/commit correction and local regression checked; focused follow-up deferred until after MVP | Before a release-grade KE10 runtime claim; does not block MVP work or separately authorized bounded MVP Bedrock tests |
| [TD-KE10-02](TD-KE10-02-bedrock-permission-set-name.md) | READY | Move Nova Lite access off the `ReadOnlyAccess` permission set to a clearly named test permission set | Before granting direct Bedrock test access to another user |
