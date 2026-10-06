# UX01 core journey evidence

Source c52524522505f59179f6779b9c9121c72417c74b. Read-only local Chromium simulation, synthetic participants, no cloud/account submission or paid calls.

All 19 focused tests passed in 1.3 minutes: np-clarity, np-qualification, np-onboarding and local-negotiation. Actual coverage includes four independent owner contexts, groups/invitations, public draft/questions/focus, private confirmation, owner-only negotiation and exact disclosure preview, refusal, unanimous final approval, pending/disabled access, refresh races, expired login and network/JSON/schema recovery. Fixtures are not verified humans or cloud acceptance. Processes, contexts and API servers use test finally cleanup.

[Phone private journey](phone-private-journey.png) is an actual full-page Chromium capture at 390×844. Root inspected rendered labels/status/private question/refusal controls; assertion confirms no horizontal overflow and no raw private canary/schema/context token. Another participant cannot see the owner's private question. No new verified defect added beyond [first-use findings](first-use-review.md).

Remaining: directly inspect desktop core captures and zoom/reflow/keyboard sequence across core controls, then consolidate UX02 handoff. Existing automated assertions establish specific behavior, not a complete visual/accessibility review. Loading-state visual coverage remains partial.

## Desktop rendered checkpoint

Actual headless Chromium, synthetic signed local API, source 5af3dc3cb915715149f66b84d154fec3d0a7a8a6. [Owner desktop](desktop-private.png), [other participant](desktop-other.png), [CSS zoom 2 simulation](desktop-zoom-private.png), [safe inventory](core-rendered-inventory.json). Root inspected owner and zoom captures. All three no horizontal overflow/no raw canary or internal version fields. Owner question present only for owner. Eight sequential Tab presses reached visible adjustment focus in owner and zoom screens. Empty label values in inventory measure aria-label only; associated HTML labels are present, so these are not missing-label findings. CSS zoom is a simulation, not browser UI zoom or physical device testing.

### Fifth consolidated finding — medium: navigation crowds the active decision

Steps: approved organizer opens Gallery meetup on desktop or phone; scroll to the current private question. Observed: all group/member/create/invite controls and both “Open decision” and “Open or retry decision” remain above the loaded decision; the active private response is below multiple long sections. Expected: a clear active-decision heading/focus and compact account/group navigation, preserving organizer actions and separate participant/display authority. Impact: especially on phone/zoom, the next required action is difficult to find. Evidence: phone-private-journey.png, desktop-private.png and desktop-zoom-private.png. UX02 should consolidate redundant open actions and progressive disclosure using existing components; do not remove consent/review controls.

Consolidated UX02 list is the four findings in first-use-review.md plus this fifth finding. Behavioral core evidence is the 19 browser checks recorded above; visual state coverage is partial for loading/error/final-approval screenshots despite their behavioral assertions. No new implementation/live acceptance. CODE_READY review checkpoint; primary provider signup completion, real browser UI zoom/physical device and exhaustive accessibility remain explicit evidence gaps, not PASS. UX02 can implement the verified list under coding-first while final managed proof remains deferred.
