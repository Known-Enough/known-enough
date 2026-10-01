# Live automated plan tests

Proposal requested on 2026-10-01. Status: PROPOSED; no test infrastructure installed and no live run performed. B / verified Battosai1806; actual GPT-6 variant/effort unexposed. Repository baseline: `28845f8`. This is a proposed execution path for [NP05](tasks/NP05.md), preserving NP00's active claim and historical evidence.

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

The Amplify workflow already assumes `KnownEnoughAmplifyMainDeploy` through GitHub OIDC for 15 minutes. Its existing policy permits deployment/job status only for this app/branch; it cannot inspect or test the backend. Local CI and NP04 do not exercise actual cloud identity, deployed routes or managed persistence. NP01–NP04 pushes used `[skip ci]`; latest source is not assumed deployed. A green Amplify job alone proves neither the correct Lambda artifact nor a working user journey. Recorded cleanup tags (Stage 0: 2026-10-04; Amplify: 2026-10-29) are reminders, not automatic deletion; include resource existence/expiry in target inventory and clarify ownership before renewing or removing resources. Recorded cleanup tags (Stage 0: 2026-10-04; Amplify: 2026-10-29) are reminders, not automatic deletion; include resource existence/expiry in target inventory and clarify ownership before renewing or removing resources.

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
| LAT01 | Inventory/target schema, public-build harness and exact release manifests; checks run from CI and can be launched by either collaborator | Repository-only implementation; actual test dispatch/public traffic scope approved |
| LAT02 | Exact observe-role/trust policy, protected workflow and sanitized collector; prove permitted reads and denied writes/wrong-repo trust | One-time authorized IAM/environment setup, then OIDC; no personal login per run |
| LAT03 | Isolated QA target, agent-owned identities, secret handling, lease/admission/cleanup mechanism and authority denial checks | Explicit setup/spending/identity-policy amendment; no unscoped aggregate writes |
| LAT04 | Real Cognito browser/API qualification, frame/persistence/replay/privacy tests; no model calls hidden in this lane | LAT02–LAT03; fixed synthetic identities and bounded writes |
| LAT05 | Paid fresh-group live-model scenarios, explicit simulated permissions/exact approvals and controlled fault cases | LAT04 plus exact paid budget/retention/fault authorization |
| LAT06 | Post-release/daily routing, clean summaries and failure triage; all active target receipts correlated to deployed artifacts | Earlier lanes stable; explicit recurring-run cadence and scope authorization |

These are proposed substeps, not newly claimed tasks or fabricated results. Implement LAT01 first, while preparing LAT02's policy diff for approval. Integrate approved steps into NP05 under one sequential implementation claim. Coordinate any NP00-owned artifact/check before execution; preserve its claim and do not duplicate its closeout verdict.

## Decision needed before installation

Approve the concrete bootstrap package when it is prepared: exact roles/trust/resource ARNs; QA shared-versus-isolated design; synthetic identities/secret store; workflow dispatch rights; protected environment policy; cleanup/rollback; per-run and recurring budget; paid/email lane permissions. This is setup authorization, not a requirement for A to log in before every test. After setup, either collaborator's agent can dispatch the approved workload and obtain reproducible results using GitHub access alone.

Writing/committing this proposal performs none of those operations. Current NP05 remains unclaimed/blocked on authorized setup/live operations, NP00 remains unchanged, and local NP01–NP04 DONE is not relabeled as cloud acceptance.
