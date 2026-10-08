# OPS00 — Complete the GitHub operations path

**Coding-first scheduling — user direction, 2026-10-06:** The coding phase follows the checked coding checkpoint of UX03, not deferred administrator installation. Prepare/test automation and the exact setup package now; install missing delegation only in the final cloud phase. Follow [the current two-phase queue](../../../../coding-first-plan.md); record CODE_READY and release a checked claim if mandatory cloud proof remains, without calling the whole task DONE. Older administrator-first scheduling dependencies below are superseded; original technical acceptance remains. No new worker or active claim is created by this update.

- Status: BLOCKED / CODE_READY / unclaimed — RUN148 checked preflight released; actual recovery bucket absent and prerequisite metadata denied; installation/recovery acceptance unproved.
- Origin: user's 2026-10-03 direction that ordinary implementation/testing should be automatic and should not repeatedly depend on A's AWS login.
- Worker: next eligible direct worker, current routing B; select/report actual model and effort at claim. One task/worker; no subagents or credential sharing.
- Scope at claim: exact GitHub workflow/scripts, resource/permission contracts needed by OPS01–03, bounded policy/bootstrap proposal, meaningful integration checks, safe evidence and own log/handoff. Record exact files first. No general administrator grant or live operation is authorized by this ticket.

## Prepare and verify

1. Inspect actual installed role/trust/policy/resource state and existing successful workload receipts. Current inspected source `scripts/live-qa/template.mjs` gives QA/primary release roles existing code/artifact updates and limited AUTH/LEASE reads; it does not define table/queue creation or general role editing. Source inspection alone does not establish effective installed access. Reuse sufficient existing access; do not add duplicates or widen policies speculatively.
2. Define the actual storage/key/archive, retention/erasure and job-recovery operations required by OPS01–03 before choosing permissions. Prefer current resources where sufficient. Prepare exact account/region/resource/partition scoping, runtime access, migration/retention contracts, costs and rollback/data-preservation boundaries. Undefined future operations are not a reason for wildcard permissions.
3. Implement a repeatable GitHub workload path for those approved operations: pinned source/plan identity, preflight, reviewed change plan, version/revision guards, private durable recovery state, apply/readback and safe failure classification. Retrying resumes verified progress without re-creating resources, clearing data or resetting usage. Runner `/tmp` is temporary tooling, not the only recovery record.
4. If the current roles cannot perform the defined operations, prepare one minimal administrator bootstrap for the complete approved envelope. Include trust, delegation boundaries, validation, readback and revocation/recovery; protect workload-role policies/trust and unrelated resources from self-expansion. Provisioning authority is separate from participant authority and destructive data approval. Prepare everything reviewable before requesting the specific final authorization. A's administrator access is used only for that unavoidable delegation, through an available authorized path; no recurring CloudShell procedure is an accepted normal workflow.
5. After explicit authorization and actual bootstrap verification, B uses B's own GitHub login to execute an authorized representative operation and inspect the matching report. Verify bounded positive/negative cases, duplicate/resume behavior and effective role scope; a policy simulation alone is not actual workload success. Keep original paid-test/email/cumulative/expiry/CLEAN gates and separate infrastructure cost authority. Adding cloud capability does not grant new spending, real-data erasure or participant consent.

## Completion

The report maps every required OPS01–03 operation to an existing verified capability or an installed, verified bounded GitHub path. B's actual authorized workload success and safe recovery are recorded. Ordinary deployments/tests/migrations/maintenance inside that approved envelope need no personal AWS credentials, administrator console session or bespoke command from A. Any genuinely outside-envelope operation remains explicitly identified; do not report universal autonomous AWS access.

Preparation can be checkpointed while the narrowly authorized bootstrap is pending, but OPS00 cannot be DONE or OPS01 managed readiness claimed on a proposed policy alone. Focused checks and pinned `npm run check` are required for executable changes; documentation-only checkpoints use documentation checks. Synchronize checked source with `[skip ci]`; publishing/paid tests require their applicable finite authorization. No grant/counter reset, permanent budget renewal, arbitrary delete or other-account access.


## B OPS00 claim — 2026-10-07T02:36:24.162905+00:00

IN_PROGRESS/B soleclaim afterUX03CODE_READYrelease; ownBattosai1806/equalmainf1ab255 verified. Scope scripts/operations plan/workflow validation and focusedtests, bounded infra/permissions proposal and operations contracts/evidence/tracking; exact executable paths recorded before edits. No live installation during codingphase or A NP00source/policy takeover. Rootactualvariant/effort unavailable/nohelpers.


## OPS00 run104 checkpoint — 2026-10-07T02:37:02.071997+00:00

IN_PROGRESS/B. Existing template/release/inspector and adapter evidence inspected; operations-envelope.md maps OPS01–03 gaps and next exact plan/journal validator contract. No executable/IAM/resource change or universal access claim. Newnames/keyprefixes unresolved rejectapply, not wildcard fallback. Next implementation/test bounded validator/recovery in sameclaim.

OPS00 executable scope refinement: scripts/operations/plan.mjs and plan.test.mjs only for offline strict plan/recovery validation; no workflow/live apply yet.


## OPS00 run105 local implementation — 2026-10-07T03:07:09.255027+00:00

IN_PROGRESS/B. scripts/operations/plan.mjs/test.mjs strict offline envelope/plan/recovery hash validation,4focusedPASS. No apply/delegation/durablejournal yet. Current envelope only fixed account/region exact KnownEnough DynamoARN, no wildcard/queue fallback. Full pinned check session42841/private /tmp/ke-run105/full.log running lint/boundariesPASS, later phasesUNKNOWN. Do not duplicate. No commit/push until checks verified; next durablejournal/verified workload path.


## OPS00 run106 local hardening — 2026-10-07T03:36:53.369532+00:00

IN_PROGRESS/B. Prior run105full PASS784/twooptional/hosted1/browser62. Self-inspection found validateRecovery trusted arbitrary checkedPlan; now originalplan+envelope revalidation mandatory. Five focusedtestsPASS incl forgedcheckedhash/wrongsource rejection. Finalfull session83874 /tmp/ke-run106/full.log running; no duplicate. Durablejournal/workflow/installation stillunfinished. No sync until executable check complete; sameclaim.


## OPS00 checked validator checkpoint — 2026-10-07T04:06:34.293131+00:00

IN_PROGRESS/B. Finalrun106full PASS784/twooptional/hosted1/browser62 and focused5PASS. Offline plan/recovery validator checked; recovery originalplan+envelope revalidation prevents forgedproof. Durablejournal CAS/terminal/count/restart test contract recorded in operations-envelope.md; adapter/workflow/setup remainunfinished, no installedproof/CODE_READY. Synchronize small checked source checkpoint now, keep same soleclaim.


## OPS00 run108 transition checkpoint — 2026-10-07T04:36:55.802188+00:00

IN_PROGRESS/B. advanceRecovery in existingplan.mjs validates originalplan/envelope/journal, matchingstorage revisions and monotoniccount/state; sixfocusedPASS. Puretransition notdistributedlock; adapter mustconditionallypersist. Fullsession77446/private /tmp/ke-run108/full.log active lint/boundariesPASS, remainingUNKNOWN. No push until checked; next durableadapter and real conditionalwrite tests.

OPS00 scope adds scripts/operations/journal.mjs and journal.test.mjs: injected durable conditional storage port plus concurrency/restart tests; no managed resource installation.


## OPS00 run109 conditional journal port — 2026-10-07T05:07:01.737315+00:00

IN_PROGRESS/B. journal.mjs injected read/createIfAbsent/compareAndSwap, originalplan/envelope validation before everyread/write, revision guard. NinefocusedPASS inclduplicateprepare/recreatedservice/oneof2writers fakeatomicport. Fake store is not durablemanagedproof. Prior108fullPASS784twooptional/hosted1/browser62. Updatedfullsession93686 /tmp/ke-run109/full.log active; sourceLOCAL pending checks. Next exactmanagedadapter/recoverymanifest/workflow integration, no apply.


## OPS00 run110 checked journal checkpoint — 2026-10-07T05:36:41.562491+00:00

IN_PROGRESS/B. Prior109full PASS784twooptional/hosted1/browser62; ninefocusedPASS. Conditionaljournalservice/revisiontransitions checked, fakeatomicstore explicitly not manageddurability. Exact dedicated KnownEnoughOperationsJournal PLAN#hash/JOURNAL schema and narrow setup/runtime proposal documented, not installed. Next transportadapter/conditionalrequest tests and workflow/bootstrap; no CODE_READY/liveclaim. Checkedsource sync now.

OPS00 scope adds scripts/operations/dynamo-journal.mjs and dynamo-journal.test.mjs: exact proposed table adapter via injected transport, no provisioning or enabled workload.


## OPS00 run111 Dynamo transport checkpoint — 2026-10-07T06:07:13.407728+00:00

IN_PROGRESS/B. exactproposedtable adapterconsistentread/exclusivecreate/revisionCAS/errorclassification;12focusedPASS injectedrequesttests only. No installedDynamo/role/provision/liveapply. Fullsession92293 /tmp/ke-run111/full.log active, inspectnoduplicate. SourceLOCAL untilchecked. Next fullresult then adapterstrictness/integration/workflow/setup.


## OPS00 run112 adapter integration — 2026-10-07T06:37:07.269253+00:00

IN_PROGRESS/B. Prior111fullFAIL lint preserve-caught-error adapterline23; fixed internalcause with sanitized publicmessage. Added journalservice/Dynamosimulatedconditionaltransport resume/2writers integration. Focused13PASS. Updatedfullsession18399 /tmp/ke-run112/full.log active; no sourcepush until verified. Simulatedtransport is not managedproof; next fulloutcome/workflow/bootstrap.


## OPS00 run113 checked adapter checkpoint — 2026-10-07T07:07:06.596890+00:00

IN_PROGRESS/B. Corrected112fullPASS784twooptional/hosted1/browser62 and focused13PASS. ExactDynamoadapter/conditionalservice integratedsimulatedtransport tests checked; no realDynamo installation. Setup-package.md defines table/readback/PITR/preservation/OIDC/runtimedeny/sourceplanworkflow/manifest prerequisites. Bootstrap/executableworkflow/manifest stillunfinished. Checkedsource syncnow; sameclaim.


## OPS00 run114 bounded source refinement — 2026-10-07T07:37:47.909904+00:00

Same IN_PROGRESS/B claim. Add scripts/operations/manifest.mjs, setup.mjs, verify.mjs and focused .test.mjs files, .github/workflows/operations-verify.yml, and infra/operations generated setup.json. Credential-free verification workflow/source binding and recovery manifest transport only; no installation/IAM delegation or live apply. Existing A NP00 and runtime templates untouched. Root GPT-6, exact modelvariant/effort unavailable; no helper.


OPS00 run114 final workflow scope: add scripts/operations/aws-transport.mjs and aws-transport.test.mjs, managed-preparation.mjs and managed-preparation.test.mjs, and .github/workflows/operations-recovery.yml. Bind a bounded synthetic recovery preparation/resume to own B/main/source, exact proposed storage and independently read-back configuration. Installation/managed dispatch remains deferred and the workload is gated by a technical installed-configuration flag. No participant/data apply, provider call, arbitrary command or IAM self-expansion. Existing recovery.mjs/recovery.test.mjs combine the previously declared manifest/journal foundation within the same claim.


## OPS00 recovery package checked source checkpoint — 2026-10-07T07:57Z

OPS00 remains IN_PROGRESS/B while the credential-free GitHub verification is inspected. Implemented versioned/hash-bound private manifests, recovery-first preparation, exact-resource bounded AWS CLI transport, fail-closed installed storage readback, generated preserved setup template and two source-bound workflows. Final 32 focused tests and pinned full check PASS: references7/planning15/lint/boundaries/types,784 application tests(two optional skips), build, hosted1 and browser62. Both workflow YAML files parse; new documentation links and diff check PASS. Template hash a8c67e9a4474b8561a991e8446ae1db36e23c70de18bd09bff4241bdd5c0d627. CFN service/schema validation and installed/effective IAM/managed recovery UNKNOWN; no AWS operation/deployment/AI/email/participant mutation. Prepare GitHub verification on the synchronized checked source, then release only the coding milestone to OPS01. A NP00 remains paused/saved.


## OPS00 exact-source GitHub verification repair — 2026-10-07T08:01Z

Source2f1dca32be575d7f5659af3fec61d9bd562cf98f synchronized. First dispatch37590705536 FAILED with OPS_VERIFICATION_FAILED because the supplied SHA was incorrectly copied; guard stopped before dependency installation. Corrected ownB/source37590790423 passed preflight and all32operations tests, then full check failed three integration suites with ERR_MODULE_NOT_FOUND for the broker's isolated pinned AWS SDK packages (742 tests PASS/two skips; later build/browser phases skipped). Added the existing repository CI prerequisite npm ci --prefix scripts/live-qa to this scoped verification workflow; no lockfile/source/SDK version change. Local focused32/YAML/diff checks PASS; corrected full GitHub verification next, same sole OPS00 claim. No AWS credentials/calls or publication in this offline workflow.


## OPS00 CODE_READY release — 2026-10-07T08:11:21.713735+00:00

REVIEW / CODE_READY; B implementation claim released. Checked source `e90ea9eaffd7b8539b49a88ec3be362b00636319` and ownB/ID143764700 [GitHub verification37591039774](https://github.com/Known-Enough/known-enough/actions/runs/37591039774) SUCCESS. Downloaded artifact matches exact source/template hash a8c67e9a4474b8561a991e8446ae1db36e23c70de18bd09bff4241bdd5c0d627; OFFLINE_VERIFIED, installation/managedRecovery UNKNOWN, apply DISABLED. Local/GitHub32focused and full784(two optional skips)/hosted1/browser62 PASS. Clean-runner isolated SDK prerequisite repaired after logged failed attempts; no application/lockfile change.

The coding foundation is strict plan/recovery validation, private versioned manifests, conditional journal persistence, bounded AWS transport, installed-state preflight, gated synthetic recovery preparation/resume and the generated exact setup package. Final cloud ledger retains inventory/CFN validation/change-set installation/effective-role readback, two actual cross-runner B preparations/negative cases and OPS01–03 exact apply/resource/participant-authority mappings after their checked schemas exist. No universal operations access, participant apply or whole-task DONE claim. Setup remains deferred; no new AWS/deployment/paid/email run. Sequential successor OPS01 coding is eligible; A NP00 paused/saved source/files/recovery remain untouched.


## RUN148 — sole OPS00 final-cloud intake claim, 2026-10-08T07:21:51.282800+00:00

Own Battosai1806/143764700, persistent B chat01a1086a-fb98-7552-b4d1-e2dbab01a404, clean main ff-only/fetched baselinebf46b61be753e75a9e53990746c2143956d7f778; no active project checks or GitHub deployment/test observed. FIN02 CODE_READY/released and all available coding phases complete. Actual root Codex GPT-6, exact variant/effort unexposed; no helper/new worker/automation. Started [receipt37742716800](https://github.com/Known-Enough/known-enough/actions/runs/37742716800) SUCCESS with downloaded own-B/main/schedule/source/summary verification. Previous RUN147 final clean readback07:15:17.371338Z reconciled; actual new hint07:15:56.109Z/observed start07:16:29Z. Timing is not native idle-gating proof.

Fresh sole OPS00 claim covers final-cloud prerequisite/configuration intake and preparation of one exact missing delegation/installation handoff. Initial write scope only OPS00 ticket, task-board.md, claim-log.md, own work-log-B.md/handoff-B.md, b-next-task-handoff.md, monitor-log.md and new docs/review-artifacts/OPS00/final-cloud-intake.md/json. Existing source/workflows/setup/protected30 paths remain read-only; any executable/installation amendment must name exact paths/resources before mutation. May execute the existing own-B read-only GitHub staging inspector to reconcile current source/configuration/resource/runtime-policy evidence. Reuse existing sufficient capability, inspect active jobs, never duplicate deployments or enable operations before verified installation.

NP00 model-off/ReadOnly/temporary-role cleanup later SUCCEEDED; do not repeat obsolete mutations. A paused NP00 saved claim/source/private recovery/excluded paths remain untouched; no bounded overlapping source/contract transfer inferred. Required private-contribution model-backed Purchase remains a source/contract plus managed gap. Its preserved-scope gap does not authorize changing A files or block a nonoverlapping OPS00 prerequisite intake. New operations recovery flag absent (configuration only), actual installed role/table/bucket UNKNOWN. This host has no aws executable; no other account credential file read. Existing GitHub inspector source defines exact old staging reads, not CloudFormation/IAM setup authority. Determine exact current evidence before installation; no speculative IAM expansion or service PASS from configuration.


### RUN148 exact source amendment — installed preflight gap, 2026-10-08T07:24:41.505883+00:00

Same sole OPS00 claim. Current shared inspector37743019693/aws job SUCCESS collected live metadata07:22:32.128Z: fixed account/inspector, active primary ZIP417eff55… matches recorded current release/package, model flags DISABLED/false/no runtime inline Nova grant, JWT routes and protected group table. Its old manifest/old signup-hold assertions fail; do not change A protected inspector/targets or claim fresh journey PASS. Actual CloudFormation/recovery-role/journal/private-bucket inventory is not collected by this workflow. Existing managed-preparation.mjs requires the disabled installation flag and new recovery role first, so it cannot establish installation prerequisites. No duplicate general inventory/preflight exists under scripts/operations or workflows.

Add exactly scripts/operations/installed-readback.mjs, installed-readback.test.mjs and .github/workflows/operations-intake.yml. Source-exact/own-B/main guarded workflow uses only the existing installed KnownEnoughGithubStagingInspector OIDC role. Script has fixed account092954139775/regionus-east-1, exact known stack/role/table/bucket targets and read-only AWS actions, one attempt/request plus physical time/buffer/count bounds. No data reads, arbitrary inputs/actions/resources, role/policy/stack writes, flag enablement, provider/email/deployment/participant access. Inspect current own workload identity before requests; preserve strict allowlisted source/resource/configuration results and exact service error codes/actions/resources, never raw errors/snapshots/trust contents. Authorization failure is UNKNOWN inventory, not ABSENT/PASS; missing resource codes differ from denial. No bypass or repeated denied mutation. Meaningful injected positive/denial/malformed/wrongidentity/bounds/sanitization checks and pinned full check required before source sync or dispatch.


## RUN148 checked OPS00 preflight phase released; actual managed setup blocker — 2026-10-08T07:46:22.312839+00:00

Own B releases the sole OPS00 phase after source[938628fa038c3d0b3d7491811507ac08225e2843](https://github.com/Known-Enough/known-enough/commit/938628fa038c3d0b3d7491811507ac08225e2843) synced clean main/origin07:41:46.262953Z. Added only fixed source/own-B/read-only installed-readback script,13 meaningful tests and operations-intake workflow; final75 native/full1281application(two optional skips)/hosted1/browser64 PASS. Final three source and30 protected hashes unchanged; isolated bad-absence classification yields3expected failures/10PASS. Existing API/artifacts/A NP00/protected source remain unchanged. New correction CODE_READY; whole OPS00 BLOCKED/unclaimed pending actual installation/recovery/OPS mapping, not DONE.

Actual own-B [intake37745058529](https://github.com/Known-Enough/known-enough/actions/runs/37745058529) on same source, job07:42:07Z–07:42:23Z, downloaded artifact/actor+triggering actor/main/source/path/13CItests/guards/OIDC/upload verified. STS exact existing inspector/account PASS; five bounded read-only requests, zero mutation. cloudformation:DescribeStacks on KnownEnoughOperationsRecovery → AccessDenied; iam:GetRole on exact KnownEnoughGithubOperationsRecovery → AccessDenied; dynamodb:DescribeTable on exact KnownEnoughOperationsJournal → AccessDeniedException. Their inventory/preservation remains UNKNOWN. s3:GetBucketVersioning on exact recovery bucket → NoSuchBucket, service-reported ABSENT. Dependent reads skipped, no grant/writer/role/stack/resource/flag/counter reset or participant/provider/email/signup/deployment action. Overall workflow FAILURE accurately means blocked preflight, not installation attempted or tests failed. No automatic approval-review denial, credential fallback, bypass or repeated denied mutation.

One concrete setup handoff: use verified own-account project setup identity to inventory stack/role/journal/OIDC/conflicts; only then validate exact setup.json hash a8c67e9a4474b8561a991e8446ae1db36e23c70de18bd09bff4241bdd5c0d627, inspect CREATE/UPDATE change set for only preserved journal/private recovery bucket/policy/narrow runtime role, apply/read back and enable recovery only after verification. Existing inspected workload is not setup authority; do not expand it speculatively or infer absence from denied reads. Same-source two-run synthetic recovery/effective negative probes precede OPS00 whole completion and OPS01→02→03 managed phases. [Exact package and actual results](../../../../review-artifacts/OPS00/final-cloud-intake.md), source-evidence JSON, [monitor148](../../../../monitor-log.md#b-run148).

A NP00 PAUSED/saved source/private recovery/excluded files/history unchanged; historical model-grant/temporary-role cleanup not repeated. Required private Purchase protected-source/contract and original recovery gaps remain; no blanket takeover. Existing30minute same-chat idle watchdog preserved, actual scheduler gate UNKNOWN; no competing writer/new worker. Do not retry unchanged setup denials on the next hint. Verify the next highest eligible independent deferred signup/Gateway phase through current workload capabilities and current ticket, or take a concrete evidenced nonoverlapping correction if blocked; no successor claim begins here. Required managed/root source gaps still gate FIN03. Finished lifecycle/log synchronization follows release documentation checks.
