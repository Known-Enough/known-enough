# KE10 model/job runtime follow-up review

## Claim

- Status: COMPLETE — CHANGES_REQUESTED; the review claim is released.
- Reviewer: User A / Codex GPT-6, actual runtime variant and effort unexposed. Separate review session and checkout from the KE10 implementation. No subagents.
- Claim time: 2026-09-28 16:11 UTC.
- Clean synchronized review checkout: `/tmp/known-enough-ke10-review`, `main` at `8d70fd912db3902d08ff04d3778e14a113bcaffa`, after successful `git pull --ff-only origin main` (0 ahead / 0 behind).
- Implementation author: User B / Codex GPT-6, exact variant/effort unexposed.
- Review artifact: KE10 runtime source and correction, base `da76fae782e1d059554e7224ff6b1443b3ea3c84`, head `8d70fd912db3902d08ff04d3778e14a113bcaffa`. This covers the Bedrock adapters, async job queue/worker, API composition, application guards, evaluations and the four correction regressions.
- Write scope: this review record, its README link, KE10 ticket/board, and User A handoff/log. Runtime source and tests are read-only.
- Required review scope: model/job isolation, context minimization, output validation, stale/revoked/duplicate delivery guards, stop/kill-switch behavior, retry/error handling, bounds, redacted logs, and the new correction regressions. Run focused adversarial checks and pinned `npm run check`; distinguish reviewer-run checks from author evidence.
- No live Bedrock calls, cloud changes, deployment, paid services or external messages are authorized by this review.

## Verdict — CHANGES_REQUESTED — 2026-09-28 16:33 UTC

**Reviewer:** User A / Codex GPT-6, exact runtime variant/effort unexposed. This review was performed in a separate session and clean clone from the KE10 implementation. **Implementation owner:** User B / Codex GPT-6, exact variant/effort unexposed.

Reviewed base/head: `da76fae782e1d059554e7224ff6b1443b3ea3c84..8d70fd912db3902d08ff04d3778e14a113bcaffa`. SHA-256 of `git diff --binary <base> <head> -- apps packages tests package-lock.json`: `6e411f0e3375886d608ba776fb9804f74b7b8a3020e1cafac28c4b1188e61e3f`.

Reviewed the Bedrock role contexts and response parser in `packages/adapters/src/bedrock-models.ts`; bounded queue, cancellation and envelopes in `packages/adapters/src/model-jobs.ts`; worker/API composition; architect, owner and negotiation context creation; application commit guards; DynamoDB optimistic transactions; runtime/evaluation tests; operational docs and the KE10 corrections.

### P1 — `stop()` can return before an in-flight model result commits

`KnownEnoughApplication.completeReasoning` checks the local runtime flag while applying a candidate in the repository callback (`packages/application/src/known-enough.ts`, around lines 749–790). The DynamoDB repository then sends its transaction and awaits `TransactWriteItems` (`packages/adapters/src/dynamodb.ts`, around line 485). That transaction condition checks the stored decision version, but it contains no model-runtime epoch/disabled state. `createKnownEnoughModelRuntime.stop()` flips a process-local boolean and closes the model queue; it does not wait for or cancel application writes already submitted to a repository (`apps/api/src/model-runtime.ts`, around line 29).

A temporary barrier probe held a proposal write after its transaction callback had validated and mutated the record but before repository commit. Calling `runtime.stop()` returned; releasing the write committed the candidate, and `negotiator.generate()` returned `APPLIED` with a public proposal. The probe reproduced the same ordering window as an async DynamoDB write. The committed regression stops before `completeReasoning` begins, so it does not cover this in-flight commit race.

**Required before release:** define and enforce the stop boundary. Either make stop coordinate with pending application commits (and test that awaiting stop means no later output can commit), or add a transactionally checked runtime generation/disable record. If the intended behavior permits writes already submitted to DynamoDB to finish, document that precise limitation and revise the kill-switch guarantee. Add a delayed-transaction regression. Do not treat the current local test alone as proof of the distributed commit boundary.

No other blocking cross-owner disclosure path was found in the reviewed context construction: architect inputs are public, owner extraction receives only that owner's structured/private state and submitted turns, negotiation receives structured trusted constraints without raw statements, and model-selected proposal values must match a trusted public catalog. Public explanations remain deterministic. These conclusions apply to the inspected artifact and do not claim live-provider behavior.

## Checks and evidence

- Focused pinned run: `npm test -- packages/adapters/src/model-jobs.test.ts packages/adapters/src/bedrock-models.test.ts apps/api/src/model-runtime.test.ts apps/api/src/known-enough-http.test.ts` — **38/38 passed**.
- Temporary adversarial barrier probe — **reproduced** the finding above (the probe file was removed and is not part of the reviewed source or commit).
- Pinned full run: Node **24.21.0**, npm **11.19.0**, `npm run check` — exit 0; 7 imported reference hashes, 15 planning checks, lint/boundaries 158, typecheck, **355 tests passed / 2 DynamoDB Local skips**, production and hosted builds, hosted browser **1/1**, E2E **44/44**. Log SHA-256: `349dfc8cea57a9f5d484fe102bcf681e8b58b239cf858865eae10d3cc102db56` (`/tmp/ke10-review-full.log`, local temporary evidence).
- Current AWS documentation confirms `amazon.nova-lite-v1:0` and in-region `us-east-1` availability with Converse. This does not establish account access, quota, retention settings, quality, price or live behavior. [Nova Lite model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-lite.html), [Converse API reference](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html).
- No live Bedrock call, AWS identity check, cloud mutation, deployment, spending or external message was performed. The two DynamoDB Local skips mean the checked suite does not exercise a real async storage transaction.

KE10 remains BLOCKED. The review claim is released for a bounded correction; no implementation task is active until a writer claims it. Review only the changed stop/commit boundary in a sequential follow-up. Separately authorized live Bedrock evidence remains outstanding. No task acceptance or user sign-off is inferred.
