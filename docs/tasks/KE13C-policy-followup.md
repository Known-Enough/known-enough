# KE13C Stage 0 IAM policy follow-up

- Status: REVIEW — the two reported findings have local corrections and author validation; policy assignment and AWS deployment remain blocked pending a fresh focused review and the already separate cloud-change gates.
- Claim: Codex; actual model reported by the runtime as GPT-6, exact variant/effort unexposed.
- Baseline: clean, synchronized `main` at `f1893e3` after `git pull --ff-only origin main` on 2026-09-27.
- Bounded files: `infra/permissions/ke13c-stage0-deploy.json`, new `infra/permissions/ke13c-preview-bucket-policy.json`, this ticket, `docs/task-board.md`, `docs/reviews/README.md`, new `docs/reviews/KE13C-policy.md`, `docs/tasks/KE13C.md`, `docs/handoff-A.md`, `infra/staging-runbook.md`, and `docs/work-log-A.md`.
- Cloud boundary: read-only identity checks and policy validation only. No permission set assignment, bucket-policy write, resource creation, deployment, or push.

## Objective

Correct the restricted Stage 0 release permissions in response to the reported CHANGES_REQUESTED verdict. The release role must not write the S3 bucket policy or configure/provision resources. It must not retag distributions. Its S3 access is limited to listing and reading/writing objects under `hosted-preview/` and `assets/`; its CloudFront read/invalidation access is limited to the exact distribution ARN established during trusted initial provisioning.

The reviewed OAC-only bucket policy is installed once by a separately authorized provisioning identity. That policy grants CloudFront `s3:GetObject` only for those two prefixes and only when the request comes from the exact distribution. Initial creation/tagging and subsequent object releases are distinct steps and permission scopes.

## Acceptance evidence for this follow-up

1. The release policy contains no bucket-policy write, bucket-configuration write, bucket/distribution/OAC creation, distribution-tagging, object-delete, or wildcard-distribution permission.
2. Release object permissions cover only the two exact S3 object prefixes; bucket listing is conditioned on those prefixes.
3. CloudFront release actions require an exact distribution ARN placeholder that must be replaced after provisioning; tagging is absent.
4. The separate bucket resource policy permits only `cloudfront.amazonaws.com` `s3:GetObject`, with an exact distribution `AWS:SourceArn` and matching `AWS:SourceAccount`, scoped to those two object prefixes.
5. The CLI runbook separates trusted one-time provisioning from incremental release, documents two explicit `aws s3 sync` calls without `--delete`, and preserves HTTPS hosted-mock semantics and cleanup boundaries.
6. JSON parsing, available IAM Access Analyzer validation, link/reference/task-consistency checks and `git diff --check` are recorded accurately. This author validation does not replace independent follow-up review.

## Author validation — 2026-09-27

- `node` parsed both policy documents successfully.
- `aws accessanalyzer validate-policy` under `known-enough-staging-ro` returned `findings: []` for both the identity release policy and S3 bucket resource policy. These are policy lint results, not live authorization simulation or account-guardrail evidence. The release ARN placeholder must be replaced with the exact provisioned distribution ID and validated again before assignment.
- Pinned Node v24.21.0/npm 11.19.0: `npm run check:references` verified 7/7 imported reference checksums; `npm run check:planning` passed 15/15 checks.
- Local Markdown link check: 751 file targets across 90 Markdown files exist.
- `git diff --check` passed. No application tests ran because executable application code was unchanged.
- Read-only STS verified `known-enough-staging-ro` as `ReadOnlyAccess`. `known-enough-staging-bootstrap` also returned STS identity, which is the account root principal; no writes were issued through it.
- No resources, budgets, permission sets, bucket policies or deployments were created or changed. No push occurred.

The artifact is ready for the requested focused independent follow-up of these corrections. The independent reviewer must inspect the exact JSON and runbook diff; the Access Analyzer result alone does not close the findings.

## Finding provenance and remaining gate

The user supplied a CHANGES_REQUESTED report against `f1893e3`: unrestricted `s3:PutBucketPolicy` could expand bucket permissions, and request-tag-only `cloudfront:TagResource` allowed an unrelated distribution to be retagged before invalidation. The report reproduced `invalidation denied → retag allowed → invalidation allowed` for a synthetic unrelated distribution. It did not evaluate live account guardrails or run AWS simulation. The reported reviewer identity/model/effort is not recorded here because it was not stated with the verdict.

After the correction, pause for an independent focused review of the exact local policy/runbook diff. Do not mark the policy accepted, assign it, or treat KE13C's accepted static build as cloud acceptance. KE13 live operational acceptance remains separate; KE00 and B04/B04.5 statuses remain unchanged.
