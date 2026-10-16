# E2E02 — Current-release decision journeys and useful failure evidence

Status: BLOCKED before start by INV01's installed USERNAME-key permission. Execution NOT STARTED. Overall current-release qualification is NOT VERIFIED.

## Purpose

Establish whether two existing users can actually use the current application, create a decision with or without AI, save private answers and reach a shared outcome. The preceding E2E01 run proved group create/rename but could not sign in both users or reach AI. Do not repeat its pattern of treating the first failed dependency as a reason to skip safe independent checks. A completed report is not the same as a working product.

## Ownership, access and authority

At genuine idle intake, verify current queue/claims and claim only E2E02. The parent worker uses exactly one `gpt-6-luna` agent for the [runbook](runbook.md), using two isolated browser contexts. No second test agent, parallel fixes, new persistent chat or automation. Report actual available model settings; do not silently substitute a model. Reuse the existing browser tooling where possible.

The user's E2E request and standing authority cover this bounded synthetic live browser work, necessary AI requests and relevant project log reads when the task is taken. This docs-only preparation starts none of them; A's no-tests direction remains in force in this chat. The worker uses its own project/GitHub access and [the private local credentials file](../E2E01/credentials.md), never A's AWS login. Credentials currently available on B's machine and the two accounts' current health must be checked, not assumed from an old report.

Do not change application code, publish a deployment, repair IAM, reset accounts, approve real users or alter model controls/budgets as part of testing. Record any proven technical dependency and a separate repair follow-up. Existing standing authority does not remove participant privacy, explicit synthetic processing consent, final approval, source/version checks or platform restrictions.

## Target and current behavior

Primary site: https://main.d143q5ravxp5av.amplifyapp.com/ . Do not switch to the separate QA site and claim the primary passed.

Latest deployment: API source `2e5902f44f10f2b68dd3f7905a79ba4c8b7aa95c`, API SHA `9b0badc58d00d3855735bc36cd300ccff6710486510f243d2f357236a1e81a87`, worker SHA `1d20b9a783134d2321d3d0a380bcdf15a81057f5118ea03b7d33774c9dc06cf8`, Amplify job `111`. [Coordinated backend](https://github.com/Known-Enough/known-enough/actions/runs/38963203435), [frontend and route reconciliation](https://github.com/Known-Enough/known-enough/actions/runs/38963388395), [public smoke](https://github.com/Known-Enough/known-enough/actions/runs/38964421870). The public smoke passed; authenticated behavior remains unverified. A read-only check found the runtime role lacks USERNAME-scoped access. The attempted policy update was denied before any IAM write; details and the guarded operator command are in [INV01](../../invitations/INV01/ticket.md). Resume E2E02 only after independent USERNAME read/write permission readback passes.

INV01 adds organizer dashboard invitation sending by exact username or verified email, plus a recipient-owned pending-invitation section and explicit dashboard acceptance. Include this feature in case 07 and case 15 as specified in the runbook. Start live tests only after the INV01 source, authenticated API route, and effective username-key access are read back on the deployed app. A source commit alone is not a published invitation feature.

The decision itself now opens in a modal. Direct explicit private-answer saves replace the old separate shared-choice confirmation and three-step private review flow; no waiting for peers to review first. Final proposal approval and consent remain separate. New creation supports editable named/exact-date topics, focused missing-detail prompts and saving/creating without AI. Limits: six topics, sixteen options each, 64 combinations. AI suggestions are not verified real-world prices or availability. Expect semantic preservation of the user's options, not exact generated wording or a restaurant-specific answer.

## Execution order and independence

Follow cases 01–06 first: two sign-ins, group creation feedback/persistence, manual editable draft and manual decision creation. If only one user works, that user can perform these independent group/creation checks. Then cases 07–10 test the two-user modal, privacy and final agreement; 11–12 test real AI; 13–14 exercise recovery; 15–16 check membership and stale approvals.

A failed AI service must not block manual creation tests. A rejected second account blocks only cases requiring that account. A global app/account/API failure may block more cases; name the actual dependency for each. Never turn a skipped scenario into PASS. Continue safe independent work, then issue one actionable final report instead of endless unchanged retries.

Use fictional inputs only and positively identify every owned group/draft/decision by run ID. Read before retrying any uncertain write. Keep request IDs/body checkpoints and do not clear unknown outcomes, replace a user's choices, repeat a paid call automatically or create duplicate groups/decisions just to get a green result. Use existing status/recovery actions. Do not retry E2E01's unknown cleanup before an ownership/state readback; old cleanup is separate from this run's core acceptance.

Recovery cases may intercept/delay only the agent's own browser responses. Clearly label these INJECTED and keep them separate from real LIVE journeys. Never mutate public service configuration or another user's traffic. Injected recovery cannot substitute for a real successful AI request or prove server-side idempotency without readback. Limit actual AI calls to explicit scenario actions; record observed call/usage evidence and any unavailable evidence.

## Required delivery

Use [the report template](report-template.md). Every case needs an expected result, actual observation, PASS/FAIL/BLOCKED and an evidence path. Retain sanitized screenshots of group feedback, choice editor, decision modal, public participant progress, final outcome and distinct failures. Capture safe HTTP status/request reference and permitted correlated logs; never just report 'unavailable'. No raw HAR, full environment, passwords/tokens, invitation URLs, private answers or model input/output in public logs/images.

Use a new dated run/evidence folder; never overwrite E2E01 or historical results. The parent reviews the Luna output, publishes the sanitized report and logs the same short chat summary in its own work log/handoff; keep the existing monitor reporting at natural checkpoints, without interrupting active tests. For a confirmed defect, check duplicates and link one actionable repair ticket. Suspected causes stay labelled suspected.

Release the claim after reporting a complete run or a documented external blocker. Overall core journey PASS requires cases 01–12 to pass on the current primary release; recovery/membership/approval cases 13–16 must also pass for full E2E02 acceptance. Otherwise report partial coverage and the failed/blocked cases. No product/MVP readiness or 99.9% reliability claim from sixteen cases. No extra human approval is required merely to execute this already-authorized task.
