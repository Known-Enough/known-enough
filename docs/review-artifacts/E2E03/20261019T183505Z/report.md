# E2E03 live retest 20261019T183505Z

State: **RUNNING**. Started 2026-10-19 18:35:05.698 UTC. This run checks whether the previously observed account-loading failure recurs. It reuses the acknowledged `Friday activity` fixture and creates no group, draft, or decision.

The deployed API remains source `5499a8e8a7116c8204b7da33fe161139120182b3`, the worker package is `33f5d50edb119df13ba570993bfea388d42dfb8c56883e506efb2748ca6eb674`, and the frontend is Amplify job `145`. No application fix has been deployed since the prior account failure. Previous server evidence recorded `account.status` returning 503 with `TransactionCanceledException`; its exact cause was not logged.

Planned: sign in U1/U2, reconcile the existing group/draft/decision, then open it. If the questionnaire loads and both existing answer states are confirmed absent, save each synthetic answer once and verify each owner’s readback. Stop at the first failure. No outcome or assistant request is planned.

| Case | Result |
| --- | --- |
| 01 — two private saves | NOT_RUN |
| 02 — one outcome/two approvals | NOT_RUN |
| 03 — optional assistant | NOT_RUN |

[Events](events.jsonl) · [Summary](summary.json)
