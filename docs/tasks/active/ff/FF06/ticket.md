# FF06 — Simple decision overview, guided modals and editable names

Status: READY / unclaimed. Requested for B; task creation does not mean B has started.

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
