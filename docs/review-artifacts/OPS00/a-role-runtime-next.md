# Next OPS00 work: connect installed storage through scoped access

Recovery storage and partitions are installed according to A's [recovery receipt](a-installed-recovery-20261009.md) and [partition receipt](a-installed-partitions-20261010.md). The recovery role has matching two-run managed preparation and selected read-only boundary proof; those do not install participant/migration/archive/job policies. No new storage creation is the next action.

## What must be prepared next

1. Reconcile the exact current primary Lambda/runtime role and attached/inline policy baselines before writing the permission package. Published inspector permission source permits Lambda GetFunctionConfiguration and runtime ListRolePolicies/GetRolePolicy, but does not grant GetRole/ListAttachedRolePolicies; no arbitrary role-inventory success is assumed. The previous user-supplied full inventory stores private snapshots under HOME and hashes publicly. Prepare one finite sanitized identity/configuration inspection step if fresh facts are needed, without raw secrets or repeated denied GitHub calls. Existing KnownEnoughStageApiRole is a candidate, not a new attached-profile claim.
2. Keep the existing participant, migration, archive and inspection profiles separate from retention/erasure/job roles. Review exact table/leading-key/transaction/return-value constraints from infra/operations/partition-setup.json and the capability ledger. Do not union117occurrences or grant general administrator access. Prepare baseline-preserving exact policy preview/apply/readback/resume with no replacement of unrelated policies/trust.
3. Wire the real runtime and migration path before enabling it. createPartitionRuntime returns an inactive Node HTTP listener and currently has no installed Lambda selector. It requires authenticated Cognito identity/profile, private email/cursor keys, verified version2 manifest/source/revision/immutable version and source/control/copied journal guards. A permission attachment alone cannot connect the app. OPS01 needs explicit Lambda/runtime integration and bounded source-preserving migration/activation/restart/privacy/concurrency proof. This remains work, not a claim the current table is serving users.
4. Restore own-A operations verification/testing through a scoped operator identity amendment where existing workflows/scripts hard-code B143764700. Standing user authority covers both A44531296 and B143764700, but existing source guards do not yet accept A. Implement only after exact scope and meaningful unknown-actor/source/target refusal checks; no B impersonation or borrowed credentials. Keep one task/worker and managed source binding.

A continues sequentially in OPS00, with an exact executable scope amendment before this next implementation. No role/flag/runtime/cloud mutation or source widening has occurred in this preparation note. Paused NP00/participant consent/cancelled password policy and B's unpublished artifacts remain preserved.

## Next read-only facts for the permission package

This five-request block verifies the exact account and actual Lambda runtime-role binding, then reports only the role name/boundary ARN, inline candidate existence/count and managed attachment count/completeness. No trust principal, token, environment variable, policy document or participant data is printed; IAM role/policy ARNs are fixed project metadata. No AWS write. Run in A's own working standard CloudShell, not another user's credentials. Count and boundary metadata do not establish effective permission; exact existing named policy/boundary content needs private baseline readback before any guarded attachment if present. It never overwrites current policies or changes the runtime.

```bash
(
set -euo pipefail
export AWS_MAX_ATTEMPTS=1 AWS_PAGER=""

test "$(command aws sts get-caller-identity --region us-east-1 --query Account --output text --no-cli-pager)" = 092954139775

test "$(command aws lambda get-function-configuration --function-name known-enough-stage-api --region us-east-1 --query Role --output text --no-cli-pager)" = arn:aws:iam::092954139775:role/KnownEnoughStageApiRole

command aws iam get-role --role-name KnownEnoughStageApiRole \
  --query 'Role.{Name:RoleName,Boundary:PermissionsBoundary.PermissionsBoundaryArn}' \
  --output json --no-cli-pager

command aws iam list-role-policies --role-name KnownEnoughStageApiRole \
  --no-paginate \
  --query '{InlinePolicyCount:length(PolicyNames),ParticipantPolicyAlreadyPresent:contains(PolicyNames, `"KnownEnoughPartitionParticipant"`),Truncated:IsTruncated}' \
  --output json --no-cli-pager

command aws iam list-attached-role-policies --role-name KnownEnoughStageApiRole \
  --no-paginate --query '{AttachedPolicyCount:length(AttachedPolicies),Truncated:IsTruncated}' \
  --output json --no-cli-pager
) 1>&2
```

Bash syntax verified locally; live metadata result remains NOT_EXECUTED. This preparation extends documentation only, with no extra application source or workflow edit.
