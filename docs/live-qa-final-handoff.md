> **Current recovery — 2026-10-02:** The actual original-pin apply stopped at PRIMARY_POOL_READBACK_FAILED. Use [the ASSESS09 same-source repair/resume command](assess09-cognito-resume.md) first. The older generic and IAM-only resume blocks below are historical for this interrupted Cognito checkpoint. Original source, backup and authorization remain in place.

# Final LIVE04 installation handoff — 2026-10-02

Use source **30fa91ad914c1dc1732680784ee368e2f30c9e92**. A retains AWS/NP00 operations; B's local corrections and installer checks are complete. This handoff preserves the existing private configuration, retained tables, original rollback material and authorization expiry **2026-10-09T03:16:41.171626Z**. It does not claim installation/live PASS or renew approval. The older package pins in setup guides describe prior checkpoints.

The QA stack was last observed UPDATE_COMPLETE at 348afae, with primary rollout not reached. This is a forward update of that installed QA stack, not a fresh table install. Final source includes A's import-tag/Amplify field-name fixes; immutable primary recovery/table guards; cumulative counters; atomic admission/roster commits; clarification/domain fixes; complete automation/triggers/routing/session renewal; refresh/capacity/maintenance corrections; journal-aware atomic resume.

## One CloudShell resume block

Open A's already-authorized CloudShell in account 092954139775 / N. Virginia. Keep the one approved HOME configuration; do not upload a replacement, edit budgets or recreate the seven-day window. **Mail.tm needs no purchased domain or Route53 zone**: provider mailtm, mailDomain/hostedZoneId null. The saved provider is retained.

```bash
set -euo pipefail
umask 077
commit=30fa91ad914c1dc1732680784ee368e2f30c9e92
resume="$HOME/known-enough-live-qa-final-resume.sh"
curl --fail --silent --show-error "https://raw.githubusercontent.com/Known-Enough/known-enough/$commit/scripts/live-qa/resume.sh" -o "$resume"
bash "$resume" "$commit"
"/tmp/known-enough-live-qa-$commit/node/bin/node" --input-type=module -e "import {readFileSync} from 'node:fs'; import {publicTarget} from '/tmp/known-enough-live-qa-$commit/source/scripts/live-qa/config.mjs'; console.log('LIVE_QA_INSTALLED_TARGET='+JSON.stringify(publicTarget(JSON.parse(readFileSync(process.env.HOME+'/known-enough-live-qa-state/$commit/package/installed-target.json','utf8')))));"
```

Expected installer result: **SETUP_READBACK_PASS**, this exact sourceCommit, **cloudQualification: PENDING_LIVE04**, and the private HOME installed-target path. The last line prints only the allowlisted non-secret target for GitHub. Do not share full private config, primary/recovery journal, Lambda environment, login secret contents or rollback files. No remembered temporary shell variable is required before the block.

If a prior primary journal exists under another pin, resume refuses with EXISTING_PRIMARY_RECOVERY_PIN_REQUIRED **before changing configuration or reading AWS**. Preserve it and coordinate explicit reconciliation in ASSESS07; do not delete/copy journals or run an unreviewed legacy installer. Same-pin resume preserves journals. Ambiguous pending/legacy primary mutations, drift, active/failed cleanup leases, missing cumulative history or expired authorization require the corresponding bounded repair/readback, not repeated blind applies.

## Exact GitHub settings and proof

After the successful readback, Settings → Secrets and variables → Actions → Variables:

| Variable | Value |
| --- | --- |
| LIVE_QA_INSTALLED_TARGET | Exact JSON printed after LIVE_QA_INSTALLED_TARGET= by the block; no placeholder/hash guessed from observation |
| LIVE_QA_ENABLED | true only after this approved installation/readback |

No AWS access key, A profile, personal mailbox or password is supplied to B. Expected installed roles are KnownEnoughGithubQaRelease, KnownEnoughGithubQaTest and KnownEnoughGithubPrimaryRelease, with repository/main OIDC trust; the existing KnownEnoughGithubStagingInspector role remains read-only and unchanged. Its existing apigateway:GET on /apis/u94iyvt6p9/* covers the new authorizer/integration collection. No additional role broadening was identified locally. Actual installed role/permission readback is still required.

B uses B's own GitHub account to launch **Live QA release and qualification** on main. That workflow publishes QA and code-only primary artifacts within the installed finite authorization; it keeps primary paid models disabled. All report lanes, seven real journeys and CLEAN cleanup must pass on the matching source/artifact receipt. A separately authorized upstream deployment must then trigger a matching automatic complete PASS. A green deployment, offline tests, mailbox-only smoke or a downloadable report does not complete LIVE04. Follow [ASSESS07](tasks/ASSESS07.md); no recurring personal AWS login is needed after installation.

## Short read-only diagnosis after a blocked result

The installer prints a static code such as AWS_OPERATION_FAILED:service:operation. Record that code and the source pin, not raw AWS diagnostics or secret-bearing input bodies. In A's same account/session:

```bash
aws cloudformation describe-stacks --stack-name known-enough-live-qa --region us-east-1 --query 'Stacks[0].StackStatus' --output text --no-cli-pager
aws lambda get-function-configuration --function-name known-enough-stage-api --region us-east-1 --query '{State:State,Update:LastUpdateStatus,Handler:Handler,Model:Environment.Variables.KE14_MODEL_MODE,Paid:Environment.Variables.KE14_PAID_CALLS_APPROVED,Groups:Environment.Variables.NP_GROUPS_ENABLED}' --output json --no-cli-pager
```

These commands read only status and selected non-secret flags. An access failure needs an exact service/action/resource proposal based on the failing operation; do not request administrator access or broaden all roles. Original handler/groups-unset is the last observed pre-rollout state, not an acceptance result. Do not use CLI --debug, print the full environment or automatically change cloud state as diagnosis.

## Verified local evidence

Pinned Node 24.21.0/npm 11.19.0 full check: **608 application tests passed, two optional DynamoDB Local skips; hosted 1/1; E2E 56/56**. Focused installer/recovery/setup tests 32/32; setup/resume Bash parses. Official CLI field checks use immutable [botocore models](https://github.com/boto/botocore/tree/9f5baa9742a6e65121479e786d6fba24b7ff940e/botocore/data): 84 literal requests across 51 operations, with a permanent required-field/casing regression.

Two clean offline dry-run builds produced identical ZIPs, one fixture-free module each, with cloudWrites false:

| Artifact | SHA-256 |
| --- | --- |
| api.zip | 6a0cd3eb5b35b1c993917962b9f5f3eb415a6eb75f9b25f98141c1ee36708b4a |
| broker.zip | b5f93d79414e582107ea16d6fd351c19d22419f47ebe772482f98630d2426a49 |

No AWS or Mail.tm request, deployment, paid call or personal credential was used in this verification. It establishes local package readiness, not CloudFormation eligibility, installed IAM, Cognito delivery, actual model behavior or cloud rollback. Whole-envelope ceilings remain 28 runs / 7,000,000 reserved tokens / USD 7 reserved model cost / 56 verification messages, alongside original daily/per-run limits and expiry. Reinstall/cleanup never resets TOTAL. Missing historical totals stop for usage reconciliation.

[Current pilot limits](operational-limits.md) retain wider-use partition/archive, retention/erasure and durable-job obligations in OPS01/02/03. [ASSESS08](tasks/ASSESS08.md) is locally complete; ASSESS07/LIVE04 managed acceptance and A's NP00 scope remain pending.

## 30fa91a missing-policy recovery addendum — 2026-10-02

If the actual 30fa91a attempt fails at iam:get-role-policy and CloudShell confirms NoSuchEntity for KnownEnoughStageGroups, do not move to another deployment pin or delete/move the original primary journal. A's bounded resume-iam-policy-fix.sh uses that same source/config/private state and injects only the reviewed command adapter correction. Existing installer guards and journal perform policy creation/continuation. Other errors, pending mutation, rollback or expired approval require their own reconciliation. This addendum does not establish successful managed readback. The repair helper's own immutable commit is supplied after verification; it is separate from the unchanged 30fa91a deployment source.

The IAM recovery helper must export `/tmp/known-enough-live-qa-30fa91ad914c1dc1732680784ee368e2f30c9e92/node/bin` into PATH before resuming: setup exports inside its own subprocess, which does not update the caller's PATH. PREPARED followed by PINNED_RUNTIME_REQUIRED is this helper/runtime issue, not managed installation success. Keep original source and recovery journal.

The IAM helper must also enter the original `/tmp/known-enough-live-qa-30fa91ad914c1dc1732680784ee368e2f30c9e92/source` before install. Rolldown uses cwd for source-marker comments; building from HOME changes package bytes/checksums despite unchanged logic. Rebuild in the original source directory; never reconcile this issue by overwriting the primary journal's targetCode or rollback baseline.
