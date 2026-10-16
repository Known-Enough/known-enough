# FF07 — Member photos, image sizing and header fixes

Status: PUBLISHED / B; claim released. Manual acceptance pending; model-job source rebind held because its control was not disabled and empty. [Receipt](../../../../review-artifacts/FF/ff06-10-publication.json).

## Reported issues

Members currently show only a square and initial (for example T), even when a profile photo is expected. Names are unreadable in light mode but visible in dark mode. Clicking Known Enough should return to the signed-in user’s groups. Uploaded photos should be resized automatically.

## Focused code changes

- Read previous [FIX02 profile work](../../fix/FIX02/ticket.md), current handoffs and profile publication evidence before changing code. Reuse existing profile/avatar components and authorized member-profile reads. Establish whether missing photos are absent data, a loading/fetch failure or rendering; do not assume the initial proves no photo exists.
- Render a member’s saved photo as a consistent circular avatar with appropriate cropping. Keep initials as the fallback when no usable photo exists. Clicking the member opens the existing permitted profile view with display name, photo and description; preserve access and privacy boundaries. Handle loading and unavailable images without broken layouts.
- Resize profile uploads automatically before saving through the existing upload path. Preserve aspect ratio, normalize orientation and export a bounded image appropriate for avatars (target maximum 512 × 512 pixels, respecting existing payload/storage limits). Fit display with consistent dimensions and object-fit. Give clear feedback for unsupported/corrupt or excessively large input; never silently discard the previous saved photo on failure. Avoid new dependencies where browser image tools suffice. Keep existing server validation.
- Fix member/profile name colors and contrast in light mode using existing theme tokens; keep dark mode readable. Cover the member list, avatar/profile view and relevant header text without global CSS overrides that break other screens.
- Make the Known Enough logo/wordmark an accessible navigation link to the signed-in user’s groups. Preserve session, normal signed-out behavior and existing unsaved-work/recovery warnings. Do not simply reload the site or discard an unfinished request.

## Scope and handoff

Code changes only under the user's current direction: no automated/live tests, AI calls, AWS/CloudShell setup or deployment. Static type/build checks are allowed; user will manually check after publication is separately arranged. Do not recreate FIX02 infrastructure or broaden profile visibility. If existing API integration really prevents member photos, record the precise remaining gap, reuse compatible existing code and finish independent UI changes; do not label the whole feature working without evidence.

Log prior findings, changed files, remaining issues and a short manual walkthrough in the B work log/handoff. Commit/push under standing repository authority. CODE_READY is not published/manual acceptance. No new worker, chat or monitor.

## User manual checklist

Saved member photos appear; a member without one shows a clean initial fallback. Clicking a member shows permitted profile details. A large uploaded photo is resized and displays correctly after reopening. Failed uploads preserve the previous image. Names are readable in both themes. Clicking the logo returns to your own groups while respecting unsaved work.

## B implementation checkpoint

Prior FIX02 evidence demonstrated saved PNG/member-profile reads; source inspection found the member list always rendered an initial without fetching images. New MemberAvatar uses only that authenticated same-group read, cancels stale requests, clears old photos, crops circularly and falls back on absent/unavailable/broken images. Profile clicks retain the existing permitted modal. Browser uploads accept PNG/JPEG/WebP up to20MB, honor orientation, retain aspect ratio and normalize to PNG within the existing 128px/16KB server contract (stricter than the ticket's target maximum512px); progressively smaller output avoids broadening server validation. Decode/resize failures never remove the saved photo. Member/profile name theme styles are scoped. Logo uses accessible in-app navigation and propagated unsaved/unknown-request guards; no reload.

Node24.21.0/npm11.19.0 typecheck, production build/bundle and lint/import boundaries580 PASS; whitespace PASS. No tests, AI, cloud setup or deployment. User walkthrough after separate publication: open members in both themes, compare saved photo versus initial fallback, open member profile, upload a large/oriented JPEG and reopen, try corrupt/unsupported input and verify the saved photo remains, then navigate with the logo while editing and while a request is unresolved. Actual rendering/persistence remains manually unverified.
