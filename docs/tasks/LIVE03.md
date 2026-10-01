# LIVE03 — Run checks after every deployment

- Status: BLOCKED — LIVE02 preparation required; unclaimed.
- Intended worker: B / Battosai1806, separate clone; record actual model/effort/baseline. Suggested direct target: gpt-6-sol / high.
- Outcome: One GitHub result automatically follows each authorized deployment; A/B can also launch it themselves.
- Policy: [Live delivery](../live-test-delivery.md).

## Bounded preparation scope

New `.github/workflows/live-qa-*.yml`, new release-receipt/report/runner files under `scripts/live-qa/` and `infra/live-qa/`, `docs/live-qa-automation.md`, this ticket and B log/handoff. Existing frontend deploy workflow may be amended only after recording exact coordinated scope; preserve A's shared-inspection workflow/scripts and NP00 fixes. Any new backend/QA deployment workflow belongs to the reviewed LIVE01 resource/artifact scope.

## Deliverables and completion

1. Add manual main-only dispatch for A/B and an automatic path following successful authorized GitHub deployment, readiness and release receipt. Support the approved frontend/backend QA release paths; the current Amplify workflow only deploys the frontend. Publish the same verified release artifacts to the isolated QA target before its journeys and label target differences.
2. Bind test runs to upstream immutable SHA and verified artifact digests/deployment receipt. Preserve independent expected-release evidence; never accept arbitrary newly observed bytes as expected. Serialize target mutation/testing and handle superseded deployments honestly.
3. Credentials exist only in trusted narrowly scoped jobs. Pin actions, verify exact repository/ref/workflow provenance, reject fork/PR execution with credentials, and if using workflow_run never execute untrusted uploaded code. Keep test-login and fixture/operator permissions separate from deploy/inspection grants.
4. Run public checks, metadata/configuration checks, LIVE02 real journeys/screens, always-run cleanup and sanitized report generation. Reuse A's stable inspector interface read-only; if its fix remains pending, record that integration dependency without taking over its files.
5. Report lane statuses, tested source/artifacts/targets, assertion counts, blocked coverage, failures and cleanup status. Required failed/blocked/missing lanes fail complete qualification; job-level continue-on-error must not hide them. Distinguish report availability from test PASS.
6. After installed authorization, routine runs have no human reviewer/environment prompt, personal AWS login, participant approval, mailbox handling or manual visual check. Enforce preapproved per-run/per-period AI/email envelope and expiry; depleted authorization blocks those lanes. No automatic paid/email calls before setup authorization.
7. Test workflow provenance/trigger/failure handling and report classification; run focused and pinned npm run check for executable changes. Provide A/B launch/read instructions and exact installation inputs. Keep workflows inactive or guarded until LIVE04 installation; sync preparation using [skip ci].

DONE means automation is prepared and locally verified. Actual post-deployment trigger and B-account access are proven in LIVE04, not inferred from YAML. No deployment/cloud/paid/email operation is authorized here. Continue to [LIVE04](LIVE04.md).
