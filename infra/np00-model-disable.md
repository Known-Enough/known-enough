# NP00 model-access shutdown — prepared, not applied

This is the NP00-only fail-closed change set. It removes the currently observed Nova Lite invocation grants and sets the Lambda model flags off. It does not create a model-test permission set, invoke a model, deploy code, or include NP05 group rollout, Cognito signup/email, or paid-model qualification. No AWS write has been run for this plan.

**Authorization/status, 2026-10-01:** the user explicitly authorized applying these exact writes after repeating the listed identity and hash checks, through the separate one-hour `KnownEnoughNP00Off` scope. The only authorized Lambda changes are `KE14_MODEL_MODE=DISABLED` and `KE14_PAID_CALLS_APPROVED=false` using the freshly read full environment map and `RevisionId`; the only policy removals are the two hash-matched Nova Lite grants. The authorized CloudShell setup is documented below, but the bootstrap profile remains unavailable and the temporary permission set is absent. No model-off write has been applied.

## Fresh read-only baseline and identity check

On 2026-10-01, both `known-enough-staging-ro` and `known-enough-stage1-release` returned account `092954139775`. Fresh readback found the Lambda `known-enough-stage-api` Active/Successful on `nodejs24.x`, handler `ke13b-lambda.handler`, execution role `KnownEnoughStageApiRole`, model mode `BEDROCK`, and paid-call flag `true`. Its unrelated environment values are preserved in a private mode-`0600` snapshot; the prepared environment request changes only those two flags to `DISABLED` and `false`.

The current runtime inline policy `KnownEnoughStageNovaLite` is exactly one Allow for `bedrock:InvokeModel` on `arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-lite-v1:0`; canonical JSON SHA-256 is `0b8612598320fc2b0121b8daa232d6814efb52f2fed30c1791ad6da4ceb58f57`. The `ReadOnlyAccess` permission-set inline policy is exactly the same single grant; canonical JSON SHA-256 is `be165dbd713fd1b5c0dc9e06a6e9511588a8863dcbd025c35fe7719494d57acd`.

The Identity Center identity was checked privately, without saving its opaque user ID or attributes in the repository:

- The `ReadOnlyAccess` permission set has one account assignment, of type `USER`.
- `identitystore:DescribeUser` returned a `UserId` matching that assignment, and the directory `UserName` matched the authenticated A SSO session name.
- The separate `known-enough-stage1-release` session also matched that same directory user and its assumed role name matched the expected Stage1 release permission set.
- The permission set is provisioned to one account, `092954139775`; its one assignment is that verified A user.
- Therefore deleting its inline policy currently affects only A's staging assignment. Repeat these checks immediately before the write and stop if the assignment, identity, account footprint, managed policy, boundary, or inline policy differs.

The Identity Center instance's encryption readback is `CUSTOMER_MANAGED_KEY` / `ENABLED`, using `arn:aws:kms:us-east-1:092954139775:key/mrk-f940f13807f145fd84387208b80a4b90`. A private `GetKeyPolicy` check found five statements and the account-root IAM delegation allow; no KMS key-policy edit is included. The temporary IAM/Identity Center caller scope therefore also needs `kms:Decrypt` on only that key for the Identity Center API operations. Recheck encryption state, key ARN, and the key-policy delegation immediately before granting or using that scope.

This read-only block refreshes those KMS prerequisites without printing the key policy:

```bash
set -euo pipefail
umask 077
NP00_KMS_CHECK_DIR=$(mktemp -d /tmp/known-enough-np00-kms-check.XXXXXX)
chmod 700 "$NP00_KMS_CHECK_DIR"
aws sso-admin describe-instance \
  --profile known-enough-staging-ro --region us-east-1 \
  --instance-arn arn:aws:sso:::instance/ssoins-722328a7765eb0e8 \
  --query EncryptionConfigurationDetails --output json --no-cli-pager \
  > "$NP00_KMS_CHECK_DIR/encryption-private.json"
aws kms get-key-policy \
  --profile known-enough-staging-ro --region us-east-1 \
  --key-id arn:aws:kms:us-east-1:092954139775:key/mrk-f940f13807f145fd84387208b80a4b90 \
  --policy-name default --query Policy --output text --no-cli-pager \
  > "$NP00_KMS_CHECK_DIR/key-policy-private.json"
chmod 600 "$NP00_KMS_CHECK_DIR"/*.json
python3 - "$NP00_KMS_CHECK_DIR" <<'PY'
import json, sys
from pathlib import Path
p=Path(sys.argv[1])
enc=json.loads((p/'encryption-private.json').read_text())
policy=json.loads((p/'key-policy-private.json').read_text())
statements=policy.get('Statement',[])
statements=statements if isinstance(statements,list) else [statements]
root='arn:aws:iam::092954139775:root'
def values(v): return v if isinstance(v,list) else [v]
delegation=any(
 s.get('Effect')=='Allow'
 and root in values(s.get('Principal',{}).get('AWS',[]))
 and any(a in ('kms:*','kms:Decrypt') for a in values(s.get('Action',[])))
 for s in statements)
assert enc.get('KeyType')=='CUSTOMER_MANAGED_KEY'
assert enc.get('KmsKeyArn')=='arn:aws:kms:us-east-1:092954139775:key/mrk-f940f13807f145fd84387208b80a4b90'
assert enc.get('EncryptionStatus')=='ENABLED'
assert delegation
print(f'IDENTITY_CENTER_CMK_CHECK=PASS; root_iam_delegation=true; statement_count={len(statements)}; key_policy_not_printed')
PY
```

This reproduces the identity and account-footprint check while printing only pass/fail counts, not the assigned principal ID or directory attributes:

```bash
python3 - <<'PY'
import json, subprocess
profile='known-enough-staging-ro'; region='us-east-1'; account='092954139775'
instance='arn:aws:sso:::instance/ssoins-722328a7765eb0e8'
store='d-906661f00d'
permission_set='arn:aws:sso:::permissionSet/ssoins-722328a7765eb0e8/ps-7223102750014ed2'
def aws(service, *args, profile=profile):
    result=subprocess.run(['aws',service,*args,'--profile',profile,'--region',region,'--no-cli-pager','--output','json'],capture_output=True,text=True)
    if result.returncode: raise RuntimeError('read-only identity query failed')
    return json.loads(result.stdout)
identity=aws('sts','get-caller-identity')
assert identity.get('Account') == account
session=identity['Arn'].split('/')[-1]
release=aws('sts','get-caller-identity',profile='known-enough-stage1-release')
assert release.get('Account')==account
release_session=release['Arn'].split('/')[-1]
release_role=release['Arn'].split(':assumed-role/',1)[1].split('/',1)[0]
assert release_role.startswith('AWSReservedSSO_KnownEnoughStage1Release_')
provisioned=aws('sso-admin','list-accounts-for-provisioned-permission-set','--instance-arn',instance,'--permission-set-arn',permission_set)
accounts=provisioned.get('AccountIds',provisioned.get('Accounts',[]))
account_ids=[a.get('AccountId') if isinstance(a,dict) else a for a in accounts]
assignments=[]
for target in account_ids:
    data=aws('sso-admin','list-account-assignments','--instance-arn',instance,'--account-id',target,'--permission-set-arn',permission_set)
    assignments.extend((target,a) for a in data.get('AccountAssignments',[]))
assert len(account_ids)==1 and account_ids[0]==account
assert len(assignments)==1 and assignments[0][0]==account
assigned=assignments[0][1]
assert assigned.get('PrincipalType')=='USER'
user=aws('identitystore','describe-user','--identity-store-id',store,'--user-id',assigned['PrincipalId'])
assert user.get('UserId')==assigned['PrincipalId'] and user.get('UserName')==session==release_session
permission=aws('sso-admin','describe-permission-set','--instance-arn',instance,'--permission-set-arn',permission_set)
assert permission.get('PermissionSet',{}).get('Name')=='ReadOnlyAccess'
managed=aws('sso-admin','list-managed-policies-in-permission-set','--instance-arn',instance,'--permission-set-arn',permission_set).get('AttachedManagedPolicies',[])
assert [item.get('Arn') for item in managed]==['arn:aws:iam::aws:policy/ReadOnlyAccess']
customer=aws('sso-admin','list-customer-managed-policy-references-in-permission-set','--instance-arn',instance,'--permission-set-arn',permission_set).get('CustomerManagedPolicyReferences',[])
assert not customer
role_name=identity['Arn'].split(':assumed-role/',1)[1].split('/',1)[0]
role=aws('iam','get-role','--role-name',role_name).get('Role',{})
assert role.get('Arn') and not role.get('PermissionsBoundary')
print('IDENTITY_AND_SCOPE_CHECK=PASS; assignments=1; provisioned_accounts=1; principal_id_and_attributes=not_printed')
PY
```

Private fresh snapshots and the prepared full-environment request are in `/tmp/known-enough-np00-model-off-q6zwmjh1` (directory mode `0700`; files mode `0600`). They include environment values and opaque Identity Center data. Do not print, commit, or copy them. The saved Lambda revision ID is only a preflight value; refresh it before any later authorized update.

## Exact change set

Apply only after the fresh read-only checks below and with the short-lived `KnownEnoughNP00Off` permission set described in [temporary permissions](permissions/np00-model-disable-temporary.json). This set is assigned only to A for the staging account, has a one-hour session duration, and grants only the Lambda guard update, the two exact policy removals/provisioning, and decryption on the one Identity Center key. Use this order:

1. Update only the Lambda environment flags using the complete, freshly read environment map and Lambda `RevisionId`; wait for `LastUpdateStatus=Successful`. AWS's CLI supports a revision guard that refuses the update if the function changed after readback ([AWS CLI reference](https://docs.aws.amazon.com/cli/latest/reference/lambda/update-function-configuration.html)).
2. Remove `KnownEnoughStageNovaLite` from `KnownEnoughStageApiRole` after a fresh exact-policy/hash check. This removes the runtime's observed Nova Lite grant after the application flags have been turned off.
3. Remove the one-grant inline policy from `ReadOnlyAccess`, then provision that permission set only to account `092954139775`. Do not change its assignment or AWS-managed `ReadOnlyAccess` attachment. IAM Identity Center's delete operation removes the whole inline policy; the exact one-statement policy and one-account/one-user footprint above are required before that command ([API reference](https://docs.aws.amazon.com/singlesignon/latest/APIReference/API_DeleteInlinePolicyFromPermissionSet.html)).

Do not restore either model grant or turn the Lambda flags back on until a separate model budget and authorization exist. An IAM policy simulation may be used as non-invoking permission readback; it is not a paid-model test and must never call Bedrock.

### Lambda environment update

Use `known-enough-staging-ro` for the read-only preparation and the temporary `KnownEnoughNP00Off` profile for the write. Do not use `known-enough-stage1-release`: although it is scoped to this function, its current permission set also allows `lambda:UpdateFunctionCode` and `lambda:InvokeFunction`. Never call either action.

Before any authorized write, run this read-only preparation and rebuild the private request by copying every current environment value and changing only these two keys. Keep the same Bash session for later command blocks so `NP00_STATE_DIR` remains set. This writes secrets only to a fresh mode-`0600` file inside a mode-`0700` private directory, and prints no environment values:

```bash
set -euo pipefail
umask 077
NP00_STATE_DIR=$(mktemp -d /tmp/known-enough-np00-model-off.XXXXXX)
chmod 700 "$NP00_STATE_DIR"
aws lambda get-function-configuration \
  --profile known-enough-staging-ro --region us-east-1 \
  --function-name known-enough-stage-api --output json --no-cli-pager \
  > "$NP00_STATE_DIR/lambda-current-private.json"
chmod 600 "$NP00_STATE_DIR/lambda-current-private.json"
python3 - "$NP00_STATE_DIR" <<'PY'
import json, sys
from pathlib import Path
p=Path(sys.argv[1])
d=json.loads((p/'lambda-current-private.json').read_text())
assert d.get('FunctionArn')=='arn:aws:lambda:us-east-1:092954139775:function:known-enough-stage-api'
assert d.get('Role')=='arn:aws:iam::092954139775:role/KnownEnoughStageApiRole'
assert d.get('Runtime')=='nodejs24.x' and d.get('Handler')=='ke13b-lambda.handler'
assert d.get('State')=='Active' and d.get('LastUpdateStatus')=='Successful'
v=d.get('Environment',{}).get('Variables',{})
assert v.get('KE14_MODEL_MODE')=='BEDROCK' and str(v.get('KE14_PAID_CALLS_APPROVED')).lower()=='true'
assert d.get('RevisionId')
v=dict(v); v['KE14_MODEL_MODE']='DISABLED'; v['KE14_PAID_CALLS_APPROVED']='false'
q=p/'lambda-model-off-environment-private.json'
q.write_text(json.dumps({'Variables':v},separators=(',',':'))+'\n'); q.chmod(0o600)
r=p/'lambda-revision-private.txt'; r.write_text(d['RevisionId']+'\n'); r.chmod(0o600)
print('LAMBDA_PREWRITE_CHECK=PASS; complete_environment_copied=true; only_model_flags_changed=true; values_not_printed')
PY
```

The prepared request from the 2026-10-01 readback is at `/tmp/known-enough-np00-model-off-q6zwmjh1/lambda-model-off-environment-private.json`; regenerate it as above before any later write. Then apply only after authorization:

```bash
set -euo pipefail
umask 077
: "${NP00_STATE_DIR:?Run the read-only Lambda preparation block first in this Bash session}"
: "${NP00_WRITE_PROFILE:?Set this to the A-only known-enough-np00-off profile}"
test -f "$NP00_STATE_DIR/lambda-model-off-environment-private.json"
test -f "$NP00_STATE_DIR/lambda-revision-private.txt"
test "$(aws sts get-caller-identity --profile "$NP00_WRITE_PROFILE" --query Account --output text --no-cli-pager)" = 092954139775
NP00_WRITE_STS_ARN=$(aws sts get-caller-identity --profile "$NP00_WRITE_PROFILE" --query Arn --output text --no-cli-pager)
case "$NP00_WRITE_STS_ARN" in arn:aws:sts::092954139775:assumed-role/AWSReservedSSO_KnownEnoughNP00Off_*/*) ;; *) printf '%s\n' 'NP00_WRITE_IDENTITY_CHECK=FAIL'; exit 1 ;; esac
aws lambda update-function-configuration \
  --profile "$NP00_WRITE_PROFILE" --region us-east-1 \
  --function-name known-enough-stage-api \
  --environment "file://$NP00_STATE_DIR/lambda-model-off-environment-private.json" \
  --revision-id "$(cat "$NP00_STATE_DIR/lambda-revision-private.txt")" \
  --query '{FunctionName:FunctionName,State:State,LastUpdateStatus:LastUpdateStatus,RevisionId:RevisionId}' \
  --output json --no-cli-pager
```

Then poll without printing the environment map:

```bash
set -euo pipefail
for attempt in $(seq 1 60); do
  NP00_UPDATE_STATUS=$(aws lambda get-function-configuration \
    --profile known-enough-staging-ro --region us-east-1 \
    --function-name known-enough-stage-api \
    --query LastUpdateStatus --output text --no-cli-pager)
  case "$NP00_UPDATE_STATUS" in
    Successful) printf '%s\n' 'LAMBDA_CONFIG_UPDATE=Successful'; break ;;
    Failed) printf '%s\n' 'LAMBDA_CONFIG_UPDATE=Failed; stop and inspect private readback'; exit 1 ;;
    InProgress) sleep 5 ;;
    *) printf '%s\n' 'LAMBDA_CONFIG_UPDATE=unexpected status; stop'; exit 1 ;;
  esac
done
test "${NP00_UPDATE_STATUS:-}" = Successful
```

Before a later execution, refresh the saved configuration and rebuild the private request; do not reuse the saved revision. The refresh must verify the account, exact function ARN/runtime/handler/role, Active/Successful state, and the two current model flags. Stop and reconcile if the flags are already different, any other environment value changed, or the role/function differs. The `--environment` file must contain the complete `{"Variables":{...}}` map; passing only two keys would replace and drop the rest.

Poll `get-function-configuration` until `LastUpdateStatus=Successful`, capturing its full response only in the private directory. Report only the function name, update status, and that `KE14_MODEL_MODE=DISABLED` and `KE14_PAID_CALLS_APPROVED=false` were read back; never print the environment map.

After polling, verify the two values from a private full response:

```bash
aws lambda get-function-configuration \
  --profile known-enough-staging-ro --region us-east-1 \
  --function-name known-enough-stage-api --output json --no-cli-pager \
  > "$NP00_STATE_DIR/lambda-after-private.json"
chmod 600 "$NP00_STATE_DIR/lambda-after-private.json"
python3 - "$NP00_STATE_DIR/lambda-after-private.json" <<'PY'
import json, sys
from pathlib import Path
d=json.loads(Path(sys.argv[1]).read_text())
v=d.get('Environment',{}).get('Variables',{})
assert d.get('LastUpdateStatus')=='Successful'
assert v.get('KE14_MODEL_MODE')=='DISABLED'
assert str(v.get('KE14_PAID_CALLS_APPROVED')).lower()=='false'
print('LAMBDA_MODEL_OFF_READBACK=PASS; environment_values_not_printed')
PY
```

### Runtime role policy removal

The write is `iam:DeleteRolePolicy` with role `KnownEnoughStageApiRole` and policy `KnownEnoughStageNovaLite`. Re-read `get-role-policy` immediately before deletion and require the full policy's canonical JSON hash to equal `0b8612598320fc2b0121b8daa232d6814efb52f2fed30c1791ad6da4ceb58f57`. For this guard, canonicalize the decoded `PolicyDocument` as UTF-8 JSON with sorted keys and separators `(',', ':')`; compare its SHA-256. Re-read the SSO policy and compare its decoded `InlinePolicy` the same way to `be165dbd713fd1b5c0dc9e06a6e9511588a8863dcbd025c35fe7719494d57acd`. If either differs, stop. `DeleteRolePolicy` has no conditional revision parameter, so serialize role-policy administration during the operation. Then use:

```bash
set -euo pipefail
umask 077
aws iam get-role-policy \
  --profile known-enough-staging-ro --role-name KnownEnoughStageApiRole \
  --policy-name KnownEnoughStageNovaLite --output json --no-cli-pager \
  > "$NP00_STATE_DIR/runtime-policy-recheck-private.json"
aws sso-admin get-inline-policy-for-permission-set \
  --profile known-enough-staging-ro --region us-east-1 \
  --instance-arn arn:aws:sso:::instance/ssoins-722328a7765eb0e8 \
  --permission-set-arn arn:aws:sso:::permissionSet/ssoins-722328a7765eb0e8/ps-7223102750014ed2 \
  --output json --no-cli-pager \
  > "$NP00_STATE_DIR/readonly-policy-recheck-private.json"
chmod 600 "$NP00_STATE_DIR/runtime-policy-recheck-private.json" "$NP00_STATE_DIR/readonly-policy-recheck-private.json"
python3 - "$NP00_STATE_DIR" <<'PY'
import hashlib, json, sys
from pathlib import Path
p=Path(sys.argv[1])
def digest(value):
    raw=json.dumps(value,sort_keys=True,separators=(',',':')).encode()
    return hashlib.sha256(raw).hexdigest()
runtime=json.loads((p/'runtime-policy-recheck-private.json').read_text())['PolicyDocument']
if isinstance(runtime,str): runtime=json.loads(runtime)
readonly=json.loads((p/'readonly-policy-recheck-private.json').read_text())['InlinePolicy']
if isinstance(readonly,str): readonly=json.loads(readonly)
assert digest(runtime)=='0b8612598320fc2b0121b8daa232d6814efb52f2fed30c1791ad6da4ceb58f57'
assert digest(readonly)=='be165dbd713fd1b5c0dc9e06a6e9511588a8863dcbd025c35fe7719494d57acd'
print('MODEL_GRANT_HASH_GUARD=PASS; policy_documents_not_printed')
PY
```

If this check fails, do not execute either policy removal; refresh the snapshot, inspect the full current policy privately, and revise the change set.

```bash
set -euo pipefail
umask 077
: "${NP00_WRITE_PROFILE:?Set to the short-lived known-enough-np00-off profile}"
aws iam delete-role-policy \
  --profile "$NP00_WRITE_PROFILE" \
  --role-name KnownEnoughStageApiRole \
  --policy-name KnownEnoughStageNovaLite \
  --no-cli-pager
```

`NP00_WRITE_PROFILE` must resolve to A's short-lived `KnownEnoughNP00Off` SSO session. `DeleteRolePolicy` is scoped by IAM to the role ARN, not to the inline policy name. It therefore permits deleting any inline policy on this one role while assigned. Verify the exact document immediately before the command, serialize IAM policy administration during the change, and remove the temporary permission-set assignment afterward. Do not grant `iam:PutRolePolicy`, `iam:AttachRolePolicy`, `iam:PassRole`, or role trust/delete permissions.

Post-write role verification is IAM-only and does not invoke Bedrock:

```bash
aws iam list-role-policies \
  --profile known-enough-staging-ro --role-name KnownEnoughStageApiRole \
  --query PolicyNames --output json --no-cli-pager \
  > "$NP00_STATE_DIR/runtime-policy-names-private.json"
chmod 600 "$NP00_STATE_DIR/runtime-policy-names-private.json"
python3 - "$NP00_STATE_DIR/runtime-policy-names-private.json" <<'PY'
import json, sys
from pathlib import Path
names=json.loads(Path(sys.argv[1]).read_text())
assert 'KnownEnoughStageNovaLite' not in names
print('RUNTIME_NOVA_POLICY_REMOVED=PASS; policy_names_not_printed')
PY
aws iam simulate-principal-policy \
  --profile known-enough-staging-ro \
  --policy-source-arn arn:aws:iam::092954139775:role/KnownEnoughStageApiRole \
  --action-names bedrock:InvokeModel \
  --resource-arns arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-lite-v1:0 \
  --query 'EvaluationResults[].{Action:EvalActionName,Decision:EvalDecision}' \
  --output json --no-cli-pager
```

Require the simulator decision to be `implicitDeny` or `explicitDeny`. This checks IAM policy state only; it does not make a paid request.

### ReadOnlyAccess permission-set inline policy removal

Immediately before the write, rerun the identity/account-footprint block above and repeat the SSO inline-policy hash check below. Confirm the `ReadOnlyAccess` ARN is `arn:aws:sso:::permissionSet/ssoins-722328a7765eb0e8/ps-7223102750014ed2`; the inline-policy canonical hash remains `be165dbd713fd1b5c0dc9e06a6e9511588a8863dcbd025c35fe7719494d57acd`; there is only the verified A `USER` assignment; and the permission set is provisioned only to account `092954139775`. Do not run the stale runtime-policy hash check again after its policy has been removed. Then:

```bash
aws sso-admin get-inline-policy-for-permission-set \
  --profile known-enough-staging-ro --region us-east-1 \
  --instance-arn arn:aws:sso:::instance/ssoins-722328a7765eb0e8 \
  --permission-set-arn arn:aws:sso:::permissionSet/ssoins-722328a7765eb0e8/ps-7223102750014ed2 \
  --output json --no-cli-pager \
  > "$NP00_STATE_DIR/readonly-policy-final-private.json"
chmod 600 "$NP00_STATE_DIR/readonly-policy-final-private.json"
python3 - "$NP00_STATE_DIR/readonly-policy-final-private.json" <<'PY'
import hashlib, json, sys
from pathlib import Path
d=json.loads(Path(sys.argv[1]).read_text())['InlinePolicy']
if isinstance(d,str): d=json.loads(d)
raw=json.dumps(d,sort_keys=True,separators=(',',':')).encode()
assert hashlib.sha256(raw).hexdigest()=='be165dbd713fd1b5c0dc9e06a6e9511588a8863dcbd025c35fe7719494d57acd'
print('READONLY_POLICY_FINAL_HASH_GUARD=PASS; document_not_printed')
PY
```

If either guard fails, do not delete the policy.

```bash
set -euo pipefail
umask 077
: "${NP00_WRITE_PROFILE:?Set to the short-lived known-enough-np00-off profile}"
aws sso-admin delete-inline-policy-from-permission-set \
  --profile "$NP00_WRITE_PROFILE" --region us-east-1 \
  --instance-arn arn:aws:sso:::instance/ssoins-722328a7765eb0e8 \
  --permission-set-arn arn:aws:sso:::permissionSet/ssoins-722328a7765eb0e8/ps-7223102750014ed2 \
  --no-cli-pager

NP00_PROVISION_REQUEST=$(aws sso-admin provision-permission-set \
  --profile "$NP00_WRITE_PROFILE" --region us-east-1 \
  --instance-arn arn:aws:sso:::instance/ssoins-722328a7765eb0e8 \
  --permission-set-arn arn:aws:sso:::permissionSet/ssoins-722328a7765eb0e8/ps-7223102750014ed2 \
  --target-type AWS_ACCOUNT --target-id 092954139775 \
  --query PermissionSetProvisioningStatus.RequestId --output text --no-cli-pager)
printf '%s\n' "$NP00_PROVISION_REQUEST" > "$NP00_STATE_DIR/readonly-provision-request-id-private.txt"
chmod 600 "$NP00_STATE_DIR/readonly-provision-request-id-private.txt"
aws sso-admin describe-permission-set-provisioning-status \
  --profile known-enough-staging-ro --region us-east-1 \
  --instance-arn arn:aws:sso:::instance/ssoins-722328a7765eb0e8 \
  --provision-permission-set-request-id "$NP00_PROVISION_REQUEST" \
  --query 'PermissionSetProvisioningStatus.{Status:Status,AccountId:AccountId}' \
  --output json --no-cli-pager
```

Poll that request with a five-minute bound; stop on failure or timeout and preserve the request ID:

```bash
set -euo pipefail
for attempt in $(seq 1 60); do
  NP00_PROVISION_STATUS=$(aws sso-admin describe-permission-set-provisioning-status \
    --profile known-enough-staging-ro --region us-east-1 \
    --instance-arn arn:aws:sso:::instance/ssoins-722328a7765eb0e8 \
    --provision-permission-set-request-id "$NP00_PROVISION_REQUEST" \
    --query PermissionSetProvisioningStatus.Status --output text --no-cli-pager)
  case "$NP00_PROVISION_STATUS" in
    SUCCEEDED) printf '%s\n' 'READONLY_PERMISSION_SET_PROVISION=SUCCEEDED'; break ;;
    FAILED) printf '%s\n' 'READONLY_PERMISSION_SET_PROVISION=FAILED; preserve request ID and stop'; exit 1 ;;
    IN_PROGRESS) sleep 5 ;;
    *) printf '%s\n' 'READONLY_PERMISSION_SET_PROVISION=unexpected status; stop'; exit 1 ;;
  esac
done
test "${NP00_PROVISION_STATUS:-}" = SUCCEEDED
```

Read back that the inline policy is empty, managed `ReadOnlyAccess` remains attached, the same one-user assignment remains, no permissions boundary has appeared, and the permission set still covers only the staging account. Refresh A's SSO session and verify that the effective Nova Lite grant is gone. Do not make a model request.

The post-provision reads are:

```bash
aws sso-admin get-inline-policy-for-permission-set \
  --profile known-enough-staging-ro --region us-east-1 \
  --instance-arn arn:aws:sso:::instance/ssoins-722328a7765eb0e8 \
  --permission-set-arn arn:aws:sso:::permissionSet/ssoins-722328a7765eb0e8/ps-7223102750014ed2 \
  --query InlinePolicy --output text --no-cli-pager
aws sso-admin list-managed-policies-in-permission-set \
  --profile known-enough-staging-ro --region us-east-1 \
  --instance-arn arn:aws:sso:::instance/ssoins-722328a7765eb0e8 \
  --permission-set-arn arn:aws:sso:::permissionSet/ssoins-722328a7765eb0e8/ps-7223102750014ed2 \
  --query 'AttachedManagedPolicies[].Arn' --output json --no-cli-pager
```

The first result must be empty; the second must contain only `arn:aws:iam::aws:policy/ReadOnlyAccess`. Then rerun the identity/account-footprint check above and, after A refreshes their own SSO session, use the IAM simulator against the active ReadOnlyAccess role ARN; require `bedrock:InvokeModel` on Nova Lite to be denied. No model invocation is part of this procedure.

The optional IAM-only check is `aws iam simulate-principal-policy` for `bedrock:InvokeModel` on the exact Nova Lite ARN against each role; require denial. It never contacts Bedrock. This is permission-state verification only, not model qualification or a paid call.

## Minimal permissions needed

`known-enough-stage1-release` can update the Lambda configuration but also allows code update and invocation on that function, so it is not used for this change. `known-enough-staging-ro` remains the read profile. The exact temporary A-only write permissions are in [the installable policy](permissions/np00-model-disable-temporary.json); no deployment, invocation, model, or participant permission is included.

| Purpose | Required IAM actions for apply | Resource scope |
| --- | --- | --- |
| Lambda safety flags | `lambda:UpdateFunctionConfiguration` | `arn:aws:lambda:us-east-1:092954139775:function:known-enough-stage-api` |
| Remove runtime Nova grant | `iam:DeleteRolePolicy` | `arn:aws:iam::092954139775:role/KnownEnoughStageApiRole` |
| Remove A's ReadOnlyAccess inline grant | `sso:DeleteInlinePolicyFromPermissionSet` | The exact Identity Center instance ARN and exact ReadOnlyAccess permission-set ARN above |
| Apply permission-set change to staging | `sso:ProvisionPermissionSet` | The exact Identity Center instance, ReadOnlyAccess permission set, and `arn:aws:sso:::account/092954139775` |
| Use Identity Center's customer-managed encryption key for its APIs | `kms:Decrypt` | `arn:aws:kms:us-east-1:092954139775:key/mrk-f940f13807f145fd84387208b80a4b90` |

The temporary permission set uses this exact allow policy; it deliberately has no permission-set creation/assignment, policy attachment, Lambda code-update, Lambda invocation, or model permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SetOnlyStageModelGuardsOff",
      "Effect": "Allow",
      "Action": "lambda:UpdateFunctionConfiguration",
      "Resource": "arn:aws:lambda:us-east-1:092954139775:function:known-enough-stage-api"
    },
    {
      "Sid": "RemoveStageRuntimeNovaInlinePolicy",
      "Effect": "Allow",
      "Action": "iam:DeleteRolePolicy",
      "Resource": "arn:aws:iam::092954139775:role/KnownEnoughStageApiRole"
    },
    {
      "Sid": "RemoveReadOnlyInlinePolicy",
      "Effect": "Allow",
      "Action": "sso:DeleteInlinePolicyFromPermissionSet",
      "Resource": [
        "arn:aws:sso:::instance/ssoins-722328a7765eb0e8",
        "arn:aws:sso:::permissionSet/ssoins-722328a7765eb0e8/ps-7223102750014ed2"
      ],
      "Condition": { "StringEquals": { "sso:PrimaryRegion": "us-east-1" } }
    },
    {
      "Sid": "ProvisionReadOnlyToStageAccount",
      "Effect": "Allow",
      "Action": "sso:ProvisionPermissionSet",
      "Resource": [
        "arn:aws:sso:::account/092954139775",
        "arn:aws:sso:::instance/ssoins-722328a7765eb0e8",
        "arn:aws:sso:::permissionSet/ssoins-722328a7765eb0e8/ps-7223102750014ed2"
      ],
      "Condition": { "StringEquals": { "sso:PrimaryRegion": "us-east-1" } }
    },
    {
      "Sid": "DecryptIdentityCenterCustomerKey",
      "Effect": "Allow",
      "Action": "kms:Decrypt",
      "Resource": "arn:aws:kms:us-east-1:092954139775:key/mrk-f940f13807f145fd84387208b80a4b90"
    }
  ]
}
```

`iam:DeleteRolePolicy` can be scoped to the role ARN but not to the inline `PolicyName`; while this grant exists it can delete any inline policy on this one role. Require the immediately preceding canonical-hash guard, serialize IAM policy administration, and remove the short-lived grant after the change. AWS lists the `Instance` and `PermissionSet` resource types for policy deletion and those plus `Account` for provisioning, with `sso:PrimaryRegion` available on the Identity Center resources ([IAM authorization reference](https://docs.aws.amazon.com/service-authorization/latest/reference/list_awsidentityandaccessmanagementiam.html), [Identity Center authorization reference](https://docs.aws.amazon.com/service-authorization/latest/reference/list_awsiamidentitycenter.html)). The current instance uses an enabled customer-managed key, and AWS requires IAM principals calling Identity Center APIs to have key access; its resource policy currently delegates IAM authorization to the account root ([customer-managed key guidance](https://docs.aws.amazon.com/singlesignon/latest/userguide/identity-center-customer-managed-keys.html)). The grant above therefore includes only `kms:Decrypt` on that exact key ARN. Do not change the KMS key policy or add KMS administration actions as part of this scope.

## One-time setup for the temporary NP00 write profile

The WSL `known-enough-staging-bootstrap` profile is currently unavailable. If no account administrator is already available through AWS CloudShell, an administrator must run this setup once. It creates a dedicated one-hour Identity Center permission set, attaches [the exact five-action policy](permissions/np00-model-disable-temporary.json), and assigns it only to A's verified `martelaxe` user in account `092954139775`. It does not modify the existing Stage1 or ReadOnlyAccess permission sets.

From AWS CloudShell signed in to the staging account with IAM Identity Center administration rights:

```bash
set -euo pipefail
AWS_REGION=us-east-1
NP00_ACCOUNT=092954139775
NP00_INSTANCE=arn:aws:sso:::instance/ssoins-722328a7765eb0e8
NP00_STORE=d-906661f00d
test "$(aws sts get-caller-identity --query Account --output text --no-cli-pager)" = "$NP00_ACCOUNT"
git clone https://github.com/Known-Enough/known-enough.git known-enough-np00-access
cd known-enough-np00-access
test "$(git branch --show-current)" = main
aws sso-admin describe-instance --instance-arn "$NP00_INSTANCE" --region "$AWS_REGION" --query 'InstanceArn' --output text --no-cli-pager
aws accessanalyzer validate-policy \
  --policy-document file://infra/permissions/np00-model-disable-temporary.json \
  --policy-type IDENTITY_POLICY --region "$AWS_REGION" \
  --query 'findings[].{Type:findingType,Code:issueCode}' --output json --no-cli-pager
NP00_USERS=$(aws identitystore list-users --identity-store-id "$NP00_STORE" --filters AttributePath=UserName,AttributeValue=martelaxe --region "$AWS_REGION" --query 'Users[].{UserId:UserId,UserName:UserName}' --output json --no-cli-pager)
NP00_USER_ID=$(python3 -c 'import json,sys; d=json.load(sys.stdin); assert len(d)==1 and d[0]["UserName"]=="martelaxe"; print(d[0]["UserId"])' <<< "$NP00_USERS")
NP00_SET=$(aws sso-admin create-permission-set --instance-arn "$NP00_INSTANCE" --name KnownEnoughNP00Off --description 'Temporary A-only fail-closed staging model shutdown' --session-duration PT1H --region "$AWS_REGION" --query PermissionSet.PermissionSetArn --output text --no-cli-pager)
aws sso-admin put-inline-policy-to-permission-set --instance-arn "$NP00_INSTANCE" --permission-set-arn "$NP00_SET" --inline-policy file://infra/permissions/np00-model-disable-temporary.json --region "$AWS_REGION" --no-cli-pager
NP00_ASSIGNMENT=$(aws sso-admin create-account-assignment --instance-arn "$NP00_INSTANCE" --target-id "$NP00_ACCOUNT" --target-type AWS_ACCOUNT --permission-set-arn "$NP00_SET" --principal-type USER --principal-id "$NP00_USER_ID" --region "$AWS_REGION" --query AccountAssignmentCreationStatus.RequestId --output text --no-cli-pager)
for attempt in $(seq 1 60); do
  NP00_ASSIGNMENT_STATUS=$(aws sso-admin describe-account-assignment-creation-status --instance-arn "$NP00_INSTANCE" --account-assignment-creation-request-id "$NP00_ASSIGNMENT" --region "$AWS_REGION" --query AccountAssignmentCreationStatus.Status --output text --no-cli-pager)
  case "$NP00_ASSIGNMENT_STATUS" in
    SUCCEEDED) printf '%s\n' 'NP00_TEMPORARY_ASSIGNMENT=SUCCEEDED'; break ;;
    FAILED) printf '%s\n' 'NP00_TEMPORARY_ASSIGNMENT=FAILED; preserve request ID and stop'; exit 1 ;;
    IN_PROGRESS) sleep 5 ;;
    *) printf '%s\n' 'NP00_TEMPORARY_ASSIGNMENT=unexpected; stop'; exit 1 ;;
  esac
done
test "${NP00_ASSIGNMENT_STATUS:-}" = SUCCEEDED
```

Before using it, the administrator must read back the permission set and confirm it has no managed policies, no customer-managed policy references, no boundary, the exact inline JSON/hash in `infra/permissions/np00-model-disable-temporary.json`, and only one `USER` assignment to A in the staging account. A then configures `known-enough-np00-off` as an SSO profile, signs in as A, verifies the `AWSReservedSSO_KnownEnoughNP00Off_*` role and account, and follows the guarded apply blocks above. The setup account-administrator rights are used only to create/assign this temporary scope; never give them to GitHub Actions.

```bash
aws configure set sso_session known-enough-sso --profile known-enough-np00-off
aws configure set sso_account_id 092954139775 --profile known-enough-np00-off
aws configure set sso_role_name KnownEnoughNP00Off --profile known-enough-np00-off
aws configure set region us-east-1 --profile known-enough-np00-off
aws sso login --profile known-enough-np00-off
test "$(aws sts get-caller-identity --profile known-enough-np00-off --query Account --output text --no-cli-pager)" = 092954139775
NP00_TEMP_ARN=$(aws sts get-caller-identity --profile known-enough-np00-off --query Arn --output text --no-cli-pager)
case "$NP00_TEMP_ARN" in arn:aws:sts::092954139775:assumed-role/AWSReservedSSO_KnownEnoughNP00Off_*/*) printf '%s\n' 'NP00_TEMPORARY_IDENTITY=PASS';; *) printf '%s\n' 'NP00_TEMPORARY_IDENTITY=FAIL'; exit 1;; esac
```

After NP00 model-off readback succeeds, an administrator must remove the temporary assignment, wait for deletion to succeed, then delete `KnownEnoughNP00Off`:

```bash
NP00_DELETE_REQUEST=$(aws sso-admin delete-account-assignment \
  --instance-arn arn:aws:sso:::instance/ssoins-722328a7765eb0e8 \
  --target-id 092954139775 --target-type AWS_ACCOUNT \
  --permission-set-arn "$NP00_SET" --principal-type USER --principal-id "$NP00_USER_ID" \
  --region us-east-1 --query AccountAssignmentDeletionStatus.RequestId --output text --no-cli-pager)
for attempt in $(seq 1 60); do
  NP00_DELETE_STATUS=$(aws sso-admin describe-account-assignment-deletion-status \
    --instance-arn arn:aws:sso:::instance/ssoins-722328a7765eb0e8 \
    --account-assignment-deletion-request-id "$NP00_DELETE_REQUEST" \
    --region us-east-1 --query AccountAssignmentDeletionStatus.Status --output text --no-cli-pager)
  case "$NP00_DELETE_STATUS" in
    SUCCEEDED) printf '%s\n' 'NP00_TEMPORARY_ASSIGNMENT_REMOVAL=SUCCEEDED'; break ;;
    FAILED) printf '%s\n' 'NP00_TEMPORARY_ASSIGNMENT_REMOVAL=FAILED; preserve request ID and stop'; exit 1 ;;
    IN_PROGRESS) sleep 5 ;;
    *) printf '%s\n' 'NP00_TEMPORARY_ASSIGNMENT_REMOVAL=unexpected; stop'; exit 1 ;;
  esac
done
test "${NP00_DELETE_STATUS:-}" = SUCCEEDED
aws sso-admin delete-permission-set \
  --instance-arn arn:aws:sso:::instance/ssoins-722328a7765eb0e8 \
  --permission-set-arn "$NP00_SET" --region us-east-1 --no-cli-pager
```

Preserve the resulting status/request IDs in the NP00 record. Keep the Lambda's model flags off and both Nova grants removed; do not restore them during cleanup.

Read-back actions may be supplied through the existing read-only profile; if they are included in the short-lived session, scope them to the same targets: `lambda:GetFunctionConfiguration` on the function; `iam:GetRole`, `iam:ListRolePolicies`, and `iam:GetRolePolicy` on the execution role; the `sso:DescribePermissionSet`, `GetInlinePolicyForPermissionSet`, `GetPermissionsBoundaryForPermissionSet`, `ListManagedPoliciesInPermissionSet`, and `ListCustomerManagedPolicyReferencesInPermissionSet` actions on the exact instance and permission set; `sso:ListAccountAssignments` on that account, instance, and permission set; `sso:ListAccountsForProvisionedPermissionSet` on the instance and permission set; and `sso:DescribePermissionSetProvisioningStatus` on the instance. `identitystore:DescribeUser` is needed only for identity verification and has already succeeded through the read-only profile. `kms:GetKeyPolicy` for the exact key can be used to repeat the private delegation check. Require `sso:PrimaryRegion=us-east-1` where supported.

Do not grant `sso:CreatePermissionSet`, `sso:PutInlinePolicyToPermissionSet`, `sso:CreateAccountAssignment`, `sso:DeleteAccountAssignment`, `iam:PutRolePolicy`, `iam:AttachRolePolicy`, `iam:PassRole`, KMS key administration, Lambda invoke/code-update, API Gateway, DynamoDB, Cognito, or Bedrock permissions to the safety operator. The existing release profile already has extra Lambda code-update/invoke capabilities; this plan does not use them.

## Recovery and scope boundary

There is no rollback that restores model access. If the Lambda update fails, re-read the latest full environment privately and retry only after reconciling its revision; keep both model flags off. If either policy has drifted or a delete/provision step is uncertain, stop and read state before any retry. Leave both Bedrock grants removed while the model budget is pending. No paid call, synthetic model test, `KnownEnoughBedrockTest` creation/assignment, NP05 group-table/API change, Cognito self-signup, verification email, or transactional email is included.
