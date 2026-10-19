# E2E03 run report — 2026-10-19

Run `20261019T170618Z` began at 17:06:18 UTC. Both synthetic users signed in and their own group reads returned HTTP 200. Each sees six groups, four shared groups, and two U1-organized two-member groups. Neither lists a `Friday activity` decision or draft. The earlier run omitted its selected group ID and request counts. Because no matching target is currently visible, the run selected the less populated qualifying shared group (one existing decision; the other candidate has three) and will leave all existing items untouched.

Last serving evidence is prior, not a fresh read: frontend source `49c460abbbdd69b149255472440a01f1782c6b4b`, Amplify job 149, [publication run 39209992152](https://github.com/Known-Enough/known-enough/actions/runs/39209992152); backend API `912bb05a`, runtime source `6082ba78`, worker `6c4c94f8`, from [the prior receipt](../../ALX02/conversation-repair-publication.json).

| Case | Result | Current evidence |
| --- | --- | --- |
| 01 — two users save private answers | BLOCKED pending reconciliation | U1’s manual-choice form attempt timed out before a draft-save response was captured. Whether the save request was sent is unknown; saved state must be checked before retry. |
| 02 — one outcome and two approvals | NOT_RUN | Depends on case 01. |
| 03 — optional private assistant | NOT_RUN | Optional; at most one request. |

The controller returned `TimeoutError` after 36.651 seconds but failed to retain the exact failing UI step or request-failure routes (four request failures were counted). No draft-save or decision-create HTTP response was observed; this does not prove the save was not sent. One member-profile GET returned HTTP 503 and later reads returned HTTP 200; no page errors were observed. No outcome or assistant action was attempted. No screenshot was captured because the controller timed out.

No app write is confirmed. Next safe action: log in as U1 and read the saved draft list and draft-request statuses; do not repeat Save draft until that readback resolves dispatch. See the [append-only event journal](events.jsonl), [incremental summary](summary.json), and [preflight record](preflight.json).
