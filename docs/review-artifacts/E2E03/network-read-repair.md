# E2E03 browser read recovery and early failure repair

Status: CODE_READY; publication pending. User explicitly requests repair with no tests. The historical [21:52Z run](20261019T215250Z/report.md) remains BLOCKED. Its U2 answer is acknowledged and must not be submitted again before a read-only owner check.

## Evidence

The browser recorded network-level failures, rather than readable HTTP error responses. Code inspection confirms the storage-transition, native Lambda and loopback-transport fallback paths returned errors without exact-origin CORS, and several paths used a fixed or missing error reference. The ordinary account diagnostics reader therefore could not explain these early failures. An expanded read-only reader found one `partition-storage-transition` / `SOURCE_UNAVAILABLE` event at 2026-10-19T21:53:12.450Z ([reader run](https://github.com/Known-Enough/known-enough/actions/runs/39331823826), [sanitized artifact](network-read-diagnosis.json)). This is time-window evidence only; there is no matching browser UUID or initiating exception detail, and it does not establish the exact cause of each browser failure.

## Focused changes

- All early API fallbacks share exact configured-origin CORS, no-store, a fresh opaque UUID and a safe stage/error-category diagnostic. No wildcard origin, raw error message, request body, token or identity is logged. Signup trigger failures remain sanitized.
- The ephemeral loopback HTTP bridge sends `Connection: close` so its one-invocation listener does not reuse pooled sockets across close/reopen boundaries. Historical pooled-socket causation is unproven; this removes that transport hazard. Retry-After/reference headers survive the bridge.
- The browser repeats a GET at most once for a transport TypeError or HTTP502/503/504, using the original deadline and cancellation signal. It honors bounded numeric Retry-After, refuses a longer/date delay and rechecks session expiry. POSTs, approvals, consent, AI jobs and other writes are never replayed. No snapshot/cache fallback substitutes for current server data.
- The bounded diagnostics reader includes early gateway/source failures. The E2E03 login wait tolerates the browser's first recoverable service response while retaining all HTTP evidence.

## Verification boundary

TypeScript compilation, changed-file ESLint, runner/Python syntax and whitespace passed. No unit/browser/live/product/AI/signup test was run. The repair improves failure handling and traceability; live recovery and the remaining outcome scenario are unverified.
