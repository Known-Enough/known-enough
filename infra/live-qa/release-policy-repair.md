# One-time QA publishing permission correction

The app deployment and automatic test trigger work. The test workflow stops at QA publication: actual [run 37082289231](https://github.com/Known-Enough/known-enough/actions/runs/37082289231) reports `AccessDeniedException` for `amplify:CreateDeployment` on `arn:aws:amplify:us-east-1:092954139775:apps/d2l23pkzmr1tio/branches/main/deployments/*`. The installed setup source's `ExactQaRelease` statement covers only the main branch and its jobs child. See the [sanitized denial](../../docs/review-artifacts/ASSESS07-qa-release-denial.json) and [active task](../../docs/tasks/active/live-testing/ASSESS07/README.md).

The proposed correction appends only that observed deployment child to the existing QA publishing statement. Its actions remain CreateDeployment, StartDeployment and GetJob; all Lambda, storage, control-table, trust and unrelated policy bytes are preserved. The source template contains the same correction for future reviewed provisioning. AWS's [Amplify authorization reference](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amplify.html) lists branch resources for CreateDeployment; the narrower correction follows the actual denied child observed in AWS, as the existing successful primary publisher already does.

## Administrator action

The executable helper is [repair-qa-release-policy.py](../../scripts/live-qa/repair-qa-release-policy.py). Download it from the published pinned repair commit supplied in the chat. Run it in A's administrator CloudShell in account 092954139775. Python and AWS CLI are already present there; no Node installation, source rebuild, remembered shell variable or surviving /tmp folder is needed.

Without arguments, the helper performs read-only preflight and prints `QA_RELEASE_POLICY_PREPARED`. `--apply` is a separate explicit authorization for its one `iam:PutRolePolicy` on `KnownEnoughGithubQaRelease` / `ExactQaRelease`. The current deployment/test approval alone does not authorize that IAM change. Use the pinned command supplied only after the final checks/publication.

The helper verifies the account, exact role ARN and GitHub repository-ID/main trust, absence of a boundary or extra policies, and the entire baseline policy against the actual rendered source. It reproduces implicit denial on the observed resource and denial outside this QA app/main branch. Fresh role ID and complete policy hash are checked again immediately before writing. IAM has no revision-conditional PutRolePolicy API; the prewrite comparison is a guard, not an atomic IAM lock. Keep the existing one-writer operations agreement.

The original policy and proposed result are saved privately under `$HOME/known-enough-qa-release-policy-repair/` (0700 directory, 0600 immutable JSON snapshots). No credentials, private user attributes, environments or raw CLI errors are printed. Complete policy readback and narrowly scoped simulation must pass before `QA_RELEASE_POLICY_READBACK_PASS` is reported. Retry is idempotent if the exact corrected policy is already installed; any different policy/trust, extra access or expired original window is BLOCKED, never overwritten or widened.

The direct inline-policy correction does not update the already-installed CloudFormation stack template. Future authorized stack maintenance must use the corrected source template; do not rerun the old installer to repair this permission. No new stack update is bundled with this helper. Saved installation/rollback state, the grant ending 2026-10-09T03:16:41.171626Z and accumulated run/model/email counters remain intact.

## After readback passes

A continues the same approved GitHub deployment → automatic qualification cycle through CLI. Verify an actual matching all-lane report, seven journeys and exact CLEAN cleanup. Neither the policy simulation nor a successful app deployment is full online PASS. B still uses B's own GitHub account for routine results; no personal AWS credentials or repeated administrator action should be needed for those runs. No A recurring monitor is created.
