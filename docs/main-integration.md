# Main integration — September 20, 2026 local

The user explicitly requested that existing A work and available B tasks be integrated onto main. This document is the current integration record; older task-branch references describe historical executions.

## Included work

- Foundation: `ca9fb636974030bfd8a620cec2b3d8581b3c8114`.
- A01 UI: `39c1885df7f00282884c26aad34782ee45f9913a`.
- Workflow/task refactor: `45aaf11` (former task/a01 tip).
- B01 solver, synthetic fixtures/demo and tests: `04c87d7` from origin/task/b01. Its recorded independent Astra review and historical test evidence are preserved in verification.md and task-execution.md.
- B02 is still in progress in B's clone, confirmed by the user during integration. No B02 implementation is available remotely; it is not merged, restarted or claimed complete.

## Conflict resolution and review

Conflicts were limited to README and documentation. Keep the new direct-model/main/transfer workflow, append B01's original execution and verification evidence, and update current status separately from historical claims. B's source/tests and A's source/tests are retained unchanged. A reviews B01's coordinated lockfile/TypeScript changes: only existing workspace dependencies and noEmit import-extension support; no external dependency or wire-contract changes.

## Working on main

Use main in separate clones for future tasks. Old task branches are historical pointers; do not continue new tasks there. They need not be deleted to make main authoritative. No branch deletion or force-push is part of this integration.

B must preserve its active B02 changes before synchronizing: save a commit or transferable diff including untracked files, then incorporate the new shared main when available and continue B02 once. Never reset an active clone. Existing B02 work should not be duplicated or abandoned merely to change branch names. Claim transfers and direct-model selection follow agent-workflow.md.

## Verification and publication

Verification finished at 2026-09-21T03:31:02Z, Node 24.21.0/npm 11.19.0 on macOS 12. `npm ci` passed. `npx playwright install chromium` could not install because this OS is unsupported; the already documented fallback used installed Google Chrome 150.0.7871.125.

`PLAYWRIGHT_CHANNEL=chrome npm run check` exited 0:

| Check | Result |
| --- | --- |
| Imported references | 7/7 unchanged |
| Planning arithmetic | 15/15 passed |
| Lint/import boundaries | Passed, 35 references |
| TypeScript | Passed |
| Unit tests | 120/120 in 6 files |
| Build/private-marker scan | Passed, 123 modules |
| Browser tests | 17/17 passed using installed Chrome |

`npm run demo --workspace @deal-table/test-support` also exited 0: 12 structural candidates, zero baseline feasible, two with the valid scoped exception; inconvenience B, balanced load A. Git comparisons confirm A’s app/browser files equal task/a01 and B’s domain/test-support/root integration files equal origin/task/b01. No contract/source rewrite was needed.

A01 and B01 are DONE under the user’s explicit integration direction and fresh combined checks. This does not close B02 or G01: the browser still uses mocks and no live API, authentication, persistence or cloud behavior is established.

The merge commit containing this record consolidates both histories on local main. No push has been performed by this integration session; origin/main remains unchanged until separately authorized publication. Old branches remain historical pointers. The later command/output reported to the user is authoritative for any subsequent push.
