# LIVE01 — Build the online setup package

- Status: DONE — setup package prepared and locally verified; actual installation/service proof remains LIVE04.
- Intended worker: B / Battosai1806, separate clone; record actual worker/model/effort and baseline at claim. Suggested direct target: gpt-6-sol / high, selected by the human.
- Prerequisite: Clean ff-only main and claim/scope check under the [delivery scheduling exception](../live-test-delivery.md#scheduling-and-ownership).
- Outcome: One complete repeatable package A can install, rather than separate exploratory administrator instructions.

## Bounded preparation scope

New `infra/live-qa/`, `scripts/live-qa/`, `docs/live-qa-setup.md`, setup regression tests under `tests/integration/live-qa-*`, this ticket and B log/handoff. Name exact files before edits. Read existing NP05 plans, group operator and artifact builders; coordinate amendments for any shared source/config/root/dependency changes. Preserve all NP00-owned files.

## Deliverables and completion

1. Render exact primary feature rollout and persistent isolated QA resources/configuration from verified source artifacts. Cover frontend, backend, group/decision storage, API routes, Cognito, separate roles/trust and narrowly scoped secret storage. Inventory existing resources; reuse only after exact compatibility checks. QA uses the same executable artifacts; record target differences.
2. Prepare automatic setup and teardown for dedicated fictional owner/pending/rejected/disabled/outsider/display identities. Provide a runner-only operator path limited to those identities and isolated data, secure login retrieval and controlled verification-mailbox configuration. No personal A/B passwords or general user administration supplied to agents.
3. Implement run leases and exact run-owned cleanup, including partial failure/retry. The group aggregate requires separate QA storage; prefix-only isolation is insufficient. Never reset primary/shared records. Cleanup failure blocks the next writable run.
4. Produce one CloudShell entry command pinned to the verified package commit, with dry-run/validate/apply/readback modes, account/region guards, full-config preservation, revision/concurrency checks, idempotent retry, private secret handling and rollback. Fresh secret values remain private. Automatically validate final setup; do not ask the human to manually judge JSON or screenshots.
5. Give one clear setup page: where to click, the single entry command, expected success/failure and exact recovery. Include resource/cost estimate and concrete configurable authorization fields for AI/email recurring ceilings and expiry. Keep unapproved lanes off; do not invent budget authorization.
6. Test renderer/resource/permission boundaries and cleanup safety locally. Run focused checks and pinned npm run check for executable changes; reference/link/consistency checks for docs. Record real preparation evidence and limitations.

DONE means the complete package is prepared and locally verified, with exact implementation files and setup scope documented. Installation and real account/service proof belong to LIVE04. No AWS writes, paid resources, email, paid AI, deployment or participant actions are authorized by this ticket. Repository sync uses [skip ci]. Continue to [LIVE02](LIVE02.md).

## Claim — 2026-10-01

B / verified Battosai1806, Windows/WSL separate clone; actual GPT-6 variant/effort unexposed. Clean ff-only main a25a77e, ahead/behind 0/0. Exact bounded files: new infra/live-qa/{config.example.json,authorization.example.json}; scripts/live-qa/{config.mjs,template.mjs,aws.mjs,install.mjs,package.mjs,setup.sh,broker.mjs,fixture-core.mjs,budget.mjs,entry.ts,package.json,package-lock.json}; new tests/integration/live-qa-setup.test.ts and docs/live-qa-setup.md; this ticket and own B log/handoff. No root/lock/app/NP00/shared-inspector/shared-deployment changes. Private generated packages/configuration stay outside Git. LIVE04 retains actual installation/service proof and concrete spending/recipient/domain authorization. Repository checkpoint/source sync uses [skip ci].

Scope clarification before edits: include new scripts/live-qa/budget.d.mts for typed imports and primary.mjs for full-config-preserving primary rollout/rollback; no existing root/app/NP00 file edits. New QA wrapper uses the existing real provider port with a server-side budget, retaining the unmodified production handler in the same bundled artifact.

## Completion — 2026-10-01

B / Battosai1806, actual GPT-6 variant/effort unexposed. Isolated CloudFormation resources, real application/provider package, controlled SES verification mailbox, broker-only synthetic identities/admission, private login retrieval, leases, server-side per-attempt/per-run/per-day reservation, exact cleanup/retry and guarded primary rollout/rollback are implemented. [Setup and recovery](../live-qa-setup.md) describes the single commit-pinned CloudShell entry, authorization fields, costs, modes and target differences. QA frontend build/publication is automated; primary frontend source publication and complete release comparison are LIVE03/LIVE04. Primary models stay disabled under NP00's hold.

Focused setup tests 12/12; final pinned npm run check exit 0: 480 passed / 2 optional DynamoDB Local skips, hosted 1/1, E2E 53/53, references 7/7, planning 15/15, lint/typecheck/builds pass. Shell syntax, final scoped lint/tests, local Markdown targets and whitespace pass. Deterministic package build succeeds: api.zip SHA-256 8058b7353ff231f2f704b41254d8a31ce91bb0d5b1ee649d428ea4e1f6b18768; broker.zip 8a6702dbf43e20bf1bd26e1c92184003f6b7b9afe7ca1b5b292331107aa202d1. Package test runs used uncommitted candidate source with source-file hashes; installation requires the committed clean release SHA. No AWS operation, fixture account, model/email call, workflow dispatch or deployment performed. CloudFormation/IAM/mail eligibility, actual retry/cleanup/rollback and release readback remain LIVE04. Pulled A's independent shared-inspector PASS documentation at 044b405 without NP00 changes. A maintains the shared board during overlap. Next eligible B preparation is LIVE02.
