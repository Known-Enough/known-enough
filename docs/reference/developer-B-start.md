# Developer B — first task after shared bootstrap

Use this only after Developer A's F00–F02 bootstrap has been shared and reviewed. Work from the same accepted baseline in your own local clone and task branch. You do not need access to RkLop's original absolute source paths; use the copied repository files.

Read AGENTS.md, docs/Deal-Table-TeamTable-plan.md, docs/Deal-Table-two-developer-architecture.md, docs/contracts.md, and the B01 task file. Inspect Git status and preserve existing work. Confirm that the shared contract baseline exists before beginning; if missing, request A's bootstrap instead of creating a second scaffold.

Implement B01 only: the pure deterministic solver and ranking policies, with independent tests. Own packages/domain and relevant server-side test fixtures. Do not edit apps/web, root manifests/lockfile, or agreed contracts without coordinating with A. Record an interface/dependency request if needed instead of silently changing the contract.

Acceptance:

- Exactly 12 structural plans for the documented synthetic fixture.
- Zero feasible plans without Nina's express scoped exception.
- Exactly two with a current, valid exception binding Thursday 11:00, 30 minutes, and no weekend duties for Nina.
- Hard conditions never relaxed; double-duty assignments and unqualified roles rejected.
- Wrong-context, expired, revoked, changed-duration, and Nina-duty cases do not pass the exception predicate.
- Declared-inconvenience policy chooses B; balance-load policy chooses A; tie-breaking deterministic.
- Optional disclosure refusal does not change feasibility.
- Hard-impossible and zero-concession-success variants tested.
- Clock and context are explicit inputs; no AWS, React, model calls, or implicit system-time dependency in the pure domain.
- Dates, timezone, and full supported meeting interval are validated; unknown availability requires confirmation.

Run the production-domain tests plus the existing planning reference script, typecheck, and applicable build/lint checks. Do not copy production logic into the expected-value oracle. The existing planning script is evidence about the example, not an adequate replacement for your tests.

Do not publish or merge automatically. Finish with review-ready changes and a concise handoff: changed files, expected outputs, commands and actual results, contract requests, and any untested cases. Leave B02 for a separate bounded task after review.
