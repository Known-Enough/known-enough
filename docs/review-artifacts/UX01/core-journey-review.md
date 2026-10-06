# UX01 core journey evidence

Source c52524522505f59179f6779b9c9121c72417c74b. Read-only local Chromium simulation, synthetic participants, no cloud/account submission or paid calls.

All 19 focused tests passed in 1.3 minutes: np-clarity, np-qualification, np-onboarding and local-negotiation. Actual coverage includes four independent owner contexts, groups/invitations, public draft/questions/focus, private confirmation, owner-only negotiation and exact disclosure preview, refusal, unanimous final approval, pending/disabled access, refresh races, expired login and network/JSON/schema recovery. Fixtures are not verified humans or cloud acceptance. Processes, contexts and API servers use test finally cleanup.

[Phone private journey](phone-private-journey.png) is an actual full-page Chromium capture at 390×844. Root inspected rendered labels/status/private question/refusal controls; assertion confirms no horizontal overflow and no raw private canary/schema/context token. Another participant cannot see the owner's private question. No new verified defect added beyond [first-use findings](first-use-review.md).

Remaining: directly inspect desktop core captures and zoom/reflow/keyboard sequence across core controls, then consolidate UX02 handoff. Existing automated assertions establish specific behavior, not a complete visual/accessibility review. Loading-state visual coverage remains partial.
