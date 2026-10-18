# Decision creation redesign

User-requested two-step creation flow: **Describe → Options**. Frontend source starts at `2963d81`, including B’s group-pagination repairs. Publication evidence will be recorded here after release.

## What changed

Describe opens with one focused textarea, three small inspiration buttons and optional writing help. Continue validates and moves to Options without saving a decision or calling AI. Examples ask before replacing existing text and retain entered options.

Options uses compact editable rows, Add/Edit/Remove actions, an editable decision name and a discreet explicit Save draft action. Required fields, duplicates, date values and existing comparison limits still gate creation. The modal is 720px on desktop with a single content scroll area and a fixed footer; responsive sizing, keyboard containment/restoration and light/dark contrast are covered.

AI remains on the existing authenticated drafting API. “Suggest a description” and “Suggest options” are explicit actions. Responses go into a separate editable suggestion buffer; descriptions and individual options are accepted or dismissed by the user. Late or recovered responses cannot overwrite newer work. A failed AI request does not prevent editing or manually creating a valid decision.

Public draft text continues to use the existing per-group browser-session cache. No private participant answers, credentials or model payloads were added to storage or logs. Closing, reopening, server-save conflicts and uncertain writes preserve current work. Creating waits for a validated server response, or a confirming read after a lost acknowledgement; no automatic paid retry was introduced.

## Existing lifecycle retained

- `GET /groups/:id/draft-requests` and per-request status/release: recover uncertain AI attempts using the original request key and current revision.
- `POST /groups/:id/drafts`: explicit public AI assistance, or a manual `choicePlan` save through the existing endpoint.
- `GET/POST /groups/:id/drafts/:draftId`: resume/save the current draft with its revision.
- `POST /groups/:id/drafts/:draftId/create`: create from the confirmed saved revision, then navigate to the existing decision experience.

No API, database, provider, identity, group admission or final-participant-approval rules changed. The installed API/worker source remains `3910e84`; this release publishes the frontend only.

Older saved frames without a choice plan keep their original identifiers, domains and shared rules. Their compatibility editor permits wording changes and continuing the existing draft; it does not flatten advanced rules into a new choice plan. Older frame-shaped AI responses require explicitly choosing “Use this saved draft” to retain their rules. Current choice-plan suggestions use individual acceptance. Generated AI drafts remain saved by the existing API even when their suggestions are dismissed; existing draft deletion remains available.

## Validation

See [machine-readable results](validation.json).

- 22 focused controlled browser tests passed, including manual creation with zero AI calls, explicit/individual suggestion acceptance, stale revision resolution, lost response recovery, unknown AI protection, saved-draft compatibility, keyboard handling and comparison limits.
- 4 option-merge unit tests passed; 1 hosted-preview browser check passed.
- Typecheck, full lint/import boundaries, reference/planning checks, production build and bundle scan passed.
- The full required check was attempted: **1,630 unit tests passed, 32 failed, 2 skipped and 1 unhandled runtime error**. It stopped before its build/browser stages, which were run separately where listed above. All current failure groups also occur on the clean pre-redesign source using the pinned dependencies; the archive comparison additionally has three integration-suite loading failures. No whole-suite PASS is claimed.
- Seven older NP browser cases were attempted. Their offline architect returns HTTP 503 before the wizard can receive a draft. Their selectors were migrated to the new flow, but these cases remain unverified. The focused current-contract and legacy-frame browser cases pass; this does not replace real live qualification.
- AI responses in browser validation are controlled fixtures, not production replacements. No real users, signups, email, paid model calls or real decisions were created for this redesign. Manual live acceptance remains pending.

## Visual evidence

| View | Light | Dark |
|---|---|---|
| Desktop description | [1280×800](describe-1280-light.png) | [1280×800](describe-1280-dark.png) |
| Desktop options | [1280×800](options-1280-light.png) | [1280×800](options-1280-dark.png) |
| Phone description | [390×844](describe-390-light.png) | [390×844](describe-390-dark.png) |
| Phone options | [390×844](options-390-light.png) | [390×844](options-390-dark.png) |
| Short description | [844×390](describe-844-light.png) | [844×390](describe-844-dark.png) |
| Short options | [844×390](options-844-light.png) | [844×390](options-844-dark.png) |

Native textarea overflow remains available for long descriptions. The modal itself has one content scroller and an unobscured footer. Physical-device virtual-keyboard behavior still needs user acceptance.

## Changed files

- `apps/web/src/group-decisions.tsx`: two-step state, explicit help/review, persistence and creation navigation.
- `apps/web/src/choice-plan-editor.tsx`: compact editable option rows and constraints.
- `apps/web/src/creation-options.ts`, `creation-suggestions.tsx`: immutable single-option acceptance and contextual suggestion review.
- `apps/web/src/app-chrome.tsx`, `style.css`, `decision-guide.tsx`: existing icon system, scoped styling and matching example copy.
- Focused `creation-options.test.ts`, `creation-wizard.spec.ts`; migrated `e2e02-repairs`, `fix01-draft` and older NP browser selectors.
- AGENTS/claim/A log and this evidence folder: bounded ownership and handback evidence.

## Manual check after publication

Open [Known Enough](https://main.d143q5ravxp5av.amplifyapp.com/), refresh, open a group and choose Start a decision. Describe the decision, Continue, add two options and create. Optional AI assistance is separate from Continue. Confirm the new two-step modal is visible before trying any real request.
