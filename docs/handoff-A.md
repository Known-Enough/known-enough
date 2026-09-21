# Developer A handoff — parallel frontend preparation

Use the direct model/effort printed in the [ticket](task-board.md); no Astra manager is required. Start with A02 (Terra medium), or choose A03/A06 (Luna medium) as ready alternatives. Read [workflow](agent-workflow.md) and [A log](work-log-A.md), then claim one task. No new A implementation has been started by this planning update.

## Existing A01 evidence

A01 is included in the user-authorized main integration; see [current results](main-integration.md). Historical implementation: task/a01 based on ca9fb636974030bfd8a620cec2b3d8581b3c8114; Terra/high implemented UI/adapters/unit tests, Astra integrated and reviewed. Its separate validated public/owner mocks, lazy owner screen, loading/empty/failure/stale states, local draft controls and separate consent feedback remain intact. Owner demo identity is not authentication. See [dated verification](verification.md#a01-verification--september-20-2026).

Historical file scope: apps/web/src, tests/e2e, supporting documentation and explicit installed-Chrome fallback in playwright.config.ts. Contracts, dependencies and lockfile were unchanged. The later user-authorized main integration supersedes its old pending-branch state; historical checks remain dated evidence. Its existing implementation now enables independent frontend preparation.

## Next work and transfer

A02 implements client/forms against v1 contracts and intercepted/injected transport. A03 adds receipt/accessibility preparation. A06 prepares demo/trial/setup drafts. These no longer wait for B02/G01. A03.5 reviews frontend boundaries; A02.5 retains real API verification with B03, followed by G01. A04/A05 preparation can then proceed independently of the later backend implementation; their .5 tickets retain live verification.

B01 source and prior review evidence are now included from 04c87d7. B02 source and final independent review evidence are also available from 47b97eb; the user authorized their integration. B must not restart those tasks. B has standing authorization to implement an available A task when A lacks tokens, after finishing/pausing its own task and recording the claim or explicit transfer. Active A work needs a saved diff/commit and a release; never infer release from silence. B records its work in [B log](work-log-B.md).

This checkout uses main. A01, the workflow refactor and B01/B02 work are consolidated at the user’s direction; historical branches are retained without new work. See [integration/publication state](main-integration.md). Future tasks use main in separate clones and retain their review/authorization gates.

B02 compatibility: owner snapshots require availabilityReview, and CONFIRM_INPUTS requires explicit reviewedIntervals. A02 must collect owner-reviewed coverage; it must not infer it from all schedule options. A01’s synthetic owner adapter is updated during integration; public DTOs are unchanged.
