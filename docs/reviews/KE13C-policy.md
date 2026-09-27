# KE13C Stage 0 IAM policy review

## Reported review — CHANGES_REQUESTED

- Verdict supplied by the user; reviewer identity/model/effort not exposed in the report.
- Reviewed artifact: `f1893e3`, policy at `infra/permissions/ke13c-stage0-deploy.json`.
- Scope: policy permissions and a synthetic local condition evaluation. The reviewer did not evaluate live account guardrails or run AWS simulation.
- JSON parsing passed.

### Findings

1. **P1 — unrestricted `s3:PutBucketPolicy`.** The restricted deployment role could replace the bucket policy to grant itself broader access, including access outside the intended object prefixes or permission to change public-access protections. Correction: install a reviewed OAC-only resource policy through separate trusted provisioning and remove bucket-policy writes from the restricted release role.
2. **P2 — request tags do not establish existing distribution ownership.** `cloudfront:TagResource` checked submitted tags on a wildcard distribution resource. The supplied evaluation found `invalidation denied → retag allowed → invalidation allowed` for a synthetic unrelated production distribution. Correction: separate one-time provisioning from release permissions, scope CloudFront release actions to the exact distribution ARN, and do not allow release-role tagging.

No files or cloud resources were changed by the reviewer. This verdict applies to the policy, not to KE13C's accepted static mock build or KE13 live operational acceptance.

## Follow-up

The author correction is tracked in [KE13C policy follow-up](../tasks/KE13C-policy-followup.md). Its exact artifact must receive an independent focused review before permission-set assignment. Neither this review nor its correction changes KE00, B04/B04.5, KE13C build acceptance, or KE13 operational acceptance.
