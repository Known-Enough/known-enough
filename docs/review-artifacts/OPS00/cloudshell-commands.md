# OPS00: CloudShell commands for A

**INVENTORY_REQUIRED. Start with block 1.** It downloads checked public source and reads configuration. Installation, activation and live acceptance are separate. Read-only inventory source: **c2046b43185669db98ae2a44c8a54d0e98e08931**. A uses A’s own AWS console session; B continues in its existing chat with its own GitHub account. No credentials are shared.

The prior package at **b4637cf1a5c5ae83540c816cc47199473b213a3c** rejected root locally after STS. Preserve `$HOME/.known-enough/ops00-20261009` and every old private inventory/source marker/resume file. This corrected read-only package uses the separate `$HOME/.known-enough/ops00-root-20261009` directory; the block downloads its checked pin there and the new resume command uses that directory. Do not repin or overwrite the old clone.

## 1. Copy this read-only block into standard CloudShell

Open account **092954139775**, region **us-east-1**, using your existing authorized setup identity. Account identity is checked before resource reads; account matching does not prove setup permissions. The exact same-account root ARN, IAM user and assumed-role identities are accepted for these bounded metadata reads only. Foreign-account, malformed and unavailable identities stop. Root is not attributed to an IAM user or a workload role; setup capabilities and effective permissions remain UNKNOWN. Standard CloudShell preserves HOME across sessions; VPC CloudShell does not. [AWS storage limits](https://docs.aws.amazon.com/cloudshell/latest/userguide/limits.html), [environment limitations](https://docs.aws.amazon.com/cloudshell/latest/userguide/working-with-aws-cloudshell.html).

```bash
set -euo pipefail
umask 077
KE_PACKAGE_SHA=c2046b43185669db98ae2a44c8a54d0e98e08931
KE_PACKAGE_HOME="$HOME/.known-enough/ops00-root-20261009"
python3 - "$KE_PACKAGE_HOME" <<'PY'
import os, sys
from pathlib import Path
home=Path.home().resolve(strict=True); target=Path(sys.argv[1]).absolute()
assert target != home and target.is_relative_to(home), 'HOME required'
current=home
for part in target.relative_to(home).parts:
    assert part not in ('.','..'), 'Unsafe path'
    current=current/part
    try: current.mkdir(mode=0o700)
    except FileExistsError: pass
    st=current.lstat()
    assert not current.is_symlink() and current.is_dir() and st.st_uid==os.getuid() and not st.st_mode & 0o077, 'Private owned directory required'
PY
if [[ ! -e "$KE_PACKAGE_HOME/source" ]]; then
  git init --quiet "$KE_PACKAGE_HOME/source"
  git -C "$KE_PACKAGE_HOME/source" remote add origin https://github.com/Known-Enough/known-enough.git
  git -C "$KE_PACKAGE_HOME/source" fetch --depth=1 origin "$KE_PACKAGE_SHA"
  git -C "$KE_PACKAGE_HOME/source" checkout --quiet --detach FETCH_HEAD
fi
test ! -L "$KE_PACKAGE_HOME/source"
cd "$KE_PACKAGE_HOME/source"
test "$(git remote get-url origin)" = https://github.com/Known-Enough/known-enough.git
test "$(git rev-parse HEAD)" = "$KE_PACKAGE_SHA"
test -z "$(git status --porcelain)"
sha256sum --check <<'HASHES'
aca919eb5f4acc586ea16f466900efad1625fb2c4c4806cbac3d42dc45fe22c6  scripts/operations/cloudshell-inventory.py
3370a0d1a03fc3792eb53f5cc5778d7202af0e4c32db06a6d6b553be9895f59e  infra/operations/setup.json
262afec3e0c6d5306e819a723d3589c86f8499e1f9995ab33956046d9ff705f0  infra/operations/partition-setup.json
b39de7214e126786e17ac0b87d736164f056c4a98c9b80fa405813118d865450  infra/operations/retention-setup.json
c16ec37ce4753ccf600fc3503aee50209f2da6f30263c25659744df1e6e2a639  infra/operations/jobs-setup.json
HASHES
if [[ ! -e "$KE_PACKAGE_HOME/resume.sh" ]]; then
  ( set -o noclobber; cat > "$KE_PACKAGE_HOME/resume.sh" <<'RESUME'
#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$HOME/.known-enough/ops00-root-20261009/source"
test "$(git rev-parse HEAD)" = c2046b43185669db98ae2a44c8a54d0e98e08931
test -z "$(git status --porcelain)"
sha256sum --check <<'HASHES'
aca919eb5f4acc586ea16f466900efad1625fb2c4c4806cbac3d42dc45fe22c6  scripts/operations/cloudshell-inventory.py
3370a0d1a03fc3792eb53f5cc5778d7202af0e4c32db06a6d6b553be9895f59e  infra/operations/setup.json
HASHES
python3 -B scripts/operations/cloudshell-inventory.py \
  --source-sha c2046b43185669db98ae2a44c8a54d0e98e08931 \
  --state-dir "$HOME/.known-enough/ops00-root-20261009/state"
RESUME
  )
fi
test ! -L "$KE_PACKAGE_HOME/resume.sh"
bash "$KE_PACKAGE_HOME/resume.sh"
```

Return only its printed JSON summary (or `state/inventory-*/summary.json`), package/template hashes and any fixed `OPS_INVENTORY_STOPPED` error. **Do not return the other files.** Full IAM/identity/Lambda environment metadata stays under private HOME, directories700/files600. No credentials, tokens, session/UserId, emails, private snapshots, grants or presigned URLs should be pasted. The helper performs at most64 sequential one-attempt reads,10seconds per process/180seconds total/128KiB captured-response limit; no pagination, AWS mutation, table-row/user/secret read, paid model or email. Denied/unreadable/incomplete means UNKNOWN; only the corresponding service’s exact not-found establishes ABSENT. Generic CloudFormation ValidationError is UNKNOWN.

Resume after session expiry with one command:

```bash
bash "$HOME/.known-enough/ops00-root-20261009/resume.sh"
```

Each inventory is a new dated attempt; the original source record and all prior files are retained. Interrupted download, changed source, unsafe path, expired/denied access or conflicting state stops. Preserve it and return the sanitized error; do not delete state, reset the clone or switch pins. HOME is regional,1GB and expires after120days of regional inactivity; retain a controlled private backup before that limit. `/tmp` is rebuildable tools only.

### Exact inventory and sanitized outputs A should return

The helper inventories recovery stack `KnownEnoughOperationsRecovery`, proposed partition stack `KnownEnoughPartitionsStorage` (a proposal, not claimed installed), existing `known-enough-live-qa` stack/templates/resource mappings; exact GitHub OIDC provider; six fixed recovery/runtime/inspector/primary-release/QA-release/QA-test roles with bounded policies; `KnownEnoughOperationsJournal`, `KnownEnoughPartitions`, `KnownEnoughGroupsStage`, `KnownEnoughStage`, `KnownEnoughQaControl`; private recovery bucket preservation/configuration; primary Lambda and fixed primary pool/participant/display clients. Full values stay private. Attached-policy documents, SCP/session boundaries, Identity Center and original private recovery are not established by this inventory.

Along with the summary, review saved files locally and return these **sanitized comparisons**, without repeating AWS calls or uploading raw metadata:

- Verified setup role name and availability of the exact setup actions in section2; no session/UserId. READ or simulation does not prove a write worked.
- Exact stack status and logical→physical project resource names; table PK/SK/ACTIVE/on-demand/SSE/PITR/deletion-protection/noTTL comparisons; bucket versioning/private/ownership/TLS/conditional-create/no-expiry comparisons. Separate ABSENT, DENIED(code), UNKNOWN and MATCH.
- Recovery role trust comparison, policy hashes/counts and extra-boundary/attachment review gaps. Fixed role/resource names only; raw policy documents containing personal principals remain private.
- Primary pool/client verified-email/self-signup/callback/scopes and unchanged minimum8/all-character-class comparisons; source-bound primary model-off/release/configuration identity. These are configuration facts, not signup/journey execution.

Own-B GitHub OIDC GET verified `use_default=true`, `use_immutable_subject=true`, prefix `repo:Known-Enough@331386621/known-enough@1377587215`. The checked proposal now trusts exactly `repo:Known-Enough@331386621/known-enough@1377587215:ref:refs/heads/main` plus `aud=sts.amazonaws.com` on the existing exact provider. This corrects the proposal’s obsolete name-only subject; no installed trust, GitHub setting or runtime permission was changed. [GitHub immutable subjects](https://docs.github.com/en/actions/reference/security/oidc). Installed effective assumption remains unverified.

The conditional install section below is preserved on its original source pin and old private directory. Successful root metadata collection does not enable installation or establish root deployment capability. Return the new sanitized inventory first; B must separately reconcile its source/resources/capabilities before any reviewed install package or apply.

## 2. Conditional preview/install — wait for inventory reconciliation

**Apply is not ready.** B reconciles the returned facts with this pin first. Reuse sufficient existing resources/roles. CREATE requires the exact stack and all proposed resources proven absent. An existing standalone resource is a conflict, not permission to recreate/import it. UPDATE requires exact owned stack/resource mapping, original template/private recovery and a reviewed delta. REVIEW_IN_PROGRESS/pending change sets resume the original attempt. Denied/unknown inventory or drift stops both paths.

The recovery template provisions only the retained encrypted/PITR/deletion-protected journal, versioned/private retained recovery bucket, TLS/exclusive-create bucket policy and exact recovery workload role. It installs no OIDC provider, participant/runtime/signup/erasure/job capability. Missing/unreadable existing OIDC provider requires its own smallest checked setup delta; no duplicate provider or wildcard administrator fallback.

Required setup capabilities are CloudFormation ValidateTemplate/CreateChangeSet/DescribeChangeSet/ExecuteChangeSet/DescribeStacks/GetTemplate/ListStackResources for the exact two stack names; recovery DynamoDB CreateTable/DescribeTable/UpdateContinuousBackups/DescribeContinuousBackups/DescribeTimeToLive; S3 CreateBucket/PutBucketVersioning/PutEncryptionConfiguration/PutBucketPublicAccessBlock/PutBucketOwnershipControls/PutBucketPolicy and matching configuration reads on the exact bucket; IAM CreateRole/GetRole/PutRolePolicy/GetRolePolicy/UpdateAssumeRolePolicy/ListRolePolicies/ListAttachedRolePolicies on the one recovery role. Any service-role/PassRole and rollback-only capability must target the separately verified setup role/delta. This is an action inventory, **not a verified delegation or ready policy**: service creation scoping, SCP/boundary effects and exact rollback actions still require readback/review. Do not give CloudFormation/IAM setup rights to the workload or widen the inspector. Stop on actual sanitized denial; preserve its failed request/change set.

After B reconciles CREATE/UPDATE, source, identity and capability facts, this block prepares a preview request under HOME. Enter CREATE/UPDATE only from that reconciled handoff. It deliberately stops if the change-set read fails; a denied/timeout/validation result is not authorization to create it.

```bash
set -euo pipefail
umask 077
cd "$HOME/.known-enough/ops00-20261009/source"
test "$(git rev-parse HEAD)" = b4637cf1a5c5ae83540c816cc47199473b213a3c
test -z "$(git status --porcelain)"
export AWS_MAX_ATTEMPTS=1 AWS_PAGER="" AWS_REGION=us-east-1
KE_STATE="$HOME/.known-enough/ops00-20261009/state"
KE_PREVIEW="$KE_STATE/preview-$(date -u +%Y%m%dT%H%M%S%N)"
mkdir -m 700 "$KE_PREVIEW"
: "${KE_RECONCILED_TYPE:?Set CREATE or UPDATE from reconciled inventory; otherwise STOP}"
python3 - "$KE_STATE" "$KE_RECONCILED_TYPE" <<'PY'
import json, os, sys
from pathlib import Path
state=Path(sys.argv[1]); kind=sys.argv[2]
assert kind in ('CREATE','UPDATE')
request={'StackName':'KnownEnoughOperationsRecovery','ChangeSetName':'ke-ops00-b4637cf1a5c5',
         'ChangeSetType':kind,'ClientToken':'ke-ops00-b4637cf1a5c5','Capabilities':['CAPABILITY_NAMED_IAM'],
         'TemplateBody':Path('infra/operations/setup.json').read_text()}
path=state/'preview-request.json'
if path.exists():
    assert not path.is_symlink() and json.loads(path.read_text())==request, 'Preserve original request'
else:
    with os.fdopen(os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600),'w') as f:
        json.dump(request,f)
PY
# Responses/diagnostics remain private. A local timeout cannot cancel a server-side operation.
timeout 30s aws cloudformation validate-template --region us-east-1 \
  --template-body file://infra/operations/setup.json --no-cli-pager > "$KE_PREVIEW/validate-template.json" 2> "$KE_PREVIEW/validate-private-error.txt"
timeout 30s aws cloudformation describe-change-set --region us-east-1 \
  --stack-name KnownEnoughOperationsRecovery --change-set-name ke-ops00-b4637cf1a5c5 \
  --no-cli-pager > "$KE_PREVIEW/preview-current.json" 2> "$KE_PREVIEW/preview-private-error.txt"
# If and ONLY if that read proves this exact change set absent, submit ONCE:
# timeout 30s aws cloudformation create-change-set --region us-east-1 \
#   --cli-input-json "file://$KE_STATE/preview-request.json" --no-cli-pager > "$KE_PREVIEW/preview-created.json" 2> "$KE_PREVIEW/create-private-error.txt"
```

Inspect the preserved diagnostic locally; return finite action/target/code only. After a lost creation acknowledgement, inspect the original name/token/request; do not create another request or switch source. Poll DescribeChangeSet at most20times,15seconds apart (5minutes); reaching the bound is pending/UNKNOWN, not a failed installation or permission to repeat a mutation. Keep dated responses under HOME. [AWS change-set semantics](https://docs.aws.amazon.com/cli/latest/reference/cloudformation/create-change-set.html).

Require CREATE_COMPLETE, correct stack/change-set ARN/account/region and exact template hash. Review every change: only Journal, Manifests, ManifestPolicy, RecoveryRole. UPDATE allows no Remove, replacement=True/Conditional, unreviewed drift, unrelated change or broader permission. Save the exact ARN and reviewed plan privately. Record `pending=execute` and the original request token **before** execution. Execute that ARN once, only after checking it starts `arn:aws:cloudformation:us-east-1:092954139775:changeSet/ke-ops00-b4637cf1a5c5/`, using `timeout 30s aws cloudformation execute-change-set --region us-east-1 --change-set-name "$KE_VERIFIED_CHANGESET_ARN" --client-request-token ke-ops00-b4637cf1a5c5 --no-cli-pager`. After expiry/timeout/unknown acknowledgement use the read-only resume command and inspect that exact stack/change set; do not re-execute. Poll stack status with the same5minute bound. Read back actual stack/template/trust/policy/table/bucket preservation before declaring installation. Metadata matching does not prove effective scope or recovery.

## 3. A’s one-time setup and B’s own remaining work

| Phase | A setup / unresolved facts | B source-matched execution and remaining managed proof |
| --- | --- | --- |
| OPS00 | Reconcile inventory; install only missing bounded recovery/trust delta; preserve journal/private bucket/history. | Effective positive/negative scope; then flag OPERATIONS_RECOVERY_ENABLED and two sequential operations-recovery.yml runs with one UUID/same current-main SHA. Preserve original manifest/version/journal across runners. |
| OPS01 | Retained KnownEnoughPartitions from partition-setup.json; map participant/migration/archive/inspection deltas to verified existing role ARNs/effective policies. | Wire checked coordinator/ports/runtime/private keys; recovery-first copy/freeze/activation, actual restart/concurrency/archive/privacy/service proof. Current workflow is a synthetic probe, not migration dispatch. |
| OPS02 | No new table/queue. Exact existing-table profiles/private seal key/source-bound synthetic policy/activity provenance. | Authenticated export/consent/erasure/executor/cleanup wiring is not installed; managed erasure/revocation/restart/unknown commit/history/backup/provider/Cognito proof. Operator access does not supply participant grants. |
| OPS03 | Dynamo bounded outbox, no invented SQS/scheduler. Exact worker profile and existing QA AUTH/TOTAL; preserve TOTAL, never seed/reset it. | Bind trusted server worker/source/control/retention/enqueue/provider;2slot leases/restart/duplicate/quarantine/usage/cleanup proof. IAM alone cannot install missing runtime wiring. |
| Primary signup / UI | Actual fixed pool/client/email/callback/configuration facts; unchanged minimum8/all classes. Password-policy/UpdateUserPool work remains cancelled. | Own existing auth-readback/release/qualification, real synthetic primary signup/email and matching UI/service checks. Configuration/old PASS is insufficient. |
| Paused NP00 / FIN01–03 | Preserve A source/private original recovery/excluded files. Historic temporary-access and ReadOnly model grant cleanup succeeded; fresh bounded effective/Identity Center evidence stays separate. Do not recreate BedrockTest or rerun obsolete mutations. | Protected-source/contract handoff for unresolved model-backed private Purchase; inherited scenarios and final matching installed release/storage/job/privacy/consent/usage/cleanup evidence before FIN03. Setup does not repair this source gap. |

Partition storage is a separate reviewed CREATE/UPDATE step using only partition-setup.json Resources and proposed stack name KnownEnoughPartitionsStorage. Its four metadata profiles need exact role mapping/attachment/readback first. retention-setup.json/jobs-setup.json are contracts, **not CloudFormation templates or installed workers**. Smallest initial conditional install: OPS00 recovery, then the retained partition delta; OPS02/03 configuration/wiring follows its real prerequisites. [OPS01 closeout](../OPS01/managed-closeout.md), [OPS02](../OPS02/managed-closeout.md), [OPS03](../OPS03/managed-closeout.md), [FIN01 obligations](../FIN01/obligations.md).

B first verifies own Battosai1806 ID143764700, clean ff-only main/exact source/hash/no active job. Use a newly checked current-main source if it differs from this preparation pin. After installed readback/effective-scope review, set only OPERATIONS_RECOVERY_ENABLED. Dispatch operations-recovery.yml with source_sha=<verified-main> and probe_id=<one synthetic UUIDv4> twice sequentially, inspecting the first matching completed actor/source/run/artifact before the second. Verify original private version/journal and safe source/plan/phase/count results. Effective negative outside-resource/prefix, overwrite/delete/self-delegation/stale-source proof needs a separately checked bounded probe; this package does not supply that negative runner or authorize real destructive probes. Simulation/assumed credentials are not effective managed PASS.

## 4. Failure and rollback

Stop writes on denial/mismatch/conflict/unknown outcome. Return UTC/source/action/fixed target/finite code/template+change-set hashes/last verified phase only; full diagnostics remain private. Disable the recovery flag to stop new probes. Retain table/bucket/manifests/journals, accounting and original source-bound progress. Revert/revoke only the separately verified exact recovery trust/policy delta from its saved original document if needed; no stack/table/bucket deletion, usage reset, permission-set reset or old-data overwrite. Retain is a safeguard, not recovered-data proof. After OPS01 freeze/activation or erasure there is no general restore-old-manifest command: reconcile current immutable recovery/committed state and original source/authority before a repair plan.

Current remaining facts: legitimate setup capabilities/boundary/SCP, ownership/drift, installed custom trust/policies, original private recovery, role-profile mapping/runtime wiring, effective negatives, same-source two-run recovery and OPS01–03 managed acceptance. All are unverified. **Block1 is usable now; apply stays INVENTORY_REQUIRED; whole OPS00 stays BLOCKED.** Preparation checks/hash records: [command evidence](cloudshell-command-evidence.json). Historical a8c67e9a… template remains historical; trust-corrected 3370a0d1a03fc3792eb53f5cc5778d7202af0e4c32db06a6d6b553be9895f59e is a checked proposal, not installed state.
