> **Current delivery, 2026-10-02:** LIVE01–03 preparation and offline verification are DONE; LIVE04 installed QA infrastructure but publication/primary rollout/complete live qualification are pending. ASSESS01–06 correct local installer/budget/admission/clarification/automation issues; ASSESS08 provides the final pinned handoff. Full authenticated automation is implemented in source, with actual delivery, B/manual and matching automatic PASS still required in [ASSESS07](tasks/ASSESS07.md). The proposed/unimplemented/no-role/no-run statements below describe earlier dates. See [board](task-board.md) and [limits](operational-limits.md).

# Live automated plan tests

## Current execution route — 2026-10-01

The user has scheduled [LIVE01–04](live-test-delivery.md) to implement this proposal: B prepares setup, real scenarios and post-deployment automation; A installs the approved package once; B proves complete live runs. The detailed assertions and access/privacy constraints below remain requirements. The original prepared-role/no-run statements are historical: shared run [36926796651](https://github.com/Known-Enough/known-enough/actions/runs/36926796651) now has verified GitHub AWS login and public 10/10 PASS, but AWS inventory/report FAIL. Full NP03/NP04 live automation is still unimplemented.

Proposal requested on 2026-10-01. The broader authenticated synthetic/isolated-QA plan remains PROPOSED. The narrow public smoke and read-only AWS inventory workflow is prepared under A's current NP00 claim; its AWS inspector role is not installed and no GitHub live run has completed. See [shared staging checks](shared-staging-checks.md). B / verified Battosai1806; actual GPT-6 variant/effort unexposed. Repository baseline when proposed: `28845f8`. This document remains the future execution path for broader [NP05](tasks/NP05.md), preserving NP00's active claim and historical evidence.

## Recommendation

Run cloud checks in GitHub Actions using short-lived workload credentials and dedicated synthetic test identities. Agents prepare tests, dispatch authorized jobs and interpret sanitized results; trusted runner processes hold AWS and participant credentials. Routine tests then require repository access, not A's personal AWS login. Keep deployment, observation, fixture management and paid-model permissions separate.

Start with checks of the existing public staging builds, then add scoped cloud metadata checks, authenticated synthetic browser/API checks and separately budgeted live-model qualification. A one-time authorized AWS administrator must establish any missing roles, fixture isolation and secret storage. That administrator need not be A under the proposed policy. Existing A-only cloud policy remains in force until the user approves the concrete replacement; this document itself changes no access or operational authorization.

## Existing assets and gaps

These values come from repository configuration and dated deployment evidence, not fresh service inspection. The first run must verify each target against its manifest.

| Target | Recorded configuration | What to test |
| --- | --- | --- |
| Connected Amplify staging | `https://main.d143q5ravxp5av.amplifyapp.com/`, app `d143q5ravxp5av`, branch `main` | Served build identity, assets, connected UI, Cognito redirect and real API integration |
| Stage 0 static preview | `https://d23eowhnwtqts3.cloudfront.net/`, distribution `E61V9RN1W6E0` | Its separately approved static build; no auth/API/owner capabilities expected |
| API Gateway | `https://u94iyvt6p9.execute-api.us-east-1.amazonaws.com`, API `u94iyvt6p9` | Routes, JWT denial, CORS, authenticated lifecycle and cross-role isolation |
| Lambda | `known-enough-stage-api`, recorded runtime role `KnownEnoughStageApiRole` | Actual code hash/config compatibility, update state and request behavior |
| Cognito | Pool `us-east-1_V9OMjd0zx`; public participant/display clients from deployment workflow | Real managed login/PKCE, verification, distinct clients and subject-based authority |
| DynamoDB | Recorded decision table `KnownEnoughStage`; NP group table still requires verified deployment | Durable application state, concurrency/replay and fixture cleanup |
| Bedrock | Recorded Nova Lite configuration and explicit runtime enablement guards | Authorized live structured output and bounded failure/refusal behavior; disabled until approved |
| Retained Vercel/other sites | Inventory URLs from existing runbooks before adding them | Classify as active, legacy or retired. Historical Vercel browser/API access was deliberately restricted after the Amplify origin switch. Do not call that expected isolation a regression. |

Account `092954139775` / region `us-east-1` are recorded staging values. Each credentialed job verifies its actual account, role and region before service calls. [Amplify runbook](../infra/amplify-hosting.md), [staging runbook](../infra/staging-runbook.md), [deployment workflow](../.github/workflows/deploy-amplify-staging.yml) and [NP05 preparation](../infra/np05-deployment.md) supply the inventory.

The Amplify workflow already assumes `KnownEnoughAmplifyMainDeploy` through GitHub OIDC for 15 minutes. Its existing policy permits deployment/job status only for this app/branch; it cannot inspect or test the backend. Local CI and NP04 do not exercise actual cloud identity, deployed routes or managed persistence. NP01–NP04 pushes used `[skip ci]`; latest source is not assumed deployed. A green Amplify job alone proves neither the correct Lambda artifact nor a working user journey. Recorded cleanup tags (Stage 0: 2026-10-04; Amplify: 2026-10-29) are reminders, not automatic deletion; include resource existence/expiry in target inventory and clarify ownership before renewing or removing resources.

## Workload access instead of personal credentials

GitHub supports OIDC exchange for short-lived AWS credentials without storing long-lived AWS keys. Use exact audience/subject trust and protected environments. [GitHub AWS OIDC guide](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws).

Preserve the existing deploy role. Prepare separate candidate roles/policies:

| Proposed role | Allowed work | Boundary |
| --- | --- | --- |
| `KnownEnoughStagingObserve` | Exact-resource Amplify job metadata; API routes/authorizers/integrations; Lambda build/config status; Cognito pool/client metadata; table schema/status; bounded log inspection | No deployment, IAM changes, user administration, table item scans or paid invocation. Some AWS read APIs cannot be resource-scoped; document each necessary wildcard and confine it with supported account/region conditions. |
| `KnownEnoughQaFixtureSetup` | Approved fixture provisioning/admission/cleanup through an isolated QA environment or narrowly validating fixture broker | Setup job only. No access to human accounts or current shared staging aggregate. No general operator access handed to agents. |
| `KnownEnoughQaIdentityRead` | Read only the named synthetic test secret(s), with exact KMS decrypt scope if required | Browser/API jobs receive only the identities assigned to their scenario; secrets remain in trusted job processes. No A/B passwords or AWS profiles. |
| Existing/frontend and proposed/backend release roles | Publish exact verified artifacts to exact named targets | Separate release job and authorization. Test agents cannot deploy, reconfigure or force a cold start in shared staging. |
| QA live-model runtime | Approved model/resource invocation by the application's runtime, with a run budget | Tests call the deployed API as synthetic participants. No direct Bedrock invocation permission for the summarizing agent. |

`id-token: write` only enables OIDC token issuance; IAM grants determine AWS access. Apply it only to credentialed jobs. [GitHub OIDC permissions](https://docs.github.com/en/actions/reference/security/oidc).

The current trust pins an immutable subject: `repo:Known-Enough@331386621/known-enough@1377587215:ref:refs/heads/main`. Adding a GitHub environment changes the subject shape. Verify the repository's actual immutable claim and render exact new trust before installation; do not copy a generic subject or broaden to `repo:*`. Proposed environments: `staging-observe`, `staging-qa`, `staging-live-model`. Restrict to reviewed main/reusable workflow code, never fork or pull-request-head code. Privileged `workflow_run` must validate the upstream repository/event/ref/SHA and checkout trusted workflow code; never execute an untrusted uploaded script. Pin action revisions during implementation.

Use 15-minute sessions for bounded credentialed jobs, with a separate fresh exchange for a later job if necessary. GitHub-hosted ephemeral runners are the default; no shared writable checkout or workstation AWS configuration. Store QA secrets in an approved protected environment or exact Secrets Manager resources, never the repository. Grant A and B appropriate repository dispatch/result access so either can launch approved tests without an AWS SSO session.

Read-only is not automatically nonsensitive: Lambda configuration can contain secrets and private bindings, code-download results can contain signed URLs, and logs can contain payloads. SDK projections are output filters, not IAM isolation. Keep these permissions in a trusted collector that emits an allowlist of booleans/hashes/counts; agents receive only that sanitized artifact. Do not publish raw environment/config/log JSON or signed URLs. Use a restricted diagnostic broker instead if that collector's exposure is unacceptable.

## Test identities and state isolation

Reuse the existing staging endpoints for public and approved nonmutating checks. Reserve four synthetic owners, one unapproved identity, one disabled identity, one outsider and one display identity for authenticated scenarios. Actual subjects must be verified privately at setup; passwords/tokens are not handoff artifacts. Accounts must be explicitly designated agent-owned QA accounts, not repurposed people or the existing five-person participant fixture.

Real hosted sign-in uses separate browser contexts and the app's authorization-code/PKCE path. Do not inject local signed tokens, browser storage sessions or mock `/userInfo` responses in live tests. Public app-client IDs are configuration, not credentials. [Cognito PKCE documentation](https://docs.aws.amazon.com/cognito/latest/developerguide/using-pkce-in-authorization-code.html).

Use precreated verified QA accounts for routine login tests. Test real signup/email verification separately with an explicitly authorized controlled QA mailbox/sender; admin-confirming a fixture does not test email delivery or real verification. Never weaken MFA or verification settings for automation. If the current configuration cannot support unattended QA login, record a blocked coverage item and prepare the exact configuration change.

**Important storage constraint:** `group-repository.ts` stores all accounts/groups in the shared `NP#GROUPS` / `STATE` item. A username prefix cannot make operator writes safe. IAM partition-key restrictions would still cover that entire item. [DynamoDB fine-grained key conditions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/specifying-conditions.html).

Recommended writable target: one separately approved, persistent QA API/Lambda deployment using the same tested release artifact, isolated decision/group tables and synthetic identity resources. Reuse the existing public builds for smoke; do not create a new stack per run. A dedicated QA frontend/client configuration is needed to test the complete QA browser journey against its own origin. A persistent QA stack incurs resources and requires an exact setup/cost authorization; provision it only when approved. Record any configuration differences from primary staging so QA results are not advertised as primary-staging verification.

An alternative fixture broker on shared staging requires explicit design/review: validate exact synthetic subjects, run lease and version-guarded mutations; reject arbitrary IDs, deletes and user-admin calls. Do not give a test role direct write access to the shared aggregate. Until either approach exists, shared staging remains public/read-only plus explicitly approved synthetic API interactions; broad admission/disable/reset tests stay blocked.

Namespace fixtures by run ID, serialize writable runs per target, and persist a lease/cleanup manifest. Current group capacity is bounded and per-group TTL cleanup is not implemented. Cleanup must remove only run-owned artifacts through a reviewed mechanism; tags and proposed expiration fields alone do not clean storage. A cleanup failure blocks the next writable run until resolved. Never reset/delete the existing staging table or another run's state.

Automated owners are simulations using fictional inputs. Each actor explicitly submits its own frame confirmation, interpretation confirmation, adjustment/disclosure decision and exact final approval. Organizer or service credentials never fabricate someone else's authority. This proves product enforcement for synthetic accounts, not real participant consent or human feedback.

## Agent workflow and scheduling

Use a coordinator agent to select an approved immutable source/target manifest, dispatch the appropriate GitHub job and summarize its sanitized result. Execution workers are bounded deterministic harnesses, with agents inspecting failures rather than improvising private inputs or granting themselves permissions. Suggested agent responsibilities:

| Agent/worker | Scope | Credential exposure |
| --- | --- | --- |
| Build verifier | Compare expected artifacts, public CDN bytes and deployment completion | Public HTTP; collector output for AWS metadata |
| Browser journey tester | Real Cognito UI, recipient links, mobile/keyboard flows, reload/reconnect | Only assigned synthetic identities inside trusted runner |
| API/privacy tester | JWT/role/owner/group denial, stale authority, idempotency and concurrency | Synthetic session tokens inside trusted runner; no operator identity |
| Live-model tester | Bounded fresh objective, structured output and exact simulated authority | Synthetic identities and server-enforced run budget |
| Evidence coordinator | Classify failures/limits, correlate build IDs and prepare a reproducible repair report | Sanitized summaries; no AWS credentials or raw participant artifacts |

A single human implementation claim still owns workflow/source changes. NP00 is neither taken over nor automatically closed. Agent test jobs may run concurrently only for independent public reads or isolated environments after the execution-policy amendment is approved. Shared writable QA and paid-model scenarios run sequentially. Agents must not repair/deploy cloud state automatically on a failed check. A code repair gets a bounded scope, local checks and a separately authorized release, then a rerun on its new artifact.

Proposed cadence, not an installed automation: post-deployment public/metadata checks; daily public/read-only drift check; manually dispatched authenticated qualification at first, becoming post-deployment only after fixtures/cleanup are stable. Paid-model and email lanes stay opt-in with an approved run budget. A deployment-specific acceptance run must finish even if a newer commit arrives; do not cancel a writable fixture run mid-cleanup. One lock covers deployment and qualification of a given target, or use immutable release aliases/targets so tests cannot race a deployment.

## Coverage and gates

| Lane | Required checks | Passing evidence |
| --- | --- | --- |
| L0: existing public builds | HTTPS/root/assets/MIME, unknown route behavior, missing chunks, uncaught browser errors, 390px/keyboard, correct static-versus-connected labels; no accidental owner data | Actual URL + index/asset hashes + sanitized screenshot/summary per registered target; no AWS credentials |
| L1: deployed artifact/config | Amplify terminal success, fetched bytes match released artifact; Lambda code hash/update state; correct API routes/JWT/CORS; Cognito callback/client compatibility; tables/schema; reviewed log/retention/model guard assertions | Frontend SHA, backend SHA/ZIP hash, target config revision and expected capability matrix agree. Test denied API status directly as well as browser behavior, because Gateway denial may lack Lambda CORS. |
| L2: real identity/API/persistence | Hosted sign-in/out, expired/invalid/wrong-client token denial, unapproved/disabled old session denial, intended-recipient/replaced/wrong-group links, nonmember/display owner-read/write denial, explicit frame commands, replay/races, persistence across new sessions | Real Cognito tokens and actual deployed API/table; no mocked transport. Model-dependent owner/draft/proposal calls excluded here unless separately budgeted. |
| L3: fresh live-model agreement | Public objective outside old demos; generated reviewed frame; four distinct owner needs; meaningful explicit concession; public explanation; all exact approvals; refused/unsupported/stale/revoked authority and disclosure independence | Actual Bedrock provider through the deployed app; complete typed snapshots and safe counts, separate scenarios/budgets for negative branches. Clarification is an honest result; never substitute fixture output to turn a live failure green. |
| L4: failure/cleanup qualification | Lost committed response retries the same envelope, warm/cold persistence, invitation expiry, kill switch/admission and timeout/provider failure, cleanup interruption | Controlled fault injection only in isolated QA; pre/post manifests and recovered authority. No shared Lambda restart/reconfiguration or service exhaustion. |

L2 can use explicitly preseeded reviewed public frames in isolated QA to test commands without model calls. Label that seeded coverage clearly; it does not prove draft creation or private interpretation. The production entrypoint currently does not expose a public injected-provider mode: do not assume an env toggle can enable deterministic cloud AI. L3 uses actual models; any separate test-only entrypoint would need its own scoped implementation and would not qualify primary live AI.

Add a **build identity manifest** to release artifacts and trusted test reports: repository SHA, frontend file hashes, backend ZIP/hash, contract/state compatibility, config version, target URL/resource IDs, deployment job ID and timestamp. Do not include secrets, subjects, permission IDs or private data. Compare the actual served bytes and actual Lambda hash before journeys. The Stage 0 preview retains its own manifest instead of matching current main. If the deployed version lacks NP group routes, report `FEATURE_NOT_DEPLOYED`, not PASS or a generic auth failure. No “all builds pass” result until every active registered target and required lane has a fresh passing receipt.

Managed persistence evidence needs more than a page reload: read the exact record through fresh sessions/new invocations, correlate persistence receipts, and in isolated QA exercise an authorized fresh Lambda version/environment against the same table. A warm invocation alone is not a cold-start test. Do not alter the existing NP00 function/configuration to obtain this evidence.

## Harness changes and evidence

Implement a separate `tests/live/` harness. Reuse NP04 lifecycle assertions and shared schemas, replacing `npApi`, cached JWKS, `npTransport` and route interceptions with real URLs/login flows. Existing `np-*` files remain deterministic regression evidence. Live tests must fail closed on a missing target, absent role, missing secret or provider substitution; optional lanes can be NOT_RUN but cannot make their requirement PASS.

Candidate files, to be created in a later implementation claim:

- `.github/workflows/live-staging-tests.yml`: trusted dispatch/post-release entry, scoped OIDC jobs, budgets, serialization and always-run cleanup.
- `scripts/live-tests/{targets,preflight,collect-manifest,fixtures,redact,report}.mjs`: exact target validation, bounded fixture lifecycle and strict reporting.
- `tests/live/{public-builds,auth-groups,lifecycle,privacy-recovery}.spec.ts`: real-browser/API tests, no local API interception.
- `infra/permissions/live-tests-*.json` and an isolated QA setup/runbook: reviewed role/resource/trust diffs, bootstrap/rollback and cleanup.
- `docs/live-test-results/<run-id>.json` or a sanitized GitHub artifact: evidence summaries; no repository transcript dumps. Raw artifacts never auto-commit.

Each summary records requested source SHA, actual frontend/backend hashes, environment/target, workflow run ID, suite version, lane/scenario counts, PASS/FAIL/BLOCKED/NOT_RUN, duration, provider-attempt/token counts where exposed, safe failure stage, cleanup status and limitations. Fixed allowlists replace public private-object spreads. Never infer a cloud PASS from npm check, an HTTP 200, or an LLM's summary.

No HAR/network-body dumps or full Playwright traces/storage state from authenticated runs. Disable credentialed tracing and secret screenshots by default; approve only selected post-login synthetic screens after redaction. Collector log scans retain bounded counts/marker matches without uploading log bodies. A scan failure blocks artifact upload. Credentials are masked before any command/output and destroyed with the runner; summaries and retained artifacts have a proposed seven-day retention. The repository is public, so treat even uploaded CI evidence as potentially public.

Budget defaults: paid model/email lanes disabled. Initial L3 smoke is planned around one architect call, four owner interpretations and two reasoning calls; reserve at most eight logical model operations, with separately approved provider-attempt/token/dollar ceilings and timeout. The implementation must count SDK/provider retries too, not just HTTP requests. Use server-side admission/budget enforcement for isolated QA; a workflow counter alone cannot stop hidden retries or concurrent calls. Budget alarms are supplementary, not a guaranteed hard cap. All additional refusal/clarification/fault branches need their own finite approved allocation. Zero blind paid retries. Every run has a bounded timeout and always-run cleanup; periodic reconciliation handles killed runners.

## Proposed implementation sequence

| Step | Deliverable and criterion | Access/setup dependency |
| --- | --- | --- |
| LAT01 | Target inventory/schema, pinned release manifest and on-demand public smoke harness, launchable by either collaborator | Repository-only implementation prepared under NP00; executing public requests needs approved scope |
| LAT02 | Exact observe-role/trust policy, protected workflow and sanitized collector; prove permitted reads and denied writes/wrong-repo trust | One-time authorized IAM/environment setup, then OIDC; no personal login per run |
| LAT03 | Isolated QA target, agent-owned identities, secret handling, lease/admission/cleanup mechanism and authority denial checks | Explicit setup/spending/identity-policy amendment; no unscoped aggregate writes |
| LAT04 | Real Cognito browser/API qualification, frame/persistence/replay/privacy tests; no model calls hidden in this lane | LAT02–LAT03; fixed synthetic identities and bounded writes |
| LAT05 | Paid fresh-group live-model scenarios, explicit simulated permissions/exact approvals and controlled fault cases | LAT04 plus exact paid budget/retention/fault authorization |
| LAT06 | Post-release/daily routing, clean summaries and failure triage; all active target receipts correlated to deployed artifacts | Earlier lanes stable; explicit recurring-run cadence and scope authorization |

These remain proposed substeps, not new claims or fabricated results. LAT01's repository-only preparation is recorded as a bounded scope amendment to the existing NP00 claim; that claim's owner and status are unchanged. The exact target records and public harness are linked below. LAT02–LAT06, live dispatch, cloud setup and paid/email runs remain unclaimed. Integrate any later approved steps into NP05 under one sequential implementation claim. Preserve NP00's claim and do not duplicate its closeout verdict.

## LAT01 target manifest and public smoke harness — prepared 2026-10-01

The [target manifest](../tests/live/targets.json) pins the two recorded public builds. Stage 0 is the static CloudFront preview at source commit `a6254989f04e194412c5682cee6073b502777645`, with three recorded frontend hashes. Connected Amplify staging is pinned to frontend source commit `bafa1d4e21cb6e29008dce76b6b52f8b146d6a5e`, five frontend file hashes and API base `https://u94iyvt6p9.execute-api.us-east-1.amazonaws.com`. Its deployed Lambda ZIP SHA-256 is `d5194b8da79250fbad2422ba948d4122654947941c20822ec58de768ef2f9b4f`, verified from AWS `CodeSha256` and the downloaded ZIP on 2026-10-01; the deployed receipt does not bind that ZIP hash to a source commit, so the manifest leaves that field null.

The [dedicated Playwright config](../playwright.live.config.ts) and [public smoke suite](../tests/live/public-smoke.spec.ts) cover HTTPS page/assets and content hashes, browser/console/network errors, a 390px viewport, keyboard focus or the static page's no-control behavior, and one unauthenticated decision API read expected to return 401. The exact command is `npx playwright test --config=playwright.live.config.ts tests/live/public-smoke.spec.ts`. The 2026-10-01 WSL local live run passed 10/10: both sites' page/assets and browser checks matched, and the unauthenticated API probe returned 401. Its first attempt caught a manifest keyboard label that reflected newer local source instead of deployed commit `bafa1d4`; the manifest now expects the observed deployed `Participant sign-in` button. The run sends only GET requests; it does not authenticate, write fixtures, collect response bodies, create screenshots/traces, deploy, invoke a model or send email. It is local public-target evidence, not yet the GitHub OIDC execution requested for shared checks.

Local LAT01 verification: manifest-only Playwright check 1/1; pinned Node 24.21.0/npm 11.19.0 clean-worktree `npm ci` had zero vulnerabilities; final `PLAYWRIGHT_CHANNEL=chromium npm run check` passed with 464 unit/integration tests, 2 optional DynamoDB Local skips, hosted 1/1 and E2E 53/53. One repeated existing NP04 retry-count race was fixed with a bounded wait in the existing assertion and the final full check passed. The separate 2026-10-01 WSL live public run passed 10/10. These results do not count as an L0 live receipt or as the requested GitHub OIDC run.

## Full journey mapped to existing NP04 assertions

The local tests are the assertion source for later live lanes. Their existing mocked transport, simulated operator, signed fixture sessions and injected model are not live evidence. LAT04/05 must replace those boundaries with real hosted Cognito/API access and, only in the separately budgeted model lane, the deployed provider.

| Journey step | Existing assertions to carry forward | Later live assertion and required actor |
| --- | --- | --- |
| Registration | `tests/e2e/np-onboarding.spec.ts`; `apps/api/src/group-service.test.ts` admission tests | A synthetic person completes Cognito signup and verified email in a controlled QA mailbox; the verified profile enters PENDING. Before admission, group/decision access is denied. Email delivery is its own opt-in lane. |
| Approval | `apps/api/src/group-service.test.ts` guarded approve/reject/disable cases; `tests/e2e/np-onboarding.spec.ts` currently calls a simulated operator | The trusted operator process approves the exact synthetic subject/version through the scoped CLI. Rejection and disable deny new calls and old access tokens. Browser participants never receive operator authority. |
| Invitations | `tests/e2e/np-onboarding.spec.ts`; `apps/api/src/group-service.test.ts` recipient binding, exact replay, replacement and expiry | An approved organizer issues links to the intended verified recipients. Correct accounts accept; wrong account, replaced, expired and replayed links fail. Acceptance changes membership only, not frame confirmation or consent. |
| Decision creation | `apps/api/src/group-decisions.test.ts` arbitrary roster, draft edit/replay and private-field rejection; `tests/e2e/np-onboarding.spec.ts` reviewed draft | The approved group creates a fresh decision from a public objective, reviews the exact draft and roster, and creates it. No fixed scenario, pre-seeded private needs or fabricated membership is used. |
| Private needs | `tests/e2e/np-qualification.spec.ts` independent frame confirmation and owner condition confirmation; `tests/integration/np-qualification.test.ts` private/public allowlist checks | Each owner confirms the same current frame, provides and reviews only their own fictional conditions, and explicitly confirms the selected interpretation. Other owners and public snapshots/logs contain no private canary. Live language interpretation uses the paid lane. |
| Negotiation | `tests/e2e/np-qualification.spec.ts` exact permission path; `tests/integration/np-qualification.test.ts` refusal, clarification and revoked-grant cases | The owner alone answers a precise adjustment request. Allow, decline, unsupported need, stale context and revoked permission retain their existing outcomes; a refusal is not asked again and cannot leak its owner. Model-dependent runs use the live-model budget. |
| Exact unanimous approval | `tests/e2e/np-qualification.spec.ts`; `apps/api/src/group-decisions.test.ts` generated frame/approval path | Every required owner inspects the same proposal ID, version and public hash, reviews their private part, and independently approves that exact proposal. Status becomes AGREED only after the last required approval; a changed/revoked proposal invalidates prepared approvals. New sessions reload the same agreement. |
| Cross-cutting recovery/privacy | `tests/integration/np-qualification.test.ts` stale roster, old approvals, audience separation, private canary rejection, fresh application/replay; `tests/e2e/np-qualification.spec.ts` retry/reconnect | Isolated QA proves denial, idempotent retry, persistence across fresh sessions, revision/revocation recovery and sanitized evidence. Restart/cold invocation uses an authorized isolated QA Lambda; no shared NP00 function mutation. |

Use one fresh run ID and one isolated group per writable run; serialize runs against the QA target through a lease. Keep success and negative branches separately counted so a refusal or clarification is not mistaken for an agreement. Reuse assertion semantics, not the fixture transport, fake approval call or scripted provider.

## Safe live-test setup and access sequence

1. LAT01 public checks use the pinned targets and unauthenticated HTTPS GETs only. The target manifest must be refreshed from current evidence before any later authenticated journey.
2. An observe-only GitHub OIDC role may read exact deployment metadata. A trusted collector emits only approved fields such as job status and artifact hashes; it never uploads raw Lambda configuration, signed URLs, logs, identity claims or payloads to the test worker.
3. Writable journeys wait for a persistent, separately approved QA deployment with isolated decision/group tables and synthetic Cognito identities. The existing group state is a shared aggregate item, so a username prefix or run ID cannot isolate writes to the existing Stage 1 table. Do not reset the NP00 function/table or use real people.
4. Use short-lived credentials from reviewed exact-repository/ref/workflow OIDC trust and protected environments. Keep deployment, observation, fixture setup, test identity reads and any runtime model permission in distinct roles. The existing Amplify deploy role cannot inspect or test the backend.
5. Use four or more fictional QA owner accounts plus named unapproved, disabled, outsider and display-only cases. Tokens/passwords stay in the trusted job process; never use mock browser storage or local route interception. Real signup email remains a separate controlled-mailbox run.
6. Give every writable run a lease and cleanup manifest that names only run-owned artifacts. Always-run cleanup removes only those artifacts through the reviewed QA mechanism. A cleanup failure blocks the next write run; it never triggers a broad table reset. No recurring dispatch begins until cleanup and identity denial are stable.

No OIDC role, protected environment, isolated QA stack, synthetic account set or cleanup broker is installed by this preparation. The current public harness is manual and credential-free.

## Separate model and email authorization budgets

Model evaluation and real email delivery remain separate opt-in lanes. Neither inherits permission from a successful public smoke or from the existing offline NP04 tests.

| Lane | Prepared initial scope | Budget fields required before authorization | Current state |
| --- | --- | --- | --- |
| Live model | One fresh synthetic group/objective; four owners; at most eight logical operations for drafting, four private interpretations and reasoning | Exact model/region; logical-call cap; provider-attempt/retry cap enforced server-side; input/output token ceilings; USD ceiling; timeout and retention; exact run count | Disabled. Eight logical calls are only the proposal's test-shape ceiling; provider, token and dollar caps are unset. |
| Real email | One controlled QA mailbox and only the signup/verification or invitation message being tested | Exact sender/domain and recipient allowlist; maximum message count; USD ceiling; test window; retention/deletion and retry limit | Disabled. Message and dollar budgets are unset; no messages sent. |

Before either lane runs, record the approving user, exact target and source/artifact manifest, one-run budget, expiration, and permitted scenarios in NP05. Model retry ceilings must include SDK/provider retries and be enforced in the application admission path; workflow counters and billing alarms are not hard caps. An email test never sends to a participant or other real person. A deployment or IAM change still requires its own explicit authorization.

## Decision needed before installation

Approve the concrete bootstrap package when it is prepared: exact roles/trust/resource ARNs; QA shared-versus-isolated design; synthetic identities/secret store; workflow dispatch rights; protected environment policy; cleanup/rollback; per-run and recurring budget; paid/email lane permissions. This is setup authorization, not a requirement for A to log in before every test. After setup, either collaborator's agent can dispatch the approved workload and obtain reproducible results using GitHub access alone.

Writing/committing this proposal performs none of those operations. Current NP05 remains unclaimed/blocked on authorized setup/live operations; NP00 remains IN_PROGRESS with its LAT01 scope amendment. Local NP01–NP04 DONE is not relabeled as cloud acceptance.
