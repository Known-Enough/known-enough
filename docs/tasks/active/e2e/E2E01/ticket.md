# E2E01 — Two-user live journeys with one Luna agent

Status: PREVIOUS RUN COMPLETE / qualification BLOCKED; claim released 2026-10-16T07:21:34Z. The 2026-10-16 FF11–FF12 checklist update remains reference planning. Fresh execution now belongs to [E2E02](../E2E02/README.md), not a second E2E01 run. Neither task update started tests.

## Goal and authority

User requests exactly ONE Luna agent, two existing dedicated users and at least TEN distinct real-app scenarios. The updated checklist has sixteen scenarios. When this task is claimed sequentially, that request authorizes bounded live browser journeys, relevant project log reads and necessary AI calls under standing authority. No new routine authorization or daily run receipt is required. The no-tests direction still applies to A's current documentation work; this update does not start the later E2E run. No concurrent implementation, extra monitor or new persistent chat. Use the requested Luna model and report the actual model, or disclose if unavailable rather than silently substituting.

## Current target and intake

Target: https://main.d143q5ravxp5av.amplifyapp.com/ — primary application, not the separate QA app.

Read current board/claims, A/B logs, FF01–FF12 and publication evidence. The latest recorded compatible baseline is source `23822677f4b8e9ffd43e09b3971844b2673a78af`, frontend Amplify job `110`, API SHA `02cfb0b50a7914e9be75c888f57fa60e653f1b5dc44ef4e55b7d1ed26faf84d3`, worker SHA `c0e681fc102dcbb616022a8a1bde0ad62cf18c9f65d1ce6ef7cae71bc5ea63a7`. [FF12 publication receipt](../../../../review-artifacts/FF/editable-choice-creation-publication.json) records matching enabled source; [FF11 receipt](../../../../review-artifacts/FF/open-decision-modal-publication.json) records the direct-answer modal now included in FF12. These are publication evidence, not functional PASS.

Verify the actual loaded frontend and available runtime/source readback at intake, or a newer compatible published baseline. Record unavailable readback precisely; do not silently label an older or unknown release as current. Freshly inspect the two local credential entries and sign-in results without exposing them. Credential availability in B's current environment is UNKNOWN until checked; earlier sign-in rejection is historical evidence, not a proved current cause. Use existing own-account log access; no AWS credential sharing or new infrastructure/deployment work in this test-only task.

## Changed acceptance criteria

[FF11](../../ff/FF11/ticket.md): Open decision opens the decision itself in a native modal, with short shared summary, own saved-answer summary and public participant progress. Direct private selections and explicit Save my answers replace the separate shared-choice confirmation screen and private-answer review wizard. Each person can save before peers act. Viewing submits nothing; processing consent, owner/version checks and separate final proposal approval/disclosure remain explicit. Do not use obsolete review-screen selectors as the acceptance requirement.

[FF12](../../ff/FF12/ticket.md): AI suggests simple named/date choices; application code builds the decision structure. Users can edit choices, save incomplete drafts and create a complete decision without AI, even when an AI request is unavailable or unresolved. Specific missing-detail prompts replace a dead end. Original AI request status and newer manual edits survive recovery without automatic paid retries, overwritten choices or duplicate decisions. Current scope: up to six topics, sixteen options per topic and 64 total combinations; exact dates use YYYY-MM-DD. Prices and availability remain supplied, unverified context. Do not claim general budget reasoning or a measured 99.9% reliability rate.

## Execution

Use one Luna agent and two isolated browser contexts for the whole run. Read [private credentials](credentials.md) on the execution machine without printing them. Exercise all sixteen [scenarios](scenarios.md), continuing safe independent routes when a dependency fails. Prioritize a complete no-AI creation path and the direct-answer modal alongside real AI drafting; an AI failure must not prevent checking the independent manual path. Do not substitute mocks for the real AI/two-user journeys.

For recovery subcases only, browser-local response delay/interception may affect this agent's own synthetic requests. Label these observations INJECTED, separately from LIVE results. Do not change AWS controls, budgets, service state, other users' traffic or application code to provoke or conceal failures. Intercepted browser behavior does not prove real provider reliability or server idempotency without matching readback.

Keep provider calls bounded to explicit scenario actions, record observed usage where available and never loop unchanged paid retries. On failure, capture the exact visible error/reference, UTC time, safe HTTP status and correlated permitted server logs before another attempt. [Decision diagnostics](../../../../debugging-decision-drafts.md) describes correlation. Log exact sanitized denials or missing evidence rather than inventing a cause. Preserve uncertain request keys/checkpoints; do not clear them just to continue. Use fictional inputs and the existing accounts; do not repeat signup/email or auto-approve access.

At intake, read back the old run's owned synthetic group before another cleanup attempt: two delete responses were unknown. Do not retry deletion blindly or remove evidence. Cleanup uncertainty does not prevent unrelated safe scenarios. Remove only positively owned test artifacts through supported actions and record anything retained.

## Evidence and delivery

Create a new dated run report; preserve earlier reports unchanged. Include start/end UTC, actual model, tested source/frontend/API/worker evidence, and expected/observed behavior with PASS/FAIL/BLOCKED for every scenario. Separate LIVE and INJECTED recovery evidence. Include sanitized screenshots of the editable choices, focused validation prompt, actual decision modal/public participant status, final outcome and each distinct failure. Capture mobile and light/dark layout observations where relevant. Hide or crop passwords, tokens, invitation URLs and private answers/notes before retaining images. Store images in this task's dated evidence folder or link the exact accessible artifact paths; explain a missing image instead of claiming it exists.

For failures, include request references, safe statuses/log findings, action taken and the next reproducible step. Distinguish observed UI behavior from unavailable provider-usage/server evidence. Record artifact ownership/cleanup, retained unknown requests and actual calls where observable. At natural checkpoints, update the existing B log/handoff with the same short sanitized summary as the chat answer; do not interrupt active testing for documentation-only ticks.

Check duplicate issues before creating a concise linked repair task for a confirmed defect. Do not start parallel fixes. Distinguish product defects, unavailable prerequisites and suspected causes. Publish the report/queue updates under standing repository authority. A report may finish with failures/blockers only if every scenario is accounted for; overall qualification stays separate and cannot be PASS while required journeys are failed or blocked. Sixteen scenarios cannot establish a 99.9% reliability rate.

## Preserved earlier results

[Initial run](run-2026-10-16.md), [resumed run](run-2026-10-16-resume.md), [final addendum](run-2026-10-16-final.md): scenario 2 PASS; scenario 1 FAIL/incomplete; scenarios 3–10 BLOCKED. User 1 sign-in rejection and the then-unavailable drafting service prevented completion; no overall product PASS or confirmed defect was established. Two cleanup responses were unknown and no screenshots were retained. The service/source mismatch was subsequently repaired and FF11–FF12 published; recheck fresh evidence instead of reporting that earlier service blocker as current. Scenarios 11–16 in the updated checklist are new and NOT EXECUTED.
