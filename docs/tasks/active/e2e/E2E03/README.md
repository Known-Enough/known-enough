# E2E03 — Small regression check

**BLOCKED / claim released (2026-10-19).** Both synthetic users authenticated; the read-only check found no `Friday activity` item or pending draft request. The old selected group ID remains unknown. The instrumented save retry stopped before app writes because the authenticated group-list response did not arrive within 45 seconds. Case 01 BLOCKED; cases 02–03 NOT_RUN. [Latest run report](../../../../review-artifacts/E2E03/20261019T170618Z/report.md); [historical report](../../../../review-artifacts/E2E03/20261019T065759Z/report.md).

[Steps, limits and reporting](ticket.md). Reuse the existing worker and private synthetic credentials. Task creation starts no tests, agents, chats or automation.

**Next-attempt reporting requirements updated:** [Durable execution reporting](execution-reporting.md) requires a published started record, host-side per-action intents/results, incremental summary, exact sanitized tool/HTTP errors, evidence-availability reasons and crash/read-only reconciliation records. Recorder readiness must be confirmed before test writes. The reporting contract was used for the latest bounded attempt. It still cannot diagnose the final authenticated-group read timeout; no product failure or historical request result is inferred.
