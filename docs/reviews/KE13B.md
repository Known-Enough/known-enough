# KE13B — focused auth, privacy, persistence and IAM review

- Verdict: **PENDING independent review**. This is a review handoff, not a PASS or cloud acceptance.
- Implementation claimant: User B / current Codex GPT-6 session, exact variant/effort unexposed; ticket target `gpt-6-sol` / high.
- Baseline: clean synchronized `main` `9b6861c99d5bef3aee3dffa2538c3569e3872e5d`.
- Exact implementation diff: `git diff --binary 9b6861c -- apps/api/src packages/adapters/src` at the checked checkpoint, SHA-256 `c55c184a470299818d26461a09d4c1360a0a52335931c9c26ee5bf4016a86f5b`. The checkpoint commit on `main` contains this code plus tests, runbook and tracking; review the exact commit range from the baseline. Any code correction requires a focused follow-up before PASS.

## One focused review scope

Inspect `apps/api/src/ke13b-lambda.ts`, `ke13b-provision*.ts`, `ke13b-policy*.ts`, `packages/adapters/src/dynamodb.ts` factory/export and the focused tests. Cover these together:

1. Cognito participant/display JWT verification, no `NON_PRODUCTION` fallback, API Gateway v2 transport/header allowlist, exact CORS, unauthenticated/invalid token behavior and current membership checks.
2. Public snapshot allowlist, owner-private projection and invitation token-to-verified-subject binding; no private content, tokens, grant IDs or refusal details in public payloads/logs.
3. STATE v6 / GUARD / REPLAY transaction use, strict codec and older-schema rejection, authorization-before-replay, guarded idempotency, retry/capacity behavior, and operator-only trusted subject provisioning. Check the existing adapter and application paths reached by this composition, not only the new lines.
4. Generated runtime IAM: one exact table ARN, `ROOM#*` transaction item actions, exact log streams, no setup actions; inspect the KE13B CLI commands for role trust, Lambda, API Gateway JWT authorizer, throttling, bootstrap and cleanup. Verify the gateway route and preflight behavior against the named production shape.

## Implementation evidence available to reviewer

Focused KE13B signed API/provisioning/IAM/adapter tests passed **9/9**. They cover signed participant/display JWTs, mock-header denial, wrong token/client denial, pending-member denial, invitation issue/wrong-subject/redeem, own snapshot and public-only display, preflight origin, initial STATE/GUARD transaction shape, strict staging subject mapping and IAM structure. The final pinned Node 24.21.0/npm 11.19.0 `npm run check` passed: 7 reference hashes, 15 planning checks, lint and 184 dependency boundaries, typecheck, **383 unit tests passed / 2 optional DynamoDB Local skips**, production browser build/bundle scan, hosted preview boundary/browser **1/1** and E2E **44/44**. A standalone Node 24 Lambda bundle was produced by pinned Rolldown, 1,496,287 bytes, SHA-256 `bca6d46b308f00974529f74f9f4c8c9e7e47090b6ee1018fa845a584a00ee2bd`; importing and invoking that exact bundle with only a `NON_PRODUCTION` header returned **401**. No AWS credential or resource was used in this smoke.

The [CLI handoff](../../infra/staging-runbook.md#ke13b-authenticated-backend-handoff-for-ke13-not-executed) is command text only. No managed Cognito login, API Gateway, Lambda, DynamoDB transaction, IAM simulation, cloud deployment, Bedrock call, external invitation or cost observation is claimed. DynamoDB Local remains opt-in and was not run for this checkpoint. KE13 retains live operational acceptance after this review PASS and separate cloud-change authorization.

## Reviewer record

An independent reviewer records reviewer/session identity and actual model, exact reviewed base/head, code and test inspection, any focused commands/probes, findings with severity, and **PASS / CHANGES_REQUESTED / BLOCKED** here. A self-check by the implementation session cannot close this gate. The review occupies the next sequential project task; KE13 remains BLOCKED until the named verdict is PASS and the code artifact is current.
