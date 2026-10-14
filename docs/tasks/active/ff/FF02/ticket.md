# FF02 — Fix unavailable private-conditions interpretation

Status: READY / unclaimed
Intended worker: B, sequentially after the existing active claim and FF01; do not interrupt current work or create another monitor.

## User report

On the decision screen in dark mode, “Your private conditions” contains entered text and an apparently enabled “Interpret my conditions” button. The page displays:

> Interpretation is unavailable. Refresh and check that everyone has confirmed the current frame.

User supplied a screenshot on 2026-10-14. Do not copy its private free text into shared task records, logs or fixtures. No request reference, response status, roster confirmation state or server cause is established by the screenshot. Do not assume refreshing, missing consent, disabled AI or permissions are the cause without evidence.

## Required work

- Trace the displayed error through the actual frontend request, API response, safe server diagnostics and relevant decision/frame/roster state. Distinguish an unmet prerequisite from a request, runtime, provider or configuration failure. Record sanitized evidence and the actual cause.
- If confirmation of the current frame is required, show that prerequisite before submission, explain whose action is needed using permitted shared status, and provide a direct path to complete it. Preserve each participant's independent consent; never auto-confirm or bypass a frame/roster check.
- If prerequisites are satisfied, repair the demonstrated interpretation failure using the compatible current runtime. Keep private conditions private; no raw input, inferred needs, tokens or provider output in public diagnostics.
- Replace the generic message with clear actionable states: not ready, processing, retryable failure or unresolved outcome. Provide a safe support reference where available. Preserve unsent text during recoverable errors, prevent duplicate submissions and do not automatically repeat an uncertain AI invocation.
- Keep controls accessible, responsive and consistent in both themes. Do not enable the button misleadingly while a known prerequisite is missing.
- If an actual access/configuration blocker is found, record the exact denied action/resource and a complete minimal recovery command with its effects. Do not infer missing AWS access from the screenshot or request broad new permissions.

## Completion evidence

Record the root cause, changed files, publication state and a short manual checklist covering unmet prerequisites, all required confirmations satisfied, successful interpretation, actionable failures and privacy. Confirm the UI does not claim success without a saved interpretation. Source readiness is not live completion.

Creation is documentation only: no code changes, tests, provider calls, AWS changes or dispatch. A's current chat does not run tests; B follows its applicable session instructions and records only actual evidence. Preserve current task ownership and the existing schedule.
