# E2E04 — five-account live check

State: **RUNNING**. Started 2026-10-22T16:42:11.809Z; ended pending.

Five isolated synthetic accounts; new owned dinner fixture, four questions and 64 possible plans. Current automatic outcome and explicit independent approvals. No account creation, deployment, setup, schedule changes or old-fixture writes. Five-user execution; twelve-per-page member pagination is outside this small run.

| Case | Result |
| --- | --- |
| 01 | PASS_WITH_INVITATION_REJECTION |
| 02 | PASS_SMALL_GROUP_AND_TWO_PAGE_CATALOG |
| 03 | PASS_CANONICAL_OWNER_READBACK |
| 04 | CORRECT_RESULT_SLOW_66_5_SECONDS |
| 05 | IN_PROGRESS_FOUR_OF_FIVE_APPROVED |
| 06 | IN_PROGRESS_FINAL_SUMMARY_PENDING |

Last action: U01.result. In flight: none.

Observed requests: {"outcome":0,"assistant":7,"aiDraft":1,"plainPosts":5}. Provider usage: UNKNOWN: request counts are not provider-call/token/billing evidence.

- U01.invite: APP_HTTP_409; screenshots/failure-0.png.
- U01.invite: page.goto: net::ERR_ABORTED at https://known-enough.vercel.app/; screenshots/failure-1.png.
- U01.invite: page.goto: net::ERR_ABORTED at https://known-enough.vercel.app/; screenshots/failure-2.png.
- U01.invite: locator.waitFor: Timeout 45000ms exceeded.; screenshot unavailable.
- U04.join: locator.waitFor: Timeout 20000ms exceeded.; screenshot unavailable.
- U02.save: OWN_SELECTIONS_MISMATCH; screenshot unavailable.
- U04.save: OWN_SELECTIONS_MISMATCH; screenshot unavailable.
- U01.open: DECISION_VIEW_NOT_READY; screenshot unavailable.
- U01.open: DECISION_VIEW_NOT_READY; screenshot unavailable.
- U01.chatRead: CHAT_SNAPSHOT_MISSING; screenshot unavailable.

[Summary](summary.json) · [Events](events.jsonl)
