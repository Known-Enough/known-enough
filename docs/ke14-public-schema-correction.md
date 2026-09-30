# KE14 structured public scope and safe diagnostics — review checkpoint — 2026-09-30

**Implementation prepared; independent review PASS; exact patch integration is claimed.** The named independent review completed with PASS; see [review evidence](reviews/KE14-public-schema-followup.md). User explicitly requested these fixes after the deployed default-objective smoke failed. User A / actual Codex GPT-6, exact variant/effort unexposed; ticket Sol/high target is not runtime proof. Clean synchronized main `b93432b`, ff-only pull and 0/0 before claim, claim published at `e2d4d17`. One task, bounded twelve executable files (including injected evaluation seam) plus review/tracking docs. Source remains frozen local working changes; only documentation and the reproducible patch are shared pending the named independent gate. Earlier model correction PASS applies to its exact previous patch, not this changed boundary.

## Observed problem and resulting behavior

[Actual deployed smoke](ke14-model-correction-deployment.md): Christmas 503 RETRYABLE_SERVER_ERROR, Purchase 422 INVALID_COMMAND. Platform logs did not identify the rejected model field and showed no Lambda timeout/error. Root cause of that specific Christmas response remains unproven; no raw provider response is logged or accessed.

The two bounded scenario endpoints already declared exact public variables/options/units in prose and enforced catalog-compatible IDs afterward. They now supply complete, strictly parsed **PUBLIC** variable definitions as structured model data. With these supplied definitions the forced architect tool requests `variableIds`, whose items are limited to declared IDs; the adapter requires the complete unique set and copies the corresponding server-owned definitions. A guessed/missing/duplicate/extra ID, or an additional model-authored `variables` field, is rejected before persistence. The server never substitutes a guessed identifier or chooses a decision value. An arbitrary injected architect also cannot drift from the complete supplied public definitions: the application compares strictly parsed definitions and rejects ID/type/option/metadata drift.

The AI still drafts the title, description, public rules, clarification questions and later private information requirements. General open-scope architect requests without supplied public definitions continue to use the previous variable-drafting protocol. This change is a public-schema selection path for the existing synthetic scenarios; it does not implement a new travel/purchase optimizer or establish live AI quality. Ownership labels preserve the registered public display names and established “proposed ownership” wording before participant confirmation.

Public schemas are bounded and validated independently at the application and adapter boundaries. Private/consent-required schemas, unknown fields, duplicate IDs and empty lists are rejected before a provider call. Enum labels still satisfy the allowed public labels; unit/currency/type metadata and the existing rule/reference checks remain authoritative. The creation request body still cannot supply a schema, subjects or membership activation. Directory authorization and persisted replay lookup still precede the provider; no permission or final approval is created by normalization.

## Payload-free failure diagnostics

Static stages distinguish provider/tool-envelope/tool-output rejection, architect fields/requirements/definition/options/public-schema validation, and scenario clarification/definition/persistence/readback failures. The runtime supplies the callback to the architect/adapter; scenario composition handles persistence/readback stages. Cloud HTTP error bodies remain the existing generic allowlist.

The Lambda logger accepts **only** exact `kind`/`stage` keys and declared enum values, then reconstructs a fresh JSON object with a fixed event label. It neither spreads nor serializes the incoming diagnostic object. No objectives, raw model output, errors/stacks, field paths, subjects, request/decision IDs, tokens, owner values, constraint/grant IDs or refusal details are logged. An observer/logger failure cannot change a result, trigger a retry or bypass validation. Existing provider attempts/timeout/capacity, invocation logging guards and privacy configuration are unchanged. No AWS write, provider request, human credentials or participant consent/approval action during this preparation.

AWS's [Nova tool definition documentation](https://docs.aws.amazon.com/nova/latest/userguide/tool-use-definition.html) specifies an object root with type/properties/required and forced tool choice support. The conditional tool uses that existing root format; service acceptance of the changed schema/output still needs bounded live verification after review, not an inference from documentation.

## Actual checks

- Final focused application/adapter/scenario/Lambda/runtime/HTTP tests **67/67**, pinned typecheck and focused lint passed.
- Negative control in isolated archive: restore original `decision-architect.ts`, `bedrock-models.ts`, `scenario-service.ts` at `e2d4d17`, then run the two new brief-objective regressions. Both fail as expected (exit 1); restore corrected files and verify every final manifest hash. This demonstrates the missing structured creation path instead of merely asserting prompt wording.
- Final connected browser checks **2/2**, one worker: actual locally signed HTTP boundaries, three owners, private conditions/negotiation/exact approvals and unchanged-envelope replay. Injected provider data establishes local behavior only.
- First full check passed 440 unit/integration, hosted 1/1 and 46/47 E2E; it caught the new template's weaker ownership labels. Preserve the existing public display-name labels; do not weaken the assertion. A two-worker focused run then hit the existing shared Vite server lifecycle race (`ERR_CONNECTION_REFUSED`), while the one-worker run passed. Final full check uses the existing configured `PLAYWRIGHT_CHANNEL=chromium` path and its one-worker setting, with bundled Chromium installed; no root/configuration/test-server change.
- Final fresh-dependency isolated archive `/tmp/ke14-public-schema-fix/check-e2d4d17`, Node 24.21.0/npm 11.19.0, `PLAYWRIGHT_CHANNEL=chromium npm run check`: exit **0**; **440 unit/integration passed / 2 optional DynamoDB Local skips, hosted 1/1, E2E 47/47**, refs 7/7, planning 15/15, lint/boundaries 201, typecheck and builds passed. Exact source/patch/archive hashes verified after completion.
- Patch dry-apply/reproduction matches all twelve final source hashes, archive and retained working bytes. No executable change after the recorded final suite. Documentation checks: 219 local Markdown targets, refs 7/7, planning 15/15, whitespace/status consistency and bounded source/hash checks passed. Only this documentation/review artifact is synchronized to main.

Local logs: `/tmp/ke14-public-schema-fix/final-focused.log`, `final-connected-serial.log`, `negative-control.log`, `first-check-label-regression.log`, `final-connected.log`, `full-check.log`, `source-manifest.json`. No invented token/billing accounting.

## Exact artifact and reviewer handoff

Base executable source: `e2d4d17` (same executable bytes as `b93432b`). [Review-only patch](review-artifacts/KE14-public-schema-correction.patch): **SHA-256 `6160910f39881f39e3fd44e08765d36cd5811ecfdd71a2e4c1c9ba389fd0f66b`**, 38652 bytes. Zero-context diff avoids whitespace-only context lines in the documentation artifact; apply with `--unidiff-zero` only against the verified baseline. Patch changes exactly these twelve files, no contracts/storage/consent/client/root/dependency/lock/CI/IAM/config changes:

| File | Final SHA-256 |
| --- | --- |
| `apps/api/src/ke13b-lambda.test.ts` | `db0c55acce1b2da364c23bb945f3876e8d5b268a5afbf76359c74c68788c9d19` |
| `apps/api/src/ke13b-lambda.ts` | `ccf78e5bf3267323811ad2e4addd595d3c079dffdd8ea5f4732c839e72cc730e` |
| `apps/api/src/model-runtime.ts` | `105c5651e4cf64f3bee3508e82a73901d6a22b54f3aa8845dfc09e4a9ec6000a` |
| `apps/api/src/scenario-service.test.ts` | `b162195992c4aab5ec149a59cda86f593a1e8534399e7f518d920489669c5d7f` |
| `apps/api/src/scenario-service.ts` | `5c0a12802d1083eac22084c32a5dbebc3e44118be2b6ef47618ce2884cac2d2c` |
| `packages/adapters/src/bedrock-models.test.ts` | `db8c15922c4db78d52cd1ef19918a435ca5c59687584fdd1f671c516c1077874` |
| `packages/adapters/src/bedrock-models.ts` | `ee8441971a13260fe2b29a14be962ebac631d3f1a67aa0eca1c42b2eda3e490a` |
| `packages/application/src/decision-architect.test.ts` | `2e12029511936d24539c134f33f145ac65838d0127771db873740904eb66042d` |
| `packages/application/src/decision-architect.ts` | `ab06b540d191cb31849e87b03b91bfc54a4be4ff776c0df120bcdfd86a8d5a8d` |
| `packages/application/src/index.ts` | `9b912d431338ed883d45ebbd68f6c052834d4bd316784d16665b0e83086915c4` |
| `packages/application/src/model-runtime.ts` | `7c9a43029eebe22bd0561f7356907a96b1a02f9087e9dd08b352377481f20adf` |
| `tests/evaluations/ke14-fixed.ts` | `d5ae019c79889a08d0b3a3591cc7cad16a6b0d733341aae6146591dbdee68369` |

Reviewer uses a separate clean synchronized clone/archive, checks the baseline/hashes, then:

```sh
git apply --unidiff-zero --check docs/review-artifacts/KE14-public-schema-correction.patch
git apply --unidiff-zero docs/review-artifacts/KE14-public-schema-correction.patch
npm test -- packages/application/src/decision-architect.test.ts packages/adapters/src/bedrock-models.test.ts apps/api/src/scenario-service.test.ts apps/api/src/ke13b-lambda.test.ts apps/api/src/model-runtime.test.ts tests/integration/ke14-fixed-http.test.ts
```

Inspect code and tests, constrained schema transport/normalization, the full public definition comparison, authorization/replay ordering, diagnostic allowlists and observer failure behavior. Existing full-suite evidence supplements independent focused checks. Do not self-certify the author’s boundary; use the named User B independent follow-up, record its exact reviewed artifact and any findings. No automatic cross-account agent or external message.

After independent PASS, integrate only identical reviewed bytes, run the required integration checks and perform the separately authorized staging release/readback. Any material correction needs follow-up review. A new bounded live check must respect the remaining paid-call allowance: prior scripts account for at most seven model requests under the original eight-model limit; a new two-scenario paid check would need an explicitly authorized budget extension before those paid requests. Preparing this patch authorizes no such extension. Complete participant-owned two-scenario consent/negotiation/refusal/revision/stale/missing-approval/final-approval qualification still follows. KE14 REVIEW at handoff, KE15 BLOCKED; no live prompt or complete scenario success claimed.


## Independent PASS and integration claim — 2026-09-30

The independent review passed on the exact patch SHA-256 `6160910f39881f39e3fd44e08765d36cd5811ecfdd71a2e4c1c9ba389fd0f66b`; all twelve file hashes matched the manifest, six focused test files passed 67/67, and typecheck passed. The author's full-check evidence remains inspected, not rerun, by the reviewer. User B claims integration from synchronized `main` at `d3a11c82541c0f2914b5593715788afce70805b8`. Only identical reviewed source bytes may be integrated; full pinned checks are required. The source is not yet integrated or deployed. Pushing its `packages/**` changes triggers the Amplify staging workflow, so hold source publication until separate staging authorization. Full Christmas/Purchase qualification remains pending; prior paid-call allowance is not extended.


## Integrator verification checkpoint — 2026-09-30

The exact 12-file patch is applied locally in a separate clone and every final manifest hash matches. Fresh focused tests passed 67/67 and typecheck passed on pinned Node 24.21.0/npm 11.19.0. Local full-check evidence has limitations: the canonical 5-second Vitest timeouts reproduce for the two capacity tests on unchanged baseline; the complete unit suite passes with `--testTimeout=30000`, but that is not a canonical check pass. Build and hosted preview passed. Browser timeouts were also reproduced on baseline. See the [KE14 ticket checkpoint](tasks/KE14.md#exact-public-schema-integration-verification-checkpoint--2026-09-30) for exact counts and commands. The patch is not committed/pushed or deployed; a `packages/**` push triggers the separately authorized Amplify staging workflow. No paid calls or participant actions occurred.
