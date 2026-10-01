# LIVE01 — Build the online setup package

- Status: READY — preparation only, unclaimed.
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
