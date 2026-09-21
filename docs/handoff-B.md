# Developer B handoff — continue B02; frontend coverage available

User update, September 20, 2026: B01 is done and B02 is in progress. These are reported facts from B's work, not locally verified code/results. Preserve both; do not restart B01 or interrupt/reassign B02. Append actual commits/model/test evidence in [B log](work-log-B.md) when available.

B02 retains its Astra/high assignment and existing application, in-memory repository, projections and consent scope. At its next reviewable slice, prepare [B02.5](tasks/B02.5.md) for an independent Astra review of actual code/tests and logs. Review remaining critical changes before B03 integration acceptance. B03 uses Terra/medium; the [board](task-board.md) shows downstream work and midpoint B04.5.

## More capacity can cover frontend work

The user explicitly authorizes B to take eligible A tasks. First finish or safely pause the active implementation task, synchronize current claims, then claim a READY unclaimed task or an explicitly released task. A02 (Terra medium), A03 (Luna medium) and A06 (Luna medium) are initial candidates; this handoff does not claim them for B. If A is actively editing, obtain a release and exact saved work before resuming. Follow [the transfer procedure](agent-workflow.md#b-can-cover-a-when-capacity-changes), the selected ticket's file limits/tests and its model assignment. B's larger token budget does not imply using Astra for routine frontend work.

A01 implementation is available in A's legacy task/a01 checkout with human acceptance pending; before editing frontend in B's clone, obtain the relevant implementation through authorized integration or a reviewable transfer. No automatic access to A's clone or credentials exists. Shared log updates require authorized sharing; they are not live locks.

## Boundaries and acceptance

B remains backend/contracts steward; A remains frontend/root steward. Claims transfer implementation ownership. Coordinate shared contract/root edits before changing them; a separate Astra reviewer can cover technical compatibility if A lacks capacity. Human acceptance is still required. Browser code imports contracts only, never backend/private fixtures. Public projections, independent consent, stale-version/idempotency enforcement and atomic acceptance retain their checks.

Use main in your separate clone for future work. Preserve any legacy branch/uncommitted work until authorized integration. No publication, push, PR, merge, deployment or paid-resource authorization is granted by this handoff. Actual auth/cloud/transaction results belong to later tested integration tasks, not mock preparation.
