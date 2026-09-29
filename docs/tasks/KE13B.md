# KE13B — Authenticated AWS backend and persistence implementation

- Status: READY — KE11 code/CLI criteria are DONE; this is next in the user-directed cloud-first MVP sequence. KE12 is deferred until after KE13. No active claim.
- Claim: unclaimed; no active implementation task. User B is the directed worker after KE11 is DONE and must record a fresh claim before starting.
- Direct worker/model: User B; target `gpt-6-sol` / high. Record actual model/effort and baseline at claim.
- Prerequisites: KE11 DONE; KE00 direction recorded; B04/B04.5 technical baseline and review evidence available; KE13A handoff reviewed; all earlier named technical gates except deferred KE12 satisfied. KE12 is no longer a prerequisite for the cloud MVP and is deferred until after KE13. Project sign-off is deferred. A ticket does not authorize CDK bootstrap, account changes, resource creation, deployment, paid calls or spending.
- Scope: production composition for authenticated API, Cognito identity, DynamoDB durable state and least-privilege IAM; add SQS/DLQ only if the accepted asynchronous worker implementation requires them. User B delivers code, automated tests and exact CLI/deployment instructions for User A. No AWS resources or external services are changed by B. Do not duplicate KE13 operational verification.

## Outcome

Implement the smallest reviewable staging backend that connects verified identity, application authorization and transactionally durable shared state. Keep public snapshots on strict allowlists and private inputs out of public/browser payloads and logs. Use the [KE13A staging runbook](../../infra/staging-runbook.md); no separate human sign-off is required.

## Acceptance

1. Compose the existing authenticated API handler with a production-capable serverless entry point and the versioned DynamoDB STATE/GUARD/REPLAY repository. Do not use the in-memory repository for shared staging state.
2. Cognito participant/display tokens are independently verified and scoped; the `NON_PRODUCTION` header identity handler remains local/loopback-only with no production fallback. No test/mock identity authenticates an internet-hosted participant.
3. Preserve exact room membership checks, authorization-before-replay, idempotency, guarded transactions, bounded retries/capacity reservations, redacted errors and the accepted schema/migration policy. No automatic migration of v3 state.
4. IAM grants only the reviewed API transaction actions for the exact table ARN and `ROOM#*` keys. Runtime credentials/secrets do not enter browser builds, logs, task artifacts or source control. Do not add IAM permissions for service setup to the request role.
5. Add focused adapter/composition/IAM policy tests, typecheck/lint/build and pinned `npm run check`; record identity, storage and failure-path evidence that is feasible without managed resources. Mock/emulator evidence is labeled and is not cloud acceptance.
6. After the first authenticated shared-state vertical slice is implemented and its focused local checks pass, run the one independent, bounded critical review of the exact artifact, covering authentication, privacy, persistence and IAM together before KE13. Do not split it into repeated general reviews. Preserve the explicitly required KE09 cloud-boundary follow-up before external testers; volunteer access still requires explicit authorization. A materially changed artifact may need a focused follow-up.

## Handoff

When implementation criteria and the one required focused independent review PASS, record DONE and hand off to [KE13](KE13.md). User A then uses the CLI runbook and an AWS profile with the required permissions to provision/deploy and test the cloud slice. B must not receive or store A's AWS credentials. Explicit authorization for cloud actions remains scoped to KE13.
