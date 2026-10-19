**DONE — final live readback passed, 2026-10-19T23:10Z.** Using the existing agreed fixture, both users reopened the decision after the owner-read repair. Fresh owner reads returned AGREED, 2/2 answers, 2/2 approvals, their own distinct saved selections and the exact pinned proposal; each list showed “Decision agreed.” Case01’s acknowledged saves and case02’s one outcome/two approvals are documented in the preceding run, with this readback closing the only remaining final-reopen gap. This run made zero app writes/provider requests; case03 optional assistant remains NOT_RUN. The prior underlying network error is still unproven; the repaired path passed for both users. [Final readback report](../../../../review-artifacts/E2E03/20261019T230825Z/report.md) · [Events](../../../../review-artifacts/E2E03/20261019T230825Z/events.jsonl) · [Summary](../../../../review-artifacts/E2E03/20261019T230825Z/summary.json).

# E2E03 — Cheap, focused regression check

**Final reopen repair PUBLISHED — source1f7d441 / frontend152; repair claim released.** Participant loading and background polling now use one authenticated owner response containing the current shared snapshot. Native owner responses advertise installed queue capability; the renamed-title lookup is bounded/nonblocking. Source/owner/context/privacy/approval guards remain. API/worker/frontend and restored ENABLED schedule readbacks passed; no product tests or participant/AI actions during repair. [Repair](../../../../review-artifacts/E2E03/owner-read-repair.md) · [Receipt](../../../../review-artifacts/E2E03/owner-read-publication.json). **Next acceptance is read-only on the latest 20261019T224223Z agreed checkpoint; no outcome, answer or approval may be repeated.** Historical case02 remains BLOCKED pending actual final readback.


## Latest run — 2026-10-19T22:42Z

**Case01 PASS; case02 BLOCKED at final U1 reopen; run closed/claim released.** Published runtime1117433/API9e9c3672/worker37bcbd5c/frontend151. Both distinct synthetic users signed in, reconciled the existing fixture, reopened and matched their own different saved choices. Both decision chips were neutral Ready for outcome. Prior acknowledged answers reused without another save. One outcome returned Board games in25.4s; U1 and U2 explicitly approved the same proposal once each (both HTTP200). U1 initially saw1/2; U2's fresh owner read then confirmed AGREED/2approvals. U1's final reopen hit two browser `net::ERR_FAILED` public reads, followed by DECISION_VIEW_NOT_READY; final cross-user agreement/persistence remains unverified. No outcome/approval retry. Case03 NOT_RUN. Owned AI job SUCCEEDED/one attempt/2419input+28output tokens; provider-call count and billed cost unrecorded. Safe logs show six classified storage-read recoveries but do not establish the final network cause. Case02 image unavailable because the runner's global two-image cap was exhausted by case01. Group-wide chips not asserted in the reused multi-decision group. [Report](../../../../review-artifacts/E2E03/20261019T224223Z/report.md) · [events](../../../../review-artifacts/E2E03/20261019T224223Z/events.jsonl) · [summary](../../../../review-artifacts/E2E03/20261019T224223Z/summary.json). Preserve the agreed fixture; next step is a read-only U1 result check and investigation of the public-read transport/rate/CORS path, without repeating any write.


**Network/read repair PUBLISHED — 2026-10-19T22:09Z / claim released.** API `1117433` / `9e9c3672`, worker `37bcbd5c`, frontend `656c3dc` / Amplify151; prior schedule and admission restored ENABLED. Early API errors retain exact-origin headers, safe UUIDs and bounded stage diagnostics; the ephemeral loopback transport closes its per-invocation connection. GETs recover at most once within the original deadline, while commands/approvals/AI requests never replay. Account/decision loading can show a safe server reference. Static/build/publication guards passed; **no tests or participant/AI calls**. Exact historical initiating error remains unproven; live acceptance remains pending and the prior E2E03 BLOCKED result is unchanged. [Repair](../../../../review-artifacts/E2E03/network-read-repair.md) · [Receipt](../../../../review-artifacts/E2E03/network-read-publication.json).

## Latest attempt — 2026-10-19T21:52Z

**BLOCKED; run closed.** Two synthetic users signed in and reconciled the same existing two-member group, draft and decision. U1 already had a private answer. U2's planned answer was submitted once, returned HTTP200 and appeared in U2's own saved-answer view. After one read-only refresh, U2's decision could not be reopened before the runner timed out. Several `/decisions/:id/me` requests ended with browser `net::ERR_FAILED`; one later returned200, and a concurrent `/account` request also failed at the network layer. No server response/reference was available for the timeout. The runner was closed; no answer was resubmitted. Case01 remains BLOCKED because post-reload persistence/isolation could not be verified; case02/03 NOT_RUN. One app write accepted; no outcome or assistant requests. [Run report](../../../../review-artifacts/E2E03/20261019T215250Z/report.md) · [events](../../../../review-artifacts/E2E03/20261019T215250Z/events.jsonl) · [summary](../../../../review-artifacts/E2E03/20261019T215250Z/summary.json). Next: diagnose browser network/open-decision failure, then read U2's saved answer before any new write.



**Account-read/runner stability repair PUBLISHED / repair claim released:** runtime source `9569a82`, API `54a4c508`, worker `b6da4204`; admission and the prior schedule restored ENABLED. Bounded classified read-conflict recovery, failed-cache eviction, correlated safe cancellation diagnostics, catalog-only bounded runner reads/navigation and bounded command acknowledgment reads. Static/native compilation checks passed; no app tests or AI calls. E2E03 live acceptance remains pending; [repair](../../../../review-artifacts/E2E03/account-read-stability-repair.md), [publication](../../../../review-artifacts/E2E03/account-read-stability-publication.json).

## Latest attempt — 2026-10-19T19:03Z

**BLOCKED before case 01; claim released.** The latest independent-answer repair at source `eb66a97` was not exercised: U1 signed in, but U2 `GET /account` returned HTTP 503 while `/account/profile` returned 200. One read-only refresh eventually returned six groups after about 140 seconds; the runner exited before fixture reconciliation or U2 answer-state read. No app writes, outcomes or assistant requests occurred.

The bounded sanitized log read ([workflow 39308288904](https://github.com/Known-Enough/known-enough/actions/runs/39308288904), [readback](../../../../review-artifacts/E2E03/20261019T190351Z/server-account-readback.json)) found a time-window `account.status` failure with `SESSION_STORAGE_UNAVAILABLE` caused by `TransactionCanceledException`. Correlation is window-only; the transaction cancellation subreason is unavailable. This is a separate account-loading blocker, so the independent-answer repair remains unverified. U1’s existing answer is preserved; U2’s answer state is unknown.

[Run report](../../../../review-artifacts/E2E03/20261019T190351Z/report.md) · [events](../../../../review-artifacts/E2E03/20261019T190351Z/events.jsonl) · [summary](../../../../review-artifacts/E2E03/20261019T190351Z/summary.json) · [masked screenshot](../../../../review-artifacts/E2E03/20261019T190351Z/u2.login-failure.png). Next: repair or verify the account-status transaction issue, then reconcile existing fixture and read both owners’ answer state before saving.

**Independent-answer repair PUBLISHED:** Source `eb66a97`, frontend Amplify `150`, API `c60d475f`, worker `21669516`; admission and prior background schedule restored enabled. Owner/choice/proposal-bound saves permit independent answers while preserving strict lifecycle/identity/approval/replay checks. Static compilation/lint/build passed; no product tests or participant/provider calls. Manual acceptance pending; historical E2E03 failure remains unchanged. [Repair](../../../../review-artifacts/E2E03/independent-answer-save-repair.md), [publication](../../../../review-artifacts/E2E03/independent-answer-save-publication.json).

Status: **BLOCKED / claim released** after run `20261019T183505Z`. Both users signed in, reconciled the same existing fixture and opened its decision; account/profile/group-list reads were all HTTP 200 in the observed run. U1's private answer saved with owner readback. U2's save was rejected once with HTTP 409 `STALE_CONTEXT` (reference `998fac95-f718-4113-91d8-c0802b401bb1`); the likely stale page version is not proven. A later read-only runner refresh timed out. No retry, outcome request or assistant request. Read U2's own answer state before any further attempt. [Latest report](../../../../review-artifacts/E2E03/20261019T183505Z/report.md); [events](../../../../review-artifacts/E2E03/20261019T183505Z/events.jsonl); [summary](../../../../review-artifacts/E2E03/20261019T183505Z/summary.json); [prior account diagnosis](../../../../review-artifacts/E2E03/account-read-diagnosis-20261019.md); [runner](../../../../../scripts/e2e03/README.md).

Previous run `20261019T180154Z`: the account-load repair was published; U1 and U2 signed in, loaded six groups and got initial `GET /account` HTTP 200. Draft save and manual decision creation each returned HTTP 200. The runner then asserted the title while the modal was still loading; a later read-only inspection showed the expected title and answer form. No private answers or outcome were saved/requested. The synthetic draft and decision remain for reuse; [report](../../../../review-artifacts/E2E03/20261019T180154Z/report.md).

**Account-load repair PUBLISHED — direct user request:** A added a fresh fenced account-read fallback when optional username-directory maintenance fails, plus safe request-correlated diagnostics. The focused adapter suite passed 86/86. Earlier logins returned HTTP 200, but the latest rerun again saw intermittent `/account` and `/account/profile` HTTP 503s during navigation. This means stable live account loading is not yet verified; the precise server cause remains unknown. [Repair and release evidence](../../../../review-artifacts/E2E03/account-load-repair.md).

**Runner loading repair CODE_READY:** Source confirms the loading shell and loaded decision share the heading ID. Both create/open checks now wait for the acknowledged decision ID and exact title, with a bounded `DECISION_VIEW_NOT_READY` failure. Local focused checks passed before the resumed run; [repair evidence](../../../../review-artifacts/E2E03/decision-readiness-repair.md). The resumed run passed fixture reconciliation, then stopped on account loading before opening the decision. No app deployment was needed for this runner-only repair.


**Read-only diagnosis, 2026-10-19:** Server logs in the test window confirm `account.status` failed in 15 ms with `TransactionCanceledException`, surfaced as `SESSION_STORAGE_UNAVAILABLE`/503. Shared managed activation reads cache rejected promises and have no bounded retry; this is a concrete recovery weakness, but cancellation subcodes/command are unlogged, so exact trigger remains unverified. [Diagnosis and next repair](../../../../review-artifacts/E2E03/account-read-diagnosis-20261019.md). No new app test, data write or deployment.

## Goal and previous evidence

Finish **two small scenarios**, using one decision and two existing approved synthetic users. A third scenario is optional. This is a limited regression result, not whole-project qualification.

[E2E02 completion results](../../../../review-artifacts/E2E02/completion-20261017/report.md) show the five formerly blocked cases 10/11/12/15/16 subsequently passed on dated releases. They are not five current failures. Recheck the historically problematic direct saves and outcome/approval path after recent UI changes. Do not rerun all sixteen cases, old passing signup/invitation flows, baseline unit-suite failures, or the membership/stale-version matrix.

## Keep it small

- One existing worker, one task at a time, two isolated browser contexts. No new agent/chat/schedule. Reuse existing browser tooling; add only the small external logging/wrapper integration needed to meet this ticket, not a new test framework.
- Read required project instructions, this ticket, the previous report's results table and only relevant current publication evidence. Use focused snippets; avoid rereading entire work/monitor logs or repository history.
- Aim for 15–20 minutes. Two required cases, third only if straightforward. Stop at the first reproducible failure within a dependent case; record it instead of repeatedly trying variations. Safe independent optional work may continue.
- Maximum **one Find an outcome request**, plus **one optional assistant question**. No AI drafting, AI interpretation of private notes, automatic paid retries, budget/control changes or fresh signups/email. Report actual internal model calls/tokens when available; one UI request is not necessarily one provider call. Never invent usage or cost.
- No full unit/browser suite, deployment, code fixes, IAM repair, CloudShell setup, broad AWS audit or account resets. Use the worker's own access, not A's credentials. A genuine missing prerequisite is BLOCKED with the exact reason.
- Preserve participant consent, private isolation, exact proposal approval and unknown-request safeguards. Check status read-only once for an uncertain request; never resend it or clear its records to make a case pass.
- Logging is part of execution, not a report to reconstruct at the end. The evidence writer must persist and read back a startup record before any app action. If that fails, record LOGGING_BLOCKED and perform no test writes. Keep the original two-case/optional-third scope and AI limits; better reporting does not authorize more product scenarios.

## Minimal setup

Site: https://main.d143q5ravxp5av.amplifyapp.com/

Use [the existing private credential instructions](../E2E01/credentials.md). Read credentials privately on the execution machine; never print them, put them in prompts, or copy them between workers. Report users as U1/U2.

Record current serving frontend and backend evidence from the latest completed publication receipts; do not assume Git HEAD equals the deployed runtime. Use existing bounded readback tooling only if needed. Do not start a deployment to synchronize versions.

Before creating or resubmitting any decision, perform the previously required read-only reconciliation of the selected group and both users' state. Persist which old fixture/action was found, its current observable state, what remains unknown, and whether it is safe to continue. Do not turn an uncompleted reconciliation into a new blank attempt. Follow the explicit no-repeat rule in [execution reporting](execution-reporting.md#recovery-and-finalization).

Prefer an existing positively owned synthetic group containing U1/U2. Otherwise create **one** `E2E03 <UTC>` group, invite the second approved synthetic account once through the app and accept. If either account/access/invitation is unavailable, state that prerequisite precisely; do not turn this into another onboarding investigation.

Create one decision **without AI**, using the current manual choices screen:

- Name: `Friday activity`.
- Description: `Choose one activity for our group.`
- Topic: `Activity`; options: `Walk`, `Board games`.
- Both U1 and U2 participate and are required approvers. No dates, money, extra notes or additional topics.

## 01 — Two users save answers; personal alerts are correct

1. Before responding, verify each user gets a red personal-answer chip for this decision and its group once status loading completes.
2. U1 selects only **Board games**, gives the required synthetic processing consent and saves. Expect a small saving pill, then a saved-answer summary; no yellow previous-request box during an ordinary successful save.
3. U1's answer-needed alert clears; U2 still needs to answer. U2 selects **Walk and Board games**, consents and saves once.
4. Reopen/refresh each user's decision: their own selections persist; no one sees the other's private selections. Both have answered. Waiting on others, already satisfied actions and optional outcome readiness must not be red.

PASS requires both real saves and persistence. A screenshot of a selected checkbox alone is not save evidence. If a save fails or is unconfirmed, record the safe reference/status and stop this case; do not click repeatedly.

## 02 — One outcome; two distinct approvals

Depends on 01. Reuse that exact decision; do not create more variants.

1. Request an outcome **once**. Observe normal completion for at most two minutes using existing progress/status reads; no new job or forced recovery. If unresolved, mark BLOCKED/FAIL as supported by evidence and preserve the original request.
2. Expected common option: **Board games**. Verify the actual proposal, not only a request acknowledgment. Both users who still owe approval should have a red approval chip on the decision and group.
3. U1 explicitly reviews and approves that proposal once. It must still await U2: U1 waits neutrally; U2 still has a red approval action.
4. U2 explicitly approves the same proposal. Reopen both views: **Decision agreed**, both approvals persisted, own private answers preserved and personal red chips cleared.

PASS requires two distinct approvals of the same proposal and persisted agreement. Do not broaden into rejection, roster changes, stale-approval replay or several AI-created decisions; those retain their previous evidence.

## 03 — Optional: one natural private reply, no cross-user leak

Run only if time/access remain. Uses at most one assistant request and may run independently if the outcome path is blocked.

1. U1 opens **Chat → Private assistant**, gives AI consent, and sends once: `In one short sentence, what is an umbrella?`
2. Expect a relevant natural answer, not decision status or a canned acknowledgment. Observe clear replying/answered/failed/unknown state. A pending or unknown response is not PASS; check status once without another provider request.
3. Reopen U1's private thread: the message/reply persist. In U2's private thread and the group thread, U1's private message/reply must be absent. Do not send more questions from U2.

## Evidence, closeout and completion

Create `docs/review-artifacts/E2E03/<UTC>/report.md`, append-only `events.jsonl`, incremental `summary.json`, and at most **two screenshots per attempted case**, following [execution reporting](execution-reporting.md). Capture useful end-state/failure evidence; the event journal is a compact action/status ledger, not a video, full UI transcript, raw HAR or raw console dump. Never capture credentials, tokens, headers, real-person data, other owners' private answers or invitation links.

Report only:

- UTC and actual serving source/publication references; U1/U2 aliases.
- A three-row table: case, PASS/FAIL/BLOCKED/NOT_RUN, one-sentence actual result, evidence link. Optional 03 NOT_RUN is acceptable when explained.
- Up to five short lines for failures: exact step, safe request ID/HTTP code, confirmed observation, next repair. Do not diagnose from a generic UI message alone or claim unknown logs were inspected.
- Link the event journal, current summary, screenshots and sanitized failure packet. Show the last confirmed step, any in-flight/unknown action, browser/tool error or its explicitly unavailable status, and the exact next read-only check. Missing screenshots, HTTP acknowledgment or tool diagnostics each need a separate availability reason, not one generic "browser ended" sentence.
- Outcome/assistant request counts and actual usage if known; UNKNOWN otherwise. Clearly distinguish no AI request from no available usage evidence.
- One short final chat summary, matching the report. Keep the report under roughly 400 words, excluding identifiers/links/table.

Publish the initial RUNNING report before browser work, refresh remote evidence at each completed case or unexpected stop, and publish the final compact report through the worker's authorized repository workflow. If synchronization fails, state exactly what remains local and give the last confirmed remote link; do not report a failed push as published. Update this ticket and the E2E index with observed results/source boundaries and release the claim. No unrelated documentation rewrite. If positively owned work is settled, remove just the newly created synthetic fixture through the normal app; if any outcome is uncertain, retain it and name the next safe action. No broad cleanup or new support/email task.

Close the bounded run and publish its honest report after the two required cases are attempted. Mark E2E03 DONE only if both required cases PASS **and their per-action acknowledgments, owner readbacks and final reporting are present**. Otherwise record FAIL/BLOCKED, the exact follow-up and release the claim; do not keep debugging or rerunning inside this task. Optional 03 cannot substitute for either required case. No whole-project reliability percentage or full-suite PASS is implied.
