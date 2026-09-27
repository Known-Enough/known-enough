# KE13C — hosted public-only mock preview

- Status: DONE — hosted-preview build reviewed and accepted by the user on 2026-09-27. AWS deployment has not occurred.
- Claim: finished 2026-09-26T23:40:22Z. Claimant/worker: current Codex GPT-6 session; exact variant and effort are not exposed. No claim that a named model was used.
- Baseline: clean `main` at `a5d1833ff6bf818e963acac6f0a6b6ad923eafa4`; `git pull --ff-only origin main` succeeded after verifying clean `main`. This baseline includes the permitted local KE00 documentation checkpoint. The local prep docs were brought forward and their human acceptance recorded; nothing was pushed.
- Authorization: the user accepted KE00 and KE13A, then explicitly asked to proceed with staging deployment and said credits are available. Scope is Stage 0 static public-fixture preview only in `us-east-1`, with the `$25/month` planning ceiling. No API, Cognito, DynamoDB, paid model, bootstrap, or cloud-resource writes are in this task.
- Scope: `apps/web/hosted-preview/index.html`, `apps/web/src/hosted-preview.tsx`, the preview branch in `apps/web/src/public-screen.tsx`, the fail-closed `apps/web/src/hosted-local-api-stub.ts`, `apps/web/vite.hosted-preview.config.ts`, web/root package scripts, `.gitignore`, `eslint.config.mjs`, the generated-bundle boundary checker, a dedicated Playwright config/spec, this ticket, task board, A handoff/log and staging runbook. Preserve the existing local demo for local development. No change to backend authentication or persistence.

## Goal

Produce a deployable web artifact that displays only the reviewed public synthetic fixture screen. The hosted URL must ignore `?view=owner`, `?local=...`, and query-selected scenarios; contain no owner-demo bundle, local identity header/client, API endpoint, server/private fixture, or navigation into a local-only route. It must say **“Hosted mock preview — simulated data, no shared state.”** This is a mock preview and cannot synchronize state between browsers.

## Acceptance

1. A dedicated build entry and output directory exist; ordinary local development keeps its existing demo behavior.
2. The hosted artifact uses only the public fixture adapter and fixed safe scenario. Query strings cannot activate owner/local/demo modes or change the selected fixture.
3. The hosted artifact contains no `OwnerScreen`, `NON_PRODUCTION` identity, `X-Deal-Table-Test-Identity`, local API URL/client, or server/private fixture import. The preview UI has no link to an owner/local route.
4. The screen clearly labels simulated data and lack of shared state. No fetch/XHR/WebSocket to an API is made.
5. Focused checks inspect the built artifact and selected URL variants. Run the pinned project checks required by the workflow before handoff. Evidence is local/build-only; it is not cloud or deployment acceptance.
6. The author run and browser checks pass; independent critical review and human acceptance are recorded in [the KE13C review](../reviews/KE13C.md). Do not mark KE13 live operations accepted.

## Verification and handoff

Pinned Node 24.21.0/npm 11.19.0, installed with `npm ci` in the clean task clone. `npm run check` passed: 7/7 imported reference hashes; 15/15 planning checks; ESLint and 94 import/dependency boundary references; TypeScript; 232 unit tests passed with one opt-in emulator test skipped; standard build/privacy scan; hosted build static bundle scan; hosted browser test passed; and 41 existing browser tests passed. Hosted output contains three files: `hosted-preview/index.html`, one CSS bundle and one JS bundle. The artifact scan found none of the local identity header, `NON_PRODUCTION`, local API origin, `OwnerScreen`, or owner navigation markers. Browser smoke tried owner, local identity and scenario query strings; each rendered the collecting public fixture and issued no external request.

No AWS resource, budget, permission set, bootstrap or deployment change occurred. A separate read-only check verified the existing `ReadOnlyAccess` role and found no S3 buckets, CloudFront distributions or AWS Budgets. The role cannot create Stage 0 resources. The exact hosted-preview artifact passed the review reported by the user as Sol and was explicitly accepted by the user; the reported reviewer did not expose a model variant or effort, so this is not recorded as the ticket's scheduled Astra/high review. Two permanent-check gaps are documented as non-blocking for that exact artifact. Next, the account owner must set the cost alert and review/assign the separate Stage 0 permission-policy draft before deploying only the authorized preview scope. KE13B backend work and KE13 operational acceptance remain separate.

## Review and human acceptance

The reviewer reported PASS on `a5d1833..a625498`; the user confirmed Sol had reviewed it and explicitly accepted KE13C on 2026-09-27. The review report did not expose its exact model variant or effort, so the record does not claim Astra/high. Its findings and limits are in [the review record](../reviews/KE13C.md). The reviewer’s two non-blocking permanent-check gaps remain open for future hardening; no post-review source edits were made. This acceptance is for the mock-preview build, not a cloud deployment or KE13 operational acceptance.

## Cloud boundary and handoff

The user authorized proceeding with the Stage 0 plan: one private S3 build bucket behind CloudFront Origin Access Control, HTTPS through the CloudFront domain, in `us-east-1`; estimated low-traffic hosting is approximately `$0–$3/month`, within the `$25/month` planning ceiling. Cost alerts are not a hard cap. The accepted artifact is commit `a625498`; no AWS resources exist yet. The current `known-enough-staging-ro` profile is authenticated as `ReadOnlyAccess` and cannot create resources. The next step is to create the `$25` S3/CloudFront cost-alert budget and review/assign the Stage 0 permission-policy draft described in [the runbook](../../infra/staging-runbook.md). Static policy validation is recorded, but the policy has not had a separate critical review or user approval. Only then can the preview be deployed. Keep KE13B API/DynamoDB and KE13 live operational acceptance separate.

Follow the [workflow](../agent-workflow.md), [board](../task-board.md), and [staging runbook](../../infra/staging-runbook.md).
