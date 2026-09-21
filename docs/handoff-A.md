# Developer A handoff — parallel frontend preparation

Use the direct model/effort printed in the [ticket](task-board.md); no Astra manager is required. Start with A02 (Terra medium), or choose A03/A06 (Luna medium) as ready alternatives. Read [workflow](agent-workflow.md) and [A log](work-log-A.md), then claim one task. No new A implementation has been started by this planning update.

## Existing A01 evidence

A01 is REVIEW. Historical implementation: task/a01 based on ca9fb636974030bfd8a620cec2b3d8581b3c8114; Terra/high implemented UI/adapters/unit tests, Astra integrated and reviewed. Its separate validated public/owner mocks, lazy owner screen, loading/empty/failure/stale states, local draft controls and separate consent feedback remain intact. Owner demo identity is not authentication. See [dated verification](verification.md#a01-verification--september-20-2026).

Historical file scope: apps/web/src, tests/e2e, supporting documentation and explicit installed-Chrome fallback in playwright.config.ts. Contracts, dependencies and lockfile were unchanged. This refactor does not accept A01 for the human or repeat its old tests as new evidence. Its existing implementation now enables independent frontend preparation.

## Next work and transfer

A02 implements client/forms against v1 contracts and intercepted/injected transport. A03 adds receipt/accessibility preparation. A06 prepares demo/trial/setup drafts. These no longer wait for B02/G01. A03.5 reviews frontend boundaries; A02.5 retains real API verification with B03, followed by G01. A04/A05 preparation can then proceed independently of the later backend implementation; their .5 tickets retain live verification.

The user reports B01 complete and B02 active elsewhere; this clone has no corresponding implementation/evidence. B must not restart those tasks. B has standing authorization to implement an available A task when A lacks tokens, after finishing/pausing its own task and recording the claim or explicit transfer. Active A work needs a saved diff/commit and a release; never infer release from silence. B records its work in [B log](work-log-B.md).

Future work uses main in separate clones, with no task-branch requirement. This checkout still preserves the legacy task/a01 branch; no checkout/merge/push is authorized by the documentation refactor. Human acceptance and authorized integration remain the final steps before sharing reviewed work.
