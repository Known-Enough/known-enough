# E2E02 — Prove the current decision journey

**Latest full rerun complete —11 PASS/5 BLOCKED; qualification BLOCKED.** [Report](run-2026-10-17-201917Z/report.md). AI/manual creation, direct saves, invitations, recovery and membership additions pass. Outcomes remain pending, so final approvals/completed-F/stale-approval qualification remains open. The testing claim is released; published app/configuration unchanged.

**Historical repair checkpoint — repairs published; targeted live checks PASS — 2026-10-17T18:38:06.044180+00:00.** Frontend119/72f1906 and API/worker755440b fix direct answer saves, draft creation, suggestion disclosure and recovery. Live checks saved both owners, created the original failing AI draft, verified invitation fallback and preserved membership progress. [Repair ledger](repairs.md) and [receipt](../../../../review-artifacts/E2E02/repair-publication.json). No new AI calls were made. Full16-case qualification is not claimed; existing full-suite baseline failures remain.

**Earlier partial live runs, retained as history.** Initial run: [E2E02-20261016-222259Z](run-2026-10-16-222259Z/report.md) (1 PASS, 1 FAIL, 14 BLOCKED; dashboard route guard prevented journeys). User-directed rerun: [E2E02-20261016-234411Z](run-2026-10-16-234411Z/report.md) (8 PASS, 4 FAIL, 4 BLOCKED). Username invitations and dashboard acceptance passed. Direct private-answer saves and AI draft creation failed; verified-email invitation and outcome-dependent cases remain blocked. No end-user readiness is claimed.

The rerun used frontend Amplify117 / source6cb97c4 and API source40ec579 / hash6f2bff59. The fresh USERNAME permission inspection passed. That historical baseline is preserved in the report. Use baseline.json for the repaired current release.

- [Task and limits](ticket.md)
- [Exact published baseline and execution order](baseline.json)
- [Exact steps, inputs and expected results](runbook.md)
- [Report template and required images/logs](report-template.md)
- [Private credential setup](../E2E01/credentials.md)

Require actual screenshots, safe request references and case-by-case results. The latest modal, invitation and group-creation regressions are included. A successful deployment or this completed plan is not a passing test run. [E2E01](../E2E01/README.md) remains historical evidence.
Historical E2E02/E2E01 runs are preserved. The latest sixteen-case rerun is linked above; five dependent cases remain blocked.
