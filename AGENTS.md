# Deal Table working agreement

Read docs/Deal-Table-TeamTable-plan.md for product semantics and docs/Deal-Table-two-developer-architecture.md for ownership/sequencing. Imported references are immutable; contracts.md and decisions.md describe the implementation baseline. Read the assigned docs/tasks ticket before edits; preserve existing work.

A owns apps/web, browser tests, root configuration, lockfile and CI. B owns backend/domain/adapters/infra and packages/contracts after bootstrap; A reviews breaking contracts. Coordinate cross-lane changes. One task branch and active task per developer; separate clones. Do not spawn cross-account agents.

For every task, use GPT-6 Astra as the working lead and read docs/agent-workflow.md. The user explicitly authorizes Astra to choose and spawn available local subagents (including their model/reasoning effort) for bounded subtasks without per-spawn confirmation. Astra may work directly when delegation adds no value; it retains integration, verification and handoff responsibility. This is same-session delegation, not cross-account access. Preserve task gates and human review; these instructions do not switch the selected session model.

Never import server fixtures or backend code into the browser. Public snapshots are strict allowlists, never private object spreads. No real personal data, secrets, private conditions, grant IDs or refusal details in public payloads/logs. Verified server identity must determine the owner; mock identities are not authentication.

Exception, disclosure and final acceptance are independent permissions. Semantic revisions supersede old consent; control versions guard concurrent changes. A public plan hash contains only public facts and an opaque context token. Hash/schema checks are not authorization or transaction enforcement.

Use Node/npm pinned in .nvmrc/package.json. Run npm run check (install Playwright Chromium first); it includes references, arithmetic, lint, typecheck, unit tests, build and browser smoke tests. Record actual evidence. No solver/application behavior in F00–F02.

Do not publish, push, open PRs, merge, deploy, create paid resources or spend money without explicit user authorization. Mark tasks REVIEW until human review/integration; do not claim unrun cloud/auth tests passed.
