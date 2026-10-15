# FF05 — Guided private answers in a modal

Status: PUBLISHED / user manual acceptance pending; A claim released; no tests or AI calls.

## Problem

The owner types a restaurant and one date, but receives an interpretation containing both dates and no restaurant. Internal HARD labels and duplicated condition lists make confirmation unclear. Text interpretation must not be necessary for selecting existing shared options.

## Scope

Reuse native dialog/wizard styling. Show public choice options as explicit acceptable sets plus an optional first choice. Any/selected/none are explicit, never inferred. Additional notes alone can use the existing AI interpreter and its consent/recovery flow. Review direct answers and optional old/model conditions separately; do not silently remove saved constraints or unresolved notes. Save with authenticated owner identity, frame/owner/control versions and idempotency on the existing command route. Retention policy/stamp checks join the save transaction; no raw notes enter storage/public logs. Changes retain existing approval/permission invalidation and reconfirmation. None-work answers stay blocked for clarification rather than inventing an agreement.

## Completion

Build/static compilation and compatible publication; no new tests/model probes per user instruction. Manual checks: one date stays one date, selected restaurant is retained, alternatives/favourites stay distinct, none-work does not become readiness, cancellation preserves work, old context/replay cannot mutate another owner, notes cannot overwrite direct choices, modal mobile/theme/focus/escape/recovery are usable. Functional acceptance remains pending user observations.

Implementation note: public finite-domain extraction is shared with the existing candidate builder (no scenario-specific options). Native direct answers use the existing commands route and guarded confirmation/invalidation transition in one transaction. Required input fields/options/identity are server-owned. NONE creates a private unresolved condition that remains visible and blocks readiness; an explicit replacement resolves earlier extra notes only at the owner’s choice. The existing boundary checker flagged the unchanged walkthrough’s `new URL` as an import; its same-origin link is now built by string concatenation, with the exact URL preserved.

Static results: TypeScript compilation, frontend production build, changed-source lint and import/dependency boundary checks completed. The safe diagnostic reader compiles without being executed. Tests, signups, participant actions and model calls NOT_EXECUTED under the user’s manual-testing direction. Existing model remains Nova Lite v1; no model migration or new AWS role/route/storage is included.

## Publication — 2026-10-15T21:32:12.165916+00:00

Exact source `a3e665f7390ca14fde24150374f6b6a455ba9f0f`: [native API/worker38810143062](https://github.com/Known-Enough/known-enough/actions/runs/38810143062) SUCCESS/API`01767852`/worker`6de8cf66`; [enable38810286050](https://github.com/Known-Enough/known-enough/actions/runs/38810286050) SUCCESS/current source/TOTAL unchanged/individual consent required; [frontend38810285927](https://github.com/Known-Enough/known-enough/actions/runs/38810285927) SUCCESS/Amplify103/nine published files verified. Registration/profile/managed routes configuration matched with zero configuration writes. [Receipt](../../../../review-artifacts/FF/private-answer-modal-publication.json), [manual checklist](../manual-checklist.md), [debugging](../../../../debugging-decision-drafts.md). No participant records changed by A, no tests or provider calls, no new cloud installation. A claim released; functional acceptance remains unverified. Existing automated assertions for the former inline UI have not been refreshed or executed under the user’s manual-testing pause.
