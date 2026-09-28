# TD-KE10-01 — KE10 stop/commit race

- Status: **READY — intentionally deferred for local MVP progress.**
- Priority: P1 before live or release-grade use.
- Origin: independent KE10 runtime follow-up, CHANGES_REQUESTED on `da76fae782e1d059554e7224ff6b1443b3ea3c84..8d70fd912db3902d08ff04d3778e14a113bcaffa`.
- Decision: on 2026-09-28, the user directed that this issue be saved as technical debt so local work can continue. This defers the fix; it does not accept the reviewed runtime or change the review verdict.

## Finding

An application proposal write can pass a process-local enabled check, enter an asynchronous DynamoDB transaction, and commit after `runtime.stop()` returns. A temporary barrier probe reproduced an `APPLIED` public proposal after stop. The existing stop regression does not cover a transaction already in flight.

## Work allowed while deferred

Continue local development and tests that do not make live Bedrock calls or present the runtime as release-ready. KE11 may proceed with local/test-auth session work. Cloud changes, paid provider calls, deployment and publication still require their separate authorization.

## Closure trigger and required work

Close this item before any live Bedrock evaluation or release-grade use. Choose and document the intended stop boundary, then either make `stop()` wait for pending application commits or transactionally check a runtime generation/disabled record. Add a delayed-transaction regression proving the selected behavior. Run the focused stop/commit checks and the ticket-required pinned check, then request the already named focused independent follow-up. Do not add a broader review session.

The original [review record](../reviews/KE10-runtime-followup.md) remains CHANGES_REQUESTED for the exact reviewed artifact. This debt entry is not a PASS, completion, or live-safety claim.
