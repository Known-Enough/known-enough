# TD-KE10-01 — KE10 stop/commit race

- Status: **REVIEW — correction checked; focused independent follow-up pending.**
- Priority: P1 before live or release-grade use.
- Origin: independent KE10 runtime follow-up, CHANGES_REQUESTED on `da76fae782e1d059554e7224ff6b1443b3ea3c84..8d70fd912db3902d08ff04d3778e14a113bcaffa`.
- Decision history: the user first directed deferral so local work could continue, then reprioritized this P1 correction before Bedrock tests. The original review verdict remains CHANGES_REQUESTED until a focused independent follow-up; neither instruction accepts the reviewed runtime.

## Finding

An application proposal write can pass a process-local enabled check, enter an asynchronous DynamoDB transaction, and commit after `runtime.stop()` returns. A temporary barrier probe reproduced an `APPLIED` public proposal after stop. The existing stop regression does not cover a transaction already in flight.

## Intended fix

Awaited `runtime.stop()` will close model-job admission and wait for already-started model-result persistence transactions to settle. The guarantee is that those outputs cannot commit after `stop()` resolves; an already-submitted transaction may finish before `stop()` resolves. Add a delayed-transaction regression for this boundary.

Correction checkpoint: `runtime.stop()` now tracks proposal completion, owner-draft persistence and negotiation-question persistence. The pinned focused test delays a proposal repository commit after application validation and verifies that awaited stop remains pending until the write settles. See the [KE10 ticket](../tasks/KE10.md) for exact test and full-suite results. This is local deterministic evidence, not a live DynamoDB transaction run.

## Closure trigger and required work

The correction and delayed-transaction regression are implemented and checked locally. The remaining closure step is the already named focused independent follow-up on this exact correction. If it passes, record the verdict here and close this item. Keep live Bedrock calls gated until that review passes and the ticket's separate account/configuration and paid-call requirements are satisfied. Do not add a broader review session.

The original [review record](../reviews/KE10-runtime-followup.md) remains CHANGES_REQUESTED for the exact reviewed artifact. This debt entry is not a PASS, completion, or live-safety claim.
