# KE13B — Authenticated AWS backend and persistence implementation

- Status: BLOCKED.
- Claim: unclaimed. This is a future direct implementation task, not part of active KE13A.
- Direct worker: `gpt-6-sol` / high, selected for difficult backend/authentication/IAM work. The human must select that session model when claiming; record the actual model/effort and baseline.
- Prerequisites: KE12 accepted; KE00 human acceptance; B04/B04.5 human acceptance; KE13A handoff reviewed; all intervening sequential gates satisfied; bounded implementation and cloud scope explicitly authorized. A ticket does not authorize CDK bootstrap, account changes, resource creation, deployment, paid calls or spending.
- Scope: production composition for authenticated API, Cognito identity, DynamoDB durable state and least-privilege IAM; add SQS/DLQ only if the accepted asynchronous worker implementation requires them. Exact files, baseline and whether work is code-only or includes authorized cloud changes are recorded at claim. Do not duplicate KE13 operational acceptance.

## Outcome

Implement the smallest reviewable staging backend that connects verified identity, application authorization and transactionally durable shared state. Keep public snapshots on strict allowlists and private inputs out of public/browser payloads and logs. Use the [KE13A staging runbook](../../infra/staging-runbook.md) after its human review.

## Acceptance

1. Compose the existing authenticated API handler with a production-capable serverless entry point and the versioned DynamoDB STATE/GUARD/REPLAY repository. Do not use the in-memory repository for shared staging state.
2. Cognito participant/display tokens are independently verified and scoped; the `NON_PRODUCTION` header identity handler remains local/loopback-only with no production fallback. No test/mock identity authenticates an internet-hosted participant.
3. Preserve exact room membership checks, authorization-before-replay, idempotency, guarded transactions, bounded retries/capacity reservations, redacted errors and the accepted schema/migration policy. No automatic migration of v3 state.
4. IAM grants only the reviewed API transaction actions for the exact table ARN and `ROOM#*` keys. Runtime credentials/secrets do not enter browser builds, logs, task artifacts or source control. Do not add IAM permissions for service setup to the request role.
5. Add focused adapter/composition/IAM policy tests, typecheck/lint/build and pinned `npm run check`; record identity, storage and failure-path evidence that is feasible without managed resources. Mock/emulator evidence is labeled and is not cloud acceptance.
6. After the first authenticated shared-state vertical slice is implemented and its focused local/emulator checks pass, run one independent, bounded architecture review of the exact artifact, covering authentication, privacy, persistence and IAM together. This is the post-MVP architecture checkpoint; do not split it into repeated general reviews. Preserve the explicitly required KE09 cloud-boundary follow-up before external testers and human acceptance. A materially changed artifact may need a focused follow-up.

## Handoff

Leave REVIEW after implementation and independent review; hand off to [KE13](KE13.md) for separately authorized deployment and operational acceptance. User approval is required for each requested cloud action before it is performed.
