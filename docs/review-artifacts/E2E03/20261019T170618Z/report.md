# E2E03 run report — 2026-10-19

Run `20261019T170618Z` started at 17:06:18 UTC. This is a new bounded attempt; the previous incomplete run remains unchanged. U1 sign-in is now verified by authenticated reads: `GET /groups` returned HTTP 200 three times, and `GET /decisions/:id/me` returned HTTP 200 four times. Six groups were visible. The text-only sign-in check was a runner mistake because the signed-in header uses an icon; no failed app requests or page errors were observed.

Last known serving evidence remains prior evidence, not a fresh read: frontend source `49c460abbbdd69b149255472440a01f1782c6b4b`, Amplify job 149, [publication run 39209992152](https://github.com/Known-Enough/known-enough/actions/runs/39209992152); API `912bb05a`, runtime source `6082ba78`, worker `6c4c94f8`, from [the prior receipt](../../ALX02/conversation-repair-publication.json).

| Case | Result | Current evidence |
| --- | --- | --- |
| 01 — two users save private answers | NOT_RUN | Read-only reconciliation of the old group and any `Friday activity` decision is still required before writes. |
| 02 — one outcome and two approvals | NOT_RUN | Depends on case 01. |
| 03 — optional private assistant | NOT_RUN | Optional; at most one request. |

No application writes, answer saves, outcome requests, email or AI calls occurred. The old fixture remains unresolved. The remote Node console could not attach (`sandboxCwd is not a local file URI`); local Node/Playwright/Chromium were available. One script failed before browser launch with `ERR_AMBIGUOUS_MODULE_SYNTAX`; another inspected the page before frontend hydration and therefore made no authenticated group request. The corrected sign-in is verified by server responses, but no screenshot was captured. Next action: wait for hydration, restore U1’s private session, and inspect only group/decision metadata to identify the old fixture.

See the [append-only event journal](events.jsonl), [incremental summary](summary.json), and [preflight record](preflight.json).
