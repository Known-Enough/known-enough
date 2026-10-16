# E2E01 — Two-user live journeys with one Luna agent

Status: RUN COMPLETE / qualification BLOCKED; claim released 2026-10-16T16:47:04Z. Fresh test02/test03 run: scenarios 1–2 PASS, scenarios 3–10 BLOCKED (scenario 5 guidance inspected only). No AI calls or product changes; new empty group remains. Prior group's cleanup remains UNKNOWN and untouched. [Run report](run-2026-10-16-test02-test03.md). No overall product PASS or confirmed defect.

## Goal and authority

User explicitly requests this E2E batch with exactly ONE Luna agent, two existing dedicated users and at least TEN different real-app scenarios. When this task is taken and its target changes are published, that request authorizes this bounded live browser testing, relevant project log reads and necessary AI calls under existing standing authority. This is the scoped exception to the preceding no-tests direction; it does not start tests now or waive platform/account restrictions. No other concurrent implementation/agent, extra monitor or new persistent chat. Use Luna as requested; report the actual model or disclose if unavailable rather than silently substituting.

## Intake

Read current board/claims, A/B logs, FF01–FF10 and exact publication receipts. Inspect the current live website and verify its deployed version. Do not test an old release and claim newer changes passed; unpublished features are a recorded dependency, not a reason to ask the user to repeat AWS setup. Preserve an actual active claim; take this task sequentially. No deployment or infrastructure repair is part of this test-only task.

Target: https://main.d143q5ravxp5av.amplifyapp.com/ (primary application). Use existing own-account log access; no AWS credential sharing. Relevant guidance: [decision diagnostics](../../../../debugging-decision-drafts.md), [private credentials](credentials.md), [scenarios](scenarios.md). Distinguish the primary site from the separate QA app.

## Execution

Use one Luna agent and two isolated browser contexts for the entire run. Read credentials privately from the file on the execution machine; never print or commit secrets. Exercise all ten listed scenarios, including independent routes if another scenario fails. No mock-only substitute for actual browser journeys. Do not change product code to make the report pass, auto-approve access or weaken checks. Use fictional inputs; do not repeat signup/email if the two existing accounts already work.

Keep calls bounded to the scenario plan and record observed usage where available. Do not make unchanged automatic retries of a failed model request. Inspect its visible error/reference and correlated permitted server logs first. If logging is denied, record exact sanitized denial and what can still be inspected; never invent a cause. Do not enumerate real users or collect unrelated logs. Preserve failed-request checkpoints. Remove only clearly owned test artifacts via supported actions where safe, recording any retained evidence/artifacts; cleanup limitations do not justify destroying state or concealing results.

## Evidence and delivery

Write results in this task folder: run start/end UTC, tested deployment/source, actual model, scenario-by-scenario expected and observed behavior, PASS/FAIL/BLOCKED, sanitized screenshots/error references, correlated log findings, artifact ownership/cleanup and remaining gaps. Never include private credentials, tokens, invitation links or sensitive notes. Record progress at natural checkpoints and a short chat-summary equivalent in the existing B log/handoff; no documentation-only interruptions imposed on active testing.

For each confirmed defect, first check duplicates, then create/link a concise actionable repair task with reproduction and evidence. Do not start parallel fixes. Distinguish genuine product defects, unavailable prerequisites and suspected causes. Publish the report/queue updates under standing repository authority. The E2E execution/report can be complete with failures if every scenario has a truthful outcome, blocker or defect follow-up; that is NOT an app-wide PASS or MVP-ready claim. State the overall qualification result separately. No all-green claim from builds, old runs or configuration alone.
