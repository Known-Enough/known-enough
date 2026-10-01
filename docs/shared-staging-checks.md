# Shared staging checks

**Current status: role installed; Amplify resource correction prepared, not yet applied.** Diagnostic run [36930827040](https://github.com/Known-Enough/known-enough/actions/runs/36930827040) authenticated through GitHub, then returned `AccessDeniedException` on the exact `main/jobs/*` resource because no identity-based policy allowed it. The checked-in policy now permits `amplify:ListJobs` on both the documented branch ARN and the observed job-list resource; it grants no new action, other branch or write access. The earlier setup checkpoint follows as history.

**Historical preparation checkpoint:** The bootstrap profile `known-enough-staging-bootstrap` did not authenticate in WSL. On 2026-10-01 the staging read-only and Stage1 release profiles again verified account `092954139775`; neither session can install this role. No AWS write was attempted. The policy and workflow are ready for the one-time account administrator setup below.

The manual [Shared staging checks workflow](../.github/workflows/shared-staging-check.yml) runs the existing LAT01 public Playwright suite and reads staging metadata in a separate AWS job. Its third-party actions are pinned to verified commit SHAs. The report is written to the GitHub Actions run summary and attached as a 30-day artifact named `shared-staging-report`. The workflow only runs the check jobs on `main`.

## What each run checks

- **Public website:** availability, registered asset hashes, desktop and mobile page behavior, keyboard behavior and the existing unauthenticated API denial probe for the Stage 0 preview and connected Amplify site. It uses no participant login.
- **Deployed version:** Amplify's latest successful main-branch job summary and commit ID, when supplied; the Lambda runtime/configuration and actual ZIP SHA-256 compared with the manifest; and public frontend release hashes. A manual Amplify artifact job can have no commit ID, so the report leaves that source commit unknown and relies on the byte checks.
- **Existing services:** exact API Gateway route names/authorization, the current `KnownEnoughStage` table and whether the required `KnownEnoughGroupsStage` exists, Cognito signup/verification settings and the participant/display client scopes, plus inline Bedrock permissions on the Lambda execution role.
- **Missing features and holds:** absent group table/routes are BLOCKED under NP05; the current model-off write is BLOCKED under NP00 until the short-lived operator setup; verified-email signup stays BLOCKED under its separate email authorization; paid-model tests remain BLOCKED under their separate budget.

The AWS job assumes `KnownEnoughGithubStagingInspector` through GitHub OIDC for 900 seconds. It has no static credential or GitHub secret. Its policy can read only the named Lambda configuration, one API, two named table descriptions, one Cognito pool/client set, inline policies on the Lambda execution role and Amplify main-branch job summaries. It has no Lambda invoke/update/code, API write, DynamoDB item, Cognito user, email, Bedrock, deployment or IAM write permission. The inspector and report scripts keep raw service responses out of logs and artifacts; output uses a fixed field allowlist.

AWS cannot field-scope `lambda:GetFunctionConfiguration`; the service response includes the function's environment configuration. The CLI applies a fixed field query and the script only emits the two model guard values, the artifact hash and runtime metadata. Treat edits to the inspector script/workflow on `main` as changes to the AWS read surface. The two Cognito clients are checked as public clients with no client secret; the workflow prints only a boolean secret-presence value.

## Amplify ListJobs resource repair — administrator applies once

The original policy allowed `amplify:ListJobs` only on `arn:aws:amplify:us-east-1:092954139775:apps/d143q5ravxp5av/branches/main`. AWS's [authorization table](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amplify.html) lists the branch resource, and that simulation passed. The actual API error in [the diagnostic run](https://github.com/Known-Enough/known-enough/actions/runs/36930827040) names `arn:aws:amplify:us-east-1:092954139775:apps/d143q5ravxp5av/branches/main/jobs/*` and explicitly says no identity-based allow. The correction adds only that resource to the same ListJobs statement; all other actions/resources/trust stay unchanged. Simulation of the corrected policy allows a main job resource while denying other-branch listing and StartJob. Access Analyzer returned zero findings.

WSL's bootstrap/root-login profiles remain unavailable; its read-only session cannot apply this IAM change. An administrator uses CloudShell in account `092954139775` and the exact checked-in corrected policy:

```bash
set -euo pipefail
test "$(aws sts get-caller-identity --query Account --output text --no-cli-pager)" = "092954139775"
INSPECTOR_FIX_FILE=$(mktemp)
curl -fsSL \
  "https://raw.githubusercontent.com/Known-Enough/known-enough/94d48f9d487767b34e14cdef8e078bf04bb2e2a5/infra/permissions/shared-staging-github-inspect.json" \
  -o "$INSPECTOR_FIX_FILE"
printf '%s  %s\n' \
  "f5b12007c5df14306cd9e3534466d529858c6160b3cf8e17e0bf52b4f0f4079f" \
  "$INSPECTOR_FIX_FILE" | sha256sum -c -
aws iam put-role-policy \
  --role-name KnownEnoughGithubStagingInspector \
  --policy-name InspectExistingStagingMetadata \
  --policy-document "file://$INSPECTOR_FIX_FILE" \
  --no-cli-pager
echo "READ-ONLY FIX APPLIED"
```

The block above downloads the exact verified correction commit and checks its SHA-256, so an older CloudShell clone is not a dependency. This updates only the one existing inspection policy; it does not create a new role or touch the deployment role. Compare fresh full policy/trust readback before and after, preserving unrelated settings. IAM has no RevisionId for PutRolePolicy, so do not run concurrent edits. Rollback is the previous exact policy from commit `92f72951ef1b8545e08048f04b770dd2705aaff2`, which restores the read-only branch-only grant and the known failed ListJobs state. After installation, the worker checks exact policy equality and reruns the full shared workflow through GitHub. Administrator simulation alone does not count as live repair PASS.

## One-time AWS administrator setup

This setup is authorized. Run it from AWS CloudShell in account `092954139775` as an administrator who can create an IAM role/inline role policy and an Identity Center permission set/assignment. CloudShell is used only for this one-time setup; routine checks need no local AWS session. Do not attach or edit `KnownEnoughAmplifyMainDeploy`.

First get the exact files from public `main` and confirm the account and existing GitHub OIDC provider:

```bash
set -euo pipefail
AWS_REGION=us-east-1
test "$(aws sts get-caller-identity --query Account --output text --no-cli-pager)" = 092954139775
git clone https://github.com/Known-Enough/known-enough.git known-enough-inspector-setup
cd known-enough-inspector-setup
test "$(git branch --show-current)" = main
aws iam get-open-id-connect-provider \
  --open-id-connect-provider-arn arn:aws:iam::092954139775:oidc-provider/token.actions.githubusercontent.com \
  --query '{Url:Url,ClientIDList:ClientIDList}' --output json --no-cli-pager
```

Create the separate role and attach only the checked-in inspection policy. `create-role` must succeed; if the role already exists, stop and compare its full trust and inline policy with the two files before doing anything else.

```bash
aws accessanalyzer validate-policy \
  --policy-document file://infra/permissions/shared-staging-github-inspect.json \
  --policy-type IDENTITY_POLICY --region us-east-1 \
  --query 'findings[].{Type:findingType,Code:issueCode}' --output json --no-cli-pager
aws accessanalyzer validate-policy \
  --policy-document file://infra/permissions/shared-staging-github-inspect-trust.json \
  --policy-type RESOURCE_POLICY \
  --validate-policy-resource-type AWS::IAM::AssumeRolePolicyDocument \
  --region us-east-1 \
  --query 'findings[].{Type:findingType,Code:issueCode}' --output json --no-cli-pager
aws iam create-role \
  --role-name KnownEnoughGithubStagingInspector \
  --description 'Read-only GitHub OIDC inspection of existing Known Enough staging services' \
  --max-session-duration 3600 \
  --assume-role-policy-document file://infra/permissions/shared-staging-github-inspect-trust.json \
  --query 'Role.{Arn:Arn,MaxSessionDuration:MaxSessionDuration}' --output json --no-cli-pager
aws iam put-role-policy \
  --role-name KnownEnoughGithubStagingInspector \
  --policy-name InspectExistingStagingMetadata \
  --policy-document file://infra/permissions/shared-staging-github-inspect.json \
  --no-cli-pager
aws iam get-role \
  --role-name KnownEnoughGithubStagingInspector \
  --query 'Role.AssumeRolePolicyDocument' --output json --no-cli-pager
aws iam get-role-policy \
  --role-name KnownEnoughGithubStagingInspector \
  --policy-name InspectExistingStagingMetadata \
  --query PolicyDocument --output json --no-cli-pager
```

Compare both readbacks to their checked-in files, then simulate the installed role policy. AWS IAM Access Analyzer validation was run on these exact files: the identity policy returned no findings; the trust returned only suggestion `CONFIRM_AUDIENCE_CLAIM_TYPE`, while explicitly requiring `aud=sts.amazonaws.com`. These calls use IAM's policy simulator; they do not call the application or model services:

```bash
set -euo pipefail
INSPECTOR_ARN=arn:aws:iam::092954139775:role/KnownEnoughGithubStagingInspector
assert_decision() {
  expected=$1; action=$2; resource=$3
  actual=$(aws iam simulate-principal-policy --policy-source-arn "$INSPECTOR_ARN" \
    --action-names "$action" --resource-arns "$resource" --query 'EvaluationResults[0].EvalDecision' \
    --output text --no-cli-pager)
  test "$actual" = "$expected"
  printf 'IAM_SIMULATION=%s %s\n' "$action" "$actual"
}
LAMBDA_ARN=arn:aws:lambda:us-east-1:092954139775:function:known-enough-stage-api
API_ROUTES_ARN=arn:aws:apigateway:us-east-1::/apis/u94iyvt6p9/routes
GROUP_TABLE_ARN=arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughGroupsStage
POOL_ARN=arn:aws:cognito-idp:us-east-1:092954139775:userpool/us-east-1_V9OMjd0zx
RUNTIME_ROLE_ARN=arn:aws:iam::092954139775:role/KnownEnoughStageApiRole
AMPLIFY_BRANCH_ARN=arn:aws:amplify:us-east-1:092954139775:apps/d143q5ravxp5av/branches/main
NOVA_LITE_ARN=arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-lite-v1:0
assert_decision allowed lambda:GetFunctionConfiguration "$LAMBDA_ARN"
assert_decision allowed apigateway:GET "$API_ROUTES_ARN"
assert_decision allowed dynamodb:DescribeTable "$GROUP_TABLE_ARN"
assert_decision allowed cognito-idp:DescribeUserPoolClient "$POOL_ARN"
assert_decision allowed iam:GetRolePolicy "$RUNTIME_ROLE_ARN"
assert_decision allowed amplify:ListJobs "$AMPLIFY_BRANCH_ARN"
assert_decision implicitDeny lambda:InvokeFunction "$LAMBDA_ARN"
assert_decision implicitDeny lambda:UpdateFunctionConfiguration "$LAMBDA_ARN"
assert_decision implicitDeny lambda:UpdateFunctionCode "$LAMBDA_ARN"
assert_decision implicitDeny apigateway:POST "$API_ROUTES_ARN"
assert_decision implicitDeny dynamodb:GetItem "$GROUP_TABLE_ARN"
assert_decision implicitDeny cognito-idp:AdminCreateUser "$POOL_ARN"
assert_decision implicitDeny amplify:StartDeployment "$AMPLIFY_BRANCH_ARN"
assert_decision implicitDeny iam:PutRolePolicy "$RUNTIME_ROLE_ARN"
assert_decision implicitDeny bedrock:InvokeModel "$NOVA_LITE_ARN"
assert_decision implicitDeny ses:SendEmail '*'
```

The simulation scope covers this policy file's supported exact resources. No deployment or application-test call is part of this setup.

The same administrator can follow the [NP00 model-disable temporary-access setup](../infra/np00-model-disable.md#one-time-setup-for-the-temporary-np00-write-profile) separately. That creates a one-hour A-only permission set for the already-authorized NP00 changes; it is not assigned to GitHub.

## Launch from either GitHub account

Current GitHub reads verified that `martelaxe` (A) and `Battosai1806` (B) both have `admin` permission on the public `Known-Enough/known-enough` repository, whose default branch is `main`. Each uses their own account and may launch the same workflow:

1. Open **Known-Enough/known-enough → Actions → Shared staging checks → Run workflow**.
2. Select `main` and choose **Run workflow**.
3. Open the run's **Summary** tab for the shared report, or download its `shared-staging-report` artifact.

From a coding worker with GitHub CLI authenticated as its own A or B account, launch and inspect the same report with:

```bash
gh auth status
gh workflow run shared-staging-check.yml --ref main
gh run list --workflow shared-staging-check.yml --limit 5
# Copy the new run ID shown above:
RUN_ID=123456789
gh run watch "$RUN_ID" --exit-status
gh run view "$RUN_ID" --web
```

Workers do not need `AWS_PROFILE`, `aws sso login`, AWS secrets, participant credentials or repository secrets. A worker may be asked: “Launch the Shared staging checks workflow on `main` using my GitHub identity, then summarize the newest run's report. Do not deploy, create accounts, send email, invoke a model, or change the manifest from a failed live result.”

**Completion remains pending:** after the administrator installs the role, A or B must launch a run and confirm that the report shows the GitHub OIDC account/role, the public test result and fresh AWS metadata. Until that actual run exists, this document and local checks are preparation only.
