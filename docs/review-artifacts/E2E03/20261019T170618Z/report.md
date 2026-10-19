# E2E03 run report — 2026-10-19

Run `20261019T170618Z` began at 17:06:18 UTC. Both existing synthetic users signed in; their own group reads returned HTTP 200. Each sees six groups, four shared groups, and two U1-organized groups with two members. Neither account lists a `Friday activity` decision or draft. The earlier run omitted its selected group ID, so that historical ID and its request/provider counts remain unknown. Because both current catalogs have no matching target, no `Friday activity` private answer or proposal exists to repeat. The run selected the least-populated qualifying shared group (one existing decision; the other candidate has three); the existing decision will remain untouched.

Last serving evidence is prior, not a fresh read: frontend source `49c460abbbdd69b149255472440a01f1782c6b4b`, Amplify job 149, [publication run 39209992152](https://github.com/Known-Enough/known-enough/actions/runs/39209992152); backend API `912bb05a`, runtime source `6082ba78`, worker `6c4c94f8`, from [the prior receipt](../../ALX02/conversation-repair-publication.json).

| Case | Result | Current evidence |
| --- | --- | --- |
| 01 — two users save private answers | RUNNING | Reconciliation passed. U1 is preparing one no-AI manual choices draft; no answer save has occurred. |
| 02 — one outcome and two approvals | NOT_RUN | Depends on case 01. |
| 03 — optional private assistant | NOT_RUN | Optional; at most one request. |

No application writes, outcome requests, assistant requests, email or provider calls have yet occurred in this run. No screenshots were captured; the reconciliation used authenticated metadata reads only. The remote Node REPL was unavailable (`sandboxCwd is not a local file URI`); the first local script failed before launch (`ERR_AMBIGUOUS_MODULE_SYNTAX`), and two read attempts exposed runner issues (hydration checked too early; Playwright storage state omitted app session storage). Fresh hosted logins recovered successfully; no app HTTP errors or page errors were observed.

See the [append-only event journal](events.jsonl), [incremental summary](summary.json), and [preflight record](preflight.json).
