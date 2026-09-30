# KE14 reviewed model correction release — 2026-09-30

**Exact independently reviewed correction integrated at this checkpoint; staging code-only release is in progress.** User explicitly requested proceeding; prior deployment/paid synthetic use authorization persists. User A / Codex GPT-6, exact variant/effort unexposed. Baseline synchronized main `38bc8da`, ff-only pull and ahead/behind 0/0, with only the two retained frozen reviewed files; single integration/release claim published in `900b81e`. [Independent PASS](reviews/KE14-live-model-followup.md) on patch SHA-256 `730b18b636b18272e02de019d53f5616432e72e2973aed98d29a0e853fa2df89` matches retained bytes exactly. No new source design or additional independent review inferred.

## Source integration and verification

Only `packages/adapters/src/bedrock-models.ts` and its reviewed regression changed executable code: forced negotiation tool requires declared `candidateIndex`; architect public draft guidance preserves supplied IDs and distinguishes later private requirements. Source hashes remain `aff55f1311a050ec1247a43b2fae63e5468e4aaacec432398b00346c6fe37d18` and test `f8a940423de8ba042d9531b0ca81e3552276a7f7ee4f6eea0fd623ee0a326c76`.

Fresh restored pinned Node 24.21.0/npm 11.19.0, npm ci and Chromium, isolated archive `/tmp/ke14-correction-integration-38bc8da`: full `npm run check` exit 0, **418 unit/integration passes / 2 optional DynamoDB Local skips, hosted 1/1, E2E 47/47**, refs 7/7, planning 15/15, lint/boundaries 199, types/builds. Both source files byte-match the archive and independent-PASS artifact; no executable change after review/tests.

Pinned Rolldown 1.2.9 with explicit matching Linux native binding and codeSplitting false built a single ESM Lambda module from that tested archive. Module SHA-256 `f91218b86f90acc13754a58fa2d7293a24b35706e4fb12863353c979a1639370`, ZIP SHA-256 `d5194b8da79250fbad2422ba948d4122654947941c20822ec58de768ef2f9b4f`, 1698353 uncompressed bytes, exactly `ke13b-lambda.mjs`, no source maps/fixtures/dependency directory. Direct local bundled handler with actual model-enabled config but mock gateway JWT claims/no bearer returns **401**, without provider invocation. Tool schema and prompt markers are present in the actual bundle.

## Authorized release preparation

Existing account `092954139775`, `us-east-1`, function `known-enough-stage-api`. User renewed SSO sign-in; STS verifies scoped `KnownEnoughStage1Release` for code updates and the already assigned `ReadOnlyAccess` for readbacks. Root bootstrap session is expired and unused; no permission set, IAM or account setup is changed.

Preflight confirms Lambda Active/Successful, original reviewed code ZIP SHA-256 `017aae3553a16edbd7b3c019956b388f3e6c16bd08a238e1f705a785c220c6ca`; downloaded rollback bytes match this hash. All model flags remain explicit and true, BEDROCK mode, same strict five-person trusted directory. Actual Bedrock invocation logging remains unconfigured/disabled, retention inherit, exact Nova-only invocation policy unchanged. No zero-retention guarantee inferred.

Release scope is **code only**, revision-guarded. Keep environment, runtime, handler, role, memory/timeout/network/layers/KMS/tracing, IAM, API routes/authorizer, memberships and data unchanged. Existing codec handles the already created v6 receipts; no provisioning/reset or schema migration. No redundant frontend release is initiated. No new paid model request, real participant credential/consent/approval or external message during integration/preflight.

Protected local release artifacts/logs: `/tmp/ke14-correction-release-38bc8da`; configuration snapshots/rollback have restricted permissions and are not published. Exact post-release hash/config/safe HTTP/mock/log results will be recorded after upload. KE14 IN_PROGRESS, sole A claim retained; KE15 BLOCKED, complete managed participant qualification pending.
