# Developer A handoff — A01 review, A02 next

Select **GPT-6 Astra** as lead and follow [agent-workflow.md](agent-workflow.md). A01 used `gpt-5.6-terra` with high reasoning for UI/adapters/unit tests; Astra integrated the changes, independently reviewed the public/owner boundary and consent UI, and owns browser verification and handoff.

A01 is on `task/a01`, based on foundation-review commit `ca9fb636974030bfd8a620cec2b3d8581b3c8114`. The user authorized this task on September 20 after that foundation reached remote main. Human review of A01 remains required.

The shared table and lazy-loaded owner demo now use separate validated mock adapters. Loading, empty, failure/retry and stale/refresh states are available through documented URL scenarios. Owner controls retain a local input draft and separate exception/disclosure feedback; stale data disables choices. No final acceptance action is offered without an exact proposal. The fixed fictional owner is not an identity selector or authentication. Server fixtures remain excluded from browser imports.

Files: `apps/web/src`, `tests/e2e`, A01 documentation, and A-owned `playwright.config.ts` for an explicit installed-Chrome fallback on macOS 12. Contracts, dependencies and lockfile are unchanged. See [verification evidence](verification.md#a01-verification--september-20-2026).

After human acceptance, A02 connects real command/forms behavior; it depends on B02 and needs B03 for real HTTP verification. Do not treat this mock UI as proof of authorization, solving, transactional consent or cloud integration. B01–B06 remain in B's lane.
