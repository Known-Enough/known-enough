# E2E02 — Instructions for the single Luna agent

Read [the ticket](ticket.md), [report template](report-template.md), [credential rules](../E2E01/credentials.md) and [earlier actual results](../E2E01/run-2026-10-16-final.md) first. This file is a test plan, not proof that tests ran. Work on the actual primary website through its normal UI. Never fix product code during this run.

## Set up once

1. Record start UTC, actual model/tool/browser versions and a run ID such as `E2E02-YYYYMMDD-HHMMSSZ`.
2. Verify the primary release against the saved publication baseline or a newer compatible release. Record what is observed versus unavailable; do not assume the latest repository commit is deployed.
3. Privately read `~/.known-enough/e2e-credentials.json` on the execution machine; report only availability/permissions, never values. Use its first account as User 1 and second as User 2. Put each in its own browser context. Do not print secrets or pass literal passwords through shared logs/prompts.
4. Prepare a new run report and evidence directory in this task folder. Before a meaningful click, enable safe network/status observation so the click's UTC, route, HTTP status and request reference can be correlated if it fails. Do not save a full HAR or raw responses with identity/private data.
5. Use only new, clearly owned fixtures. Record created IDs privately as needed and public labels/run IDs in the report. Do not mutate the previous E2E01 group until a supported read confirms ownership/state; an unresolved old cleanup must not consume the entire new run.

## Shared fictional inputs

Use these to make expected choices unambiguous, while evaluating semantics rather than exact AI wording. They are test descriptions, never hardcoded application behavior.

**Manual decision M — Workshop pickup**

Public idea: `We need to choose one shared workshop kit: Paper Kit, Paint Kit or Clay Kit. Pickup can be 2026-11-06 or 2026-11-07. We need one kit and one pickup day. Each person will answer privately.`

- Title: `Workshop Kit Pickup`.
- Topic `Kit`: named choices `Paper Kit`, `Paint Kit`, `Clay Kit`.
- Topic `Pickup day`: exact dates `2026-11-06`, `2026-11-07`.
- Six possible combinations. User 1 can accept Paper Kit or Clay Kit and either day; User 2 can accept Clay Kit and November 7. The common answer is Clay Kit on November 7. If the UI has favourites, they remain preferences, not extra approvals. These private test selections must not appear in shared screenshots/logs.

**AI decision A — Group dinner**

Paste: `We want a fictional group dinner on either 6 or 7 November 2026. The restaurants under consideration are Cedar Kitchen (estimated $18 per person), Moon Noodles (estimated $22) and Garden Table (estimated $32). Decide one restaurant and one date. These prices are supplied examples, not verified quotes. Each participant will add availability, preferences and personal limits privately later.`

Expected public choices: those three restaurants and those two dates, at most six combinations. No question is needed about which of the already supplied dates everyone prefers. Prices may remain in the description; do not expect automatic real-world budget filtering.

**AI decision B — Incomplete outing**

Paste: `Help us choose a group outing. We are considering a museum or a park, but have not agreed on the possible days. Each person's preferences will be supplied privately later.`

Expected: useful editable starting choices and an actionable request for possible days, or clearly labelled suggestions to review. It must not demand the organizer's private preference or repeat an answered question indefinitely. Fill any missing options yourself with `2026-11-14` and `2026-11-15`, or use one explicit optional AI-help request. Do not accept invented availability as a fact.

## Pass 1 — Accounts and a decision without AI

### 01 — User 1 can sign in

Open sign-in in Context 1, fill credentials privately and submit. Expect signed-in identity and the groups/account screen. If rejected, record the exact safe message/status/reference, whether the account or app access is unavailable, and capture a redacted error screenshot. Do not assert wrong password, reset the account or repeat unchanged attempts. Mark this case FAIL or BLOCKED with the actual reason; continue User 2 independently.

### 02 — User 2 can sign in separately

Repeat in Context 2. Expect User 2 identity, not User 1's session. Confirm changing/signing out of one context does not share its session with the other, without destroying an in-progress scenario. Two usable identities are required for later joint cases. A missing credential file is a prerequisite blocker, not a demonstrated sign-in bug.

### 03 — Group creation gives truthful feedback

Use a working user's account as organizer; record which alias. Create `E2E02 <run ID> Workshop` with one click. Observe pending/success/error feedback and network result. Confirm the new group appears, including after a supported refresh. If the UI says no group/error but readback proves creation, record the feedback failure separately from successful persistence. If the write result is unknown, read the organizer's groups before retrying; do not duplicate creation.

### 04 — Rename and reopen

Rename that group to `E2E02 <run ID> Kits`, refresh/reopen and verify the saved name and organizer. Save a safe group screenshot. A known successful rename must not become 'failed' solely because a later group-list refresh fails; document both outcomes.

### 05 — Manual editor saves incomplete work and explains errors

Open the creation modal and choose Add or edit choices without AI (use equivalent current control if copy changed). Start manual input M with a missing topic label or missing option, then check a blank/duplicate option and an invalid exact date in the same owned draft. Expect specific editable prompts, allowed incomplete saving and blocked decision creation until valid. Save/close/reopen: public idea/options survive. Correct to input M. Also check a temporary nine-by-eight named-choice draft shows the 72-combination limit, and reducing it to eight-by-eight clears that validation; no need to create that large decision. Do not call AI for validation. Capture only public editor/prompts.

### 06 — Manual creation works through to a decision

Use the corrected six-combination input M, save and create. Expect one new decision with the chosen short title, exact options/dates and correct group. Open it and read it back after refresh; no duplicate decision and no required AI call. Observe the UI/network path and available correlated usage evidence; do not claim zero provider calls from UI alone if server evidence is unavailable. If the AI inventory fails, this manual route should still work. If a shared backend/account failure also prevents manual saves, record that distinct dependency rather than saying all AI is broken.

## Pass 2 — Two people decide

### 07 — Join the group

If both users work, invite the other existing user to the new group and accept in their own context. Use the supported link/UI, no fresh signup or third account. Confirm both members appear and each retains their own identity. Do not publish the invitation URL. If only one user works, mark this and dependent joint cases BLOCKED; still continue independent AI/editor checks.

### 08 — Opening really opens a clean decision modal

Open M from the group and through its supported direct decision link. Expect the decision itself in a native dialog: short summary/title/status, own saved-answer summary, public participant progress and What works for you? selections. There is no separate shared-choice review or three-step private review gate. Opening submits nothing. Check close/Escape, keyboard focus, unsaved-edit warning, mobile-width fit and light/dark text readability. Capture the public/modal structure with private values hidden.

### 09 — Save independent private answers

Have the organizer save the corresponding private selections from input M before the other person acts. Explicit synthetic processing consent and Save my answers are required, but not peers' prior review. Then save the other person's compatible selections in the other context. Reopen both: each owner sees their own answers; the other person sees permitted progress only. No private-selection or note leakage in shared UI/normal responses; inspect only these owned users' traffic, never enumerate unrelated accounts. Optional AI notes are not mandatory. Do not retain private response bodies or screenshots.

### 10 — Reach and approve an outcome

With compatible answers saved, choose Find an outcome and inspect the proposal through the current UI. Expect Clay Kit on November 7 to be feasible; if several alternatives remain valid, judge the actual accepted selections before declaring a defect. Each person explicitly approves the same current proposal separately. After only one approval the app must not claim both approved. After both, verify the shared outcome/completed status and persistence after refresh, with a sanitized public screenshot. Record any real request/usage and pending state; never infer success from a spinner or a single approval.

## Pass 3 — Real AI and recovery

### 11 — Detailed AI idea produces usable editable choices

Create a separate decision draft using AI input A. Make one explicit request, record its reference and observed elapsed time/status. Expect the supplied restaurant/date alternatives to remain editable and structurally usable without a repeated preference question. Edit its short title to `Group Dinner Plan`, save and create if complete. Confirm saved/public choices, not exact generated prose. If it fails, capture diagnostics and test the manual repair path in case 14; do not repeatedly resubmit the same paid request.

### 12 — Incomplete AI idea helps the organizer finish

Use input B in a separate draft. Expect a targeted missing-day question or editable suggested alternatives, not a dead end. Supply the two example days yourself, or use one explicit Ask AI to help with missing details action. Existing museum/park options must remain unless you deliberately edit them. Complete/save/create and reopen. Record whether help actually improved the draft; a malformed answer is a FAIL with evidence even if manual repair subsequently succeeds.

### 13 — Reload and interrupted-save recovery

On a separate owned public draft, edit and refresh the same context; public idea/choices/checkpoint should survive without participant private answers/passwords being added to the creation cache. Observe a real interruption if available; otherwise delay/drop only this browser's save response and label INJECTED. Read state before retry. Reconciliation must preserve the exact original request key/body, avoid duplicate saves/decisions and never silently create an older plan after newer edits. Separately delay an earlier AI response while making a manual edit: its late result must not overwrite that edit. A known successful save/create remains successful if only the later group-list refresh is made unavailable. If server readback is unavailable, record UNKNOWN rather than claiming backend idempotency passed.

### 14 — Failed AI does not trap the user

Use an observed failure from 11/12, or intercept only the agent's own response/request-inventory read and label INJECTED. Keep the original request status/reference. Expect the public idea/saved work to remain and Add or edit choices without AI to be usable. Manually fix missing choices, save and create one decision. No automatic paid retry, clearing an unknown AI request or overwriting newer manual edits. Record LIVE AI failure and successful manual recovery separately; an injected failure cannot prove real provider behavior.

## Pass 4 — Preserve progress and approvals

### 15 — Joining preserves ongoing and finished decisions

In another owned group with only the organizer, create two simple manual decisions using input M with distinct titles. Save organizer answers on the ongoing one, and complete/approve the other as a one-person decision. Invite the second existing user afterwards. Expect existing ongoing answers/progress to remain without repeat review solely for joining; the new person supplies their own answers where applicable. The finished decision stays finished with the same outcome/historical approvals and no editable answer form. Respect the new member's allowed historical visibility. No third user is needed.

### 16 — Answer changes retire stale approvals

Use the ongoing two-user decision from 15, not completed M. Obtain a proposal and, if supported, one person's approval without completing the decision. The other person changes/saves their own answers. Expect the unchanged person's private answers and shared terms to remain; old proposal/approvals/disclosure permissions cannot approve a new outcome. A new proposal needs fresh explicit approvals. Stale frame/version saves must not mutate a different version. Read only supported state; do not tamper with another person's identity/credentials to test this.

## Failure handling — do this before stopping or retrying

1. Record case/substep, UTC, elapsed time, exact safe visible message and whether the action was submitted once.
2. Capture sanitized method/route, HTTP status, server reference/error code and known pending/completed result. Distinguish response unavailable, timeout, UI refresh failure, explicit server rejection and provider-format rejection.
3. For that reference/time window, use existing permitted project log access as described in [decision debugging](../../../../debugging-decision-drafts.md). Record safe diagnostic category/field path if present. No raw user/model content, secret environment, login response or unrelated log sweep. If denied or no matching event, record exactly that; do not invent a cause or demand CloudShell without a demonstrated need.
4. Capture a screenshot of the relevant public/error UI after redaction. No screenshot of a password field, token, invitation URL or private answer. Include exact evidence path.
5. For an unknown write, use supported read-only status/state first. No blind repeat or deletion. Record the pending record for later recovery.
6. Continue the independent cases that remain possible. Missing the second user does not prevent single-user creation; AI failure does not prevent manual drafting; cleanup is not a substitute for core testing.

## Finish

Write the dated report using [the template](report-template.md), including all sixteen case outcomes and separately labelled LIVE/INJECTED subcases. Keep credentials/private pending checkpoints outside the repository. Remove only positively owned disposable fixtures through supported actions when safe; otherwise record retained IDs privately and sanitized ownership/status in the report. Do not spend repeated retries on cleanup or erase failures. Give the parent worker a short summary, evidence paths, exact blockers and duplicate-checked repair recommendations; it reviews/publishes the report and releases the single claim.
