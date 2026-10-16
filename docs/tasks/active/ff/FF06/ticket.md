# FF06 — Simple decision overview, guided modals and editable names

Status: PUBLISHED / B; implementation claim released. Follow-up fixes published from `70d3fabbb5f223930dc1f282b9edf072a95db47d`; manual acceptance pending. The model-job source rebind remains held because its control was not disabled and empty. [FF06–FF10 receipt](../../../../review-artifacts/FF/ff06-10-publication.json).

## User-directed follow-up — group list actions

2026-10-15 (Mexico City): The user asks for the dots panel to show group members and decisions directly, with organizer rename and delete actions instead of Quick view. The list panel now displays the existing authorized group snapshot fields; renaming uses the existing version-checked route. Group deletion uses an organizer-only, version-checked retained tombstone and makes linked drafts/decisions unavailable to every member. A confirmation explains the impact before deletion. The previous group-creation/answer-editing repairs and privacy-safe group diagnostics remain in the same local change set.

Changed files: `apps/web/src/group-home.tsx`, `apps/web/src/style.css`, `apps/web/src/connected-decision.tsx`, `apps/web/src/private-answers-modal.tsx`, `packages/contracts/src/groups.ts`, `apps/api/src/group-service.ts`, `apps/api/src/http-core.ts`, `scripts/fix01/draft-failure-readback.py`, and `docs/debugging-decision-drafts.md`.

Initial implementation checks: `git diff --check` and Python syntax parsing passed. No automated tests, AI calls, or new cloud setup were performed. Local TypeScript checking could not complete because npm and workspace links for `@deal-table/*` were unavailable. The release workflow's frontend build passed.

## Follow-up fix publication — 2026-10-16

Pushed commit `70d3fabbb5f223930dc1f282b9edf072a95db47d` to `main`. [Backend release](https://github.com/Known-Enough/known-enough/actions/runs/38837325423) read back API hash `99a2f2fa79f223cffb13bac3dbdbffd0370ac3671824d13e36a306b7d23fcd3f`; matching worker hash `817cdbbaae969b78ddc52bb3a5abafca6c7c76ea93fe259acbfa77691bbe076f` was published with its schedule disabled. The workflow concluded failure only at the separate model-job source rebind guard (`JOB_SOURCE_NOT_DISABLED_EMPTY`); the API code publication step passed. [Frontend release](https://github.com/Known-Enough/known-enough/actions/runs/38837426011) passed and published Amplify job `105`. Its configuration readback matched API hash `99a2f2fa…`, confirmed all eight managed routes including group deletion, and recorded two configuration writes, zero data writes and zero provider calls.

The follow-up restores editable structured answers during an unresolved optional AI notes request; prevents newly typed notes from being cleared by an earlier response; hardens group-create retry behavior; moves member/decision details and organizer rename/delete into the dots menu; adds organizer/version-checked group tombstones; and logs privacy-safe group request outcomes with UUID correlation IDs. No automated regression tests or AI calls were run. Manual acceptance is still pending.

Walkthrough: open a decision with an uncertain notes request and edit/save structured answers; create a group and retry only the same request if its result is unknown; use the group dots to inspect members/decisions, rename, and confirm deletion; verify deleted groups and linked decisions return not found to their former members.

## New-decision answer-entry correction — 2026-10-16

Review of the published flow found the remaining lock: the overview routed to shared-choice review whenever any required participant had not confirmed. The private-answer entry button and its parent step also required every participant to have confirmed, even though only saving is guarded by the API. This prevented participants from preparing private answers for a new decision while waiting for others.

The overview now lets a participant who has personally confirmed the shared frame open and edit their private answers while others are pending. The save control remains disabled, with a clear explanation, until every required participant has confirmed; the API's existing check remains authoritative. No backend or confirmation rule changed. Frontend publication pending.

## First read

Read the latest [A handoff](../../../../handoff-B.md), [work log](../../../../work-log-A.md), [FF05](../FF05/ticket.md), and [publication receipt](../../../../review-artifacts/FF/private-answer-modal-publication.json). Inspect existing group/decision naming and permissions before changing them. Preserve current FF01–05 work; do not rebuild the private-answer backend or repeat old AWS setup.

## User problem

Opening a decision still shows too much explanation, shared rules and confirmation material. The user wants a brief understandable overview, their own answer summary, everyone's progress and an obvious next step. A hidden modal launcher alone is insufficient.

## Code changes

1. Make the opened decision page a compact overview: short decision title; one or two sentences explaining the decision; a private summary of what the signed-in user has said/selected (or “You haven't answered yet”); a participant status list; one primary next-step button. Use “What works for you?” for the private-answer action. Keep Back to group and secondary actions discreet.
2. Put detailed shared-choice review/confirmation, private choices/notes/review, and later proposal/approval steps in focused modals using existing components. The overview's Continue action opens the next applicable step. Keep required shared confirmation before saving private answers; explain missing prerequisites plainly. Do not auto-confirm or auto-approve. Keep compact summaries outside modals, not all the forms, disclaimers, rules and repeated instructions. Preserve accessible close/back/keyboard/mobile behavior and draft recovery.
3. Show only each participant's progress publicly: for example reviewing choices, answers saved, or approval pending. Only the signed-in user sees their own answer summary. Never expose anyone else's selections, notes, constraints or refusal reasons.
4. Give newly created decisions a meaningful approximately three-word editable title, rather than generic “Current decision”. Derive a sensible default from the supplied public idea without a new AI call or scenario-specific hardcoding. Keep stable IDs separate from names, and render useful titles on group lists and the decision overview. Existing decisions keep their stored content; do not migrate/rewrite all records merely for titles.
5. Allow organizers to rename groups and decisions through a small edit modal/action. Reuse existing persistence and authorization paths where supported; preserve memberships, links, decision content and approval rules. Handle blank/overlong names and failed saves clearly. Inspect whether titles are semantic/versioned before altering persistence; do not accidentally reset confirmations or silently bypass a required semantic revision.

## Scope and handoff

User explicitly requests focused CODE CHANGES ONLY: no automated tests, live tests, AI calls, AWS/CloudShell setup or deployment for this task. The user will test manually. Do not add permissions or infrastructure; if an actual missing API capability prevents persistence, document the exact gap and finish independent UI work instead of inventing a cloud prerequisite. Existing static build/type checks are allowed; report precisely what was and was not checked.

Work sequentially after verified claim/intake. Record changed files, previous-log findings, implemented flow, any real blocker and a short manual walkthrough in the ticket/B log/handoff. Commit/push under standing repository authority. Mark CODE_READY when implemented; do not claim published or manually accepted. No new chat, monitor or schedule.

## Manual acceptance for the user

Open a decision: immediately understand its subject, your own saved answers, everyone’s progress and what to do next. Continue opens the relevant modal; closing returns to the compact overview. Rename a group and a decision, reopen them and see the saved names without broken links or lost data. Private answers remain private. New decisions have distinct useful short names.

## B implementation checkpoint

Compact overview now shows a short description, owner-only saved conditions, public progress and next-step buttons. Shared review and proposals/disclosures use a native focused dialog; private answers retain the existing modal and recovery state. Public progress adds only participant ID/answers-saved boolean. New draft names use three words from the public idea, editable before creation. Organizer rename dialogs persist cosmetic group/binding labels with previous-name and version checks, separately from semantic frame content; existing confirmations and proposal hashes are untouched. Native and transient handlers implement POST `/groups/{groupId}/name`. Existing records are read without bulk rewrite; old names remain as fallbacks.

Static typecheck, production build/bundle boundary, lint/import boundaries (576 references), and whitespace checks passed using Node24.21.0/npm11.19.0. No tests, model calls, cloud setup or deployment. Publication must include matching API/worker readers for the optional binding title and public progress schema, plus JWT POST and NONE OPTIONS `/groups/{groupId}/name` routes; installed route support is unverified. No infrastructure was changed.

Manual walkthrough: open a decision, inspect your private summary and public progress, open/close each applicable step, confirm shared choices explicitly, then save answers and review a proposal. Rename a group and decision, reopen and verify labels persist while existing answers, links and confirmations remain. Check a second account sees progress only. This is CODE_READY, not live acceptance.

Final source-review follow-up 2026-10-15T22:44:22.013207+00:00: one primary next-step action now opens proposal/permission work when applicable; display sessions can open the public proposal; private summary is capped at three conditions with a link back to all answers. Short-title generation ignores common introductory filler words. Rename validation explains the80-character limit; public progress validates unique current roster IDs. Final type/build/lint/boundaries579/reference7/whitespace PASS. No tests/deployment. Follow-up claim released.
