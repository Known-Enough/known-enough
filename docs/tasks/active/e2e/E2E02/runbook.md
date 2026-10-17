# E2E02 — Instructions for the single Luna agent

Read [the ticket](ticket.md), [published baseline](baseline.json), [report template](report-template.md), [credential rules](../E2E01/credentials.md) and [earlier actual results](../E2E01/run-2026-10-16-test02-test03.md) first. This file is a test plan, not proof that tests ran. Work on the actual primary website through its normal UI. Never fix product code during this run.

## Set up once

1. Record start UTC, actual model/tool/browser versions and a run ID such as `E2E02-YYYYMMDD-HHMMSSZ`.
2. Compare primary public files with baseline.json (frontend117/source6cb97c4) and record available backend metadata/receipt (runtime40ec579/API6f2bff59). Compare the current installed worker hash with the final worker guard, not priorInstalledWorkerSha256 (or the historical actualWorkerSha256 field, which was the pre-update baseline). The latest main documentation commit need not be the deployed app source. Record any newer matching release and relevant differences before proceeding. Unavailable metadata is NOT VERIFIED; do not request A's AWS credentials or infer the old IAM blocker. Preserve any genuinely active worker/claim.
3. Privately read `~/.known-enough/e2e-credentials.json` on the execution machine; report only availability/permissions, never values. Use its first account as User 1 and second as User 2. Put each in its own browser context. Do not print secrets or pass literal passwords through shared logs/prompts.
4. Prepare a new run report and evidence directory in this task folder. Before a meaningful click, enable safe network/status observation so the click's UTC, route, HTTP status and request reference can be correlated if it fails. Do not save a full HAR or raw responses with identity/private data.
5. After sign-in, refresh each user's own account/groups once. This recovers missing username lookup entries for older approved accounts under the published repair. Verify app approval through each owned session; do not create/approve/reset users or install permissions.
6. Use only new, clearly owned fixtures. Record created IDs privately as needed and public labels/run IDs in the report. Do not mutate the previous E2E01 group until a supported read confirms ownership/state; an unresolved old cleanup must not consume the entire new run.

## Execution map and evidence

Keep case IDs, but run **01 → 02 → 03 → 04 → 07 → 05 → 06 → 08 → 09 → 10 → 11 → 12 → 13 → 14 → 15 → 16**. Invite/accept both users before the main draft; joining a group alone does not enroll an existing decision.

- **G:** main two-person group; create manual decision **M** after case07; AI decisions **A/B** also use G.
- **H:** separate membership group for case15, initially organizer-only; retain ongoing **O** and completed **F**.
- **R:** separate ongoing two-person decision in G for case16, independent of case15.
- **SOLO:** label fixtures made while only one account works. Their results cannot prove two-person privacy/approval.

Save actual public screenshots: successful group creation; choice editor in light/dark and phone/short viewports with Choice2 reachable; public decision overview/progress; manual final outcome; usable AI draft/final outcome; distinct failures. Use desktop1280×800, phone390×844 and short844×390 where relevant. Capture one safe screenshot early to verify the artifact pipeline. Collapse/crop private-answer panels and remove credentials, real identities, invitation links and private values. Verify files exist/read correctly before linking; missing images remain evidence gaps.

Observe an AI/outcome action for up to three minutes with visible progress and supported status reads. If still unresolved, retain its reference/checkpoint and record the action as PENDING and the affected case as BLOCKED; continue independent cases without resubmission. The observation window does not authorize clearing an uncertain server request. Keep LIVE and browser-only INJECTED results distinct.

## Shared fictional inputs

Use these to make expected choices unambiguous, while evaluating semantics rather than exact AI wording. They are test descriptions, never hardcoded application behavior.

**Manual decision M — Workshop pickup**

Public idea: `We need to choose one shared workshop kit: Paper Kit, Paint Kit or Clay Kit. Pickup can be 2026-11-06 or 2026-11-07. We need one kit and one pickup day. Each person will answer privately.`

- Title: `Workshop Kit Pickup`.
- Topic `Kit`: named choices `Paper Kit`, `Paint Kit`, `Clay Kit`.
- Topic `Pickup day`: exact dates `2026-11-06`, `2026-11-07`.
- Six possible outcomes. User 1 can accept Paper Kit or Clay Kit and either day; User 2 can accept Clay Kit and November 7. The common answer is Clay Kit on November 7. If the UI has favourites, they remain preferences, not extra approvals. These private test selections must not appear in shared screenshots/logs.

**AI decision A — Group dinner**

Paste: `We want a fictional group dinner on either 6 or 7 November 2026. The restaurants under consideration are Cedar Kitchen (estimated $18 per person), Moon Noodles (estimated $22) and Garden Table (estimated $32). Decide one restaurant and one date. These prices are supplied examples, not verified quotes. Each participant will add availability, preferences and personal limits privately later.`

Expected public choices: those three restaurants and those two dates, at most six possible outcomes. No question is needed about which of the already supplied dates everyone prefers. Prices may remain in the description; do not expect automatic real-world budget filtering. For the complete joint journey: User1 accepts Cedar Kitchen or Moon Noodles and either date; User2 accepts only Moon Noodles and November7. Expected common outcome: Moon Noodles on November7.

**AI decision B — Incomplete outing**

Paste: `Help us choose a group outing. We are considering a museum or a park, but have not agreed on the possible days. Each person's preferences will be supplied privately later.`

Expected: useful editable starting choices and an actionable request for possible days, or clearly labelled suggestions to review. It must not demand the organizer's private preference or repeat an answered question indefinitely. Fill any missing options yourself with `2026-11-14` and `2026-11-15`, or use one explicit optional AI-help request. Do not accept invented availability as a fact. Once the organizer reviews museum/park and November14/15 as shared alternatives: User1 accepts either outing but only November14; User2 accepts only park and either date. Expected common outcome: park on November14.

## Pass 1 — Accounts, membership and a decision without AI

### 01 — User 1 can sign in

Open sign-in in Context 1, fill credentials privately and submit. Expect signed-in identity and the groups/account screen. If rejected, record the exact safe message/status/reference, whether the account or app access is unavailable, and capture a redacted error screenshot. Do not assert wrong password, reset the account or repeat unchanged attempts. Mark this case FAIL or BLOCKED with the actual reason; continue User 2 independently.

### 02 — User 2 can sign in separately

Repeat in Context 2. Expect User 2 identity, not User 1's session. Confirm changing/signing out of one context does not share its session with the other, without destroying an in-progress scenario. Two usable identities are required for later joint cases. A missing credential file is a prerequisite blocker, not a demonstrated sign-in bug.

### Dashboard regression from INV01 — verify during 01–03

After account and groups return successfully, the browser must attempt the exact authenticated `/invitations` read; a local `Invalid API path` must not prevent it. A successfully loaded empty inbox shows no invitations card, zero badge or empty-inbox sentence. If invitations alone cannot load, validated groups remain visible with a clear invitations retry notice, rather than a full-page groups-format error or a false zero-invitation claim. Record the actual request/status and frontend source. This is a user-reported confirmed client-route defect; do not reuse the earlier public smoke as authenticated evidence.

### 03 — Group creation gives truthful feedback

Use a working user's account as organizer; record which alias. Create `E2E02 <run ID> Workshop` with one click. Observe pending/success/error feedback and network result. Confirmed creation should open the saved group without the false “Leave this view and discard unsaved input?” prompt. Monitor real browser dialogs instead of automatically dismissing them. Confirm persistence after a supported refresh. Separately verify leaving genuinely unsaved group-name text still warns; cancel that navigation and retain the text. If the UI says no group/error but readback proves creation, record the feedback failure separately from successful persistence. If the write result is unknown, read the organizer's groups before retrying; do not duplicate creation.

### 04 — Rename and reopen

Rename that group to `E2E02 <run ID> Kits`, refresh/reopen and verify the saved name and organizer. Save a safe group screenshot. A known successful rename must not become 'failed' solely because a later group-list refresh fails; document both outcomes.

### 07 — Invite and join before the main draft

Run this immediately after04, before05/06. Use User1's group-local Send invitation with User2's exact login username. Both users have already refreshed their own accounts. Verify sending exists only inside the group and there is no replacement/lost-link checkbox. User2's main Groups page should show the addressed group, organizer and expiry; explicitly accept there. Confirm both distinct members appear in G, the pending item disappears, and a confirmed empty inbox card disappears. The organizer's group snapshot must not expose recipient login/email/hash/token. Only then start M.

In a second owned group, reverse roles and check email invitation. Use [verifiedSessionProfile](../../../../../scripts/live-qa/browser-recovery.mjs) with the recipient’s own session and configured domain: native SRP sessions use token-authorized Cognito GetUser; PKCE sessions use that domain’s user-info endpoint. Hosted user-info HTTP401 for an SRP token is not an unavailable verified email. Keep the returned identity/email private; publish only lookup status, verified/matching booleans and delivery mode. Privately establish the recipient's verified email through a supported own-session provider/profile read; never guess from a display name or export tokens/emails. Distinct uniquely resolvable emails should yield the addressed inbox item. If these synthetic accounts deliberately share an email, do not assert it identifies exactly one account: exercise the supported private copy-link fallback in the intended recipient context, record actual delivery mode and whether UI guidance is truthful. No third account/signup. A missing verified identity blocks only the dependent email subcase, not username membership or the other journeys. An unavailable username path gets a fresh HTTP/reference diagnostic; do not assume the historical IAM gap persists.

### 05 — Manual editor saves incomplete work and explains errors

Open the creation modal and choose Add or edit choices without AI (use equivalent current control if copy changed). Start manual input M with a missing topic label or missing option, then check a blank/duplicate option and an invalid exact date in the same owned draft. Expect specific editable prompts, allowed incomplete saving and blocked decision creation until valid. Save/close/reopen: public idea/options survive. Correct to input M. Also check a temporary nine-by-eight named-choice draft shows the 72-combination limit, and reducing it to eight-by-eight clears that validation; no need to create that large decision. Do not call AI for validation. Check desktop/phone/short-height layouts and both themes: Choice1/Choice2 and all controls are reachable, text fits, and scrolling does not clip content. At normal heights Save draft/Create decision remain outside the form scroll area; the short-height outer-scroll fallback may make the whole dialog scroll. Expand/edit the retained original idea, return via Back, and open/return from See an example without losing work or making a provider call merely to read the example. Record confusing copy/transitions separately; the suggested “Enter the options yourself” label is not deployed. Save actual public editor/viewport screenshots.

### 06 — Manual creation works through to a decision

Use corrected input M in G after case07. Verify the saved draft includes both distinct users as required participants before creating once. A draft started before joining must be replaced by a fresh current-roster draft; do not silently reuse it. Expect one new decision with the chosen short title, exact options/dates and correct group. Open it and read it back after refresh; no duplicate decision and no required AI call. The confirmed-create transition must not trigger a spurious discard warning. Rename this decision to `Shared Kit Pickup` and reopen, verifying unchanged choices and participants. Observe the UI/network path and available correlated usage evidence; do not claim zero provider calls from UI alone if server evidence is unavailable. If the AI inventory fails, this manual route should still work. If a shared backend/account failure also prevents manual saves, record that distinct dependency rather than saying all AI is broken.

## Pass 2 — Two people decide

### 08 — Opening really opens a clean decision modal

Open M from the group and through its supported direct decision link. Expect the decision itself in a native dialog: short summary/title/status, own saved-answer summary, public participant progress and What works for you? selections. Verify both expected participants are present. There is no separate shared-choice review or three-step private review gate. Opening submits nothing. Check close/Escape, keyboard focus, unsaved-edit warning, mobile-width fit and light/dark text readability. Capture the public/modal structure with private values hidden.

### 09 — Save independent private answers

Have the organizer save the corresponding private selections from input M before the other person acts. Explicit synthetic processing consent and Save my answers are required, but not peers' prior review. Then save the other person's compatible selections in the other context. Choose the acceptable-options mode, not just an optional favourite. For M, User1 selects Paper Kit/Clay Kit and either day; User2 selects only Clay Kit and November7. Verify both owners saved once and the public progress shows two saved participants. Reopen both: each owner sees their own answers; the other person sees permitted progress only. No private-selection or note leakage in shared UI/normal responses; inspect only these owned users' traffic, never enumerate unrelated accounts. Optional AI notes are not mandatory. Do not retain private response bodies or screenshots.

### 10 — Reach and approve an outcome

With compatible answers saved, choose Find an outcome and inspect the proposal through the current UI. Expect Clay Kit on November 7 to be feasible; if several alternatives remain valid, judge the actual accepted selections before declaring a defect. Use See proposal and explicitly review/Approve this exact proposal in each context. The proposal must require two distinct participants; a one-person roster/result cannot pass this joint case. Each person approves the same current proposal separately. After only one approval the app must not claim both approved. After both, verify the shared outcome/completed status and persistence after refresh, with a sanitized public screenshot. Record any real request/usage and pending state; never infer success from a spinner or a single approval.

## Pass 3 — Real AI and recovery

### 11 — Detailed AI idea produces usable editable choices

Create a separate decision draft using AI input A. Make one explicit request, record its reference and observed elapsed time/status. Expect the supplied restaurant/date alternatives to remain editable and structurally usable without a repeated preference question. Edit its short title to `Group Dinner Plan`, save and create if complete. Confirm saved/public choices, not exact generated prose. Verify AI and manual entry converge on the same editable choices screen with original idea retained. Complete both users' private answers from input A, Find an outcome, review and approve separately, then reopen the agreed result. A created AI draft alone does not pass this case. If it fails, capture diagnostics and test the manual repair path in case 14; do not repeatedly resubmit the same paid request.

### 12 — Incomplete AI idea helps the organizer finish

Use input B in a separate draft. Expect a targeted missing-day question or editable suggested alternatives, not a dead end. Supply the two example days yourself, or use one explicit Ask AI to help with missing details action. Existing museum/park options must remain unless you deliberately edit them. Complete/save/create and reopen. Use the private selections from input B, reach the expected compatible proposal and obtain two explicit approvals. Record whether help actually improved the draft; a malformed answer is a FAIL with evidence even if manual repair subsequently succeeds.

### 13 — Reload and interrupted-save recovery

On a separate owned public draft, edit and refresh the same context; public idea/choices/checkpoint should survive without participant private answers/passwords being added to the creation cache. Observe a real interruption if available; otherwise delay/drop only this browser's save response and label INJECTED. Read state before retry. Reconciliation must preserve the exact original request key/body, avoid duplicate saves/decisions and never silently create an older plan after newer edits. Separately delay an earlier AI response while making a manual edit: its late result must not overwrite that edit. A known successful save/create remains successful if only the later group-list refresh is made unavailable. If server readback is unavailable, record UNKNOWN rather than claiming backend idempotency passed.

### 14 — Failed AI does not trap the user

Use an observed failure from 11/12, or intercept only the agent's own response/request-inventory read and label INJECTED. Keep the original request status/reference. Expect the public idea/saved work to remain and Add or edit choices without AI to be usable. Manually fix missing choices, save and create one decision. No automatic paid retry, clearing an unknown AI request or overwriting newer manual edits. Record LIVE AI failure and successful manual recovery separately; an injected failure cannot prove real provider behavior.

For an injected delayed response, use [captureDelayedResponse](../../../../../scripts/live-qa/browser-recovery.mjs). Playwright route.fetch returns APIResponse, whose headers() method is synchronous; it has no allHeaders() method. Capture the one server response, open/edit the manual choices while it is held, then release that same response exactly once. Assert the newer local name/options survive and the earlier AI draft is listed separately. A helper failure after receiving the response must deliver that response without fetching it again; preserve UNKNOWN if delivery cannot be confirmed.

## Pass 4 — Preserve progress and approvals

### 15 — Joining preserves existing decisions

Use H, not completed M. Before inviting User2, create organizer-only ongoing O and completed/approved F using M's public choices with distinct titles. Save User1's answers on O; record F's completed outcome and approval count. Invite/accept User2 afterwards. Joining alone must leave O's existing answers/participants unchanged and F finished; it does not automatically enroll User2 into either decision.

Separately, the organizer may use Update decision participants on O to explicitly include the new person. After the supported addition, User1's existing answers/confirmations must remain and User2 supplies its own; no repeat review solely for joining. F must retain its recorded outcome/participants even if a participant-update control is offered. Record misleading old reset-copy as a UI finding separately from actual state. Never modify F's terms or re-open a completed result to force a pass. If enrollment is unavailable, report that subcase; continue independent case16 in G.

### 16 — Answer changes retire stale approvals

Create R as a fresh two-person manual decision in G, using M's public choices; do not reuse completed M/A/B or depend on case15 enrollment. Save both compatible inputs. Obtain a proposal and, if supported, one person's approval without completing the decision. The other person changes/saves their own acceptable options to create a different common outcome (for M's choices: User2 switches from Clay Kit/November7 to Paper Kit/November6; User1 already allows Paper Kit and either day). Expect the unchanged person's private answers and shared terms to remain; old proposal/approvals/disclosure permissions cannot approve a new outcome. A new proposal needs fresh explicit approvals. Stale frame/version saves must not mutate a different version. Read only supported state; do not tamper with another person's identity/credentials to test this.

## Failure handling — do this before stopping or retrying

1. Record case/substep, UTC, elapsed time, exact safe visible message and whether the action was submitted once.
2. Capture sanitized method/route, HTTP status, server reference/error code and known pending/completed result. Distinguish response unavailable, timeout, UI refresh failure, explicit server rejection and provider-format rejection.
3. For that reference/time window, use existing permitted project log access as described in [decision debugging](../../../../debugging-decision-drafts.md). Record safe diagnostic category/field path if present. Native invitation failures now support `known-enough.group-failure` / `group.invite` UUID correlation, while draft and private-save diagnostics retain their own event types. No raw user/model content, secret environment, login response or unrelated log sweep. If denied or no matching event, record exactly that; do not invent a cause or demand CloudShell without a demonstrated need.
4. Capture a screenshot of the relevant public/error UI after redaction. No screenshot of a password field, token, invitation URL or private answer. Include exact evidence path.
5. For an unknown write, use supported read-only status/state first. No blind repeat or deletion. Record the pending record for later recovery.
6. Continue the independent cases that remain possible. Missing the second user does not prevent single-user creation; AI failure does not prevent manual drafting; cleanup is not a substitute for core testing.

## Finish

Write the dated report using [the template](report-template.md), including all sixteen case outcomes and separately labelled LIVE/INJECTED subcases. Keep credentials/private pending checkpoints outside the repository. Remove only positively owned disposable fixtures through supported actions when safe; otherwise record retained IDs privately and sanitized ownership/status in the report. Do not spend repeated retries on cleanup or erase failures. Give the parent worker a short summary, evidence paths, exact blockers and duplicate-checked repair recommendations; it reviews/publishes the report and releases the single claim.
