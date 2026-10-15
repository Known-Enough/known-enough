# FF10 — Align the example with the current app

Status: READY / unclaimed. Intended worker: B after FF09; one task at a time.

## User request

Read previous logs, inspect the website and compare possible differences so the example reflects current code and the revised decision flow. Change the example only where needed.

## Work

1. Read FF03 onboarding records, FF05–FF09 tickets, latest A/B handoffs/work logs and actual publication receipts. Inspect current implementation rather than treating old task descriptions as proof of current behavior.
2. Inspect the live website read-only where accessible. Identify which version is published and distinguish live behavior from code not yet published. Do not assume a deployment gap is a product bug or rewrite guidance around obsolete live screens. If sign-in prevents inspection, record what is unavailable and continue with code/log review without asking for credentials.
3. Compare the example against the actual creation modal, short decision names, shared choices, private-answer modal, participant status, invitations/joining, proposal review and completion. Use actual current wording/navigation. Include only implemented behavior; mark unavailable or planned functionality honestly.
4. Update outdated example steps, labels and explanations as needed, preserving FF09's example-inside-creation-modal-only placement. Use a coherent fictional scenario with explicit options and explain what each participant does privately, what the group sees, and how the final outcome is approved. Avoid promising automatic approval, guaranteed agreement or invented AI capabilities. Do not hardcode example-specific behavior into the product.
5. Keep this a focused guidance/content change. Preserve actual app functionality, privacy/consent, unsaved drafts and recovery. Do not use this task to implement unrelated missing features. If no content change is necessary, record the comparison and evidence rather than manufacturing edits.

## Constraints and delivery

No automated or live functional tests, signup, participant actions, model calls, AWS/CloudShell setup or deployment. The requested website check is read-only observation, not submitting decisions or triggering workflows. Static build/type checks allowed if executable UI changes. User performs manual testing.

Log which code/version, prior records and live pages were examined, exact differences found, content changed, unavailable observations and remaining publication gaps. Save a concise comparison in this task folder and update B work log/handoff. Commit/push under standing authority. CODE_READY does not imply live publication or user acceptance. No new chat/monitor; follow existing sequential intake.

## Expected result

A short, accurate example available inside decision creation that matches the latest implemented flow. Any difference between deployed and prepared code is stated explicitly so future workers do not mistake old screens for the new design.
