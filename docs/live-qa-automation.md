# LIVE03 deployment and unattended qualification

Prepared, disabled until installation. No workflow dispatch, AWS write/publication, real account, model or email operation occurred in this task. [LIVE04](tasks/LIVE04.md) records actual installed scope/envelope, A-to-B handoff, B's authenticated complete PASS and a separate authorized primary deployment followed automatically by a matching complete PASS. Local YAML/regression/full-suite success cannot prove those service results.

## Installation inputs

A uses the exact completed package release commit and [setup configuration](live-qa-setup.md). Full installation requires `primaryRollout=true` after NP00's coordinated model-off operations, the fresh primary revision, an owned dedicated Route53 mail subdomain, a working controlled SES mailbox, the approved finite recurring model/email/resource/publication envelope, and successful automatic setup readback. The template installs distinct GitHub QA release/test roles and, only when primary rollout is enabled, the primary backend code-only role. The shared read-only inspector remains A's unchanged existing role/interface. No personal AWS profiles or credentials are supplied to B.

Publish the installer's allowlisted `installed-target.json` as repository Actions variable **LIVE_QA_INSTALLED_TARGET**. It must contain the exact verified pool/client/API/Amplify/table/secret identifiers and `PrimaryReleaseRoleArn=arn:aws:iam::092954139775:role/KnownEnoughGithubPrimaryRelease`. Do not use [the NOT_INSTALLED placeholder](../infra/live-qa/installed-target.example.json), invented observed hashes, account attributes or a Lambda environment snapshot. Repository admin may use Settings → Secrets and variables → Actions → Variables. Set **LIVE_QA_ENABLED=true** only after the concrete initial installation/recurring publication scope is authorized and installed. Missing/false variables block all credential jobs and produce a failing blocked report. The setup example remains off/zero; this documentation grants no resource or spending permission.

The existing exact immutable OIDC main subject remains required. Test credentials last one hour because the real 15-minute token expiry test and cleanup exceed a 15-minute AWS session; releases/inspection use 15-minute sessions. Lambda/Cognito runtime credentials remain service-managed, inaccessible to the runner. No GitHub environment approval prompt is introduced within the approved recurring envelope.

## A/B launch and actual release behavior

After installation, either account opens GitHub Actions → **Live QA release and qualification** → **Run workflow** → main, or runs this with its own authenticated GitHub CLI:

```bash
gh workflow run live-qa-release-and-check.yml --repo Known-Enough/known-enough --ref main
gh run list --repo Known-Enough/known-enough --workflow live-qa-release-and-check.yml --limit 5
```

This workflow builds and publishes QA **and primary backend code** from verified main, then qualifies that release; it is not a read-only dispatch. Initial recurring authorization must explicitly cover these publications. It cannot change the primary environment, IAM, Cognito or group/decision data. It keeps primary paid-model flags disabled and refuses an uninstalled primary feature configuration. A/B can use the existing **Deploy Known Enough staging to AWS Amplify** workflow for an approved primary frontend deployment. Its successful main completion automatically starts the new qualification workflow, which validates its exact workflow identity and source before any credential job. For backend-only changes, use the new manual release path; primary frontend bytes must still match the independent build from that source. Existing frontend deployment workflow stays unchanged.

A/B read the workflow summary and **live-qa-complete-report** artifact. It states the initiating GitHub account, tested immutable source, per-lane statuses and sanitized counts. The workflow's overall status fails for missing, blocked, skipped or failed required lanes. A report being downloadable is not a test PASS. LIVE04 must record an actual B/Battosai1806 manual run and an actual automatic run after a separately authorized primary deployment; YAML or repository permissions do not establish either.

## Provenance, expected artifacts and serialization

Only the exact repository/main manual dispatch or successful trusted main push/manual upstream frontend deployment is accepted. The guard checks fixed repository IDs, head repository/ref, conclusion, upstream name/workflow API path, immutable SHA and latest main. Fork/PR events, failed upstream runs and superseded source stop before credential jobs. All action references are full commit hashes. No workflow uploaded code is executed: every script comes from the verified main checkout. Artifact downloads are restricted to this workflow's own release/result artifacts and contain only data receipts/reports, not executable scripts.

The release job runs the pinned full application check **before credentials**, builds deterministic API/broker ZIPs and primary/QA browser artifacts, and records independently expected hashes and per-file public digests before publication. Target-specific build configuration is explicit. QA gets those exact API/broker bytes; all four functions undergo readiness/digest readback, and Amplify deployment completion supplies its job receipt. A separate narrow job updates primary backend code from the same content-addressed expected API ZIP with model-off/feature/revision guards. Primary and QA source/hash claims stay separate. Lambda handler exports and isolated tables/pools/clients/URLs are intentional target differences; primary models remain off while QA's real provider has the server-side budget.

One concurrency group serializes target publication and journeys; cancel-in-progress is false. Publication refuses an active/failed-cleanup lease and expired/unapproved installed authorization. API changes use fresh revision guards. Partial function publication attempts exact guarded rollback using the prior content-addressed ZIPs; a missing prior artifact or concurrent revision blocks rollback rather than overwriting another change. Frontend partial publication requires forward repair/inspection and never qualifies a failed release. Installed initial artifacts remain in the reviewed private bucket. The primary code-only job never restores a paid environment or touches data. A newer main source before final reporting classifies the run as superseded/blocked instead of presenting old evidence as current.

## Required report lanes

| Lane | Evidence | Failure behavior |
| --- | --- | --- |
| Current source and release receipt | Valid main provenance, immutable expected source/hashes, actual QA deployment/code readbacks and primary backend publication | Missing, drifted or superseded receipt blocks complete qualification. |
| Public primary/QA/static builds | Downloaded files match independently built expected digests; stable static preview keeps its historical allowlisted hashes; actual mobile/keyboard sign-in screens and unauthenticated API denial | Real mismatch or failed render/probe fails. Expected bytes never come from newly observed target output. |
| Primary configuration | Unchanged shared inspector observations, matching expected backend ZIP, model-off/no inline invocation grant, group table/routes, verified-email signup/client and private environment guard readback | Collection failure or incomplete configuration remains blocked; historical inspector manifest checks are retained, and new release comparison is explicit. No private environment is published. |
| Isolated QA journeys | Seven LIVE02 real hosted-login/signup/model/owner/negative/recovery/rendered tests, budgeted model/message counts, bounded log privacy | Skipped/missing tests, absent/depleted budget, inaccessible fixture or a failed assertion cannot pass. |
| Cleanup | Runner finally cleanup plus workflow always-run retry for the exact run ID | Failed/incomplete cleanup blocks qualification and the next writable lease. No arbitrary reset. |

Credential jobs are separate for QA publication, primary code publication, read-only metadata and synthetic journeys. Public/report jobs have no AWS access. Always-run artifact/report steps preserve factual failures without job-level continue-on-error. Reports accept only allowlisted status/hash/count/account fields and discard raw assertion errors, environments, mailbox contents, passwords/tokens and private owner data.

## Recovery and remaining actual checks

If setup/authorization is absent, install the approved package; do not widen a runner role or copy A credentials. If publication finds an active/incomplete run, complete/retry only that exact run's broker cleanup. Expired/depleted envelopes require the next separately approved configuration change; counters/expiry are not bypassed. Inspect sanitized report statuses; private administrator snapshots stay in CloudShell. Rollback revokes the QA test/release policies and the optional primary-code policy, disables the recurring AUTH record and retains resources/data for forward repair. Coordinate primary rollback with NP00 and preserve its model-off guards.

LIVE04 must prove CloudFormation/SES eligibility, role assumptions, real selectors/model output, cleanup/retry/rollback and both actual GitHub launch paths. [LIVE02 coverage](live-qa-coverage.md) records the known bound-display admission mismatch; a coordinated application fix is still required before QA05 can pass. Existing primary frontend IAM/workflow supports only frontend publishing; the new prepared role/job explicitly supplies the separate backend code path after initial authorization. No claim of real online PASS is made here.
