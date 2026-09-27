# KE13C — hosted public-only mock preview

- Status: DONE — hosted-preview build reviewed and accepted by the user; Stage 0 deployed and verified over HTTPS on 2026-09-27. KE13 operational acceptance remains separate.
- Claim: finished 2026-09-26T23:40:22Z. Claimant/worker: current Codex GPT-6 session; exact variant and effort are not exposed. No claim that a named model was used.
- Baseline: clean `main` at `a5d1833ff6bf818e963acac6f0a6b6ad923eafa4`; `git pull --ff-only origin main` succeeded after verifying clean `main`. This baseline includes the permitted local KE00 documentation checkpoint. The local prep docs were brought forward and their human acceptance recorded; nothing was pushed.
- Authorization: the user accepted KE00 and KE13A, explicitly authorized CLI deployment, and later waived the `$25/month` planning ceiling in favor of available credits. Scope completed: Stage 0 static public-fixture preview only in `us-east-1`. No API, Cognito, DynamoDB, paid model, or CDK bootstrap was included.
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

At the time of build acceptance, the read-only check found no S3 bucket, CloudFront distribution or AWS Budget; the later Stage 0 deployment is recorded below and in the [runbook](../../infra/staging-runbook.md). The exact hosted-preview artifact passed the review reported by the user as Sol and was explicitly accepted by the user; the reported reviewer did not expose a model variant or effort, so this is not recorded as the ticket's scheduled Astra/high review. Two permanent-check gaps are documented as non-blocking for that exact artifact. Stage 0 policy authorization is tracked separately in [the IAM policy follow-up](KE13C-policy-followup.md): the policy reviewed at `f1893e3` received CHANGES_REQUESTED findings, and the correction does not reopen this accepted build. KE13B backend work and KE13 operational acceptance remain separate.

## Review and human acceptance

The reviewer reported PASS on `a5d1833..a625498`; the user confirmed Sol had reviewed it and explicitly accepted KE13C on 2026-09-27. The review report did not expose its exact model variant or effort, so the record does not claim Astra/high. Its findings and limits are in [the review record](../reviews/KE13C.md). The reviewer’s two non-blocking permanent-check gaps remain open for future hardening; no post-review source edits were made. This acceptance is for the mock-preview build, not a cloud deployment or KE13 operational acceptance.

## Cloud boundary and handoff

Stage 0 is deployed: private S3 bucket `known-enough-preview-20260927-7f94b6a1`, CloudFront distribution `E61V9RN1W6E0` with OAC `E10RFHXAY9PCCP`, and HTTPS preview [https://d23eowhnwtqts3.cloudfront.net/](https://d23eowhnwtqts3.cloudfront.net/). The runbook records artifact hashes and HTTP 200 checks. The user later waived the original `$25/month` planning ceiling; no budget or hard cap exists, and the reported credit balance was not verified. This is only a fixed synthetic mock: no authentication, API, DynamoDB, or shared state. The provisioner candidate policy was not used; a temporary setup permission set was removed after setup, while the release SSO role remains. Keep KE13B implementation gates and KE13 operational acceptance separate.

Follow the [workflow](../agent-workflow.md), [board](../task-board.md), and [staging runbook](../../infra/staging-runbook.md).
