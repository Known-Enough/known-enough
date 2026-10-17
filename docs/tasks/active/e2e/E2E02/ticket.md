# E2E02 — Current-release decision journeys and useful failure evidence

Status: TWO PARTIAL LIVE RUNS COMPLETE; qualification NOT VERIFIED. The user-directed rerun is [E2E02-20261016-234411Z](run-2026-10-16-234411Z/report.md): 8 PASS, 4 FAIL, 4 BLOCKED. Username invitation send/accept passed; direct answer saves and AI draft creation failed. Preserve both reports; no end-user readiness claim.

The rerun's frontend117/API6f2bff59 baseline matches the current plan refresh. The former USERNAME permission gap is resolved; invitation behavior passed by username. Current defects and unverified worker alignment remain as detailed in the report.

## Current repair — 2026-10-17T02:15:20Z

Direct user request authorizes fixing all findings in the completed report. B owns the single repair implementation on synchronized `88c84e7cf42b9689532f6e49f468dfbce1a20d29`; this supersedes the testing-only code/deployment restriction below for this bounded repair. Historical testing remains unchanged and is not a repair PASS. See [repair ledger](repairs.md). No new test agent, chat or schedule.

## Purpose

Establish whether two existing users can actually use the current application, create a decision with or without AI, save private answers and reach a shared outcome. E2E01 proved separate sign-ins and group create/rename in its latest report, but never proved a complete two-user decision or real AI journey. Do not repeat its pattern of treating the first failed dependency as a reason to skip safe independent checks. A completed report is not the same as a working product.

## Ownership, access and authority

The earlier user instruction to execute E2E02 remains authorized. This A-side request refreshes the plan only: no test, live AI call or agent is started here. Before execution, inspect current claims; reuse a genuinely active assigned worker instead of duplicating it. The parent worker uses exactly one `gpt-6-luna` agent for the [runbook](runbook.md), using two isolated browser contexts. No second test agent, parallel fixes, new persistent chat or automation. Report actual available model settings; do not silently substitute a model. Reuse the existing browser tooling where possible.

The user's E2E request and standing authority cover this bounded synthetic live browser work, necessary AI requests and relevant project log reads. The worker uses its own project/GitHub access and [the private local credentials file](../E2E01/credentials.md), never A's AWS login. Credentials currently available on B's machine and the two accounts' current health must be checked, not assumed from an old report.

Do not change application code, publish a deployment, repair IAM, reset accounts, approve real users or alter model controls/budgets as part of testing. Record any proven technical dependency and a separate repair follow-up. Existing standing authority does not remove participant privacy, explicit synthetic processing consent, final approval, source/version checks or platform restrictions.

## Target and current behavior

Primary site: https://main.d143q5ravxp5av.amplifyapp.com/ . Do not switch to the separate QA site and claim the primary passed.

Use [baseline.json](baseline.json) as the single source for published versions and public asset hashes. At this refresh:

- Frontend source `6cb97c414b8dced2f06effa9557fb6d2102389c6`, Amplify **117**, [matching release](https://github.com/Known-Enough/known-enough/actions/runs/38980855371) and [modal-layout receipt](../../../../review-artifacts/FF/choice-modal-layout-publication.json).
- API source `40ec579c55410b1ae15aecb12fc2a0a30b2cc4c6`, artifact SHA `6f2bff590976861470bd4faa2475141e612b2afb0dd0f23057777496dd4a853f`; matching worker SHA `715f84620c9a65ef4a1b2ea2bcf2d6fe1217d319a79533b0d0e7913211b9e05d`. [Backend/username recovery receipt](../../../../review-artifacts/INV01/username-lookup-repair-publication.json).
- Runtime username permission was read back **INSTALLED**. The earlier missing-permission/denied-repair notes are historical, preserved in [INV01](../../invitations/INV01/ticket.md). An older approved account may still need its own signed-in account refresh to create the missing username lookup. Do this for both test accounts during preflight; no automatic approval or new CloudShell setup is implied.
- Main Groups hides its invitations card after a successful zero-pending read; pending items and genuine load failures retain the appropriate display. Sending is inside each organizer-owned group, by username/email, with no replacement checkbox. [Empty-inbox receipt](../../../../review-artifacts/INV01/empty-inbox-visibility-publication.json).
- Successful group creation should open the saved group without an unsaved-name discard warning. Genuine unsaved-input warnings remain. [Saved-group warning receipt](../../../../review-artifacts/FF/group-create-warning-publication.json).
- Set up your choices has compact cards, bounded scrolling, a collapsed editable original idea, persistent save/create actions and an in-modal example. The manual fallback is still labelled **Add or edit choices without AI**; the suggested rename **Enter the options yourself** has not been implemented. Test actual UI labels and whether the transition makes sense.

Both ordinary AI drafting and the manual fallback lead to the same shared-choice editor. The editor defines public alternatives; each person's acceptable options/preferences are entered privately later. Neither route approves a final outcome. Require normal desktop, phone-width, short-height and both-theme evidence for the clipping regression.

The decision itself now opens in a modal. Direct explicit private-answer saves replace the old separate shared-choice confirmation and three-step private review flow; no waiting for peers to review first. Final proposal approval and consent remain separate. New creation supports editable named/exact-date topics, focused missing-detail prompts and saving/creating without AI. Limits: six topics, sixteen options each, 64 combinations. AI suggestions are not verified real-world prices or availability. Expect semantic preservation of the user's options, not exact generated wording or a restaurant-specific answer.

## Execution order and independence

Run **01 → 02 → 03 → 04 → 07 → 05 → 06 → 08 → 09 → 10 → 11 → 12 → 13 → 14 → 15 → 16**. Keep existing case IDs for report compatibility. Case07 is deliberately moved before the main draft: group membership does not automatically enroll someone in an existing decision. Verify both people appear as required participants when creating the main joint decision M.

Use a fresh joint group G for M and AI examples A/B. Case15 uses a separate group H to test joining after decisions exist, preserving finished outcomes. Case16 uses a separate ongoing two-person decision R in G, so a blocked enrollment case15 cannot prevent stale-approval checks. Never reuse a finished decision for answer changes.

If only one account works, label its manual/AI fixtures **SOLO** and continue independent checks; a one-person agreement cannot pass the two-person cases. When the second account recovers, create a new joint draft after it joins rather than silently reusing a draft with the wrong roster.

A failed AI service must not block manual creation tests. A rejected second account blocks only cases requiring that account. A global app/account/API failure may block more cases; name the actual dependency for each. Never turn a skipped scenario into PASS. Continue safe independent work, then issue one actionable final report instead of endless unchanged retries.

Use fictional inputs only and positively identify every owned group/draft/decision by run ID. Read before retrying any uncertain write. Keep request IDs/body checkpoints and do not clear unknown outcomes, replace a user's choices, repeat a paid call automatically or create duplicate groups/decisions just to get a green result. Use existing status/recovery actions. Do not retry E2E01's unknown cleanup before an ownership/state readback; old cleanup is separate from this run's core acceptance.

Recovery cases may intercept/delay only the agent's own browser responses. Clearly label these INJECTED and keep them separate from real LIVE journeys. Never mutate public service configuration or another user's traffic. Injected recovery cannot substitute for a real successful AI request or prove server-side idempotency without readback. Limit actual AI calls to explicit scenario actions; record observed call/usage evidence and any unavailable evidence.

## Required delivery

Use [the report template](report-template.md). Every case needs an expected result, actual observation, PASS/FAIL/BLOCKED and an evidence path. Retain real sanitized screenshot files of group feedback, desktop/mobile/short-height choice editor, decision modal, public participant progress, final outcome and each distinct failure. Check that each referenced file exists and is readable; missing screenshots remain an explicit evidence gap. Record UI clipping/navigation/copy failures even if the server operation succeeded. Capture safe HTTP status/request reference and permitted correlated logs; never just report 'unavailable'. No raw HAR, full environment, passwords/tokens, invitation URLs, private answers or model input/output in public logs/images.

Use a new dated run/evidence folder; never overwrite E2E01 or historical results. The parent reviews the Luna output, publishes the sanitized report and logs the same short chat summary in its own work log/handoff; keep the existing monitor reporting at natural checkpoints, without interrupting active tests. For a confirmed defect, check duplicates and link one actionable repair ticket. Suspected causes stay labelled suspected.

Release the claim after reporting a complete run or a documented external blocker. Overall core journey PASS requires cases 01–12 to pass on the current primary release; recovery/membership/approval cases 13–16 must also pass for full E2E02 acceptance. Otherwise report partial coverage and the failed/blocked cases. No product/MVP readiness or 99.9% reliability claim from sixteen cases. No extra human approval is required merely to execute this already-authorized task.


## Status history retained

E2E02 previously carried IN PROGRESS/start-direction language while its README said unclaimed/not started, and cited frontend113/API9b0badc5 with a missing IAM permission. Those were older preparation states, not current qualification. This refresh found no dated E2E02 report/evidence folder in this task directory; it does not establish whether an inaccessible B browser worker is active. Preserve any actual claim and obtain fresh observations against the current baseline. E2E01 reports and historical INV01 evidence remain unchanged.
