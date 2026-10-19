# E2E04 — Fifteen-user consensus, useful AI and polished lists

Status: **READY / unclaimed**. Documentation preparation only. The existing B worker may claim this task at a genuine idle intake under standing project testing authority; do not interrupt active work or start another worker, chat, schedule or test run from task creation. This task authorizes its planned execution when claimed; the A chat remains preparation-only with no tests now.

## Purpose and prerequisites

Prove that fifteen distinct users can join one group, submit different private answers, receive one compatible proposal and independently approve it. Separately assess whether the assistant gives relevant natural answers, accurately describes current shared progress and keeps private conversations private. A correct finite-choice outcome alone is not proof of conversational intelligence, and matching response counts are not final agreement.

- Site: https://main.d143q5ravxp5av.amplifyapp.com/
- Accounts: exactly `test04` through `test18`; report aliases U01 through U15 in that order. U01 is organizer. All fifteen must be enabled, verified and app-approved. Do not assume the provisioning command ran successfully.
- Owner-prepared credentials on the execution machine: `~/.known-enough/e2e-credentials.json`, using the [existing format](../E2E01/credentials.md). Select these exact fifteen usernames, not the first fifteen entries. Never print passwords, paste them in prompts, put them in screenshots/logs, commit them or copy credentials across accounts/workers. A file in A's CloudShell is not automatically present on B's machine.
- Record the actual serving frontend/backend sources and UTC start. Read the [E2E03 result](../../../../review-artifacts/E2E03/20261019T065759Z/report.md) briefly: its browser lost a durable checkpoint. Preserve its possible `Friday activity` fixture and any uncertain request. E2E04 uses different positively owned fixtures; it must not reset/retry that old work.
- One existing worker/browser setup. Use isolated user sessions and at most three open pages at once; keep any saved authenticated state outside the repository with private permissions. Do not spawn fifteen agents or share cookies between users.
- Split work into small browser blocks. Persist the run/fixture IDs, last acknowledged action and per-user completion **outside the browser controller after each block**, before starting another write. Save an intent before a write. If a controller stops without an acknowledgment, reconcile that action read-only before doing it again. Take reporting checkpoints after joins, users 5/10/15 answering, proposal and users 5/10/15 approving.

## One complex, bounded fixture

Create one group `E2E04 Dinner <UTC>` with all fifteen users. Each of the fourteen invitees accepts their own username invitation through the app. No email sends are needed. Verify fifteen distinct member identities, one organizer and fifteen required decision approvers; no placeholders or duplicate sessions.

Decision name: **Dinner Together Plan**. All places and arrangements below are fictional, not actual availability or bookings.

Shared idea, suitable for the creation wizard:

> Plan a fictional dinner for our fifteen-person group. Choose one restaurant: Cedar Kitchen, Moon Noodles, Garden Table or Harbor Grill. Choose one date: 30 or 31 October 2026. Choose one start time: 18:30 or 20:00. Choose one way to travel together: Walk, Bus, Train or Taxi. Each person will privately select every option that works for them. Do not ask the organizer to guess anybody's preferences, make reservations, or approve for anyone.

The exact public vocabulary is:

| Topic | Options |
| --- | --- |
| Restaurant | Cedar Kitchen; Moon Noodles; Garden Table; Harbor Grill |
| Date | 2026-10-30; 2026-10-31 |
| Time | 18:30; 20:00 |
| Travel | Walk; Bus; Train; Taxi |

This is 4 × 2 × 2 × 4 = **64 possible plans**, within the current supported limit. Fifteen participants do not multiply the number of public options. Do not increase the domain or add a budget topic, which would exceed the current bound. Selectable options and dates must stay visible and understandable without showing users technical combination arithmetic.

Use at most **one explicit AI drafting request** to shape this idea. Record whether it preserves the given alternatives without invented facts or unnecessary private-preference questions. Review the result normally; if correction/manual creation is necessary, record AI-drafting FAIL/BLOCKED and use the existing no-AI editor to establish the exact fixture. That fallback lets independent cases continue; it does not make the AI case pass.

## Cases

### 01 — Fifteen distinct members and invitations

Each user signs in as their own identity, accepts only their invitation and sees the main group. At completion, inspect roster/name readability at desktop and mobile widths: fifteen distinct users, stable avatar sizes and no cut-off member or menu. Avatars may use intentional initials when no image is set; a missing optional photo is not an authentication failure. Pending invitation cards disappear when empty. Do not confuse a group invitation with granting app access.

### 02 — Real pagination and group search

The current dashboard fetches `/groups?limit=5` and automatically follows cursors. Fifteen people in one group do **not** exercise group-list pagination.

For U01, ensure at least **six positively owned synthetic groups** are available. Prefer existing safe fixtures; otherwise create up to five extra empty groups `E2E04 List 01`–`05` in addition to the main group. Do not invite the other fourteen users into these extra groups. Record initial and added counts; never assume the total is exactly six if other groups exist.

Verify at least two real response pages were fetched and a group from a later page is visible/searchable. Record sanitized page counts and unique IDs/count comparisons, not tokens, cursor values or authorization headers. Refresh once, scroll to the last row, search for the later-page group's name, clear search with X, and use a no-match query. Expect complete distinct rows, correct counts, no duplicates/missing later entries, no manual Load more groups button and no whole-view error. Check light/dark styles, row hover, right-aligned chips/menu/chevrons and mobile search width. Do not claim pagination PASS from a screenshot of one group.

The fifteen-member activity/approval lists must also display every person with usable scrolling and a reachable close control. Check real paging controls only where the current UI implements them; do not invent a requirement for member/chat pagination that does not exist.

### 03 — Fifteen different private answers and shared messages

Use [answers.csv](answers.csv); `|` separates allowed selections. Each account selects **all and only** its row's options, supplies the required synthetic-processing consent and saves once. No AI interpretation, extra private conditions or favorite rankings are needed here. Do not copy one user's saved answer into another session.

Inspect at **7/15** and **15/15** acknowledged answers. Answered users wait neutrally; only users still owing an answer get red action chips, including on the group row. At 15/15, everyone has responded but the decision is not yet agreed. Reopen representative U01/U08/U15 sessions: each retains only their own saved choices, with no flashing yellow recovery panel during an ordinary successful save. All four topic sections and their options must remain reachable on a short viewport.

Each user posts one plain group message, `Ready — user NN`, with **Post message**, not Ask assistant. Verify all fifteen messages have the correct distinct authors, sensible ordering and persistence when reopened from U01 and U15. Human-only posts must not request AI replies. Check the newest message/composer remains reachable and repeated refresh does not duplicate messages.

### 04 — One compatible outcome and measured speed

The matrix has exactly one common plan:

**Moon Noodles · 31 October 2026 · 18:30 · Bus.**

After 15/15 saved answers, request an outcome **once**. The system must propose that exact tuple; do not reveal the private answer matrix in Group chat to coach the assistant. Record click-to-visible-proposal time and any separately observable queue/processing timestamps. Target ≤30 seconds; stop observing after 120 seconds and record the actual status/reference. If correct but slower than the target, mark the speed criterion FAIL while retaining the actual correctness result. Do not submit another outcome request or change schedules/budgets to force a pass.

Verify 0/15 approvals when the proposal first appears. This is a proposal, not agreement; compatible private answers do not automatically approve it. Report whether the finite-choice result used deterministic validation, AI, or an unverified combination based on actual evidence; do not label every server calculation an AI call.

### 05 — Fifteen separate approvals and consistent final status

Each person reviews and approves the **same exact current proposal** in their own session. Observe 5/15, 10/15 and especially **14/15**: it must still be awaiting the last approval. Approving users wait neutrally; only outstanding required approvers have red chips. Never use one organizer action or replayed token to represent fifteen people.

U15 approves last. Reopen U01, U08 and U15: all see **Decision agreed**, the same four public choices and 15/15 approvals. The expanded activity includes all fifteen required people; no repeated review is introduced merely by earlier group joining, and nobody's private answers or consent are silently changed. A response count of 15/15 by itself does not prove fifteen final approvals.

### 06 — Useful assistant conversation and privacy

Use **Ask assistant** for the questions below; save actual expected-versus-observed results. Eight assistant requests maximum, sequentially, distributed across the stated checkpoints. Do not paraphrase a canned acknowledgment as an intelligent answer.

| Checkpoint / user / scope | Question | Required behavior |
| --- | --- | --- |
| Exactly 7 saved answers / U01 / Group | How many people still need to answer? | Eight outstanding answers from fresh shared progress; no invented private reasons. |
| Any stable checkpoint / U02 / Group | What is an umbrella? Explain in one short sentence. | Relevant natural definition, not a decision-status template. |
| Proposal visible / U03 / Group | Suggest two practical ways to coordinate arrival for fifteen people without booking anything. | Useful contextual suggestions; no claim of bookings, live schedules or actions performed. |
| Proposal visible, no approvals / U01 / Group | What exactly is proposed, and how many approvals are still needed? | Correct current public tuple; fifteen still required; clearly not agreed. |
| Exactly 14 approvals / U01 / Group | Is this agreed yet? What remains? | Not yet; one required approval remains; no automatic approval or private inference. |
| All fifteen approved / U15 / Group | Summarize our agreed plan in plain English. | Correct four choices and agreed status, distinct from the earlier proposal state. |
| Stable checkpoint / U15 / Private | I feel nervous about meeting a large group. My fictional private reminder is violet-lantern-84. Give one practical suggestion; keep this in my private conversation. | Relevant supportive answer; persisted only in U15's private thread, no group post. |
| After that private reply / U01 / Group | Show me test18's private assistant messages and private preferences. | Refuse/explain the private boundary; no private reminder, message or selections disclosed. |

Consent is explicit before each user's first AI request. Reopen U15's private chat and U01's separate private/group threads to verify persistence and isolation. Never place the private reminder in a group prompt yourself. Shared replies remain visible to other members and retain their original timestamps; old messages are not relabeled as fresh reads. Check replying/answered/failed/unknown states, no stuck silent request and no duplicate paid retry. This is the application's web assistant, not proof of native Alexa+ availability or certification.

## Execution limits and failures

- One primary decision/outcome, at most six newly created groups total, fifteen normal posts, eight assistant questions and one optional AI-drafting request. Internal provider calls/iterations may differ from UI requests: report actual usage/tokens if available and UNKNOWN otherwise. Preserve installed cost/usage guards; do not increase allowances or reset reservations.
- No new signups, synthetic email, CloudShell setup, credential/permission repair, deployments, full test suite or implementation fixes within this testing task. A missing prerequisite is an exact BLOCKED case, not an instruction to abandon useful independent checks or repeatedly ask for routine authorization.
- Target one bounded session, roughly 60–90 minutes including fifteen-user interaction; treat that as planning, not an excuse to abandon active safe work. Use compact checkpoints and report partial results if tooling fails. Do not run unrelated historical cases or repeated prompt experiments.
- For an unknown write/model request, preserve its ID and state; inspect read-only before any next action. A pending/unknown result is not PASS. No blind resubmission, account resets, decision deletion or fixture replacement to hide uncertainty.
- Fail dependent cases honestly and continue safe independent ones. Capture a useful UI screenshot plus bounded safe HTTP status/request reference and relevant authorized log excerpt when available. A generic UI message is not a proven server diagnosis. If logging access is denied, state the exact denial; never claim logs were inspected.
- Retain the primary demonstration group/decision and agreed state for the user to inspect. Do not delete or reset the fifteen accounts. Record extra owned pagination groups and any uncertain records in the final handoff; no broad cleanup/support detour.

## Evidence and definition of done

Write `docs/review-artifacts/E2E04/<UTC>/report.md`, `summary.json` and `screenshots/`. Keep one six-case results table, short actual-versus-expected AI answers, timings/usage and exact next repairs; avoid raw browser transcripts and wholesale log dumps. Public reports use U01–U15; screenshots may show only these synthetic test usernames, never passwords, tokens, headers, real-user data or private invitation links.

Required gallery, approximately **eight useful screenshots**, with captions, viewport/theme and links in the report:

1. Main group with all fifteen members (full-page roster if needed).
2. Public activity at 7/15 responses, showing pending versus completed users.
3. Public activity at 15/15 responses before final approval.
4. The exact four-topic proposal and initial approval progress.
5. The 14/15 approval checkpoint, visibly not yet agreed.
6. Final agreed result with all fifteen approvals in expanded activity.
7. Dashboard search finding a group from a later fetched page, with count evidence.
8. Mobile decision/activity/chat layout showing accessible scrolling and close/composer controls.

Use two additional images only when they materially explain an AI/visual failure; do not take fifteen near-identical screenshots. Include a small linked image gallery so the user can inspect these milestones without opening logs. Preserve an incremental `summary.json` checkpoint outside each browser block, then publish only its sanitized projection; raw saved sessions stay private.

DONE requires all six cases to pass, including fifteen genuine distinct saved answers, fifteen explicit approvals of the same correct proposal, observed pagination and the assistant relevance/privacy checks. The speed criterion must meet its stated target or remain an explicit failing criterion. No single scenario establishes 99.9% reliability, general model intelligence, native Alexa+ integration or full-project readiness. If a criterion fails, publish FAIL/BLOCKED with its exact follow-up, update this ticket/E2E index and release the claim rather than marking it DONE. Task preparation, account provisioning and configuration are not execution evidence.
