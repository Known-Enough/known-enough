# NP00 — A-only Bedrock permission-set cleanup

Prepared CLI handoff, not executed. The original Mac lacked AWS CLI/profile; the receiving WSL worker now has both `known-enough-staging-ro` and `known-enough-stage1-release`, each read-only STS-verified for account `092954139775`. [Current read-only preflight](../docs/review-artifacts/NP00-wsl-deployment-preflight.json) records the actual permissions. [NP00](../docs/tasks/NP00.md) retains the required live result; [TD-KE10-02](../docs/technical-debt/TD-KE10-02-bedrock-permission-set-name.md) remains open.

The intended permission-set repair moves the existing single-model permission out of `ReadOnlyAccess` into `KnownEnoughBedrockTest`, assigned only to the verified A account owner. Keep the old read-only assignment. Add no B assignment, access key, email, or unrelated application change. Use an authorized Identity Center administration profile; do not substitute root or grant broader permissions on failure.

**Current user direction, 2026-10-01:** keep paid model calls disabled until their separate budget is authorized. The read-only Lambda config currently reports `KE14_MODEL_MODE=BEDROCK` and `KE14_PAID_CALLS_APPROVED=true`; its runtime role and the `ReadOnlyAccess` role each still have a Nova Lite `bedrock:InvokeModel` grant. No model call was made in the WSL session. This runbook is preparation only: after the user reviews/authorizes AWS writes, first disable the Lambda model guard and remove the runtime-role and `ReadOnlyAccess` grants. Do not create/assign `KnownEnoughBedrockTest` or restore any invocation grant until the separate model budget is approved. This newest direction gates the create/assignment/simulation commands below; they are future steps, not currently authorized operations.

The exact NP00-only fail-closed commands, refreshed runtime/permission-set policy hashes, verified A identity/account footprint, and minimal write permissions are now in [the model-disable plan](np00-model-disable.md). Use that plan for the model-off change. The permission-set creation, assignment and simulated model-test profile below remain future paid-model-test preparation and are not part of the current shutdown. Do not run those sections for NP00 model disable.

## 1. Read-only preflight

Run in one Bash session. Replace the three `REPLACE_` values only from current readback and A's verified Identity Center identity, not a Git author name. The instance/account below are historical targets and must be confirmed. Use a private operations directory for before/after policy and assignment evidence; publish only sanitized role/policy outcomes.

```bash
set -euo pipefail
umask 077
NP00_IAM_PROFILE=REPLACE_AUTHORIZED_IAM_PROFILE
NP00_REGION=us-east-1
NP00_ACCOUNT=092954139775
NP00_INSTANCE=arn:aws:sso:::instance/ssoins-722328a7765eb0e8
NP00_OLD_SET=arn:aws:sso:::permissionSet/ssoins-722328a7765eb0e8/ps-7223102750014ed2
NP00_A_USER_ID=REPLACE_VERIFIED_EXISTING_A_IDENTITY_CENTER_USER_ID
NP00_OPS_DIR=$(mktemp -d "${TMPDIR:-/tmp}/known-enough-np00-iam.XXXXXX")
case "$NP00_IAM_PROFILE:$NP00_OLD_SET:$NP00_A_USER_ID" in *REPLACE_*) exit 1;; esac
np00_sso() { aws sso-admin "$@" --profile "$NP00_IAM_PROFILE" --region "$NP00_REGION" --no-cli-pager; }
test "$(aws sts get-caller-identity --profile "$NP00_IAM_PROFILE" --query Account --output text --no-cli-pager)" = "$NP00_ACCOUNT"
aws sts get-caller-identity --profile "$NP00_IAM_PROFILE" --query '{Account:Account,Arn:Arn}' --no-cli-pager
np00_sso list-instances
np00_sso describe-permission-set --instance-arn "$NP00_INSTANCE" --permission-set-arn "$NP00_OLD_SET" > "$NP00_OPS_DIR/old-set.json"
test "$(np00_sso describe-permission-set --instance-arn "$NP00_INSTANCE" --permission-set-arn "$NP00_OLD_SET" --query PermissionSet.Name --output text)" = ReadOnlyAccess
np00_sso list-account-assignments --instance-arn "$NP00_INSTANCE" --account-id "$NP00_ACCOUNT" --permission-set-arn "$NP00_OLD_SET" > "$NP00_OPS_DIR/old-assignments.json"
np00_sso list-managed-policies-in-permission-set --instance-arn "$NP00_INSTANCE" --permission-set-arn "$NP00_OLD_SET" > "$NP00_OPS_DIR/old-managed.json"
np00_sso list-customer-managed-policy-references-in-permission-set --instance-arn "$NP00_INSTANCE" --permission-set-arn "$NP00_OLD_SET" > "$NP00_OPS_DIR/old-customer-managed.json"
np00_sso get-inline-policy-for-permission-set --instance-arn "$NP00_INSTANCE" --permission-set-arn "$NP00_OLD_SET" --query InlinePolicy --output text > "$NP00_OPS_DIR/old-inline.json"
python3 - "$NP00_OPS_DIR" "$NP00_A_USER_ID" <<'PY'
import json, sys
from pathlib import Path
p = Path(sys.argv[1])
assignments = json.loads((p/'old-assignments.json').read_text())['AccountAssignments']
assert len(assignments) == 1 and assignments[0]['PrincipalType'] == 'USER'
assert assignments[0]['PrincipalId'] == sys.argv[2]
managed = json.loads((p/'old-managed.json').read_text())['AttachedManagedPolicies']
assert [x['Arn'] for x in managed] == ['arn:aws:iam::aws:policy/ReadOnlyAccess']
assert not json.loads((p/'old-customer-managed.json').read_text())['CustomerManagedPolicyReferences']
policy = json.loads((p/'old-inline.json').read_text())
assert set(policy) == {'Version', 'Statement'} and policy['Version'] == '2012-10-17'
statements = policy['Statement']
assert isinstance(statements, list) and len(statements) == 1
statement = dict(statements[0])
statement.pop('Sid', None)
assert statement == {'Effect': 'Allow', 'Action': 'bedrock:InvokeModel',
    'Resource': 'arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-lite-v1:0'}
print('Exact existing single-user, read-only plus Nova Lite scope confirmed.')
PY
```

Current WSL read-only SSO Admin readback confirmed the instance/account, primary region, `ReadOnlyAccess` permission-set ARN above, one `USER` assignment, and no existing `KnownEnoughBedrockTest`. The assigned principal's Identity Store identity is not yet joined to A's verified user; before any mutation, run `identitystore describe-user` for the opaque assignment ID and compare it privately with A's active Identity Center identity. Inspect existing permission boundaries and the verified old STS role. Stop if assignments/policies differ from this narrow preflight, if `KnownEnoughBedrockTest` already exists, or if the selected administration identity is outside the separately authorized scope. Preserve existing resources and amend the plan rather than overwriting them.

## 2. Create the separate set and assign only A

This is the first mutation section and requires the separate authorization. Copy the exact validated old inline policy. AWS creates/provisions the account role with the account assignment; later policy changes require provisioning. See [create permission set](https://docs.aws.amazon.com/cli/latest/reference/sso-admin/create-permission-set.html) and [create account assignment](https://docs.aws.amazon.com/cli/latest/reference/sso-admin/create-account-assignment.html).

```bash
NP00_NEW_SET=$(np00_sso create-permission-set --instance-arn "$NP00_INSTANCE" --name KnownEnoughBedrockTest --description 'Known Enough read-only inspection plus authorized Nova Lite tests' --session-duration PT1H --query PermissionSet.PermissionSetArn --output text)
np00_sso attach-managed-policy-to-permission-set --instance-arn "$NP00_INSTANCE" --permission-set-arn "$NP00_NEW_SET" --managed-policy-arn arn:aws:iam::aws:policy/ReadOnlyAccess
np00_sso put-inline-policy-to-permission-set --instance-arn "$NP00_INSTANCE" --permission-set-arn "$NP00_NEW_SET" --inline-policy "file://$NP00_OPS_DIR/old-inline.json"
NP00_ASSIGNMENT_REQUEST=$(np00_sso create-account-assignment --instance-arn "$NP00_INSTANCE" --target-id "$NP00_ACCOUNT" --target-type AWS_ACCOUNT --permission-set-arn "$NP00_NEW_SET" --principal-type USER --principal-id "$NP00_A_USER_ID" --query AccountAssignmentCreationStatus.RequestId --output text)
np00_sso describe-account-assignment-creation-status --instance-arn "$NP00_INSTANCE" --account-assignment-creation-request-id "$NP00_ASSIGNMENT_REQUEST"
```

Repeat only the last read-only status command until `SUCCEEDED`, bounded to five minutes; stop on `FAILED` or timeout and preserve its request ID. Do not submit a duplicate creation/assignment to resolve an uncertain response. Read back the new name, inline/managed/customer policies, boundary and exactly one expected assignment; compare the inline JSON semantically with the saved original.

Use a new local profile, keeping the old profile intact. `known-enough-sso` is the previously recorded A SSO session; confirm its current instance/region before reusing it. Device/browser sign-in belongs to A; no token or login code is shared.

```bash
aws configure set sso_session known-enough-sso --profile known-enough-bedrock-test
aws configure set sso_account_id "$NP00_ACCOUNT" --profile known-enough-bedrock-test
aws configure set sso_role_name KnownEnoughBedrockTest --profile known-enough-bedrock-test
aws configure set region "$NP00_REGION" --profile known-enough-bedrock-test
aws sso login --profile known-enough-bedrock-test
test "$(aws sts get-caller-identity --profile known-enough-bedrock-test --query Account --output text --no-cli-pager)" = "$NP00_ACCOUNT"
NP00_NEW_STS_ARN=$(aws sts get-caller-identity --profile known-enough-bedrock-test --query Arn --output text --no-cli-pager)
case "$NP00_NEW_STS_ARN" in arn:aws:sts::092954139775:assumed-role/AWSReservedSSO_KnownEnoughBedrockTest_*) ;; *) exit 1;; esac
NP00_NEW_ROLE_NAME=${NP00_NEW_STS_ARN#*:assumed-role/}
NP00_NEW_ROLE_NAME=${NP00_NEW_ROLE_NAME%%/*}
NP00_NEW_ROLE_ARN=$(aws iam get-role --role-name "$NP00_NEW_ROLE_NAME" --profile "$NP00_IAM_PROFILE" --query Role.Arn --output text --no-cli-pager)
aws iam simulate-principal-policy --profile "$NP00_IAM_PROFILE" --policy-source-arn "$NP00_NEW_ROLE_ARN" --action-names bedrock:InvokeModel bedrock:InvokeModelWithResponseStream --resource-arns arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-lite-v1:0 arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-pro-v1:0 arn:aws:bedrock:us-west-2::foundation-model/amazon.nova-lite-v1:0 --query 'EvaluationResults[].{Action:EvalActionName,Resource:EvalResourceName,Decision:EvalDecision}' --no-cli-pager
```

Require only non-streaming Nova Lite in us-east-1 to be allowed; the other five cases must be denied. The [IAM simulator](https://docs.aws.amazon.com/cli/latest/reference/iam/simulate-principal-policy.html) does not invoke the model and does not establish a successful paid call or every live-service policy effect. Verify selected old/new attached role policies separately.

## 3. Remove invocation from the old set, then read back

Proceed only after the new role/account/profile/policies and simulations pass. The exact old inline document must still equal the preflight snapshot; re-read and compare immediately before deletion. If it changed, stop. Whole-inline deletion is safe here only because preflight proved it contains exactly the one old model grant and no unrelated statement. See [delete inline policy](https://docs.aws.amazon.com/cli/latest/reference/sso-admin/delete-inline-policy-from-permission-set.html).

```bash
np00_sso get-inline-policy-for-permission-set --instance-arn "$NP00_INSTANCE" --permission-set-arn "$NP00_OLD_SET" --query InlinePolicy --output text > "$NP00_OPS_DIR/old-inline-recheck.json"
python3 - "$NP00_OPS_DIR" <<'PY'
import json, sys
from pathlib import Path
p=Path(sys.argv[1])
assert json.loads((p/'old-inline.json').read_text()) == json.loads((p/'old-inline-recheck.json').read_text())
PY
np00_sso delete-inline-policy-from-permission-set --instance-arn "$NP00_INSTANCE" --permission-set-arn "$NP00_OLD_SET"
NP00_PROVISION_REQUEST=$(np00_sso provision-permission-set --instance-arn "$NP00_INSTANCE" --permission-set-arn "$NP00_OLD_SET" --target-type AWS_ACCOUNT --target-id "$NP00_ACCOUNT" --query PermissionSetProvisioningStatus.RequestId --output text)
np00_sso describe-permission-set-provisioning-status --instance-arn "$NP00_INSTANCE" --provision-permission-set-request-id "$NP00_PROVISION_REQUEST"
np00_sso get-inline-policy-for-permission-set --instance-arn "$NP00_INSTANCE" --permission-set-arn "$NP00_OLD_SET"
np00_sso list-managed-policies-in-permission-set --instance-arn "$NP00_INSTANCE" --permission-set-arn "$NP00_OLD_SET"
np00_sso list-account-assignments --instance-arn "$NP00_INSTANCE" --account-id "$NP00_ACCOUNT" --permission-set-arn "$NP00_OLD_SET"
```

Wait for provisioning `SUCCEEDED` under the same bounded status rule. Confirm the old inline policy is empty, `ReadOnlyAccess` remains the only managed policy, old assignments/boundary are unchanged and the actual old IAM role no longer has model invocation. Run the same six simulations on its verified role ARN; all six must deny. Refresh the old read-only SSO profile and verify its account/role still works for read-only checks. Do not claim TD-KE10-02 resolved until these actual results are recorded.

If the authorized operation needs rollback, preserve both histories and report the failed step. Restoring the saved exact old inline policy with `put-inline-policy-to-permission-set` plus the same `provision-permission-set` is the bounded rollback; execute it only within the approved rollback scope. No permission-set/assignment deletion or unrelated policy change is part of this plan.

## Required sanitized record

Record UTC time, verified old/new role names, permission-set ARNs, unchanged assignment count, policy SHA-256 hashes, creation/provisioning request status, six-case simulation decisions for each role, profile identity checks and any remaining limitation. Keep opaque user IDs, tokens, login material and full credential/config files out of repository logs. Link that result from [the NP00 evidence table](../docs/np00-technical-closeout.md).
