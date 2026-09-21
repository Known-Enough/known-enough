# Developer B handoff — B03 integrated; live integration next

Current integration: A01/workflow, B01 (04c87d7) and B02 (47b97eb) are consolidated on main at the user’s direction. See [integration results](main-integration.md) and [B02.5 review evidence](reviews/B02.5.md). B02 is no longer an active implementation claim; preserve any newer unshared changes before synchronizing.

B03 `27a110c` is now integrated on main by explicit user request. It provides local HTTP composition and fixed non-production test identities; see [API instructions](../apps/api/README.md). B03 remains REVIEW for live acceptance. A02.5/G01 depend on resolving the existing A03.5 frontend findings; this integration does not close them. Real authentication/persistence remain B04 work. No new task is claimed.

## More capacity can cover frontend work

The user explicitly authorizes B to take eligible A tasks. First finish or safely pause the active implementation task, synchronize current claims, then claim a READY unclaimed task or an explicitly released task. A02 (Terra medium), A03 (Luna medium) and A06 (Luna medium) are initial candidates; this handoff does not claim them for B. If A is actively editing, obtain a release and exact saved work before resuming. Follow [the transfer procedure](agent-workflow.md#b-can-cover-a-when-capacity-changes), the selected ticket's file limits/tests and its model assignment. B's larger token budget does not imply using Astra for routine frontend work.

A01 and the revised workflow are now included on main. If the clone has any changes beyond published B02, save them in a commit or transferable diff including untracked files before incorporating shared main. Do not reset or discard local work. Old task branches are historical; use main for subsequent tasks. No automatic access to A's clone or credentials exists. Shared log updates require authorized sharing; they are not live locks.

## Boundaries and acceptance

B remains backend/contracts steward; A remains frontend/root steward. Claims transfer implementation ownership. Coordinate shared contract/root edits before changing them; a separate Astra reviewer can cover technical compatibility if A lacks capacity. Human acceptance is still required. Browser code imports contracts only, never backend/private fixtures. Public projections, independent consent, stale-version/idempotency enforcement and atomic acceptance retain their checks.

Use main in your separate clone for future work. Preserve any legacy branch/uncommitted work until authorized integration. No publication, push, PR, merge, deployment or paid-resource authorization is granted by this handoff. Actual auth/cloud/transaction results belong to later tested integration tasks, not mock preparation.

## B01 implementation facts for B02

Shared evidence records initial Sol implementation, Astra completion after a usage limit, and independent Astra review. B01’s historical full check passed 116 tests and two browser tests; fresh combined results are recorded separately in main-integration.md. `packages/domain` exports enumeration and `solveDecision`; `npm run demo --workspace @deal-table/test-support` runs the isolated fixture.

Wire contracts are unchanged. Internal owner `availabilityReview` binds confirmed coverage to context/input revision; B02 must obtain it from authoritative owner confirmation, never infer it from the schedule. Domain scores, candidate/grant references and clarification details remain server-only and must not enter public DTOs. B01 does not authenticate callers or finalize agreements.

B02 now implements availabilityReview from explicitly confirmed reviewedIntervals, independent consent, local solve jobs, replay checks and in-memory transaction isolation. Its imported independent Astra review found no remaining actionable findings after two regression fixes. Current combined verification and remaining HTTP/auth/cloud limits are recorded separately from B’s historical run.
