# Decision workflow pages

Major decision workflows now use the existing shareable query-string routing on both hosts. No new router or server fallback configuration is required.

- Creation: `?group=<group-id>&create=decision&step=describe` or `step=options`.
- Answers and saved summary: existing `?group=<group-id>&decision=<decision-id>`.
- Decision details: add `&view=details`.
- Outcome and proposal approval: add `&view=outcome`.

Old group and decision URLs remain valid. Direct Options links without a local description return to Describe by replacing history, avoiding a Back loop. Direct decision pages authenticate and load the same checked atomic owner snapshot.

The existing editor stores shared description/options in this browser session; the indicator distinguishes that local copy from a server-saved draft. Refresh restores the same public editor and request recovery keys. Private answers/notes are never added to browser storage. Switching decision subpages preserves in-memory edits and uncertain commands without refetching or remounting; leaving the workspace or reloading warns about unsaved work. Cancelled browser Back returns to the original history entry rather than inserting a duplicate. Group and creation pages retain the same group workspace.

The page column is 720px, with natural document scrolling, non-sticky actions, inline optional assistance and light/dark/mobile styling. Assistance suggestions require explicit acceptance and retries. Chat, profiles, deletion confirmations and quick actions retain their existing dialogs/popovers. No API payload, permission, consent, approval, paid-retry or backend contract changed.

Validation: five routing unit checks, fifteen focused browser checks, TypeScript, changed-file ESLint, import boundaries and production build passed. Browser cases use intercepted synthetic responses only; no real user, AI, email or AWS data operations. Coverage includes direct links/refresh, history/cancel, preserved edits, draft/save/create recovery, legacy drafts, explicit suggestion acceptance, no nested scrollers at desktop/mobile/landscape sizes in both themes, and chat remaining a dialog. Earlier fixture label/finite-choice assumptions were corrected; final focused browser run passed 15/15. Full application/live qualification was not run. Publication evidence is in `decision-workflow-pages-publication.json`.
