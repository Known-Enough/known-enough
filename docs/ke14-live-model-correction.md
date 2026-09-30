# KE14 live model correction — reviewable artifact — 2026-09-29

**Prepared and tested, not integrated or deployed; independent follow-up pending.** Actual worker User A / Codex GPT-6, exact variant/effort unexposed. Bounded baseline `b682a6b` (executable source identical to reviewed `95db9b5`); two executable files only. [Reproducible review patch](review-artifacts/KE14-live-model-correction.patch), SHA-256 `ee30798fa57b739f7b552f153009c2a7be66d4feccecea8114e3d2781015a617`. The patch is documentation/review evidence on main; application source on main remains unchanged. A retains the two frozen local working changes, implementation claim released for the named next independent review. No independent PASS or KE14 DONE is claimed.

## Observed live results on the existing deployed artifact

[Activation evidence](ke14-ai-activation.md) records exact reviewed staging code/config/IAM. In the human's own Cognito participant session:

- Default brief objectives returned 422 NEEDS_CLARIFICATION for both scenarios; neither was created. The current endpoint returns only the generic error, not public clarification questions.
- v2 complete public scope: Christmas create/public/own reads 200, six public variables/five approvers, safe public fields, persisted context, no automatic consent; Purchase 422 INVALID_COMMAND. Code inspection identifies strict variable/option identity checks as the likely rejection point, without claiming access to raw provider output.
- v3 explicit Purchase schema: both create/public/own reads 200. Christmas used the original durable receipt; Purchase has four public variables/three approvers. After page reload, the exact same envelopes replayed both decision IDs with all reads 200, same persisted context, private fields absent and zero automatic confirmations/approvals.
- Independent DynamoDB transaction reads verify both v6 creation receipts, exact registered memberships, only the creator active, zero private confirmed constraints, zero frame confirmations and no proposal. Purchase has seven total definition variables: four public and three owner-private contribution variables. This is persistence/provisioning proof, not full participant qualification.

Eight conservative create/replay HTTP attempts were recorded; code paths permit five architect invocations and three pre-provider durable replays. No additional operator model calls, human token access, consent/approval or credential reset. Billing was not independently measured. New local model prompts have **not** been tested against the live provider or deployed.

## Exact correction and remaining limits

`packages/adapters/src/bedrock-models.ts`:

- Negotiation tool schema declared `candidateIndex` but required undeclared `values`. Correct the required field to `candidateIndex`; trusted catalog copying and strict application/kernel validation remain unchanged.
- Architect prompt now preserves explicitly supplied variable/option IDs and types, distinguishes an unselected decision variable from unresolved public scope, and places later private budgets/dates/preferences/accessibility in participant information requirements. It continues to ask about genuinely unresolved public scope and prohibits invented private values. Removed the contradictory broad instruction to ask whenever unspecified facts are missing.

`packages/adapters/src/bedrock-models.test.ts`: a forced-output-envelope transport checks that each required tool field is declared and present in the scripted output, then runs the existing construction/proposal/extraction/privacy evaluations. The new test fails against the original schema and passes against the correction. This catches the real request/response mismatch; it does not claim simulated model text proves live prompt quality.

No contract, permissions, owner/private model context, catalog, storage, client, dependencies, lockfile, CI, IAM or deployed configuration changed. The current creation endpoint's generic clarification error remains a recorded UX limitation. Default-objective live retry, owner interpretation, refusal/revision/stale cases, negotiation and each participant's exact final approval remain to qualify after the gate.

## Validation and review handoff

- Focused adapter/scenario/HTTP tests **20/20**, focused lint and typecheck passed.
- New regression against baseline: exit 1, expected single failure (`KE10_EVALUATION_FAILED`); other tests filtered. Final corrected full `npm run check`: exit 0, **418 unit/integration passes / 2 optional DynamoDB Local skips, hosted 1/1, E2E 47/47**, references 7/7, planning 15/15, lint/boundaries 199, types and builds.
- Clean archive `/tmp/ke14-live-model-correction-b682a6b`, fresh npm ci, pinned Node 24.21.0/npm 11.19.0, Chromium; logs `baseline-regression.log` and `full-check.log`. Both corrected files byte-match the tested archive. Sorted two-file manifest SHA-256 `6b651a39c90daf52f9b5f7fab079750be30c16f9325cd25a8b84a450cf5bc8c6`:

```text
f8a940423de8ba042d9531b0ca81e3552276a7f7ee4f6eea0fd623ee0a326c76  packages/adapters/src/bedrock-models.test.ts
aff55f1311a050ec1247a43b2fae63e5468e4aaacec432398b00346c6fe37d18  packages/adapters/src/bedrock-models.ts
```

The [KE14 ticket](tasks/KE14.md) requires the existing focused independent KE09 model-boundary follow-up before changed-code deployment/trials. The author cannot independently certify this correction. Review **only this patch, both changed files, the new regression, relevant existing role/catalog guards and recorded tests**; preserve earlier R1/R2 PASS. An independent reviewer uses their clean separate clone, pulls main ff-only, checks/applies this review patch in an isolated archive (or inspects it directly), runs appropriate focused checks and records PASS/CHANGES_REQUESTED on the exact patch hash. No shared writable checkout, source integration or cloud action is needed for review.

After PASS, A can integrate the retained exact changes under standing main authorization and continue the authorized staging release/qualification. Material further fixes need their own focused follow-up. KE14 REVIEW, KE15 BLOCKED; full managed five/three-person consent and approval paths remain pending.
