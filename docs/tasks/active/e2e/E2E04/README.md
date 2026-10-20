# E2E04 — Fifteen people, one agreed plan

**RUNNING / current user-requested execution.** The user explicitly authorized Node24.19. All fifteen exact synthetic accounts authenticated with approved app access; the fifteen-alias recorder is running. [Current report](../../../../review-artifacts/E2E04/20261020T032500Z/report.md).

One shared dinner decision will collect fifteen independent private responses and explicit approvals, with assistant/privacy, pagination and layout checks.

- [Task, steps and evidence](ticket.md)
- [Exact synthetic response matrix](answers.csv)

Use the existing worker and the fifteen approved synthetic accounts `test04`–`test18`. Creation of this task starts no tests, agents, chats, deployments or schedules. Setup/credential availability must be verified on the execution machine, not inferred from a prepared CloudShell command.

## Updated after the E2E03 repair — 2026-10-19

The [two-user final readback passed](../../../../review-artifacts/E2E03/20261019T230825Z/report.md). The ticket now uses the current owner-snapshot/modal loading path, preserves the agreed E2E03 fixture, requires durable six-case logging and exact per-user save/approval readback, and uses the current group/private assistant buttons.

That readiness review was documentation-only. The current user-requested run has since verified the exact fifteen-account file and prepared `scripts/e2e04/session-runner.mjs`; the older two-account file finding is historical. Follow the current run report for actual execution results.


## Latest execution intake — 20261020T031040Z

Credentials verified privately (exact accounts, file mode 0600, directory mode 0700). Public site HEAD returned 200. Browser execution did not start because the required Node 24.21.0 runtime is unavailable; the installed Playwright package is present but was not used. All six cases remain NOT_RUN. No login, app writes, AI calls, provider calls or screenshots. Resume only after the required runtime is available on this execution machine.
