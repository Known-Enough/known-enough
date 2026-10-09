# OPS00 recovery CREATE: current checked command package

Use the six blocks below in order in **standard persistent CloudShell, account 092954139775, region us-east-1**, using your own existing authorized setup credentials. This is the concrete CREATE route requested after the supplied [inventory](a-cloudshell-inventory-20261009.md) observed the named recovery resources absent at 2026-10-09T15:41:39.125259Z. Each submission checks fresh identity, OIDC and named-resource conflicts; the older inventory is context, not current authorization or installation proof. No credentials are shared.

Checked source **dfee148ab3e10b05e7b089ac1d37eab60244a2b4**. [Driver](../../../scripts/operations/cloudshell-create.py), [30 offline regressions](../../../scripts/operations/cloudshell-create.test.py), [integrity/evidence](create-package-integrity.md). The template remains SHA256 **3370a0d1a03fc3792eb53f5cc5778d7202af0e4c32db06a6d6b553be9895f59e**. New private state is `$HOME/.known-enough/ops00-create-20261009`; retain it and every earlier package/private recovery file. Do not repin, delete, overwrite, or recreate state to get past a failure.

**This package has been checked offline; none of these AWS commands was executed during its preparation.** It creates only KnownEnoughOperationsRecovery and the existing four-resource template: journal, private manifest bucket/policy and exact GitHub recovery role. It does not update/import existing resources, install partition/job/retention stacks, enable flags, dispatch managed tests, or touch participant/model data. Whole OPS00 remains open until real installation, scope checks and same-source two-run recovery proof finish.

## 1. Download and verify this exact source, once

CloudShell needs git, AWS CLI and Python 3.9 or later. The new directory is private and source pinned; a partial or changed checkout stops instead of resetting saved work. The regression suite makes no real AWS request.

```bash
set -euo pipefail
umask 077
KE_OPS_SOURCE=dfee148ab3e10b05e7b089ac1d37eab60244a2b4
KE_OPS_ROOT="$HOME/.known-enough/ops00-create-tools-$KE_OPS_SOURCE"
KE_OPS_STATE="$HOME/.known-enough/ops00-create-20261009"
python3 - "$KE_OPS_ROOT" "$KE_OPS_STATE" <<'PY_HOME'
import os, sys
from pathlib import Path
home = Path.home().resolve(strict=True)
for name in sys.argv[1:]:
    target = Path(name).absolute()
    assert target != home and target.is_relative_to(home), 'Private HOME required'
    current = home
    for part in target.relative_to(home).parts:
        assert part not in ('.', '..'), 'Unsafe path'
        current = current / part
        try:
            current.mkdir(mode=0o700)
        except FileExistsError:
            pass
        info = current.lstat()
        assert not current.is_symlink() and current.is_dir(), 'Private directory required'
        assert info.st_uid == os.getuid() and not info.st_mode & 0o077, 'Private owner/mode required'
PY_HOME
if [ ! -e "$KE_OPS_ROOT/.git" ]; then
  git clone https://github.com/Known-Enough/known-enough.git "$KE_OPS_ROOT"
  git -C "$KE_OPS_ROOT" checkout --detach "$KE_OPS_SOURCE"
fi
cd "$KE_OPS_ROOT"
test "$(git rev-parse HEAD)" = "$KE_OPS_SOURCE"
test "$(git remote get-url origin)" = https://github.com/Known-Enough/known-enough.git
test -z "$(git status --porcelain)"
printf '%s  %s\n' '97942c7f427c27dd3efd411b08b7894ba8840bf52f70bbc96d741e97bb711987' 'scripts/operations/cloudshell-create.py' | sha256sum --check --strict -
printf '%s  %s\n' '6e8423eaeb94554dddfbf105c7aa98df4baab5288d7936b7df586c130851b9d9' 'scripts/operations/cloudshell-create.test.py' | sha256sum --check --strict -
printf '%s  %s\n' 'ba8feef68de6ebe7cf9ba65f705cd61d773eb92c3dd424f4612c17b7e202e66f' 'scripts/operations/cloudshell-inventory.py' | sha256sum --check --strict -
printf '%s  %s\n' '3370a0d1a03fc3792eb53f5cc5778d7202af0e4c32db06a6d6b553be9895f59e' 'infra/operations/setup.json' | sha256sum --check --strict -
python3 -B scripts/operations/cloudshell-create.test.py
```

## 2. Submit the CREATE preview

This is the first AWS mutation: one CREATE change set with a durable client token, after identity/OIDC/conflict/ValidateTemplate reads. CloudFormation creates a REVIEW_IN_PROGRESS stack placeholder; resources are installed only by block 4. The driver fsyncs `create.intent.json` before submission. A repeated block 2 with an intent already present performs read-only resume, never another CREATE submission.

```bash
set -euo pipefail
umask 077
KE_OPS_SOURCE=dfee148ab3e10b05e7b089ac1d37eab60244a2b4
KE_OPS_ROOT="$HOME/.known-enough/ops00-create-tools-$KE_OPS_SOURCE"
KE_OPS_STATE="$HOME/.known-enough/ops00-create-20261009"
cd "$KE_OPS_ROOT"
python3 -B scripts/operations/cloudshell-create.py prepare --source "$KE_OPS_SOURCE" --state "$KE_OPS_STATE"
```

## 3. Resume and inspect the preview

Run this block again if the result is PREVIEW_PENDING. Each invocation performs one bounded poll, with at most 32 AWS requests, a 180-second overall AWS deadline, 10 seconds per request, one CLI attempt and 128 KiB per output stream. REVIEW_READY requires CREATE_COMPLETE/AVAILABLE, exactly the four expected Add resources, the original template and the same REVIEW_IN_PROGRESS stack. The returned reviewHash binds source, template, exact stack/change-set IDs and additions; it is technical scope verification under existing standing authorization.

```bash
set -euo pipefail
umask 077
KE_OPS_SOURCE=dfee148ab3e10b05e7b089ac1d37eab60244a2b4
KE_OPS_ROOT="$HOME/.known-enough/ops00-create-tools-$KE_OPS_SOURCE"
KE_OPS_STATE="$HOME/.known-enough/ops00-create-20261009"
cd "$KE_OPS_ROOT"
python3 -B scripts/operations/cloudshell-create.py resume --source "$KE_OPS_SOURCE" --state "$KE_OPS_STATE"
```

## 4. Execute the verified preview, once

This is the second AWS mutation. This block first obtains the current reviewHash, then rechecks the preview/template/stack, identity and role/table/bucket conflicts before submitting one execute request with its saved token. `execute.intent.json` is fsynced before the request. Do not run the historical commented-out manual CREATE/UPDATE commands below.

```bash
set -euo pipefail
umask 077
KE_OPS_SOURCE=dfee148ab3e10b05e7b089ac1d37eab60244a2b4
KE_OPS_ROOT="$HOME/.known-enough/ops00-create-tools-$KE_OPS_SOURCE"
KE_OPS_STATE="$HOME/.known-enough/ops00-create-20261009"
cd "$KE_OPS_ROOT"
KE_OPS_REVIEW="$(python3 -B scripts/operations/cloudshell-create.py review --source "$KE_OPS_SOURCE" --state "$KE_OPS_STATE")"
printf '%s\n' "$KE_OPS_REVIEW"
KE_OPS_REVIEW_HASH="$(python3 -c 'import json,re,sys; v=json.load(sys.stdin); assert v["result"]=="REVIEW_READY" and re.fullmatch("[0-9a-f]{64}",v["reviewHash"]); print(v["reviewHash"])' <<< "$KE_OPS_REVIEW")"
python3 -B scripts/operations/cloudshell-create.py execute --source "$KE_OPS_SOURCE" --state "$KE_OPS_STATE" --review-hash "$KE_OPS_REVIEW_HASH"
```

## 5. Resume the same installation after waiting or reconnecting

The block sets its own paths, so it also works after reconnecting. INSTALL_PENDING is pending, not a failure or PASS. Run the same block again at a later checkpoint. After an execute intent exists, block 5 issues only configuration reads, including when the previous execute acknowledgment was lost. No automatic mutation retry, new token, reset, cleanup, rollback or parallel installation is issued.

```bash
set -euo pipefail
umask 077
KE_OPS_SOURCE=dfee148ab3e10b05e7b089ac1d37eab60244a2b4
KE_OPS_ROOT="$HOME/.known-enough/ops00-create-tools-$KE_OPS_SOURCE"
KE_OPS_STATE="$HOME/.known-enough/ops00-create-20261009"
cd "$KE_OPS_ROOT"
python3 -B scripts/operations/cloudshell-create.py resume --source "$KE_OPS_SOURCE" --state "$KE_OPS_STATE"
```

## 6. Repeat exact configuration readback

CONFIGURATION_MATCH requires CREATE_COMPLETE, original template/four physical resources, exact role/trust/inline policy/no attachments or boundary, table encryption/backups/TTL/deletion protection, and private/versioned/encrypted/TLS/exclusive-create bucket configuration. The driver retains the existing encrypted-table metadata criterion; missing metadata remains a mismatch rather than a waived check. This result is configuration only: effectivePermissions remains UNKNOWN and managedRecovery remains NOT_EXECUTED.

```bash
set -euo pipefail
umask 077
KE_OPS_SOURCE=dfee148ab3e10b05e7b089ac1d37eab60244a2b4
KE_OPS_ROOT="$HOME/.known-enough/ops00-create-tools-$KE_OPS_SOURCE"
KE_OPS_STATE="$HOME/.known-enough/ops00-create-20261009"
cd "$KE_OPS_ROOT"
python3 -B scripts/operations/cloudshell-create.py readback --source "$KE_OPS_SOURCE" --state "$KE_OPS_STATE"
```

For BLOCKED, stop the dependent sequence and retain all private intent, acknowledgment, response and diagnostic files. AccessDenied is not absence. Expired credentials may be renewed in your own authorized session, followed by block 3 or 5 using the same state. ChangeSetNotFound after uncertain submission, failed/rollback stacks, source/state conflict, unexpected resources or configuration drift require reconciliation of that saved plan; do not create another state directory or resubmit manually. Raw diagnostics/identities/configuration and resource IDs stay private, mode 600 under mode-700 HOME directories. Share only the finite result/classification/request/mutation counts and review hash, after checking the text for private data.

After configuration matches, B's own Battosai1806 workflow must separately verify installed scope and positive/negative behavior, then complete two sequential operations-recovery runs at the same verified source using the existing bounded synthetic probe and private recovery records. Keep `OPERATIONS_RECOVERY_ENABLED` and runtime/deployment state unchanged until the applicable installed guard is verified. Existing inspector access denials are not repaired or retried by this package. Record actual run links/artifacts, positive/negative outcomes and cleanup; preparation alone is not DONE.

AWS semantics: [CreateChangeSet](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_CreateChangeSet.html), [DescribeChangeSet](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DescribeChangeSet.html), [ExecuteChangeSet](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ExecuteChangeSet.html), [GetTemplate](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_GetTemplate.html). The CREATE type is bound in the saved request and exact Add/template/stack review; DescribeChangeSet does not supply a ChangeSetType field. No platform restriction is bypassed and no new approval is requested by this prepared package.

## Historical packages retained verbatim

The following is preserved evidence of older preparation and pins. The current six-block sequence above supersedes its manual placeholders; all old HOME folders and source markers remain untouched.

# OPS00: CloudShell commands for A

**INVENTORY_REQUIRED. Start with block 1.** It downloads checked public source and reads configuration. Installation, activation and live acceptance are separate. Read-only inventory source: **3c1edea0d450d2552bf08754fca6c568d172026d**. A uses A’s own AWS console session; B continues in its existing chat with its own GitHub account. No credentials are shared.

This update validates the types of OIDC audience and role/trust comparison metadata before interpreting a successful read. Malformed comparison fields produce `AWS_RESPONSE_REJECTED`/UNKNOWN, skip their dependents and allow the remaining sanitized inventory to finish. Valid configuration comparisons remain MATCH/MISMATCH; this is not installation proof.

Capture now enforces128KiB per output stream while each command runs, drains both pipes and terminates/waits on overflow or timeout. Oversized output remains AWS_RESPONSE_LIMIT/UNKNOWN; no unbounded temporary output file is accepted. All existing account/private-state/metadata and installation guards remain.

Preserve all three earlier packages: original **b4637cf1a5c5ae83540c816cc47199473b213a3c** under `$HOME/.known-enough/ops00-20261009`, root-compatible **c2046b43185669db98ae2a44c8a54d0e98e08931** under `$HOME/.known-enough/ops00-root-20261009`, and typed-metadata **9c2b168a25c6de345bce44e52397cfb8c666e928** under `$HOME/.known-enough/ops00-metadata-20261009`. Keep every private source marker, inventory and resume file. This checked read-only package uses the separate `$HOME/.known-enough/ops00-capture-20261009` directory. Do not repin, overwrite or delete older clones.

## 1. Copy this read-only block into standard CloudShell

Open account **092954139775**, region **us-east-1**, using your existing authorized setup identity. Account identity is checked before resource reads; account matching does not prove setup permissions. The exact same-account root ARN, IAM user and assumed-role identities are accepted for these bounded metadata reads only. Foreign-account, malformed and unavailable identities stop. Root is not attributed to an IAM user or a workload role; setup capabilities and effective permissions remain UNKNOWN. Standard CloudShell preserves HOME across sessions; VPC CloudShell does not. [AWS storage limits](https://docs.aws.amazon.com/cloudshell/latest/userguide/limits.html), [environment limitations](https://docs.aws.amazon.com/cloudshell/latest/userguide/working-with-aws-cloudshell.html).

```bash
set -euo pipefail
umask 077
KE_PACKAGE_SHA=3c1edea0d450d2552bf08754fca6c568d172026d
KE_PACKAGE_HOME="$HOME/.known-enough/ops00-capture-20261009"
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
ba8feef68de6ebe7cf9ba65f705cd61d773eb92c3dd424f4612c17b7e202e66f  scripts/operations/cloudshell-inventory.py
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
cd "$HOME/.known-enough/ops00-capture-20261009/source"
test "$(git rev-parse HEAD)" = 3c1edea0d450d2552bf08754fca6c568d172026d
test -z "$(git status --porcelain)"
sha256sum --check <<'HASHES'
ba8feef68de6ebe7cf9ba65f705cd61d773eb92c3dd424f4612c17b7e202e66f  scripts/operations/cloudshell-inventory.py
3370a0d1a03fc3792eb53f5cc5778d7202af0e4c32db06a6d6b553be9895f59e  infra/operations/setup.json
HASHES
python3 -B scripts/operations/cloudshell-inventory.py \
  --source-sha 3c1edea0d450d2552bf08754fca6c568d172026d \
  --state-dir "$HOME/.known-enough/ops00-capture-20261009/state"
RESUME
  )
fi
test ! -L "$KE_PACKAGE_HOME/resume.sh"
bash "$KE_PACKAGE_HOME/resume.sh"
```

Return only its printed JSON summary (or `state/inventory-*/summary.json`), package/template hashes and any fixed `OPS_INVENTORY_STOPPED` error. **Do not return the other files.** Full IAM/identity/Lambda environment metadata stays under private HOME, directories700/files600. No credentials, tokens, session/UserId, emails, private snapshots, grants or presigned URLs should be pasted. The helper performs at most64 sequential one-attempt reads,10seconds per process/180seconds total/128KiB captured-response limit; no pagination, AWS mutation, table-row/user/secret read, paid model or email. Denied/unreadable/incomplete means UNKNOWN; only the corresponding service’s exact not-found establishes ABSENT. Generic CloudFormation ValidationError is UNKNOWN.

Resume after session expiry with one command:

```bash
bash "$HOME/.known-enough/ops00-capture-20261009/resume.sh"
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
