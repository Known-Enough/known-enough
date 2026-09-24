# User B handoff — shared task pool

Current scheduling (September 23): both users follow the same [project-wide priority queue](task-board.md), with one active task at a time. G01 is DONE for its accepted local checkpoint. The divergent B04 lines have been unified locally with both histories preserved; B04 is fixing the bounded B04.5 P2 package-export/dependency-lock findings on `2dd036a`; independent follow-up follows the fix. Earlier PASSes apply to their named pre-merge artifacts only. A05 mock preparation remains REVIEW pending human acceptance. No cloud acceptance or publication follows from this integration.

Latest handoff, 2026-09-22: **A02.5/G01 synchronized repairs, REVIEW for human acceptance.** User explicitly authorized commit/push. Reviewed repairs are preserved in `d042d8f`; integration includes published `8371e7b`, shared-pool policy, readiness/debug changes and tutorial. [G01 combined artifact and evidence](reviews/G01.md) records conflict decisions, exact hashes, fresh checks and independent review. No B04 implementation or new task claim. Earlier paragraphs retain historical context.

Current integration: A01/workflow, B01 (04c87d7) and B02 (47b97eb) are consolidated on main at the user’s direction. See [integration results](main-integration.md) and [B02.5 review evidence](reviews/B02.5.md). B02 is no longer an active implementation claim; preserve any newer unshared changes before synchronizing.

B03 `27a110c` is now integrated on main by explicit user request. It provides local HTTP composition and fixed non-production test identities; see [API instructions](../apps/api/README.md). B03 remains REVIEW for live acceptance. A02.5/G01 retain their current ticket gates and follow-up review requirements. Real authentication/persistence remain B04 work. No new task is claimed.

## Selecting the next task

Check the project-wide queue and both users' latest claims. Either user gets the same highest-priority actionable task, regardless of A/B prefix. Do not start another task while one is active. Follow the [claim and transfer procedure](agent-workflow.md#shared-pool-claims-and-transfers), the ticket's model and file scope, and independent-review requirements.

A01 and the revised workflow are now included on main. If the clone has any changes beyond published B02, save them in a commit or transferable diff including untracked files before incorporating shared main. Do not reset or discard local work. Old task branches are historical; use main for subsequent tasks. No automatic access to A's clone or credentials exists. Shared log updates require authorized sharing; they are not live locks.

## Boundaries and acceptance

The recorded task claimant owns the agreed implementation scope. Coordinate overlapping files and shared contract/root edits before changing them; critical compatibility changes require independent review. Human acceptance is still required. Browser code imports contracts only, never backend/private fixtures. Public projections, independent consent, stale-version/idempotency enforcement and atomic acceptance retain their checks.

Use main in your separate clone for future work. Preserve any legacy branch/uncommitted work until authorized integration. No publication, push, PR, merge, deployment or paid-resource authorization is granted by this handoff. Actual auth/cloud/transaction results belong to later tested integration tasks, not mock preparation.

## B01 implementation facts for B02

Shared evidence records initial Sol implementation, Astra completion after a usage limit, and independent Astra review. B01’s historical full check passed 116 tests and two browser tests; fresh combined results are recorded separately in main-integration.md. `packages/domain` exports enumeration and `solveDecision`; `npm run demo --workspace @deal-table/test-support` runs the isolated fixture.

Wire contracts are unchanged. Internal owner `availabilityReview` binds confirmed coverage to context/input revision; B02 must obtain it from authoritative owner confirmation, never infer it from the schedule. Domain scores, candidate/grant references and clarification details remain server-only and must not enter public DTOs. B01 does not authenticate callers or finalize agreements.

B02 now implements availabilityReview from explicitly confirmed reviewedIntervals, independent consent, local solve jobs, replay checks and in-memory transaction isolation. Its imported independent Astra review found no remaining actionable findings after two regression fixes. Current combined verification and remaining HTTP/auth/cloud limits are recorded separately from B’s historical run.


## B04.5 fresh independent review handoff — 2026-09-23T20:21:21Z

Configured `gpt-6-astra` / high review of `b91ff76..98877e1`: **CHANGES_REQUESTED**. R6 passes; R5b must reserve the future disclosure response before its parent exception offer is issued. Preserved the interrupted attempt and recorded the explicit handoff. [Review evidence](reviews/B04.5.md) contains precise scope, hashes, checks and required future regression. Review claim finished; B04 stays PAUSED until owner A claims the bounded correction. No implementation or cloud acceptance, commit or publication.


## B04.5 final design follow-up — 2026-09-23T20:33:46Z

**PASS on `5297118` for the local midpoint design** from the configured independent `gpt-6-astra` / high reviewer. Full response-path reservation and atomic transfer close R5b; R6 remains closed. [Evidence and outstanding implementation/live gates](reviews/B04.5.md). Review claim finished; B04 design gate cleared, with sequential implementation resumption next. No design/code edits, commit, publication or live acceptance.


## B04.5 fresh R10 follow-up — 2026-09-23T22:38:42Z

**PASS on `f88b4a0..b78aab9`**. Independent configured gpt-6-astra / high reviewed the classifier, both callers, exact new/old tests and owner full-check evidence. R10 closed; R7–R9 remain closed. Fresh adapter suite **21/21** and **35 classifier assertions** passed, with references 7/7 and planning 15/15. [Review evidence](reviews/B04.5.md) records exact hashes and limits. Reviewer claim finished; B04 stays PAUSED with this code gate cleared pending owner resumption. Remaining implementation, final review, human acceptance and G02/live gates still apply. No implementation edits, live cloud acceptance or publication.
