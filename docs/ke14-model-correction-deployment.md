# KE14 reviewed model correction release — 2026-09-30

**Exact independently reviewed correction integrated at `46441d7` and deployed successfully.** User explicitly requested proceeding; prior deployment/paid synthetic use authorization persists. User A / Codex GPT-6, exact variant/effort unexposed. Baseline synchronized main `38bc8da`, ff-only pull and ahead/behind 0/0, with only the two retained frozen reviewed files; single integration/release claim published in `900b81e`. [Independent PASS](reviews/KE14-live-model-followup.md) on patch SHA-256 `730b18b636b18272e02de019d53f5616432e72e2973aed98d29a0e853fa2df89` matches retained bytes exactly. No new source design or additional independent review inferred.

## Source integration and verification

Only `packages/adapters/src/bedrock-models.ts` and its reviewed regression changed executable code: forced negotiation tool requires declared `candidateIndex`; architect public draft guidance preserves supplied IDs and distinguishes later private requirements. Source hashes remain `aff55f1311a050ec1247a43b2fae63e5468e4aaacec432398b00346c6fe37d18` and test `f8a940423de8ba042d9531b0ca81e3552276a7f7ee4f6eea0fd623ee0a326c76`.

Fresh restored pinned Node 24.21.0/npm 11.19.0, npm ci and Chromium, isolated archive `/tmp/ke14-correction-integration-38bc8da`: full `npm run check` exit 0, **418 unit/integration passes / 2 optional DynamoDB Local skips, hosted 1/1, E2E 47/47**, refs 7/7, planning 15/15, lint/boundaries 199, types/builds. Both source files byte-match the archive and independent-PASS artifact; no executable change after review/tests.

Pinned Rolldown 1.2.9 with explicit matching Linux native binding and codeSplitting false built a single ESM Lambda module from that tested archive. Module SHA-256 `f91218b86f90acc13754a58fa2d7293a24b35706e4fb12863353c979a1639370`, ZIP SHA-256 `d5194b8da79250fbad2422ba948d4122654947941c20822ec58de768ef2f9b4f`, 1698353 uncompressed bytes, exactly `ke13b-lambda.mjs`, no source maps/fixtures/dependency directory. Direct local bundled handler with actual model-enabled config but mock gateway JWT claims/no bearer returns **401**, without provider invocation. Tool schema and prompt markers are present in the actual bundle.

## Authorized release preparation

Existing account `092954139775`, `us-east-1`, function `known-enough-stage-api`. User renewed SSO sign-in; STS verifies scoped `KnownEnoughStage1Release` for code updates and the already assigned `ReadOnlyAccess` for readbacks. Root bootstrap session is expired and unused; no permission set, IAM or account setup is changed.

Preflight confirms Lambda Active/Successful, original reviewed code ZIP SHA-256 `017aae3553a16edbd7b3c019956b388f3e6c16bd08a238e1f705a785c220c6ca`; downloaded rollback bytes match this hash. All model flags remain explicit and true, BEDROCK mode, same strict five-person trusted directory. Actual Bedrock invocation logging remains unconfigured/disabled, retention inherit, exact Nova-only invocation policy unchanged. No zero-retention guarantee inferred.

Release scope is **code only**, revision-guarded. Keep environment, runtime, handler, role, memory/timeout/network/layers/KMS/tracing, IAM, API routes/authorizer, memberships and data unchanged. Existing codec handles the already created v6 receipts; no provisioning/reset or schema migration. No redundant frontend release is initiated. No new paid model request, real participant credential/consent/approval or external message during integration/preflight.

## Actual staging release and safe checks

Revision-guarded `UpdateFunctionCode` under the scoped release role succeeded. AWS reports **Active / Successful**, last modified `2026-09-30T16:25:25.000+0000`, revision `6d7ca54f-e1f8-4cce-939c-b16f1a0ddc81`. Actual AWS code hash `1RlLjaeSUPutJCK6lI1BImVJR5QcIIIuxY3naO8vm08=` matches ZIP SHA-256 `d5194b8da79250fbad2422ba948d4122654947941c20822ec58de768ef2f9b4f`. Environment, runtime/role/handler, memory/timeout/network/layers/KMS/tracing/architecture/storage and routes compare unchanged against the preflight snapshots. No IAM, Cognito membership or data mutation by the release operator.

Deployed smoke **6/6**: unauthenticated public read and creation denied 401, invalid creation bearer denied 401, exact-origin public/creation preflight 204 with expected CORS, unrelated-origin creation preflight 204 without CORS. Direct invocation of the actual deployed Lambda with mock gateway identity/no bearer returns **401**, no function error. Amplify site HTTP **200**, index SHA-256 `867259c6c93dc3a2bb3abd6774d81d383c0631b9015d4151572ba24e2161a43d`. No fresh authenticated display-account test was run in this release; existing display/unbound evidence is preserved, not relabeled.

Post-release read-only scan after the user smoke at `2026-09-30T16:39:21Z`: **26 platform log events, zero other events, zero tested bearer/private-field/registered-subject markers** (earlier pre-model window: 13 platform events). Actual invocation logging remains disabled; account retention remains inherit; exact Nova-only runtime permission remains verified. Marker scans establish only the observed window, not absence of all possible disclosure. Operator paid model requests: **0**.

## Participant-owned post-correction check and remaining qualification

User ran the prepared/opened `participant-correction-smoke-v4.js` in their own signed-in session and reported this exact sanitized result:

```json
{"phase":"post-correction-default-objectives","attempts":2,"results":[{"scenario":"CHRISTMAS","create":503,"code":"RETRYABLE_SERVER_ERROR"},{"scenario":"SHARED_PURCHASE","create":422,"code":"INVALID_COMMAND"}]}
```

**Default-objective live check FAILED; this path needs changes.** No successful snapshot/read/consent assertion resulted from this script. No negotiation call was tested. Do not reset the script counter or spend more on blind retries. Earlier explicit-scope creation/replay success remains evidence on the prior artifact, not changed-prompt acceptance.

Read-only platform diagnostics found zero Lambda timeout/error reports; eight invocation reports in the observed window, maximum duration 4582.53 ms and memory 153 MB within configured 29 s / 512 MB. This rules out a recorded platform timeout in that window; it does not prove provider success or identify which validation failed. Code inspection shows Christmas's generic 503 covers provider/envelope/model-output validation and other untyped errors. Purchase's generic 422 can cover the exact scenario variable/type/option checks. The script's envelopes and server-appended objectives meet the request-shape constraints. Raw provider output is neither logged nor accessed, so no exact rejected field/root cause is claimed. The known generic-error UX limitation remains; a bounded follow-up should distinguish failure stages with payload-free diagnostics and test the scenario's required identifiers before another paid verification. Any material source change requires the named focused independent review before integration/deployment; current PASS remains valid for the exact earlier patch.

The two new creation attempts fit the original eight paid-model-request authorization: earlier eight HTTP attempts included three pre-provider durable replays and account for five architect requests; these add at most two, for at most seven across the scripts. Billing is not independently measured. No additional retry, human-token access, private input, consent or final approval. Failed 503 does not independently prove no durable row; no creation ID was reported and no such storage claim is made.

Full KE14 still requires managed participant joins, current frame confirmations, distinct private constraints/conditions, negotiated questions, refusal/revision/stale/missing-approval cases, safe shared explanation and all exact final approvals for both scenarios. Independent PASS and successful deployment do not establish these criteria. Default-objective creation needs changes based on the reported failures. KE14 **REVIEW**, KE15 **BLOCKED**. User A integration/release claim released at this checkpoint; no other implementation/review task is active.

Protected local release artifacts/logs: `/tmp/ke14-correction-release-38bc8da`; configuration snapshots/rollback have restricted permissions and are not published. `integration-full-check.log`, `release-verified.json`, `deployed-smoke-summary.json`, `privacy-readback-summary.json`, `platform-diagnostics-summary.json` and `participant-v4-reported-result.json` hold actual fresh evidence. Documentation checks passed: 219 local Markdown targets, references 7/7, planning 15/15, whitespace/status consistency and exact reviewed source/patch hashes. Authorized documentation-only main synchronization follows; no application suite rerun with unchanged executable bytes.
