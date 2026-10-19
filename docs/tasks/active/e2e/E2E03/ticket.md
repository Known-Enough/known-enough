# E2E03 — Cheap, focused regression check

Status: BLOCKED / claim released after user-requested run on 2026-10-19. The two existing approved accounts and an existing shared U1-organized two-member group were verified. The browser runner ended without persisting its phase/result summary; answer-save state is unverified. One read-only UI reconciliation did not complete fixture inspection. Preserve any possible `Friday activity` decision and do not recreate, save again, request an outcome or clean up until a successful readback establishes its state. [Run report](../../../../review-artifacts/E2E03/20261019T065759Z/report.md).

## Goal and previous evidence

Finish **two small scenarios**, using one decision and two existing approved synthetic users. A third scenario is optional. This is a limited regression result, not whole-project qualification.

[E2E02 completion results](../../../../review-artifacts/E2E02/completion-20261017/report.md) show the five formerly blocked cases 10/11/12/15/16 subsequently passed on dated releases. They are not five current failures. Recheck the historically problematic direct saves and outcome/approval path after recent UI changes. Do not rerun all sixteen cases, old passing signup/invitation flows, baseline unit-suite failures, or the membership/stale-version matrix.

## Keep it small

- One existing worker, one task at a time, two isolated browser contexts. No new agent/chat/schedule. Reuse existing browser tooling; do not build a new test framework.
- Read required project instructions, this ticket, the previous report's results table and only relevant current publication evidence. Use focused snippets; avoid rereading entire work/monitor logs or repository history.
- Aim for 15–20 minutes. Two required cases, third only if straightforward. Stop at the first reproducible failure within a dependent case; record it instead of repeatedly trying variations. Safe independent optional work may continue.
- Maximum **one Find an outcome request**, plus **one optional assistant question**. No AI drafting, AI interpretation of private notes, automatic paid retries, budget/control changes or fresh signups/email. Report actual internal model calls/tokens when available; one UI request is not necessarily one provider call. Never invent usage or cost.
- No full unit/browser suite, deployment, code fixes, IAM repair, CloudShell setup, broad AWS audit or account resets. Use the worker's own access, not A's credentials. A genuine missing prerequisite is BLOCKED with the exact reason.
- Preserve participant consent, private isolation, exact proposal approval and unknown-request safeguards. Check status read-only once for an uncertain request; never resend it or clear its records to make a case pass.

## Minimal setup

Site: https://main.d143q5ravxp5av.amplifyapp.com/

Use [the existing private credential instructions](../E2E01/credentials.md). Read credentials privately on the execution machine; never print them, put them in prompts, or copy them between workers. Report users as U1/U2.

Record current serving frontend and backend evidence from the latest completed publication receipts; do not assume Git HEAD equals the deployed runtime. Use existing bounded readback tooling only if needed. Do not start a deployment to synchronize versions.

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

Create `docs/review-artifacts/E2E03/<UTC>/report.md` and at most **two screenshots per attempted case**. Capture only useful end-state/failure evidence; do not record a video or a step-by-step transcript. Never capture credentials, tokens, headers, real-person data or invitation links.

Report only:

- UTC and actual serving source/publication references; U1/U2 aliases.
- A three-row table: case, PASS/FAIL/BLOCKED/NOT_RUN, one-sentence actual result, evidence link. Optional 03 NOT_RUN is acceptable when explained.
- Up to five short lines for failures: exact step, safe request ID/HTTP code, confirmed observation, next repair. Do not diagnose from a generic UI message alone or claim unknown logs were inspected.
- Outcome/assistant request counts and actual usage if known; UNKNOWN otherwise. Clearly distinguish no AI request from no available usage evidence.
- One short final chat summary, matching the report. Keep the report under roughly 400 words, excluding identifiers/links/table.

Update this ticket and the E2E index with observed results/source boundaries, publish the compact report through the worker's authorized repository workflow, and release the claim. No unrelated documentation rewrite. If positively owned work is settled, remove just the newly created synthetic fixture through the normal app; if any outcome is uncertain, retain it and name the next safe action. No broad cleanup or new support/email task.

Close the bounded run and publish its honest report after the two required cases are attempted. Mark E2E03 DONE only if both required cases PASS. Otherwise record FAIL/BLOCKED, the exact follow-up and release the claim; do not keep debugging or rerunning inside this task. Optional 03 cannot substitute for either required case. No whole-project reliability percentage or full-suite PASS is implied.
