> **NP00 technical resolution, 2026-10-01T03:31:43Z:** deterministic technical scope is RESOLVED on unchanged executable source `df277dc`: inspected shared output-write tracking, focused runtime/jobs/HTTP 26/26 and clean pinned full check 440 / 2 optional DynamoDB Local skips, hosted 1/1, E2E 47/47. Delayed proposal commit and admitted creation regressions prove awaited stop remains pending until storage settles; admission denial and obsolete-job preservation checks pass. [Current evidence](../np00-technical-closeout.md) records the limits. No live DynamoDB-race proof or new independent PASS is claimed. The original finding/verdict and dated status below remain unchanged history; the NP policy defers independent follow-up.

> **Current routing, 2026-09-30:** technical closeout belongs to [NP00](../tasks/NP00.md). The prior reviewer prerequisite below is deferred under the [NP policy](../next-phase.md); no reviewer PASS or new technical closure is claimed. Keep the original debt/finding evidence below. A-only IAM actions retain separate authorization.

# TD-KE10-01 — KE10 stop/commit race

- Status: **READY — correction and local regression checked; focused independent follow-up deferred until after MVP.** The existing debt queue uses READY for an item that can be scheduled when its closure trigger is reached; it does not mean review passed.
- Priority: P1 before a release-grade KE10 runtime claim. Per the user's 2026-09-28 direction, this item does not block MVP work or separately authorized bounded MVP Bedrock tests.
- Origin: independent KE10 runtime follow-up, CHANGES_REQUESTED on `da76fae782e1d059554e7224ff6b1443b3ea3c84..8d70fd912db3902d08ff04d3778e14a113bcaffa`.
- Decision history: the user first directed deferral so local work could continue, then reprioritized this P1 correction before Bedrock tests. After the correction was implemented and locally checked, the user authorized one live evaluation and deferred the focused independent follow-up. On 2026-09-28 the user clarified that this issue should not pause progress; it remains READY for post-MVP follow-up. The original review verdict remains CHANGES_REQUESTED until that follow-up; this direction does not accept the reviewed runtime.

## Finding

An application proposal write can pass a process-local enabled check, enter an asynchronous DynamoDB transaction, and commit after `runtime.stop()` returns. A temporary barrier probe reproduced an `APPLIED` public proposal after stop. The existing stop regression does not cover a transaction already in flight.

## Intended fix

Awaited `runtime.stop()` will close model-job admission and wait for already-started model-result persistence transactions to settle. The guarantee is that those outputs cannot commit after `stop()` resolves; an already-submitted transaction may finish before `stop()` resolves. Add a delayed-transaction regression for this boundary.

Correction checkpoint: `runtime.stop()` now tracks proposal completion, owner-draft persistence and negotiation-question persistence. The pinned focused test delays a proposal repository commit after application validation and verifies that awaited stop remains pending until the write settles. See the [KE10 ticket](../tasks/KE10.md) for exact test and full-suite results. This is local deterministic evidence, not a live DynamoDB transaction run.

## Closure trigger and required work

The correction and delayed-transaction regression are implemented and checked locally. MVP work and separately authorized bounded MVP Bedrock tests may proceed while this item is deferred. Schedule the already named focused independent follow-up after the MVP, before making a release-grade KE10 runtime claim. If it passes, record the verdict here and close this item. Separate account/configuration and paid-call authorization requirements still apply. Do not add a broader review session.

The original [review record](../reviews/KE10-runtime-followup.md) remains CHANGES_REQUESTED for the exact reviewed artifact. This debt entry is not a PASS, completion, or live-safety claim.
