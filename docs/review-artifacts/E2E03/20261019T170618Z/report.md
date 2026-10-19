# E2E03 run report — 2026-10-19

Run `20261019T170618Z` began at 17:06:18 UTC. Both synthetic users signed in; their group lists returned HTTP 200. Each sees six groups, four shared groups, and two U1-organized two-member groups. Neither lists a `Friday activity` decision or draft. The earlier run omitted its selected group ID and request counts. The new run selected the less populated qualifying shared group (one existing decision; the other candidate has three); existing items remain untouched.

The first local draft-form attempt timed out without recording its exact stage or request-failure routes. A fresh U1 readback then returned HTTP 200 for the group and its draft-request list: zero `Friday activity` drafts, zero decisions, and zero pending requests. The previous save is therefore NOT_PERSISTED; its exact request dispatch remains unavailable. The same draft may now be entered once with a stage-instrumented runner.

Last serving evidence is prior, not a fresh read: frontend source `49c460abbbdd69b149255472440a01f1782c6b4b`, Amplify job 149, [publication run 39209992152](https://github.com/Known-Enough/known-enough/actions/runs/39209992152); backend API `912bb05a`, runtime source `6082ba78`, worker `6c4c94f8`, from [the prior receipt](../../ALX02/conversation-repair-publication.json).

| Case | Result | Current evidence |
| --- | --- | --- |
| 01 — two users save private answers | RUNNING | Reconciliation is clear; one manual draft save is being retried once. No answer save yet. |
| 02 — one outcome and two approvals | NOT_RUN | Depends on case 01. |
| 03 — optional private assistant | NOT_RUN | Optional; at most one request. |

The earlier controller ended with `TimeoutError` after 36.651 seconds; its exact UI stage and four request-failure routes were not retained. One member-profile GET returned HTTP 503 and later reads returned HTTP 200. On fresh reconciliation, three unrelated decision-status requests were cancelled by navigation (`net::ERR_ABORTED`); no page errors or failed reconciliation reads occurred. No outcome, assistant, email or provider action has been attempted. No screenshots were captured.

See the [append-only event journal](events.jsonl), [incremental summary](summary.json), and [preflight record](preflight.json).
