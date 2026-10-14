# Follow-up button repair

User request: show decision-wizard requirements explicitly and repair the button that remains disabled after entering a follow-up answer.

Reviewed published wizard source `470a0edc2473ad8244959bfddef9007a13e38774`, integrated through clean `f1972f4780d6ee039a085a009d33d3f8fbe62e36`.

## Findings and changes

A successful draft response calls `finishRequest`, which disables drafting until a new saved-request inventory completes. A failing inventory leaves `requestLookupAvailable=false`. Follow-up text remains editable, but its submit button is disabled. Previously the follow-up did not explain this requirement or offer an in-place inventory retry. The repair gives every wizard step the current request requirement and supplies a bounded read-only retry that preserves objective and answers. Inventory lookup aborts after 15 seconds and offers recovery instead of an indefinite wait. Request identity, pending/unknown outcomes and server release checks are retained.

The follow-up button also requires saved wording (`dirty=false`); previously its Save control existed only on Review. The follow-up now explains this condition and makes Save changes available when needed. It shares the existing revision-guarded save behavior and resets review consent after a save.

Visible requirements explain nonempty answers for every question, the 200-character per-answer limit, the 2,000-character combined objective/question/answer limit, saved-request checks, saving edits and explicit review before creation. Both answer and combined counts are displayed. The guide states that AI prepares drafts and users can edit them before creation; fully manual creation is not currently offered.

The user's screenshot does not expose internal component state, so its precise original gate is not established. The failed post-save inventory path is reproduced with synthetic browser/API interception; no user session, personal inputs or live AI call are used.

## Verification

Focused normal follow-up, failed-inventory recovery with preserved answer, known-request release and unknown-request refusal: 4/4 browser cases pass. Existing onboarding, exact participant qualification and save/review browser checks updated for the already published modal controls. Full pinned `npm run check` passed: references7/planning15/lint543/typecheck/build, unit1617PASS with2 optional skips, hosted preview1PASS, browser85/85PASS. Initial syntax error corrected before verification; initial browser harness failed on assuming one StrictMode mount and launch-time inventory readiness, corrected to target the post-draft request and await the actual check. No application assertion or timeout was weakened. Six generated historical captures were preserved privately and restored to committed evidence. Frontend publication [38628946622](https://github.com/Known-Enough/known-enough/actions/runs/38628946622) succeeded on checked source `90ff10419c33570458c202ba2f80d95f55713b53`, Amplify92. Independent live HTTP200/SHA256 verification matched all7 published files. Setup readback passed on the exact existing API hash with0 configuration/data/provider writes. [Sanitized receipt](follow-up-button-publication.json). Bounded UI repair complete and claim released; user manual acceptance and whole FIX01 criteria remain separate.

Read-only live setup inspection [38628239415](https://github.com/Known-Enough/known-enough/actions/runs/38628239415) succeeded on `f1972f4`; independently read API SHA256 `83d794ac6cd4fe204f30a320c4e34537b683b76da3aedb6a106f9077dff6f663`, configuration/data/provider writes zero. This frontend repair does not publish backend code, modify AI controls or approve participant needs. Whole FIX01 live model acceptance remains separate from this bounded UI repair.
