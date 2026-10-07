# OPS00 exact setup and workflow package — preparation

The checked journal adapter targets only `arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughOperationsJournal`. Nothing here establishes installation or permission effectiveness.

## Setup change set

Create the dedicated PAY_PER_REQUEST DynamoDB table with string PK/SK, encryption enabled and point-in-time recovery enabled. No TTL until OPS02 retention is fixed. Preserve the table on rollback/removal; never replace a table containing a journal. Read back account/region/table/key schema/encryption/PITR before allowing workload use. Runtime role is separate from setup role; OIDC trust binds `repo:Known-Enough/known-enough:ref:refs/heads/main` and audience `sts.amazonaws.com`. Role name and bootstrap integration must be reviewed against installed role inventory before creation; no duplicate role assumed necessary.

Runtime needs only GetItem/PutItem on the exact journal table; restrict LeadingKeys to PLAN# hashes, no DeleteItem/DeleteTable/IAM access or AUTH/TOTAL control writes. DescribeTable/readback is a separate exact-resource capability. Role trust/policy mutation must stay outside runtime self-delegation. Existing workload roles are reused for publication, never widened to arbitrary administration.

## Workload workflow inputs and preflight

Use exact current main source, operation contract hash and plan hash, plus approved resource identity. Private plan/manifest records are loaded from a separately fixed recovery location; never put participant rows, credentials or arbitrary commands in workflow dispatch inputs. Before credentials or mutations, run focused operations tests, verify source/ref/own account, strict envelope/plan validation and operation contract completeness. Do not enable a workflow whose plan is incomplete.

Only after installed table/role and durable manifest readback may the injected Dynamo adapter be wired to AWS. Service preparation is create-if-absent; resume loads the same plan/revision and uses conditional writes. A failed CAS must reread before another bounded action, never overwrite. Operation-specific writes require target revision checks and participant/operator authority independently of cloud workload authorization. Journal completion cannot substitute for data readback.

Safe receipts contain source/plan/contract hashes, phase/result and counts only. Report exact sanitized service denial classification and retain private diagnostics securely. No unbounded retry, resource re-creation, counter resets, destructive rollback or private artifact upload. Revoke only this bounded delegation after preserving recovery records; completed journal history does not authorize a new operation.

## Remaining coding dependencies

The journal adapter and conditional service are tested; they do not yet implement migration/archive/erasure/model-job operations. OPS01–03 must provide exact operation contracts. Durable manifest storage, executable source-pinned workflow, minimal bootstrap template/policies and actual installed readback/representative workload remain required. OPS00 stays IN_PROGRESS, not CODE_READY/DONE. Final cloud phase installs only a checked setup package; current coding work needs no personal AWS credentials or recurring A console session.


## Checked recovery foundation — 2026-10-07, run114

The source package now includes strict plan/recovery validation, conditional journal service, exact-table Dynamo transport, content-addressed versioned S3 manifests, recovery-first preparation, a bounded AWS CLI transport, installed-storage readback and a synthetic preparation/resume workload. These are inactive, compatible additions; existing application publication/runtime and A's paused NP00 are untouched.

The generated [setup.json](../../../infra/operations/setup.json) proposes only `KnownEnoughOperationsJournal`, private bucket `known-enough-operations-recovery-092954139775-us-east-1`, and role `KnownEnoughGithubOperationsRecovery`. Retain table/bucket on stack deletion/replacement; table deletion protection, encryption/PITR and no TTL; bucket versioning, encryption, owner-enforced ownership, all public-access blocks and no lifecycle expiry. The runtime role cannot edit IAM/trust, assume other roles or delete the table/manifest versions. Describe/readback permissions are exact-resource only. Setup has no participant-table, AUTH/TOTAL or provider permissions. Do not replace/repurpose an existing resource with the proposed name.

[operations-verify.yml](../../../.github/workflows/operations-verify.yml) accepts an exact main SHA, verifies repository/ref/B numeric actor/checkout/source/template before installing dependencies, and runs focused operations plus pinned full checks. It has no AWS credentials or id-token permission. Its artifact includes only the public setup proposal and allowlisted `OFFLINE_VERIFIED` report; installation and managed recovery remain UNKNOWN.

[operations-recovery.yml](../../../.github/workflows/operations-recovery.yml) is gated by the technical `OPERATIONS_RECOVERY_ENABLED` configuration flag, which B has not enabled. It checks source/actor/ref/probe ID before OIDC, then actual account/exact role and table/bucket preservation configuration before any write. Only a synthetic UUID-v4 recovery manifest and PREPARED journal can be created/resumed. There is no arbitrary command/plan input or participant operation. Reuse the same UUID and exact source for duplicate/restart proof; a changed source requires a newly reviewed plan and never silently adopts an old journal. Maximum 15 AWS requests per successful preparation, each with one attempt/30-second subprocess timeout, 1 MiB manifest limit and 1-item probe bound. No paid model/email call. Private temporary files are scoped to a mode700 directory with mode600 upload/request files and removed on success/failure. Durable recovery remains in S3/Dynamo; private bytes/version IDs never enter GitHub artifacts. A failed storage write can have an unknown outcome: preserve original inputs and resume/read back, never overwrite/reset counters or recreate resources.

The CLI uses JSON input files for nonbinary API fields and an explicit file path for `--body`; GET pins the HEAD version and size before download and verifies exact bytes afterward. Its classified failures expose only allowlisted service codes, with private diagnostics held internally. The setup's conditional-put policy follows [AWS's conditional-write guidance](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes-enforce.html); binary file and last-position output handling follows [PutObject](https://docs.aws.amazon.com/cli/latest/reference/s3api/put-object.html) and [GetObject](https://docs.aws.amazon.com/cli/latest/reference/s3api/get-object.html) documentation. Local tests use injected subprocess/storage fixtures; this establishes wiring and guards, not installed AWS behavior.

## Exact final cloud phase steps — do not execute during coding

1. Verify own account092954139775/us-east-1, clean source/hash, existing table/bucket/role/stack inventory and OIDC provider through the authorized setup/inspector path. Reuse sufficient installed capabilities; do not create duplicates or expand A's saved NP00 role. The proposed recovery role must remain separate from setup authority. Any existing conflicting resource or outside-envelope permission stays a concrete gap.
2. Validate the checked template with AWS CloudFormation and prepare a named change set for `KnownEnoughOperationsRecovery` using the exact checked `infra/operations/setup.json`, `--capabilities CAPABILITY_NAMED_IAM`, `--region us-east-1`. Inspect all changes for the three intended resources plus the bucket policy, no replacement/deletion or unrelated IAM mutation. No CloudFormation schema/service validation has executed in the coding phase.
3. Execute that exact change set only in the final phase; inspect stack result, IAM trust/effective scope and resource preservation settings. Save sanitized source/template/change-set identity. On failure stop and preserve existing data; Retain is not a rollback/migration proof. Revoke only the bounded runtime delegation if necessary; keep journals/manifests for recovery under the eventual retention policy.
4. Only after installation/readback set `OPERATIONS_RECOVERY_ENABLED=true` in the project configuration. Using B's own GitHub login, dispatch `operations-recovery.yml` twice sequentially on unchanged main with the same source and synthetic UUID. Inspect matching actor/source/result artifacts and persistent original manifest/journal across runners, plus bounded negative/denial cases and effective scope. A configured flag or successful OIDC alone is not managed recovery PASS. Disable the flag on a genuine configuration failure; never reset storage/usage to repair proof.
5. OPS01–03 supply their exact partition/archive, retention/erasure and ID-only job contracts and participant/operator authority checks in their sequential coding phases. Extend only the reviewed resource-specific apply/readback paths after those schemas exist; no wildcard future-table/queue permissions or claim that this synthetic preparation applies real operations. Consolidate those checked contracts into the final setup package before actual managed migration/deletion/job execution.

These steps are deferred managed criteria, not a new approval requirement. Standing user authority applies; administrator installation is scheduled last. OPS00's coding milestone can hand off this recovery foundation to OPS01 while whole-task status remains REVIEW. Final OPS00 DONE requires actual bounded operations mapping/delegation and B workload/recovery proof, rather than this proposed template or synthetic fixtures alone.


### Final-phase change-set command contract

These commands are saved instructions, not executed cloud evidence. Work from the checked repository source whose setup hash is `a8c67e9a4474b8561a991e8446ae1db36e23c70de18bd09bff4241bdd5c0d627`. Verify the installed inventory and source before choosing CREATE versus UPDATE; an existing stack/resource must not be silently replaced. Use the authorized setup account/session, never another human's credentials or the recovery workload role.

```bash
sha256sum infra/operations/setup.json
aws sts get-caller-identity --region us-east-1
aws cloudformation validate-template --region us-east-1 --template-body file://infra/operations/setup.json
aws cloudformation create-change-set --region us-east-1 --stack-name KnownEnoughOperationsRecovery --change-set-name ke-operations-recovery-v1 --change-set-type CREATE --capabilities CAPABILITY_NAMED_IAM --template-body file://infra/operations/setup.json
aws cloudformation describe-change-set --region us-east-1 --stack-name KnownEnoughOperationsRecovery --change-set-name ke-operations-recovery-v1
```

The CREATE example is valid only after proving that stack and all proposed resources are absent. For a verified existing managed stack, prepare a separately reviewed UPDATE change set with its exact existing identity. Execute only the inspected change-set ARN, then read back stack/IAM/resource configuration and preserve sanitized receipts. The source-exact B GitHub preparation/resume dispatch and storage/participant operation separation above remain required. No runtime self-delegation or universal setup authority is created by this package.
