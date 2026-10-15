# FF03 — Unsupported AI follow-up draft and confusing recovery UI

Status: READY / unclaimed for B
Scheduling: preserve the current active claim and one implementation writer. This overlaps FIX01's public-draft lifecycle: B should correlate these reports with the current FIX01 repair first, without starting a parallel claim. If FIX01 resolves the same defect, link its actual evidence here instead of duplicating work; otherwise take this bounded follow-up sequentially.

## Observed report

During the “Let’s fill in a few details” wizard, after follow-up input and “Let AI update the draft,” the user sees:

> AI returned an unsupported draft. No draft was saved. Recover this request before editing or starting another.

Reported references:
- 96d4d2fc-c74e-4771-91f6-7aa7313947fa
- 8974d217-130b-444a-bc02-74fb69bbbbce

The same screen combines unfinished-request recovery (“Check progress” / “Retry this same request”), “The AI needs a little more context,” answer counters and the update action. The stepper also appears as “2Follow-up” and “3Review.” The user cannot understand whether the AI needs input, has failed, or is still running.

The error reports an output-contract rejection, but the exact field/schema/semantic mismatch, provider completion and saved-request state have not been established from this report. Do not assume an AWS permission issue, user input error or missing response. Do not include user input or raw model output in shared logs.

## Work

1. Correlate both references with the matching deployed source and available sanitized server/provider diagnostics. Determine the actual rejection stage and whether it is malformed output, unsupported fields/values, truncation, prompt/schema drift or another proven cause. Record a safe reason/stage without sensitive content. If evidence is unavailable, state that rather than inventing a root cause.
2. Inspect the follow-up prompt, output parsing/validation and conversion into the persisted public draft. Fix the demonstrated mismatch while retaining strict output validation, allowed public fields, identity, revisions and independent participant review. Do not accept arbitrary output or weaken privacy checks to make the error disappear.
3. Correct request disposition after an acknowledged invalid answer: distinguish completed-but-rejected output from an unknown provider outcome. Preserve usage accounting and existing draft/answers; provide a safe close/edit/retry path where technically valid. Do not replay an uncertain call, clear reservations blindly or automatically launch additional paid calls.
4. Make wizard states mutually clear: follow-up ready, submitting, saved, rejected or uncertain/recovery required. Hide or disable contradictory editing/submission controls while recovery is required; explain the next concrete action. Preserve answers when closing a request, and show whether an earlier draft is still saved rather than implying all drafts were lost.
5. Fix stepper number/label spacing and present character counters readably. Explain why follow-up questions are asked and what the update action will do.

## Completion

Record the root cause, source changes, exact disposition for both reported requests if observable, publication status and a short manual retest guide. Distinguish source checks from actual live acceptance; do not mark done solely because an error label changed. Link FIX01 evidence where reused.

Task creation is documentation only. No tests, provider calls, recovery, AWS changes, deployment or worker dispatch by A. B follows its applicable session instructions and logs actual checks and blockers. Existing claim and schedule unchanged.


User-directed FIX01 continuation 2026-10-15T06:08:44.323908+00:00: overlapping report is being addressed inside the single active FIX01/B claim; no separate FF worker. Current findings and checks are recorded in [FIX01](../../fix/FIX01/ticket.md). Original two FF03 reference outcomes are not independently correlated; new source diagnostics add finite rejection stage only, no user/model content. No FF DONE or live success inferred from local code.
