# ZZ03 — Separate home, groups and decisions

**Status:** IN_PROGRESS / unclaimed — the bounded icon/alignment/contrast polish is published from main 2d9ff85299bbdf26a4fd422756feaac6fec70b23. Layout, typography, behavior and responsive structure stay intact; manual visual/authenticated and protected-flow acceptance remain pending.

Replace the long signed-in page with clear views: waiting for approval, Your groups, a selected group and a selected decision. Keep the ZZ02 profile drawer in the header. Remove manual decision-ID entry, fictional templates, simulated Alexa and fictional invitations from the normal product flow.

Each view shows one next action, useful status and clear back navigation. Reuse existing authorized group/decision behavior; reorganizing screens does not make unfinished AI features work.

[Ticket](ticket.md) · [ZZ batch](../README.md) · [Task board](../../../../task-board.md)

[Checked navigation review and exact dependency](../../../../review-artifacts/ZZ03/navigation-review.md). [Group-details publication and byte readback](../../../../review-artifacts/ZZ03/group-details-publication.json). [Supplied-brand publication and byte readback](../../../../review-artifacts/ZZ03/brand-assets-publication.json). [Dark/light publication evidence](../../../../review-artifacts/ZZ03/theme-publication.json). [Surgical group icon polish publication](../../../../review-artifacts/ZZ03/group-icon-polish-publication.json). Local checks do not prove actual primary signup/profile/AI acceptance.

### Surgical icon polish implementation checkpoint — 2026-10-13T21:02:30Z

Added the requested understated section/action icons using the existing inline SVG approach; no Lucide package/dependency was present or added. Heading icon tiles use pale green, 18px glyphs, and dark-theme palette support. Section subtitles align under heading text and muted group details are slightly darker. Existing cards, typography, invitation/member/decision handlers, and responsive grid remain unchanged. Pinned Node24.21.0/npm11.19.0 `npm run typecheck` PASS; `npm run build` PASS including browser-bundle boundary check; `git diff --check` PASS. No app/browser/API/provider suites or probes run under the user's manual-review direction. No backend, identity, permission, data, configuration, or dependency change. Exact-source frontend publication/readback is next; manual visual/authenticated review remains the user's.

### Surgical icon polish published and released — 2026-10-13T21:05:48Z

Exact source `2d9ff85299bbdf26a4fd422756feaac6fec70b23` published successfully by own-A [38467754472](https://github.com/Known-Enough/known-enough/actions/runs/38467754472), Amplify job78. The deployed root page and all six referenced assets returned HTTP200 and matched the exact manifest SHA-256 values. Configuration readback passed with no configuration/data writes; API publication, signup delivery and provider calls were not executed. Pinned static and docs checks passed; regression checks were skipped and application/browser/API/provider suites/probes were not run by user direction. Receipt: [group icon polish](../../../../review-artifacts/ZZ03/group-icon-polish-publication.json). The bounded A claim is released. User visual/responsive/authenticated review and whole ZZ03 acceptance remain pending; no whole-task DONE claimed.
