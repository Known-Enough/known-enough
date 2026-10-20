# E2E04 20261020T032500Z

State: **RUNNING**. Started 2026-10-20T03:23:37.850Z. 

Node v24.19.0; project Playwright1.63.0; installed Chrome. User authorized the available Node24.19 runtime. Fifteen isolated synthetic identities; at most three open pages. Scope: one primary dinner decision, up to six newly created groups, one outcome, fifteen separate saves/approvals/posts, up to eight assistant questions and one optional AI draft request. Prior E2E03 agreed fixture is preserved.

| Case | Result |
| --- | --- |
| 01 | PASS |
| 02 | PASS |
| 03 | NOT_RUN |
| 04 | NOT_RUN |
| 05 | NOT_RUN |
| 06 | NOT_RUN |

Last verified serving baseline: source1f7d441 / APIe8338c82 / workerc4258495 / frontend152. Live evidence and credential readiness are recorded in the summary; a documentation commit is not a serving release.

Last confirmed action: U01.capture.d0a644. In flight: none.

Observed UI requests: {"outcome":1,"assistant":2,"aiDraft":1,"plainPosts":15}. Provider calls/tokens/billed cost: UNKNOWN unless separately recorded.

- U01.invite.3ca912: APP_HTTP_409; screenshot screenshots/failure-0.png.
- U01.suggest.a2a5b9: locator.isDisabled: Timeout 20000ms exceeded.
Call log:
[2m  - waiting for getByRole('button', { name: 'Suggest options', exact: true })[22m
; screenshot screenshots/failure-1.png.
- U01.acceptSuggestions.47ada4: AI_TOPIC_LABEL_MISMATCH; screenshot NOT_AVAILABLE.
- U01.manualOptions.a236c1: locator.selectOption: Timeout 20000ms exceeded.
Call log:
[2m  - waiting for locator('[data-topic="0"]').getByLabel('Options format', { exact: true })[22m
; screenshot NOT_AVAILABLE.
- U01.saveDraft.d28e3e: locator.click: Timeout 20000ms exceeded.
Call log:
[2m  - waiting for getByRole('button', { name: 'Save draft', exact: true })[22m
; screenshot NOT_AVAILABLE.
- U01.saveAnswer.138948: DECISION_VIEW_NOT_READY; screenshot NOT_AVAILABLE.
- U03.saveAnswer.0e1558: APP_HTTP_503; screenshot NOT_AVAILABLE.
- U09.saveAnswer.938eb4: APP_HTTP_503; screenshot NOT_AVAILABLE.
- U13.saveAnswer.35fadf: APP_HTTP_503; screenshot NOT_AVAILABLE.

[Summary](summary.json) · [Events](events.jsonl)
