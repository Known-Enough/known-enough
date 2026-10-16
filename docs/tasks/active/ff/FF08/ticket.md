# FF08 — Joining without restarting decisions

Status: PUBLISHED / B; claim released. Manual acceptance pending; model-job source rebind held because its control was not disabled and empty. [Receipt](../../../../review-artifacts/FF/ff06-10-publication.json).

## User report and agreed behavior

Inviting a new person after creating a decision produces confusing changes. The exact current failure is not yet established. Inspect previous logs and existing invitation, membership, roster-revision and decision transitions before implementing. Do not describe the report as a proven server failure without evidence.

The user explicitly removes any requirement for existing participants to review/reconfirm earlier steps merely because someone joins. This changes the older membership-triggered roster-review requirement for this bounded behavior; preserve other identity/privacy/consent and final-outcome approval rules.

- Creating/sending an invitation, before acceptance, changes no existing decision progress.
- Accepting group membership alone must not reset answers, restart the decision wizard, revoke unrelated progress or reopen a finished decision. Preserve the existing group-versus-decision membership model; do not silently enroll a new group member into every decision or disclose private data.
- When the new person is included in an ongoing decision, preserve existing participants' saved answers and completed shared-choice confirmations. The new participant supplies their own required answers/consent; nobody else repeats review or re-enters answers solely because of joining. A brief informational notice is enough; no blocking “review the updated group” action.
- A finished decision remains finished, with its recorded outcome and approvals intact. Do not add a new approver retrospectively or regenerate/reopen its result. Any shared outcome visibility still follows existing access rules.
- If new answers change a proposal before completion, normal approval of the current final proposal still applies. Do not carry an approval for a different proposal forward, auto-approve for anyone, or let a completion race omit a genuinely required participant. Preserve original consent and processing scope; enrolling a newcomer cannot authorize private-input reuse or broaden disclosure.

## Implementation scope

Trace the actual behavior through invitation acceptance, group membership and linked decision updates. Fix the underlying transitions and their UI messages rather than hiding a required server error. Make membership additions distinct from edits to the actual decision choices/rules: changing the subject/options can still require its existing semantic review. Keep all existing saved answers and checkpoints recoverable, preserve revision/concurrency/idempotency checks, and keep completed decisions immutable under membership events. Do not weaken removal/revocation rules or grant access merely from an invitation URL.

Use the existing architecture and compatible runtime. Read prior FF05 private-answer and roster/invitation logs to avoid recreating old failures or overwriting current work. Explain precisely which automatic reset/review branch changed and what happens to existing in-progress records; no bulk destructive migration.

## Delivery constraints

Code changes only under the user's current direction: no automated/live tests, model calls, AWS/CloudShell setup or deployment. Static type/build checks are allowed. The user will manually check. Record any genuine compatibility gap without inventing an AWS prerequisite. Work in the existing sequential queue, maintain ticket/B log/handoff and commit/push under standing authority. CODE_READY is not published or manually accepted. No new worker/chat/monitor.

## User manual walkthrough

Create a decision and save private answers. Invite someone: nothing resets while pending. Accept and include the person in that ongoing decision: original participants retain answers and confirmations; the newcomer can provide their own input, with no extra review requirement for others. Complete another decision, then invite/include a new group member: the finished decision stays finished. Check that changed proposed outcomes still require normal final approval and no private answers are exposed.

## B implementation checkpoint

Source tracing found that invitation creation does not change group.version; acceptance increments it, making every older decision binding fail STALE_CONTEXT. Both native and transient acceptance now advance only previously-current decision bindings alongside that group-version change. They never edit decision membership, owner inputs or outcomes. Bindings already stale (including removal-related records) stay stale for explicit organizer recovery.

The organizer's existing review/revise path is now available as “Update decision participants” for current decisions too. The application recognizes an unchanged public subject/options/rules plus an addition-only roster: it retains the old semantic/frame/context versions, frame confirmations and entire existing owner input records, appending empty owners only for genuinely new identities. Existing private variables are preserved, not rebuilt from the public projection. Previous in-progress proposal/approvals/jobs are retired and solveEpoch advances, so old results cannot settle a new roster; disclosure/adjustment permissions are superseded without broadening their audience or replaying refusals. New members must confirm and supply their own input. Native repository validation admits this exact addition branch while retaining the captured group/decision CAS and current identity fences. AGREED/CLOSED membership-only updates preserve the exact record and recorded outcome; substantive edits/removals retain the existing semantic revision behavior. No bulk migration.

Old records made stale solely by earlier additions can use the explicit organizer update once; no existing participant reconfirmation is requested for that additive branch. Unknown model journal entries/capacity are not reset or replayed. User-reported live behavior remains unreproduced under the no-tests direction.

Node24.21.0/npm11.19.0 typecheck, production build/bundle boundary, lint/import boundaries580 and whitespace PASS. No automated/live tests, AI, setup or deployment. Publish matching API/worker code together before manual checks. Manual walkthrough: save original participants' answers; send invitation (no change), accept into group (original decisions still open), explicitly include in ongoing decision (original answers/confirmations preserved; newcomer answers empty), and verify changed proposal requires new approval. Repeat against a finished decision and verify outcome/approvals/roster unchanged. Check removal still invalidates old access and no private data appears publicly.
