# OPS00 — Complete the GitHub operations path

**Coding-first scheduling — user direction, 2026-10-06:** The coding phase follows the checked coding checkpoint of UX03, not deferred administrator installation. Prepare/test automation and the exact setup package now; install missing delegation only in the final cloud phase. Follow [the current two-phase queue](../../../../coding-first-plan.md); record CODE_READY and release a checked claim if mandatory cloud proof remains, without calling the whole task DONE. Older administrator-first scheduling dependencies below are superseded; original technical acceptance remains. No new worker or active claim is created by this update.

- Status: IN_PROGRESS / B — recovery automation/setup coding. Administrator installation/required managed acceptance deferred to final cloud phase.
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
