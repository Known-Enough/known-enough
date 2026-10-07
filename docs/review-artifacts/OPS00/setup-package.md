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
