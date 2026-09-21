# Developer B handoff — continue B02; frontend coverage available

Current integration: B01 source and its prior verification/review evidence are included from 04c87d7 alongside A01/workflow changes on main. The user confirms B02 is still in progress in B’s clone. Preserve that active work; do not restart B01 or interrupt/reassign B02. See [integration results and publication state](main-integration.md).

B02 retains its Astra/high assignment and existing application, in-memory repository, projections and consent scope. At its next reviewable slice, prepare [B02.5](tasks/B02.5.md) for an independent Astra review of actual code/tests and logs. Review remaining critical changes before B03 integration acceptance. B03 uses Terra/medium; the [board](task-board.md) shows downstream work and midpoint B04.5.

## More capacity can cover frontend work

The user explicitly authorizes B to take eligible A tasks. First finish or safely pause the active implementation task, synchronize current claims, then claim a READY unclaimed task or an explicitly released task. A02 (Terra medium), A03 (Luna medium) and A06 (Luna medium) are initial candidates; this handoff does not claim them for B. If A is actively editing, obtain a release and exact saved work before resuming. Follow [the transfer procedure](agent-workflow.md#b-can-cover-a-when-capacity-changes), the selected ticket's file limits/tests and its model assignment. B's larger token budget does not imply using Astra for routine frontend work.

A01 and the revised workflow are now included on main. Before synchronizing B’s active clone, save B02’s work in a commit or transferable diff including untracked files, then incorporate the shared main when available. Do not reset or discard B02. Old task branches are historical; use main for subsequent tasks. No automatic access to A's clone or credentials exists. Shared log updates require authorized sharing; they are not live locks.

## Boundaries and acceptance

B remains backend/contracts steward; A remains frontend/root steward. Claims transfer implementation ownership. Coordinate shared contract/root edits before changing them; a separate Astra reviewer can cover technical compatibility if A lacks capacity. Human acceptance is still required. Browser code imports contracts only, never backend/private fixtures. Public projections, independent consent, stale-version/idempotency enforcement and atomic acceptance retain their checks.

Use main in your separate clone for future work. Preserve any legacy branch/uncommitted work until authorized integration. No publication, push, PR, merge, deployment or paid-resource authorization is granted by this handoff. Actual auth/cloud/transaction results belong to later tested integration tasks, not mock preparation.

## B01 implementation facts for B02

Shared evidence records initial Sol implementation, Astra completion after a usage limit, and independent Astra review. B01’s historical full check passed 116 tests and two browser tests; fresh combined results are recorded separately in main-integration.md. `packages/domain` exports enumeration and `solveDecision`; `npm run demo --workspace @deal-table/test-support` runs the isolated fixture.

Wire contracts are unchanged. Internal owner `availabilityReview` binds confirmed coverage to context/input revision; B02 must obtain it from authoritative owner confirmation, never infer it from the schedule. Domain scores, candidate/grant references and clarification details remain server-only and must not enter public DTOs. B01 does not authenticate callers or finalize agreements.
