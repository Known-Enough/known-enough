# E2E03 run report — 2026-10-19

Run `20261019T170618Z` started at 17:06:18 UTC and ended BLOCKED at 17:26:29 UTC. The project-root `e2ecredentials.json` was read privately (mode 0600, two synthetic accounts); no credential values were logged. Both U1 and U2 authenticated successfully in earlier fresh sessions and received HTTP 200 group reads. Each saw six groups, four shared groups, and two U1-organized two-member groups. Neither current catalog contained a `Friday activity` decision or draft. The earlier attempt did not record its selected group ID or request counts. The new run selected the least populated qualifying group (one existing decision, with both owner views showing saved-answer readiness) and left that decision untouched.

A first form attempt timed out after 36.651 seconds without recording its exact stage or request-failure routes. A fresh U1 readback then returned HTTP 200 for the group and its draft-request queue: zero matching drafts, decisions or pending requests. The earlier save was therefore NOT_PERSISTED, and no save was repeated while that state was uncertain.

The instrumented retry submitted U1 sign-in but did not receive authenticated `GET /groups` within 45 seconds. It never reached the selected group or the draft form. The instrumented retry sent no write request, outcome request, assistant request, email or paid-model action. The first form attempt’s write dispatch remains unknown, but its fresh readback showed no persisted draft or pending request. No page error was observed in the last retry, but the reason the group response did not arrive is unverified. No screenshot was captured because the authenticated group page was not reached.

Last serving evidence is prior, not a fresh readback: frontend source `49c460abbbdd69b149255472440a01f1782c6b4b`, Amplify job 149, [publication run 39209992152](https://github.com/Known-Enough/known-enough/actions/runs/39209992152); backend API `912bb05a`, runtime source `6082ba78`, worker `6c4c94f8`, from [the prior receipt](../../ALX02/conversation-repair-publication.json).

| Case | Result | Actual result |
| --- | --- | --- |
| 01 — two users save private answers | BLOCKED | Reconciliation found no old Friday item or pending request; retry stopped before app writes on authenticated group-read timeout. |
| 02 — one outcome and two approvals | NOT_RUN | Depends on case 01. |
| 03 — optional private assistant | NOT_RUN | Optional and not attempted. |

No app write is confirmed. Provider calls from this run: 0; token usage was not read. Earlier old-run request/provider counts remain UNKNOWN. The remote Node REPL had failed before app access (`sandboxCwd is not a local file URI`); a local CommonJS script initially failed before browser launch (`ERR_AMBIGUOUS_MODULE_SYNTAX`). The first group inspection checked before frontend hydration, and Playwright storage state did not preserve session storage; those issues were corrected for later successful reads. One member-profile GET returned HTTP 503 and later reads returned HTTP 200. The final retry’s exact wait failure is confirmed; its underlying cause is not.

See the [append-only event journal](events.jsonl), [incremental summary](summary.json), and [preflight record](preflight.json). Next step before any future E2E03 write: repair and verify the caller-side authenticated-group readiness check, then repeat the read-only fixture reconciliation.
