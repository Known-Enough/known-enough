# E2E02 report — <run ID / UTC date>

Status: NOT STARTED. Replace this line only with the actual run outcome. This template contains no test evidence.

## Run and target

- Start/end UTC; parent/task identity; actual Luna model/available settings and browser/tool versions:
- Primary URL and observed frontend/source/runtime versions; matching receipt/run links; unavailable readback:
- Baseline comparison (frontend117/source6cb97c4, API6f2bff59/runtime40ec579, or explicitly reconciled newer release); any mid-run target change:
- Credentials file availability/modes (no contents); User 1/User 2 login/access results:
- Each user's own account refresh; actual approved access and two distinct required participants in the main decision:
- Execution order followed: 01, 02, 03, 04, 07, 05, 06, 08–16. SOLO versus joint fixtures:
- Run-owned fixtures and where private identifiers/checkpoints are retained:
- Actual AI/provider calls/usage if observable; explicitly unavailable evidence; no invented counts:

## Results

Use PASS/FAIL/BLOCKED for every case and explain mixed subcases. LIVE and INJECTED are evidence kinds, not pass statuses. Never copy an earlier run's PASS into this table.

| Case | Expected | Observed / UTC | Result | LIVE / INJECTED | Evidence / dependency |
| --- | --- | --- | --- | --- | --- |
| 01 User 1 sign-in | Own account/groups entry | Not executed | BLOCKED — not executed | — | — |
| 02 User 2 sign-in | Separate account/session | Not executed | BLOCKED — not executed | — | — |
| 03 Group create feedback | Saved group opens without false discard alert; genuine unsaved-input guard retained | Not executed | BLOCKED — not executed | — | — |
| 04 Rename | Saved name/organizer after reopen | Not executed | BLOCKED — not executed | — | — |
| 07 Invitation — execute before05 | Both users join before main draft; group-local sending, recipient inbox, hidden empty state | Not executed | BLOCKED — not executed | — | — |
| 05 Editable validation/layout | Incomplete save and specific prompts; both choices reachable, controls visible, original idea/example retained | Not executed | BLOCKED — not executed | — | — |
| 06 Manual decision | One current-roster two-person decision created/reopened/renamed without AI | Not executed | BLOCKED — not executed | — | — |
| 08 Decision modal | Direct answers, concise public overview, accessible layout | Not executed | BLOCKED — not executed | — | — |
| 09 Private answers | Independent saves; no cross-user private disclosure | Not executed | BLOCKED — not executed | — | — |
| 10 Outcome | Clay Kit/November7; two required people and two explicit approvals | Not executed | BLOCKED — not executed | — | — |
| 11 Detailed real AI | Retained alternatives through two-user answers/proposal/agreement; Moon Noodles/November7 | Not executed | BLOCKED — not executed | — | — |
| 12 Incomplete real AI | Useful edit/help through two-user agreement; park/November14 | Not executed | BLOCKED — not executed | — | — |
| 13 Recovery | No lost newer edits, duplicate or false unknown success | Not executed | BLOCKED — not executed | — | — |
| 14 Failed-AI fallback | Manual completion, original request preserved | Not executed | BLOCKED — not executed | — | — |
| 15 Membership | Joining leaves existing decisions unchanged; explicit ongoing inclusion preserves answers; finished F stays finished | Not executed | BLOCKED — not executed | — | — |
| 16 Changed answers | Independent joint fixture R; other answers retained and old approvals unusable for new outcome | Not executed | BLOCKED — not executed | — | — |

## Required regression subchecks

For each, give an actual observation, result and evidence path; do not mark these from source inspection alone.

- Successful zero-pending read hides the invitations card; load failure retains a retry notice and groups remain usable.
- Group creation has no false discard prompt; abandoning genuinely unsaved text still warns and Cancel retains it.
- Older recipient's own account refresh, username invite, addressed inbox, acceptance and group membership; no repeated setup assumption.
- Email delivery: unique versus deliberately shared address, actual inbox/copy-link behavior, truthful UI; no identity guessing.
- Choice editor desktop light/dark, phone and short-height screenshots; Choice2 and every input/action reachable without clipping.
- Original idea expands/edits; Back retains work; in-modal example returns to the same draft without a provider call.
- AI and manual routes reach the same shared-choice editor; private preferences remain a later owner-only step. Record confusing labels/navigation separately from save success.
- Both required participants are present before M creation; one person's approval never becomes a two-person agreement.
- AI A/B each reaches a real saved decision, independent private answers and two explicit final approvals. Draft-only success is partial coverage.
- Case15 group membership is separate from explicit decision enrollment; completed F and existing answers stay preserved.
- Case16 runs in independent R even if case15 enrollment failed.

## Screenshot index

Link actual files under this run's evidence directory or exact accessible artifacts: group feedback, public choices/validation, desktop light/dark, phone390×844 and short844×390 editor views, decision modal/public progress, manual and AI final outcomes, and each distinct failure. Record viewport/theme/UTC with each image and verify the file exists and is readable. For unavailable images, state why. Redact credentials, real identities, invitation URLs and private answers first.

## Failure record — repeat for each distinct issue

- Case/substep, UTC, elapsed time, submitted action and known outcome:
- Exact safe visible message; request reference; route/method/status/error code:
- Browser dialog text when relevant; UI/navigation/layout failure versus actual server save/persistence result:
- Supported readback and permitted log lookup/run link, matched diagnostic or exact denial/no match:
- Evidence paths:
- Confirmed facts versus suspected cause and missing evidence:
- Which independent cases continued; exact dependency for each blocked case:
- Duplicate check; linked repair ticket or minimal next diagnostic step:

## Artifacts and final summary

- Owned fixtures removed/retained; unknown writes and private checkpoint location; no assumed cleanup:
- Counts of PASS/FAIL/BLOCKED and LIVE versus INJECTED evidence:
- Core cases 01–12: PASS only if all actually passed on the current release; otherwise partial/not verified:
- Full E2E02: PASS only if all sixteen cases passed with adequate evidence; otherwise unmet cases:
- Same brief sanitized summary given in chat and existing work log/handoff:
- First safe screenshot verified, final report/evidence actually saved/published, and missing-image/log/version evidence listed explicitly:
- Next concrete action and claim release:

No production/MVP readiness or 99.9% reliability percentage can be inferred from this small run.
