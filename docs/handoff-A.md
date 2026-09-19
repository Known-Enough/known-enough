# Developer A handoff — A01 next

Select **GPT-6 Astra** as lead; follow [agent-workflow.md](agent-workflow.md). Astra chooses available local subagents and verifies their integrated work. Start by asking: “Read AGENTS.md and execute docs/tasks/A01.md within its scope and dependency gates.”

F00–F02 establishes the reviewed candidate foundation: npm workspaces, public React scaffold, Zod contract v1, examples, canonical public SHA-256, import boundaries and credential-free CI. See README and docs/verification.md. No commit or remote exists; this is the local uncommitted bootstrap on main, awaiting human review/integration. Share an accepted baseline snapshot with B before separate task branches.

Start docs/tasks/A01.md: build shared-table and personal screens with mock API adapters, loading/error/stale states, keyboard navigation and mobile layout. Relevant files: apps/web/src/App.tsx, mock-adapter.ts, mocks/public, tests/e2e, docs/contracts.md. Keep private owner mock values isolated from the shared surface; current examples are synthetic, not authentication or solver output.

Contract baseline: schemaVersion 1, package 0.1.0; strict PublicRoomSnapshot/OwnerSnapshot, CommandEnvelope/Result, independent permissions, expected context/control versions and exact proposal hashes. B owns contracts after bootstrap; coordinate changes before consuming them.

A owns root config/lockfile/CI and web/browser tests. Reserve domain, application, API, workers, adapters and infra for B. Do not implement server permission logic in UI. A02 real integration depends on B02 and B03; A01 requires accepted F02.

Acceptance: mock shared/owner flows, safe error/stale handling, no private values in public snapshots, keyboard/mobile checks plus npm run check. Bootstrap evidence: 49 unit tests, 2 Chromium tests, 15 arithmetic checks, lint/typecheck/build and 7 reference checks passed. Backend identity, expiry and concurrency remain unimplemented.
