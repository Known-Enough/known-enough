# Fixed retained partition CREATE and readback package

This OPS00 phase prepares one table: `KnownEnoughPartitions`, in account092954139775/us-east-1, stack `KnownEnoughPartitionsStorage`. The unchanged [checked template](../../../infra/operations/partition-setup.json) has SHA256 `262afec3e0c6d5306e819a723d3589c86f8499e1f9995ab33956046d9ff705f0`. It retains encrypted on-demand PK/SK storage, PITR, deletion protection, Retain/UpdateReplacePolicy Retain and no TTL. The permission profiles in Metadata are declarations; this package attaches none of them. [Capability mapping](capability-map.md), original recovery/private CloudShell state, historical two-run and denial proofs remain separate and unchanged.

[partition-create.py](../../../scripts/operations/partition-create.py) imports only the checked private state, credential environment and bounded subprocess utilities from the existing recovery package. It never instantiates the recovery installer or changes its constants/state/template. New state basenames start `ops00-partition-`, with separate partition.plan/template/create/review/execute records, owner-only HOME permissions, lock, no symlinks, exclusive flushed intent and immutable source/template binding. No profiles, endpoints, table, stack, role, arbitrary template or target override is accepted.

Inventory sends only fixed metadata reads after verifying signed account identity. On GitHub it additionally requires the exact installed staging-inspector role and own B/numeric143764700/main/manual/source; the CLI prohibits every action except inventory there. CloudShell uses its legitimate current credential chain; source and fixed account validation do not prove administrator permissions or the human owner of an AWS session. Do not use another account's credentials. Each invocation has32 attempted requests/180s, each child10s/connect5/read8, single SDK attempt, no custom endpoints/profile files, private131072-byte capture per stream and owned process cleanup. Uploaded summaries expose finite codes/fixed public targets only; no identity ARN, raw error, participant payload or state is uploaded.

Prepare requires actual service-reported absence of both the fixed table and stack. AccessDenied or unrelated ValidationError is UNKNOWN/failure, never absence. Existing resources require inspection/reconciliation; no UPDATE/IMPORT/delete/reset/recreate command exists. The CREATE change set restricts ResourceTypes to DynamoDB::Table, requests no IAM capability or service role, forbids auto-import/nested stacks and uses DO_NOTHING on failure. Review requires exactly one Add/Partitions/DynamoDB::Table, exact original template, fixed source-bound change/stack IDs and REVIEW_IN_PROGRESS. Its hash pins the private reviewed record. Execute re-reads that exact preview and actual table absence before persisting the execute intent and sending one request. An unknown acknowledgment never permits replay: prepare/execute/resume reconstruct from fixed service metadata and the durable intent. Failed stacks preserve the records and require reconciliation rather than cleanup/recreate. This is consistent with the [AWS create-change-set](https://docs.aws.amazon.com/cli/latest/reference/cloudformation/create-change-set.html) and [execute-change-set](https://docs.aws.amazon.com/cli/latest/reference/cloudformation/execute-change-set.html) contracts checked during implementation.

Configuration matching requires the exact CREATE_COMPLETE stack/template/sole physical table, no stack service-role redirection, active ARN/schema/encryption/on-demand/deletion-protection/no extra indexes or stream, PITR enabled and TTL disabled. It does not prove effective data permission, role attachment, migration, runtime selection, participant consent, activation or managed acceptance. Existing target/stack mismatch is preserved and reported; no inferred repair is performed.

## Own-B readback

The [read-only workflow](../../../.github/workflows/operations-partition-readback.yml) runs exact-source/template/package regressions before assuming the already installed staging inspector for900s. It has no IAM/deployment/data request, no arbitrary mode input and no paid/model/email operation. A current resource/metadata denial remains an exact missing inspection capability, not a setup PASS. Its observed result and verified artifact will be appended below. The credential-free [verification workflow](../../../.github/workflows/operations-verify.yml) adds package tests to the existing proposal/native/full checks. Existing nine-file artifacts/proposals and all other workflow behavior remain unchanged.

## Source-pinned commands

The checked source and actual readback evidence are recorded in the dated handoff below. The shell block below now pins that verified source; keep this checkout/state pinned for every resume. Use only a fresh separate checkout and a new own-account state directory. Do not change, reuse, repin or reset the original recovery installer state. Git branch rename preserves the freshly received main before selecting the checked main-line commit; no existing checkout is overwritten.

```bash
PARTITION_SOURCE='c2eaadb85d72b318f2360325d1cbed0e6928f531'
PARTITION_CHECKOUT="$HOME/known-enough-partition-setup"
PARTITION_STATE="$HOME/.known-enough/ops00-partition-${PARTITION_SOURCE}"
test ! -e "$PARTITION_CHECKOUT" || exit 1
git clone --no-checkout --single-branch --branch main https://github.com/Known-Enough/known-enough.git "$PARTITION_CHECKOUT" || exit 1
cd "$PARTITION_CHECKOUT" || exit 1
git branch -m main received-main || exit 1
git checkout -b main "$PARTITION_SOURCE" || exit 1
test "$(git rev-parse HEAD)" = "$PARTITION_SOURCE" || exit 1
python3 -B scripts/operations/partition-create.test.py || exit 1
python3 -B scripts/operations/partition-create.py inventory --source "$PARTITION_SOURCE" --state "$PARTITION_STATE"
```

Only an actual CREATE_REQUIRED inventory permits preparing the fixed preview. Already matching/existing/denied/unknown resources are preserved. Existing standing project authorization covers this scoped setup; an installed access denial remains a platform restriction and is not bypassed.

```bash
python3 -B scripts/operations/partition-create.py prepare --source "$PARTITION_SOURCE" --state "$PARTITION_STATE"
python3 -B scripts/operations/partition-create.py resume --source "$PARTITION_SOURCE" --state "$PARTITION_STATE"
# If REVIEW_READY, copy its exact reviewHash after reading the fixed preview contract.
PARTITION_REVIEW_HASH='REVIEW_OUTPUT_PENDING'
python3 -B scripts/operations/partition-create.py execute --source "$PARTITION_SOURCE" --state "$PARTITION_STATE" --review-hash "$PARTITION_REVIEW_HASH"
python3 -B scripts/operations/partition-create.py resume --source "$PARTITION_SOURCE" --state "$PARTITION_STATE"
python3 -B scripts/operations/partition-create.py readback --source "$PARTITION_SOURCE" --state "$PARTITION_STATE"
```

Execute and readback are not dispatched by the inspector workflow. Local AWS/administrator credentials are not established by this preparation. Do not continue a returned BLOCKED/pending/reconciliation code with a fresh state/reset; resume the same source/state, inspect actual pending work, and preserve exact unknown outcomes. Creation/role setup and full [OPS01 managed closeout](../OPS01/managed-closeout.md) remain open until actual successful evidence.

## RUN189 local verified checkpoint — 2026-10-10T03:04:55.306305+00:00

23 package/286 native PASS; pinned Node24.21.0/npm11.19.0 full PASS02:59:52.469641–03:03:33.555724Z (1407 app/two existing optional skips/hosted1/browser64/ref7/plan15/import boundaries414 references, lint/types/build). Four executable and983 protected hashes unchanged. Closing-summary assertion expected nonexistent 414 assertions passed text and failed; actual 414 references line inspected/corrected without source changes. Source/CI/cloud readback remain pending; no installer mutation executed. Progress2 request returned0, original workflow lookup failed with sanitized GET api.github.com workflow list: dial tcp140.82.112.5:443:i/o timeout; one existing-run retry verified38019120798 SUCCESS/exact artifact, created03:01:58Z. No duplicate publication. Unassigned run38018280676 did not meet own/current-main/source/SUCCESS identification conjunction; no artifact download/cadence claim. Earlier10655s own verified receipt gap remains FAIL/activity unknown. Integration after fresh own143/main/source/docs checks; same phase remains active.

## RUN189 actual GitHub outcomes and same-phase correction — 2026-10-10T03:09:53.544643+00:00

Source3ef0b32 synchronized03:04:59.881632Z. Existing push full check38019303277/job114116505558 SUCCESS03:05:03–03:07:41Z; exact ownB/main/source and1407app/64browser/414boundaries verified03:08:01.724697Z. Separate operations-verify dispatch held before API by active push job (AssertionError), no dispatch/run created; subsequent inspector of nonexistent dispatch file failed FileNotFoundError. Progress3 receipt38019319792 incorrectly said requested; exact correction38019334466 verified. Existing progress3 lookup ambiguous because a later same-source progress receipt also matched; bounded by next dispatch time, both exact artifacts now verified without duplicate publication. Run38018280676 is A/martelaxe44531296 scheduled B monitor inspect, not ownB lifecycle/execution and not included in cadence.

Actual ownB readback38019429797/job11411689475003:07:08–03:07:16Z FAILURE; exact source/artifacta8e1ad4de44d6c142e38cc3daa17fdd6674a39230eca70bbd9658a651eb31b87 verified03:07:46.460735Z. Precredential23 package/source/template tests PASS and fixed staging-inspector900s OIDC configuration SUCCESS; CLI returned CHECKOUT_REJECTED/0resource requests/0mutations, no identity/resource/configuration proof. Private checkout log shows exact fixed HTTPS origin omitting .git; no arbitrary URL/foreign-repo normalization. Same bounded phase corrects Python GitHub URL comparison to exactly two canonical spellings and executes the actual Python checkout/source check before credentials. New24focused PASS03:08:51.366518–03:08:53.569341Z; new native/full now owned/running, required because reviewed code/workflow changed. Original local/recovery constructor source rules unchanged, no IAM/data/activation/write/cloud installer execution. Source correction integration waits checks; no claim release/new task/worker. Next final source-matching CI/readback; earlier reporting gap FAIL and failed run preserved.

## RUN189 corrected final local source checkpoint — 2026-10-10T03:13:09.729757+00:00

24 package/286native/final full PASS; full03:08:56.558141–03:12:42.423127Z,1407app/two existing optional skips/hosted1/browser64/ref7/plan15/boundaries414/lint/types/build. Four final source and983 protected hashes unchanged. Actual initial checkout failure and source1 full CI remain preserved; final source2 integration uses checked own143/main/fresh source and [skip ci] solely to avoid another automatic duplicate full job, followed by the required exact-source operations-verify workflow and real fixed readback. Progress5 receipt38019536329 SUCCESS/exact artifact verified, created03:08:56Z. No generic checkout weakening/local origin change, IAM/deployment/data/activation/paid/email operation. Same claim remains active through new verification; whole task unfinished.

## RUN189 final source/current jobs checkpoint — 2026-10-10T03:14:06.680171+00:00

Corrected sourcec2eaadb85d72b318f2360325d1cbed0e6928f531 synchronized clean/equal main03:13:14.384444Z after fresh ownB143/main/origin/source/doc/hash checks. Actual operations-verify dispatched03:13:17.612727–03:13:19.278594Z, run38019793134 in_progress last observed03:13:28Z; no duplicate automatic source2 full job after [skip ci]. Original source1 push full remains completed, final source2 local24/286/full PASS. Progress6 run38019795597 created03:13:21Z last observed in_progress, artifact not yet verified at this checkpoint. Corrected fixed readback submitted through ownB/main/c2ea while credential-free offline verification is owned/running; same claim, fixed read-only metadata only, no independent implementation/installer/data writer. Actual job result remains UNKNOWN until terminal artifact; original checkout failure preserved. No AWS provisioning/profile/migration/archive/erasure/counter/model/email operation. Source-pinned command block stays gated until verified handoff. Next inspect owned jobs/artifacts and precise returned denial/existence, then release this bounded checked phase if criteria met or genuine boundary.

## RUN189 actual fixed readback boundary — 2026-10-10T03:15:53.443569+00:00

OwnB143/main/sourcec2eaadb actual readback38019839052/job11411817897503:14:09–03:14:18Z FAILURE. Precredential source/checkout/template/24 package tests and fixed inspector900s configuration SUCCESS; STS GetCallerIdentity READ then DynamoDB DescribeTable fixed KnownEnoughPartitions AccessDeniedException,2attempted service requests/0mutations. Exact closed schema/source/public target/effective UNKNOWN/attachment NOT_EXECUTED/activation DISABLED/migration and managedRecovery NOT_EXECUTED artifact4882248f64fab1ee204cb6352d6805e8bf280cc9cce86b154979485e2b5eca00 verified03:14:46.475954Z. Table/stack existence and configuration remain UNKNOWN; CloudFormation reads not reached. No absence, provisioning, role repair or whole-task PASS inferred. No unchanged access retry or installed restriction bypass. Exact required next inspection delta is prepared in partition-create-evidence.json: three Dynamo metadata reads on only Partitions ARN, three CloudFormation reads on only PartitionsStorage stack; no IAM/data/role mutation or trust/profile union. Installation requires actual verified role/policy readback and own supported authorized IAM route, currently unavailable in this inspector path; standing authorization remains, not a new approval request. Final offline source CI38019793134 still owned/running; next terminal artifact verification, checked phase release and durable finished receipt/docs synchronization.

### Exact remaining inspection delta

This is a prepared metadata-only requirement, not an executed IAM repair or proof the entire delta is missing. The actual denial above establishes only DescribeTable on this table. Inspect current role/trust/policies before applying any missing subset; keep existing trust, policy and every other resource unchanged. Permission does not establish existence, mutation authority or participant grants.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadFixedRetainedPartitionMetadata",
      "Effect": "Allow",
      "Action": [
        "dynamodb:DescribeTable",
        "dynamodb:DescribeContinuousBackups",
        "dynamodb:DescribeTimeToLive"
      ],
      "Resource": "arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughPartitions"
    },
    {
      "Sid": "ReadFixedRetainedPartitionStack",
      "Effect": "Allow",
      "Action": [
        "cloudformation:DescribeStacks",
        "cloudformation:GetTemplate",
        "cloudformation:ListStackResources"
      ],
      "Resource": "arn:aws:cloudformation:us-east-1:092954139775:stack/KnownEnoughPartitionsStorage/*"
    }
  ]
}
```

The fixed metadata action/resource requirements were checked against current official [CloudFormation service authorization](https://docs.aws.amazon.com/service-authorization/latest/reference/list_cloudformation.html) and [DynamoDB service authorization](https://docs.aws.amazon.com/service-authorization/latest/reference/list_dynamodb.html). The older long-name reference URLs redirected to the generic index without the required content; they are not used as supporting evidence. These references establish supported declaration scope, not installed permission or successful execution.

## RUN189 verified phase handoff/release — 2026-10-10T03:19:35.091815+00:00

Checked source [c2eaadb](https://github.com/Known-Enough/known-enough/commit/c2eaadb85d72b318f2360325d1cbed0e6928f531), ownB143/main/manual [operations verification38019793134](https://github.com/Known-Enough/known-enough/actions/runs/38019793134)/job114118032408 SUCCESS03:13:22–03:17:54Z. Exact nine-file artifact/source and all steps/cleanup verified03:18:30.442602Z: four proposals unchanged byte-for-byte and five reports exact local generators; eight profiles117entries effective UNKNOWN unchanged. New24package/286native/full1407app/two existing optional skips/hosted1/browser64 PASS. Original local/source1 checks plus actual checkout failure preserved; changed source corrected/tested rather than waived. Final source hashes0cddb2f/483b3f2/f0467c2/d6c50af and983 protected files unchanged. Actual readback38019839052 identity READ then fixed Partitions DescribeTable AccessDeniedException,2requests/0mutations, table/stack existence UNKNOWN; exact artifact4882248 verified. No role/data/installer write, cutover/activation/participant grant/provider/AI/email operation or original recovery repin.

This single preparation coding phase is CODE_READY and its B claim is released; whole OPS00 REVIEW/unclaimed, not DONE. Source-pinned separate CREATE/review-hash/resume commands and finite metadata-only delta are reviewable in partition-create-package.md/partition-create-evidence.json. Genuine current boundary: installed staging-inspector metadata denied; use an available own supported IAM operator to read actual role/trust/policies and apply only missing fixed metadata requirements, then re-read exact resources after access changes. Actual existence determines whether to reuse/reconcile or create the sole retained table. Runtime profile/operator separation, Github apply path, migration/source-control/private recovery, activation/managed/provider/current-consent/usage/cleanup proofs remain open. Standing authorization remains; no new approval request or bypass. No unchanged live retry and no new claim/worker. A NP00/private recovery/excluded files, ASSESS07 history/password cancellation/old CWS b4/positive/denial proofs preserved.

Scheduled23:58:36.312Z/first visible observation00:01:07.762592Z; six coalesced hints listed in existing dated entries, no six executions/no activity invented in the reporting gap. Own verified cadence00:01:36→02:59:11 gap10655s FAIL; later receipts/corrections and one timeout retry verified. Source1 automatic full CI was reused and separate verification held before API; misleading progress3 corrected explicitly by progress4. A scheduled logging inspect is excluded from own lifecycle. Finished publication and final checked documentation synchronization are next owned closing steps; actual final end remains unobserved at this checkpoint. Requested model/effort and native idle gating UNKNOWN; existing single monitor/chat settings untouched. Nominal next03:28:38.839Z is cadence only.

Chat answer summary: [OPS00’s partition setup package](https://github.com/Known-Enough/known-enough/blob/main/docs/review-artifacts/OPS00/partition-create-package.md) passed 24 package tests, 286 operations tests and full checks. [Own-B readback](https://github.com/Known-Enough/known-enough/actions/runs/38019839052) returned AccessDeniedException; installation, role setup and activation remain open. Missed progress receipts are recorded.

## RUN189 finished receipt and closing observation — 2026-10-10T03:21:13.601718+00:00

Finished [38020161390](https://github.com/Known-Enough/known-enough/actions/runs/38020161390) created03:19:38Z SUCCESS; ownB143/main/sourcec2eaadb/event/OPS00/schedule/result completed for the bounded phase/exact420-character chat summary downloaded and verified before main documentation advance. Nine own lifecycle artifacts verified:38007211707/38018943100/38019120798/38019319792/38019334466/38019536329/38019795597/38019946019/38020161390. Actual creation gaps[10655,167,197,15,206,265,152,225]s: maximum10655s FAIL ten-minute cadence; no retrospective progress/activity invented. Later cadence bounded but never converts the earlier failure to PASS. One progress lookup i/o timeout recovered by one existing-run retry; exact inaccurate requested wording corrected by a distinct receipt, ambiguity fixed without duplication. A scheduled inspect run excluded; no other missing publication now.

Actual execution observed from first visible00:01:07.762592Z through2026-10-10T03:21:13.601718+00:00; original unseen/truncated earlier intake and unobserved activity gap remain UNKNOWN. Own focused/native/full/source-CI/readback/receipt tools terminal; current queued/in_progress GitHub jobs empty. Final documentation-only synchronization is the sole remaining owned closing step; its actual result/end will be saved privately and reconciled at the next natural checkpoint, not invented now. Current CODE_READY preparation claim released/no successor, whole OPS00 REVIEW/not DONE; exact metadata denial and future setup/roles/GitHub apply/runtime/source/consent/provider/managed gaps remain. Four source983protected hashes unchanged; original proposals/recovery/A NP00 untouched. Existing monitor cadence/chat/environment/preferences unchanged; requested model/effort and native idle gating UNKNOWN. Nominal next2026-10-10T03:28:38.839Z configuration expectation only; no new wake delivered since the six recorded coalesced hints. Final sync requires fresh ownB/main/fetched expected c2eaadb/checked source/docs/history/links and explicit nonforce origin main; on failure preserve local and stop new task work.

Chat answer summary: [OPS00’s partition setup package](https://github.com/Known-Enough/known-enough/blob/main/docs/review-artifacts/OPS00/partition-create-package.md) passed 24 package tests, 286 operations tests and full checks. [Own-B readback](https://github.com/Known-Enough/known-enough/actions/runs/38019839052) returned AccessDeniedException; installation, role setup and activation remain open. Missed progress receipts are recorded.
