# ZZ03 — Separate home, groups and decisions

**Status:** IN_PROGRESS / A — requested section/action icons and minor alignment/contrast improvements are implemented and statically checked from main 0be1b3613c93861e6f41ba25d9fba783bb1cee64; exact-source publication is next. Layout, typography, behavior and responsive structure stay intact; manual visual/authenticated and protected-flow acceptance remain pending.

Replace the long signed-in page with clear views: waiting for approval, Your groups, a selected group and a selected decision. Keep the ZZ02 profile drawer in the header. Remove manual decision-ID entry, fictional templates, simulated Alexa and fictional invitations from the normal product flow.

Each view shows one next action, useful status and clear back navigation. Reuse existing authorized group/decision behavior; reorganizing screens does not make unfinished AI features work.

[Ticket](ticket.md) · [ZZ batch](../README.md) · [Task board](../../../../task-board.md)

[Checked navigation review and exact dependency](../../../../review-artifacts/ZZ03/navigation-review.md). [Group-details publication and byte readback](../../../../review-artifacts/ZZ03/group-details-publication.json). [Supplied-brand publication and byte readback](../../../../review-artifacts/ZZ03/brand-assets-publication.json). Local checks do not prove actual primary signup/profile/AI acceptance. [Dark/light publication evidence](../../../../review-artifacts/ZZ03/theme-publication.json).

### Surgical icon polish implementation checkpoint — 2026-10-13T21:02:30Z

Added the requested understated section/action icons using the existing inline SVG approach; no Lucide package/dependency was present or added. Heading icon tiles use pale green, 18px glyphs, and dark-theme palette support. Section subtitles align under heading text and muted group details are slightly darker. Existing cards, typography, invitation/member/decision handlers, and responsive grid remain unchanged. Pinned Node24.21.0/npm11.19.0 `npm run typecheck` PASS; `npm run build` PASS including browser-bundle boundary check; `git diff --check` PASS. No app/browser/API/provider suites or probes run under the user's manual-review direction. No backend, identity, permission, data, configuration, or dependency change. Exact-source frontend publication/readback is next; manual visual/authenticated review remains the user's.
