# FF09 — Example inside the create-decision modal only

Status: READY / unclaimed. Intended worker: B after FF08; sequential queue.

## User direction

The example decision flow belongs inside the modal used to create a decision, not elsewhere in the app.

## Focused changes

- Read existing FF03 onboarding/example logs and FF06 modal work before editing. Reuse the existing fictional example content and shared modal styling.
- Put a discreet “See an example” action within the create-decision modal. Show the example inline as an expandable section or as a step within that same modal; do not open a new tab or another standalone page/modal.
- Let the user return to their creation form with their idea, answers and saved request state intact. Do not submit, overwrite or create a decision when viewing the example.
- Remove example links/actions from the landing page, groups page, other screens and external navigation. Retire the standalone example route as a separate example experience; handle old `?guide=decision` links gracefully without showing the example outside creation or breaking authentication callbacks.
- Keep examples clearly fictional, generic and read-only. Preserve shared/private distinctions; viewing guidance makes no AI/API call. Keep navigation accessible and readable on mobile and both themes.

## Delivery

Code changes only: no automated/live tests, AI calls, AWS/CloudShell setup or deployment. Static build/type checks allowed; user manually checks. Preserve current FF work, authentication, draft recovery and privacy. Record changes and a short manual walkthrough in ticket/B log/handoff, then commit/push under standing repository authority. CODE_READY does not mean published or accepted. No new chat/monitor.

Manual outcome: the example is available only while creating a decision, stays inside that modal, and returning preserves the user's draft. No example launchers elsewhere.
