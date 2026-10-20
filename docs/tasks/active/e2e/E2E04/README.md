# E2E04 — Fifteen people, one agreed plan

**FAIL / execution completed; claim released.** Four cases passed and two failed. All fifteen users saved their exact answers and independently approved the same correct plan, visible in9.532s. Three initial save503s required reconciled recovery; two assistant summaries remained UNAVAILABLE. The strict draft-label criterion required manual normalization. [Final report](../../../../review-artifacts/E2E04/20261020T032500Z/report.md), [precise follow-ups](../../../../review-artifacts/E2E04/20261020T032500Z/followups.md). Node24.19 used under the user’s override.

The agreed demonstration, two saved drafts and five empty pagination groups are retained for inspection. Do not repeat its outcome, approvals or failed assistant requests.

- [Task, steps and evidence](ticket.md)
- [Exact synthetic response matrix](answers.csv)

Use the existing worker and the fifteen approved synthetic accounts `test04`–`test18`. Creation of this task starts no tests, agents, chats, deployments or schedules. Setup/credential availability must be verified on the execution machine, not inferred from a prepared CloudShell command.

## Updated after the E2E03 repair — 2026-10-19

The [two-user final readback passed](../../../../review-artifacts/E2E03/20261019T230825Z/report.md). The ticket now uses the current owner-snapshot/modal loading path, preserves the agreed E2E03 fixture, requires durable six-case logging and exact per-user save/approval readback, and uses the current group/private assistant buttons.

That readiness review was documentation-only. The current user-requested run has since verified the exact fifteen-account file and prepared `scripts/e2e04/session-runner.mjs`; the older two-account file finding is historical. Follow the current run report for actual execution results.


## Historical preflight — 20261020T031040Z

Credentials verified privately (exact accounts, file mode 0600, directory mode 0700). Public site HEAD returned 200. Browser execution did not start because the required Node 24.21.0 runtime is unavailable; the installed Playwright package is present but was not used. All six cases remain NOT_RUN. No login, app writes, AI calls, provider calls or screenshots. The later user override authorized Node24.19; see the completed run above.
