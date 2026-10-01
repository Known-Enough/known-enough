# Technical debt — current routing

All existing technical obligations route through [NP00](../tasks/NP00.md), the first task in the [NP queue](../task-board.md). Do not claim a TD/KE task in parallel. The old independent review prerequisite is deferred by the [current user direction](../next-phase.md); actual technical checks remain required, and old review verdicts are preserved.

| Item | Current work | Status |
| --- | --- | --- |
| [TD-KE10-01](TD-KE10-01-stop-commit-race.md) | Verify/fix stop-and-drain behavior with meaningful delayed-storage regressions; record technical closure in NP00 | Open technical closeout; former independent follow-up deferred |
| [TD-KE10-02](TD-KE10-02-bedrock-permission-set-name.md) | A's separately authorized least-privilege permission-set cleanup/readback | Open; NP00 |
| KE14 source/staging/check gaps | Reconcile source/deployment, fix inherited verification failures and qualify existing live synthetic scenarios | Open; NP00 |

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
