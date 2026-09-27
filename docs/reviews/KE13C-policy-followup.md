# KE13C Stage 0 policy independent follow-up

## Verdict — PASS for the reviewed draft

2026-09-27T01:15:00Z. Independent sequential review of `f1893e3cc25c513df7223c77a8853ab59fc86c79..62387004883606d36f221af1c8ab3cf5934eeed5`. Both reported findings close. No newly introduced overbroad grant was found in the release policy. This verdict covers the exact templates and runbook at that head; it does not approve policy assignment, initial provisioning, deployment or live KE13 operations.

Reviewer: independent Codex GPT-6 session, exact runtime variant/effort unexposed. The assignment requested `gpt-6-astra` / high; this record does not assert unexposed telemetry. Implementation owner: initiating Codex session / A log. Implementation paused before this review occupied the single task slot. Review clone: `/tmp/known-enough-ke13c-policy-review`, clean `main` at the named head before tracking edits. Required `git pull --ff-only origin main` succeeded; GitHub `origin/main` was `65359ebd19c8ae81007a4b502cce955d5d8ff292`, four commits behind this local artifact. No review commit or publication occurred.

## Inspected scope and evidence

Read the working agreement/workflow, current board, [author ticket](../tasks/KE13C-policy-followup.md), [initial verdict](KE13C-policy.md), KE13C build status, A handoff and relevant A/B log entries, and the product/architecture/pivot boundaries. Inspected all ten changed paths in the named diff. Direct policy/runbook inspection covered:

- [Release identity policy](../../infra/permissions/ke13c-stage0-deploy.json): every action, resource and condition.
- [S3 resource policy](../../infra/permissions/ke13c-preview-bucket-policy.json): principal, action, two object resources and both source conditions.
- [Staging runbook](../../infra/staging-runbook.md): Stage 0 semantics, CLI/profile boundary, provisioning and ARN rendering, release commands, required permissions, cleanup and acceptance gates.
- Tracking changes in the author ticket, board, KE13C ticket, initial policy review, review index, A handoff and A log. KE13C build and KE00 remain DONE; B04/B04.5 remain REVIEW and KE13 remains BLOCKED.

| Reviewed file | SHA-256 at head |
| --- | --- |
| Release policy | `f734984f18e28b04c841cd1524ef811e45e6f705a9f5e8f966ec4bdafaec5a83` |
| Bucket policy | `70d0dc01c9558334fbb7e95e00035dc5d58c282d0950dfb7581247302bc5d63f` |
| Runbook | `cb2a737cf5a1536a8afb748d2e6672addcb85b28b639f52723423200cdc92d0e` |

## Findings and closure

**P1 closed.** The release policy has no `s3:PutBucketPolicy` or bucket configuration/creation action. Its four S3 actions are `ListBucket` restricted by `s3:prefix`, bucket-specific `GetBucketLocation`, and `GetObject`/`PutObject` on the two intended object prefixes. The separate bucket policy allows only the CloudFront service principal to read those prefixes when both the exact distribution ARN and source account match. Trusted initial provisioning installs it; the release identity cannot rewrite it. This follows AWS's [OAC bucket policy pattern](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html).

**P2 closed.** No tagging action remains. All five CloudFront actions share one literal account/distribution ARN; no tag condition or wildcard distribution resource remains. An unrelated distribution cannot become eligible through request tags. These actions support distribution resource scoping in the [CloudFront authorization reference](https://docs.aws.amazon.com/service-authorization/latest/reference/list_cloudfront.html).

**No new overbroad release permissions found.** Nine explicit actions remain. There is no IAM, Billing, bucket-policy/configuration write, provisioning, OAC, deletion or distribution-update authority. Object `*` suffixes stay within the two intended prefixes. Bucket-wide location lookup is metadata needed by the CLI and is not object listing. Root/empty and similarly named prefixes do not match the listing condition; omitted `s3:prefix` does not satisfy `StringLike`. See AWS's [condition semantics](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_condition_operators.html).

**Placeholder handling is safe for this draft, with a remaining deployment prerequisite.** Both templates contain the same literal `REPLACE_WITH_PROVISIONED_DISTRIBUTION_ID`, without wildcard or IAM variable syntax. It cannot match an actual distribution. The runbook obtains `Distribution.ARN` through the explicit provisioning profile, then uses `jq --arg` to substitute only the intended fields. It leaves the account condition intact and prohibits assignment before review and substitution. Successful lookup of a real distribution cannot introduce a wildcard; a failed/empty lookup does not broaden these grants. Local synthetic rendering preserved all other fields. Before assignment, the provisioning owner must inspect the exact rendered ARN/account/bucket and revalidate both rendered policies as already required by the author ticket. No actual distribution ID has been reviewed.

Nonblocking operational note: the sample rendering snippets do not explicitly stop on failed lookup or assert the expected ARN/account. Add fail-fast checks when making the concrete provisioning procedure executable; this prevents unusable policy installation or selecting the wrong trusted provisioning output. It is not a release-role escalation in this artifact. Fixes, if made, belong to the implementation owner and require follow-up on the changed scope.

**Runbook boundary passes.** Provisioning and initial tagging are outside the release role. Two explicit `s3 sync` commands target the allowed prefixes without `--delete`; invalidation/status commands use the exact distribution ID. Root and `AdministratorAccess` use are prohibited. HTTPS hosted mock/public synthetic fixture semantics and absence of shared state are explicit. Cleanup requires separate exact-resource approval. KE13B implementation and KE13 live evidence/human acceptance remain separate.

## Commands and results

- `git status --short`, `git branch --show-current`, `git rev-parse HEAD`, required `git pull --ff-only origin main`, and `git rev-list --left-right --count origin/main...HEAD`: clean main before claim; exact head above; pull succeeded; `0 4` behind/ahead.
- `git diff f1893e3..6238700 -- <ten changed paths>`, focused `cat`/`sed`/`nl` reads, and `sha256sum` of both policies/runbook: inspected exact diff and hashes above.
- Local inline Python JSON/policy probe plus the runbook's two `jq` rendering expressions: **32 assertions passed**, exit 0. Covered explicit action set, resources, principal/source restrictions, positive/negative prefix matches, unresolved placeholder versus real/synthetic ARNs, unrelated distribution mismatch after rendering, and preservation of other fields. This is a limited local pattern check, not an IAM authorization simulator.
- Pinned Node **v24.21.0**, npm **11.19.0**: `npm run check:references` **7/7** and `npm run check:planning` **15/15**, exit 0. The initial ambient runtime was v23.3.0/npm 10.9.0; the checks above explicitly used the pinned installation.
- `git diff --check f1893e3..6238700`: exit 0. Review documentation link/status/hash consistency and working-diff whitespace are recorded in the final A-log handoff.
- Author ticket reports AWS Access Analyzer `findings: []` for both draft policies under `known-enough-staging-ro`. This reported result was inspected, not independently rerun; no raw validation transcript is committed in the reviewed diff. The independent closure rests on policy inspection and local checks, not that report alone.

## Limits and handoff

No AWS API call was made by this reviewer. No live account guardrails, SCPs, permission boundaries, attached-policy combinations, IAM simulation, OAC delivery or CLI upload were checked. Allow statements do not cap permissions supplied by other policies. Source-account availability and actual OAC behavior remain live acceptance checks. No application source changed and no application suite ran; prior build evidence remains historical.

Review claim finished; author ticket remains REVIEW pending human acceptance and cloud prerequisites. Next is the user's review of this verdict and the separately authorized concrete provisioning scope, including cost alert and scoped non-root identity. Do not assign an unresolved template or infer cloud authorization/acceptance from PASS. No subsequent task was started.
