# Full assessment of Known Enough

Completed 2026-10-02 UTC (2026-10-01, Mexico City). B / Battosai1806; actual Codex GPT-6, variant/effort unexposed. User-requested assessment, not independent release certification.

**Local implementation is substantial, but complete online qualification is unfinished. Findings: seven confirmed behavioral defects and thirteen additional risks, gaps, limitations or maintenance issues. Five are P1. Correct primary retry/rollback, admission, clarification and cumulative-budget defects before trusting complete live PASS.** No P0 defect was established; absence of other defects is not established.

Reviewed executable baseline: `fb42d675756bd6c67ff77f7a1a980ae965705a76`, clean ff-only pull. Claim: `bd3cd80`. Locations refer to that baseline. [Board](task-board.md), [workflow](agent-workflow.md), [LIVE04](tasks/LIVE04.md) and [NP00](tasks/NP00.md) govern current claims/statuses. No fixes or task status changes are delivered.

## Corrective execution register — 2026-10-01

User assigned local corrections to B, including primary/budget/workflow scope; A retains cloud operations and NP00. Original findings/evidence below are retained. [ASSESS01](tasks/ASSESS01.md) implements immutable recovery, fail-closed ambiguous mutations and verified rollback; local verification passed (FA01/FA02/FA12 locally resolved; actual service proof ASSESS07). [ASSESS04](tasks/ASSESS04.md) implements FA05 cumulative reservations (locally resolved; full verification passed, actual managed evidence ASSESS07); [ASSESS02](tasks/ASSESS02.md), [ASSESS03](tasks/ASSESS03.md), [ASSESS05](tasks/ASSESS05.md) and [ASSESS06](tasks/ASSESS06.md) follow sequentially. Actual managed proof belongs to new [ASSESS07](tasks/ASSESS07.md), not inferred from these fixes.

## Scope and evidence

Inspected current contracts/kernel, decision/owner/permission/approval lifecycle, group admission/invitations/roster, HTTP/Cognito/Lambda, browser sessions/screens, DynamoDB/replay, Bedrock/jobs, installer/recovery/rollback, fixtures/mailbox/budgets, deployment/qualification workflows and relevant tests/task obligations. Historical TeamTable remains regression evidence. Review concentrated on authority/privacy/concurrency/recovery/completion; this is not a line-by-line independent audit of every historical fixture/import.

| Evidence | Result | Limit |
| --- | --- | --- |
| Fresh focused group/contracts/kernel/lifecycle/storage/live-automation run | 108 existing tests passed, 12 files | Offline checks |
| Diagnostic probes in that run | 7/7 reproduced expected defects/counterexamples | Passing probes mean defective behavior observed, not fixed |
| Fresh focused HTTP/Lambda/Cognito/browser/model/mocked-DynamoDB run | 112 tests passed, 10 files | Offline identity/provider/storage |
| Latest A-recorded full check | 523 application tests passed; two optional DynamoDB Local skips; hosted 1/1; E2E 53/53 | Existing LIVE04 evidence; not rerun here |
| A-recorded shared inspection run 36932474464 | Public 10/10; AWS metadata/report PASS | Narrow inspection, not complete product/model proof |
| A-recorded Mail.tm smoke | Create/authenticated empty-read/delete PASS | Cognito verification delivery untested |
| Installation/live qualification | Import, full apply and real journeys pending | Repository evidence, no fresh AWS query |

Fresh total: **227 checks passed: 220 existing tests and seven probes across 23 files**, pinned Node 24.21.0, `--maxWorkers=1`. Temporary probes were removed; no executable changes. Probe source SHA-256: `050bc03d325212b0b078e937b731a794e1451fa1c8e976b4c4ed7584ae7c3e56`. Recipes below specify permanent regressions to add when fixes are scheduled. The full browser/application suite was not rerun for this documentation deliverable.

No AWS operations, dispatches, deployment, model calls, signup email, mailbox operations, credential sharing or external messages occurred. Only assessment and own B log/handoff change. Preserve source, A claims/statuses, immutable imports and historical evidence.

## Finding register

P1: correct before trusting affected installation/authority/budget. P2: correct or explicitly bound before complete qualification/broader use. P3: maintenance. Confirmed means reproduced offline or directly established by source/workflow, not observed in production.

| ID | Priority | Classification | Finding |
| --- | --- | --- | --- |
| FA01 | P1 | Confirmed defect | Partial retry replaces original primary rollback journal |
| FA02 | P1 | Confirmed defect | Rollback reports PASS without verified restoration |
| FA03 | P1 | Confirmed defect | Admission change does not guard delayed read/model commit |
| FA04 | P1 | Confirmed defect | Unchanged draft save removes unresolved clarification |
| FA05 | P1 | Confirmed budget mismatch | UTC daily counters exceed seven-day total |
| FA06 | P2 | Confirmed defect | Failed Playwright completion can yield PASS |
| FA07 | P2 | Confirmed automation gap | API/harness-only changes miss automatic qualification |
| FA08 | P2 | Live failure risk | Broker socket timeout shorter than Lambda deadline |
| FA09 | P2 | Partial commit risk | Roster revision and group binding are separate transactions |
| FA10 | P2 | Algorithm limit | Catalog omits feasible typed values |
| FA11 | P2 | Coverage gap | Metadata does not establish exact routing identity |
| FA12 | P2 | Resource risk | Existing primary table check incomplete |
| FA13 | P2 | Dependency risk | Mail.tm/Cognito delivery unproven together |
| FA14 | P2 | Timing risk | Suite outlasts 15-minute sessions |
| FA15 | P2 | Capacity limit | Groups/accounts share one bounded aggregate |
| FA16 | P2 | Product/operations limit | General erasure/distributed jobs absent |
| FA17 | P2 | Browser risk | Group refresh can retain stale/out-of-order state |
| FA18 | P3 | Documentation debt | Current-looking introductions contradict newer evidence |
| FA19 | P3 | CI hardening | Mutable foundation action tags |
| FA20 | P3 | Maintainability | Compressed critical operational scripts |

### FA01 - Partial primary retry overwrites rollback baseline

Source: [primary.mjs](../scripts/live-qa/primary.mjs), lines 8-13; [resume.sh](../scripts/live-qa/resume.sh), revision refresh. Completed matching installation returns early; any other existing journal is replaced. Partial route/policy/Cognito changes become the new original state; resource ownership/rollback bytes are reset. Resume refreshes the expected revision, permitting retry.

**Reproduced:** original revision/owned route/createdPolicy/code hash journal, later successful configuration, failed rollback-download fetch. Call throws ROLLBACK_CODE_UNAVAILABLE after journal changes to later configuration, empty routes, createdPolicy false, rollbackCode null.

**Required:** immutable original snapshots/ZIP, separate resumable phase/resource journal, exact drift guards. Test every mutation/journal cut point and repeated failure; never silently adopt another writer's changes.

### FA02 - Rollback can return PASS with Lambda still updating

Source: [primary.mjs](../scripts/live-qa/primary.mjs), lines 26-31. After 60 unsuccessful polls, it continues route/policy deletion and Cognito restoration then returns PASS. Successful code update starts configuration restoration without waiting/readback. Original code/environment/handler/final Cognito are not verified.

**Reproduced:** all Lambda reads InProgress, instantaneous local delays, matching journal/ZIP/Cognito: PASS and route deletion without update-function-configuration.

**Required:** fail on failed/stuck updates, await each step, verify original bytes/configuration/Cognito and preserve resumable partial rollback. Test configuration/Cognito failure and revision drift. Release-script code rollback has separate waits; this exact defect concerns installer rollback.

### FA03 - Admission is not bound to delayed decision operations

Source: [http-core.ts](../apps/api/src/http-core.ts), lines 515, 626-630, 680-683; [group-service.ts](../apps/api/src/group-service.ts), lines 156-179; [owner-conversation.ts](../packages/application/src/owner-conversation.ts), lines 99-112, 151-153; [known-enough.ts](../packages/application/src/known-enough.ts), lines 466-484. Group/account admission is checked in one aggregate; decision/model commit guards use another store's versions/owner/runtime. Disable/removal does not invalidate those guards.

**Two reproductions:** pause owner /decisions/{id}/me after admission, disable account, release: pending read 200; next read 403. Pause valid owner model response after frame confirmation, disable requester, release: HTTP 200 and draft persists; fresh read denied. No other-owner leak/arbitrary outsider authentication bypass was demonstrated.

**Required:** define in-flight revocation semantics; transactionally bind delayed work/mutations to current admission/roster or coordinated fencing. Another pre-write read alone leaves a race. Test queue/provider/storage delays with disable/removal; existing runtime stop does not guard this separate store.

### FA04 - Unchanged save clears unresolved clarification

Source: [group-decisions.ts](../apps/api/src/group-decisions.ts), lines 51-64; [group UI](../apps/web/src/group-decisions.tsx); [product](known-enough-product.md). Edit removes all questions whenever genericCandidates is nonempty, although finite candidates do not resolve public-scope ambiguity.

**Reproduced:** finite draft with unresolved question rejects create at revision 1 (NEEDS_CLARIFICATION). Save identical title/objective/variables/rules: revision 2 has no questions and creates successfully without resolution.

**Required:** preserve semantic clarification until explicit supported resolution/revalidation. Test unchanged/title-only saves and real answers. Later participant confirmation does not excuse silently deleting the blocker.

### FA05 - UTC counters permit excess whole-window reservations

Source: [broker.mjs](../scripts/live-qa/broker.mjs), lines 27-33/message reservation; [fixture-core](../scripts/live-qa/fixture-core.mjs), lease/reservation; [authorization schema](../scripts/live-qa/config.mjs); [LIVE04](tasks/LIVE04.md). Recorded seven-day approval specifies at most 28 runs, USD 7 model reservations and 56 messages. Implementation has per-run/UTC-date limits and expiry, but no cumulative cap.

**Offline counterexample:** start 2026-10-02T03:16:41.171626Z through expiry 2026-10-09T03:16:41.171626Z touches eight UTC dates. Four cleaned runs/date before expiry satisfy current predicates: 32 runs, up to USD 8 reservations/64 messages. This reproduces guard arithmetic, not real cloud admission/spending. Manual launches share the budget even if nominal scheduling uses fewer runs.

**Required:** atomic cumulative run/cost/token/message ceilings; preserve counters/expiry across retries; no inferred increase. Test UTC boundaries/exhaustion/concurrency/retry. Infrastructure usage remains outside documented model cap.

### FA06 - Overall Playwright failure ignored

Source: [runner](../scripts/live-qa/runner.mjs), lines 11-13; [reporter](../scripts/live-qa/sanitized-reporter.mjs), lines 4-6; [qualification](../scripts/live-qa/runner-core.mjs), lines 6-7. Child exit code is returned but discarded; reporter ignores overall completion/global errors.

**Reproduced:** seven passed records plus overall failed completion still yield qualification PASS if other lanes succeed. This can mask worker/teardown failure after the last passed test.

**Required:** zero exit and overall passed completion; sanitized global failure category. Test final teardown failure, interruption/missing results/reporter-write failure; cleanup always runs.

### FA07 - Automatic trigger misses API/harness-only changes

Source: [deployment workflow](../.github/workflows/deploy-amplify-staging.yml), lines 4-15; [qualification workflow](../.github/workflows/live-qa-release-and-check.yml), triggers. Qualification follows upstream deployment, whose push paths omit API source/live-QA scripts/tests/config and qualification workflow. Main changes only there start no automatic deployment/qualification. Manual dispatch works; intentional skip-CI checkpoints are separate policy.

**Confirmed from source:** include all approved artifact inputs and test API/harness/package/browser/docs-only trigger matrix. Preserve publication authorization. No live dispatch/deployment was executed.

### FA08 - Broker invocation timeout can leave ambiguous completion

Source: [runner](../scripts/live-qa/runner.mjs), line 9; [template](../scripts/live-qa/template.mjs), broker timeout; [broker](../scripts/live-qa/broker.mjs), provision/cleanup. Lambda allows 180 seconds; subprocess timeout is 180,000 ms, but AWS CLI read timeout is not set. AWS documents a 60-second default. Provision makes many calls; cleanup waits 32 seconds before deletion. Slow operations can outlive the caller and continue mutating state. [AWS CLI Invoke reference](https://docs.aws.amazon.com/cli/latest/reference/lambda/invoke.html).

**Potential, not measured:** align bounded connect/read/process deadlines and resolve ambiguous completion through the run-owned lease. Test slow provision/cleanup without duplicate fixtures or hidden cleanup failures.

### FA09 - Roster reset can commit before binding update fails

Source: [group-decisions](../apps/api/src/group-decisions.ts), lines 111-128; [application](../packages/application/src/known-enough.ts), reviseDecision. Decision revision resets owners/confirmations/proposal/approvals before a separate group transaction updates binding. Concurrent roster change or second-step failure can leave a committed reset despite failure response. Subsequent access should fail closed; reconciliation is still missing.

**Required:** inject failure after decision commit/concurrent roster change. Use resumable idempotent revision or coordinated transactional fencing. Retry must not repeatedly reset valid work or revive old consent. Creation reservation/replay does not cover this revision path.

### FA10 - Generic catalog omits feasible typed values

Source: [generic-candidates](../packages/adapters/src/generic-candidates.ts), lines 8-28; [negotiator](../packages/application/src/decision-negotiator.ts), lines 197-215. ENUM_SET catalog includes empty/singletons/full set, not two-choice subsets of three options. Numeric/date-like domains use public literals/endpoints, not interval interiors: integer 10 < x < 20 misses feasible 15. Products above 64 yield no catalog. Structural validation is not completeness/public-rule feasibility.

**MVP limitation, not invalid-agreement evidence:** kernel rejects invalid choices; model cannot select outside catalog. Declare supported finite vocabulary, clarify unsupported search shapes or enumerate complete bounded domains. Test subsets/interiors; never equate failed catalog exploration with proof of no solution.

### FA11 - Metadata PASS incompletely establishes routing

Source: [metadata](../scripts/live-qa/metadata.mjs), line 4; [inspector](../scripts/inspect-shared-staging.mjs); [primary](../scripts/live-qa/primary.mjs), route guard. Comparison requires named routes/JWT type, not exact authorizer ID/issuer/audiences/integration target/config. Installer checks are stronger; later drift can escape. Public 401 decision probe does not prove every group route's authenticated routing.

**Coverage gap:** compare sanitized expected/observed routing; test wrong authorizer/integration/protected group routes. No actual drift observed. Metadata PASS is not primary writable-product proof.

### FA12 - Existing primary group table is weakly checked

Source: [primary](../scripts/live-qa/primary.mjs), line 15; compare [recovery](../scripts/live-qa/recovery.mjs), checkTables. Existing KnownEnoughGroupsStage need only key names PK,SK. Key types/HASH-RANGE mapping, ACTIVE state, ownership/index/encryption/deletion-protection expectations are not checked before wiring access. New tables have safer settings; reuse is the concern.

**Required:** exact schema/state/account/ownership guards and collision tests; distinguish adoption from unrelated/incompatible resources. Never replace/delete conflicts automatically.

### FA13 - Mailbox smoke is not managed verification proof

Source: [mailtm](../scripts/live-qa/mailtm.mjs), request/code/delete; [broker](../scripts/live-qa/broker.mjs), verification/customMessage; [QA01](../tests/live/qa/journey.spec.ts). Mail.tm removes purchased domain/Route53/owned-SES prerequisites. Fixed origin/bounded calls/persisted creation intent/exact recipient/owned cleanup help. Cognito delivery is untested; parsing assumes sender/format and first three pages. Delays, provider/domain rejection, localization/template changes or accumulated mail can block proof.

**Required live evidence:** signup -> email -> confirmation -> PKCE login -> cleanup, plus late/missing/duplicate/wrong-recipient retry. Keep synthetic-only data/current limits. Owned-SES is optional, not a missing current LIVE04 requirement.

### FA14 - Journey can outlast its sessions

Source: [template](../scripts/live-qa/template.mjs), line 37; [live Playwright config](../playwright.live-qa.config.ts); [helpers](../tests/live/qa/helpers.ts); [browser session](../apps/web/src/cognito-session.ts). Tokens last 15 minutes and browser expires without refresh-token use. Suite permits 30 minutes, five-minute tests; most sessions are created once in QA01. Slow valid runs can fail later through expiry.

**Required:** explicit synthetic reauthentication at boundaries or bounded suite lifetime, preserving separate expiry-denial tests. Test slow email/model and 15-minute crossing; never silently extend credentials/consent.

### FA15 - Shared group aggregate has a small global ceiling

Source: [group repository](../packages/adapters/src/group-repository.ts), lines 4-44; [group service](../apps/api/src/group-service.ts); [draft service](../apps/api/src/group-decisions.ts). Accounts/groups/invitations/public drafts/bindings share NP#GROUPS/STATE, 300,000-byte ceiling and six CAS attempts. Limits: 256 accounts, 32 groups, 16 members/group, 64 drafts/decisions/group. Large frames hit bytes before nominal counts; unrelated groups contend. No general finished-group/draft archive frees space. Memory repository lacks transport byte ceiling, though transport tests cover CAS/invalid state.

**Required:** declare limits, test realistic sizes/concurrent groups, useful capacity response and safe archival/partitioning before wider enrollment. No current full table/lost write was demonstrated.

### FA16 - General erasure and distributed jobs are absent

Source: [architecture](known-enough-architecture.md), retention; [model jobs](../packages/adapters/src/model-jobs.ts); [worker](../apps/workers/README.md); [template](../scripts/live-qa/template.mjs); [cleanup](../scripts/live-qa/broker.mjs). Raw turns transient, structured data bounded, scoped QA cleanup/seven-day logs. General account/group/decision erasure and backup/provider deletion not implemented. Retained tables/pool/artifacts outlive rollback. Jobs are expressly process-local: restart loses work; instance concurrency is not distributed lease/account-wide bound. No SQS/DLQ consumer.

**Known limits:** finish managed persistence proof; separately scope real-user retention/export/deletion/distributed work if needed. Never queue raw conversations or claim provider/backup erasure from record deletion. Shared capacity is intentional low-quota repair; transactional budgets must enforce spending.

### FA17 - Group refresh lacks stale-response/failure cleanup

Source: [group-home](../apps/web/src/group-home.tsx), lines 39-55; [API fetch](../apps/web/src/cognito-session.ts), lines 143-153; compare [connected-app](../apps/web/src/connected-app.tsx) loadEpoch. Group load lacks epoch/abort; failed account fetch marks unavailable without clearing retained account/groups. Rendering can use prior approved status. Concurrent action/refresh completion order can overwrite newer state; effect active flag guards catch only, not setters. No built-in request deadline. Parent clears on 401, not every network/server failure.

**UI risk, not server bypass:** epoch/cancellation/finally clearing/bounded requests; test out-of-order approved/disabled states, failed refresh and session/unmount change.

### FA18 - Document introductions lag current evidence

Source: [automation proposal](live-automated-plan-tests.md), intro; [product](known-enough-product.md), lead; [debt index](technical-debt/README.md); dated [board](task-board.md)/[B handoff](handoff-B.md) history. Leads say automation unimplemented/inspector absent/no completed run despite newer preparation/inspection. Product still says historical TeamTable implementation; debt index says cleanup awaits A despite NP00 evidence. Historical package pins can be mistaken for current handoff.

**Required:** concise current-state banners/links and exact package/evidence reconciliation. Preserve imported/detailed dated history and unfinished obligations; do not invent DONE. A-owned status files remain untouched in this report.

### FA19 - Foundation CI uses mutable action tags

Source: [check.yml](../.github/workflows/check.yml), checkout/setup-node. Foundation uses @v4 tags; critical live/deployment workflows use immutable commits. Token is read-only; no compromise observed. Pin supported commits through controlled maintenance, preserving Node/npm/least privilege.

### FA20 - Critical operational scripts are hard to audit

Source: [primary](../scripts/live-qa/primary.mjs), [install](../scripts/live-qa/install.mjs), [release](../scripts/live-qa/release.mjs), [runner](../scripts/live-qa/runner.mjs), [metadata](../scripts/live-qa/metadata.mjs), [report](../scripts/live-qa/report.mjs). Long compressed statements combine guards/writes/journals/recovery. Untyped JS/blanket sanitized catches obscure phase boundaries/actionable failure reasons.

**Required:** readable named phases/pure guards and bounded failure categories, preserving sanitization. Permanent fault-injection regressions for FA01/02/05/06. Refactoring alone does not establish correction.

## Current tasks and what remains

| Task | Current status | Implemented/evidenced | Still required |
| --- | --- | --- | --- |
| [NP00](tasks/NP00.md) | IN_PROGRESS, A claim | Source/checks, stop/write correction, inspector/model-off/access cleanup | Inherited current artifacts/config and full Christmas + Shared Purchase lifecycles; debt/evidence reconciliation |
| [NP01](tasks/NP01.md) | DONE locally | Registration/admission/operator/groups/recipient links | Managed identity/operator/session proof via LIVE04; FA03/limits follow-up |
| [NP02](tasks/NP02.md) | DONE locally | Group frames/edit/reserved creation/replay/roster review | Live model/persistence/roster evidence; FA04/09/10 |
| [NP03](tasks/NP03.md) | DONE locally | Copy/screens/local inventory | Actual managed signup/error/denial/invitation/clarification/revision/display [states](np03-screen-inventory.md) |
| [NP04](tasks/NP04.md) | DONE locally | Fresh-group offline signed-token/model/kernel tests | Real identity/model/storage/privacy/concurrent authority evidence |
| [NP05](tasks/NP05.md) | BLOCKED/unclaimed umbrella | Acceptance/check list | Online obligations mapped to LIVE01-04, no duplicate operations claim |
| [LIVE01](tasks/LIVE01.md) | DONE preparation | Package/templates/installer/readback/rollback/limits | Actual successful install/readback; applicable FA01/02/05/12 |
| [LIVE02](tasks/LIVE02.md) | DONE preparation | Seven real browser/API journeys, scoped fixtures/mailbox | Actual hosted PASS; FA06 and FA08/13/14 validation |
| [LIVE03](tasks/LIVE03.md) | DONE preparation | Provenance/roles/receipts/public/metadata/journey report | Trigger/coverage correction, automatic complete run |
| [LIVE04](tasks/LIVE04.md) | IN_PROGRESS, A install then B qualification | Concrete authorization, model-off, Mail.tm smoke, recovery preparation | Successful recovery/apply, exact roles/targets, B manual and automatic complete PASS, cleanup/retry/handoff |

No DONE ticket reopened; local/preparation DONE is not live acceptance. User excludes B from NP00 implementation; this review inventories it without taking its work. NP05's older authorization text does not establish that newer concrete authorization is absent.

### LIVE04 completion checklist

Use newest verified executable package pin supplied by A's active installer claim, not a historical handoff pin. Baseline fb42d67 removes added import Outputs; this assessment is not a new package/install certificate. Preserve saved private configuration and expiry `2026-10-09T03:16:41.171626Z`.

1. Correct P1 defects affecting the next setup/activation/authority step; permanent regressions and required pinned full implementation check. Coordinate A scope, no second cloud writer.
2. Successfully import only the three retained QA tables with output-free recovery template; apply full stack; exact ownership/schema/readback. AWS validate-template proves syntax, not import success.
3. Finish primary signup/group rollout with original rollback journal and code/environment/IAM/routing verification. Keep primary models DISABLED/paid false under NP00.
4. Verify separate QA frontend/API/pool/clients/tables/control/secret and exact GitHub test/release/primary-code-only roles; populate target/enable repository variables from actual output. No credentials/private actor values in docs/variables/reports.
5. Prove Cognito verification through Mail.tm, PKCE login, registration/operator approval/rejection/disable/old-session denial. Owned domain/zone optional for selected mode.
6. All seven real journeys with bounded Nova Lite and explicit synthetic confirmations/concession/disclosure/exact approval. Include refusal/stale/revoked authority, audience privacy, invitation replay/replacement/expiry, roster reset, managed reload and actual screens; add concurrent/failure findings.
7. Prove exact account/mailbox/group/decision cleanup, failure retry, release rollback/forward repair; failed/expired lease blocks next run until repaired.
8. B launches complete PASS with B's own GitHub account, without A's personal AWS session. Record actor/SHA/hashes/run link/sanitized counts/cleanup.
9. Authorized deployment followed automatically by complete PASS on its matching source/artifact receipt. Green Amplify/public-only/A manual run insufficient.
10. Reconcile LIVE04/NP05 and residual NP00 obligations. Verify expiry/exhaustion; renewals require fresh authorization. Four runs/day is a cap, not a clock schedule: current triggers are dispatch/upstream deployment, no periodic schedule.

Concrete existing approval: four runs/day, 200 attempts/250,000 reserved tokens/USD 0.25 model reservations per run, two signup messages/run/eight per day, recorded seven-day window. FA05 identifies missing cumulative enforcement. Hosting/storage/other costs separate; reported credits are not verified balance or total billing cap.

### Deferred release/product work

[Pre-NP administrative closure](archive/pre-np-task-statuses.json) preserves unfinished scope. Future scheduling decisions, not alternative next tasks/restored acceptance gates:

| Deliverable | What remains | Route |
| --- | --- | --- |
| Christmas + Shared Purchase | Complete current managed model/lifecycle proof; garden QA not both scenarios | NP00 retained scope coordinated with LIVE04 |
| Independent architecture/privacy/release review | Later review deliberately deferred; historical/self-review verdicts retained | KE09/KE17 when user reinstates scheduling |
| Real participant feedback/trials | Synthetic agents do not establish volunteer results | [KE15](tasks/KE15.md), friction/testing plans, participant consent |
| Final demo/submission | Recording/materials/truthful service labels; official eligibility/deadline verification/submission | [KE16](tasks/KE16.md), [demo](known-enough-demo.md), [KE17](tasks/KE17.md) |
| Native Alexa/MCP | Access/integration unproven and optional; current assistant simulated/public-only | Optional post-MVP, keep simulated label |
| Invitation email sender | Copyable links implemented; automatic sender optional | Separately configured/authorized; signup verification remains required |
| Resource lifecycle | Stage 0 cleanup tag 2026-10-04, Amplify 2026-10-29 are reminders, not automatic deletion | Coordinated A inspection of ownership/existence and authorized retention/removal/renewal |
| Wider use | Catalog/capacity/erasure/distributed-job limits | Bounded post-MVP before broader claims |

No reliable percent-complete follows from ticket counts. Critical path: **correct P1 defects -> finish LIVE04 installation -> B/manual and automatic complete proof -> remaining NP00 technical closeout -> separately scheduled release work**.

## Proposed corrective tasks

Recommendations, not active claims/board edits. Keep one task active and respect A's installation scope. Cloud/model/email checks stay in LIVE04/NP00 unless a concrete uncovered operation needs a new authorized checklist.

| Proposed task | Scope | Completion evidence |
| --- | --- | --- |
| ASSESS01 - Preserve/verify primary recovery | FA01/02/12 | Immutable baseline, resumable phases, fault-injection/full check, authorized retry/rollback proof |
| ASSESS02 - Current admission at commit | FA03/09 | Delay/concurrent disable/remove/revision tests, reconciled records, no revived consent |
| ASSESS03 - Clarification/supported domains | FA04/10 | Unchanged/title-only edit regression, explicit resolution, finite feasibility/unsupported-shape behavior |
| ASSESS04 - Whole-envelope limits | FA05 | Atomic 28-run/USD 7/56-message ceilings if retaining exact envelope; UTC/concurrency/retry/expiry tests |
| ASSESS05 - Complete automation fails closed | FA06/07/08/11/13/14 | Global failure rejection, trigger matrix, slow/session/routing cases, B and automatic LIVE04 PASS |
| ASSESS06 - Honest operational/product limits | FA15-20 | Capacity/refresh tests, retention/job limits, current banners, action pins/readable scripts; separately scoped scaling/deletion |

Recommended order: ASSESS01/04 before affected install/activation retries; ASSESS02/03 before live authority/model acceptance; ASSESS05 before trusting automatic complete PASS. This is risk-based prioritization, not permission to alter queue or widen cloud authorization.

## Retained safeguards and already-corrected errors

Public snapshots use explicit allowlists/strict parsing. Cognito verifies tokens/display scope; browser/server boundaries enforced. Model output creates no consent. Exact approval/context/semantic binding, separate concession/disclosure/approval, refusal identity and kernel checks remain tested. DynamoDB transactions/replay/group CAS help but do not guard a different authority store automatically.

Old errors corrected in source: incompatible reserved Lambda concurrency removed; deleted-stack waiter accepts DELETE_COMPLETE by ARN; private persistent HOME state/resume replaces fragile temporary journals; retained-table import omits added Outputs. Their real corrected installation remains pending. Existing mailbox guards reject unrelated SES rules/conflicting domain/MX; no unguarded mail-rule overwrite is asserted. API Gateway's JWT default route rejects unauthenticated probes before QA lease gate; no lease-related public 503/401 defect asserted.

Preparation/offline tests/template syntax/repository sync/narrow inspection each prove only their scope. This report does not certify production readiness or claim every possible error has been found.

## Original claim retained

Initial report was the unchanged 948-byte IN_PROGRESS scope note published in bd3cd80. Its baseline, read-only code review, bounded report/B log/handoff writes, preserved A claims/history/imports, no cloud/external operations and no exhaustive/independent certification remain applicable. This completed assessment supersedes its progress status without deleting implementation evidence.
