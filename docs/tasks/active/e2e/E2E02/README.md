# E2E02 — Prove the current decision journey

**Partial live runs complete; qualification NOT VERIFIED.** Initial run: [E2E02-20261016-222259Z](run-2026-10-16-222259Z/report.md) (1 PASS, 1 FAIL, 14 BLOCKED; dashboard route guard prevented journeys). User-directed rerun: [E2E02-20261016-234411Z](run-2026-10-16-234411Z/report.md) (8 PASS, 4 FAIL, 4 BLOCKED). Username invitations and dashboard acceptance passed. Direct private-answer saves and AI draft creation failed; verified-email invitation and outcome-dependent cases remain blocked. No end-user readiness is claimed.

The rerun used frontend Amplify117 / source6cb97c4 and API source40ec579 / hash6f2bff59. The fresh USERNAME permission inspection passed. A subsequent plan refresh retained the same release baseline; use it for any future dependent rerun after the reported defects are addressed.

- [Task and limits](ticket.md)
- [Exact published baseline and execution order](baseline.json)
- [Exact steps, inputs and expected results](runbook.md)
- [Report template and required images/logs](report-template.md)
- [Private credential setup](../E2E01/credentials.md)

Require actual screenshots, safe request references and case-by-case results. The latest modal, invitation and group-creation regressions are included. A successful deployment or this completed plan is not a passing test run. [E2E01](../E2E01/README.md) remains historical evidence.
Both E2E02 runs preserve E2E01 as historical evidence. The next work is a focused repair of direct answer saves and a worker-hash reconciliation before dependent journeys are rerun.
