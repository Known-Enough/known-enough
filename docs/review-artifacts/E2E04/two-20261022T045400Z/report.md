# E2E04 — two-account live check

State: **PARTIAL_CHECKPOINT**. Started 2026-10-22T04:49:28.496Z; ended 2026-10-22T04:58:19.707Z.

Two isolated synthetic accounts; new owned dinner fixture, four questions and64 possible plans. Current automatic outcome and explicit independent approvals. No account creation, deployment, setup, schedule changes or old-fixture writes. Five/fifteen-user capacity and member pagination are outside scope.

| Case | Result |
| --- | --- |
| 01 | PASS |
| 02 | PASS |
| 03 | PASS |
| 04 | NOT_RUN |
| 05 | NOT_RUN |
| 06 | NOT_RUN |

Last action: U02.proposal. In flight: none.

Observed requests: {"outcome":1,"assistant":2,"aiDraft":1,"plainPosts":2}. Provider usage: UNKNOWN: request counts are not provider-call/token/billing evidence.

- U02.chatRead: CHAT_SNAPSHOT_MISSING; screenshots/failure-0.png.
- U02.approve: APP_HTTP_409; screenshots/failure-1.png.

[Summary](summary.json) · [Events](events.jsonl)
