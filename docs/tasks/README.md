# Task guide

Start here to understand what is left. Every task has its own folder: README.md explains the basic idea and next step; ticket.md contains its full requirements, claim and evidence. The [shared board](../task-board.md) decides the current order. One implementation task at a time; a folder move does not release an existing claim.

**B conversation dispatch — user direction, 2026-10-03:** The existing five-minute automation assigns one `gpt-6-sol` / `max` conversation per eligible claim and resumes the same worker until verified completion or explicit release. The [claim log](../claim-log.md) records assignments and excludes claimed work from availability. ASSESS07 already has its dedicated B worker; later tasks retain their prerequisites. Its extra two-run receipt expired at 2026-10-04T00:00:00Z, so first reconcile actual results; no new live start or budget renewal is implied.

## Online testing

**Current B authorization:** [Two new cycles approved](https://github.com/Known-Enough/known-enough/actions/runs/37167291403), expiring October4,18:00 Mexico City. B resumes the same claimed ASSESS07 worker after current budget/expiry/CLEAN/counter checks. Actual test execution/full PASS remain pending. The expired October3 allowance and readback below are historical; no prior usage or original spending ceiling is reset.

Installation, GitHub settings and automatic test triggering are verified. Real signup/email/login and invitations passed; decision creation failed in the latest online run, blocking the four later journeys. The checked correction needs a new deployment and real proof. A has now recorded exactly two extra B runs through GitHub, valid until October3,18:00 Mexico City; original cost/email/cleanup limits still apply. B pulls clean main, claims ASSESS07 and starts an authorized staging deployment using B's own GitHub login. Tests follow automatically, with no personal AWS credentials, CloudShell or separate test click. Actual receipt consumption and full live PASS are still pending. [Approval evidence](../review-artifacts/ASSESS07-github-two-b-runs-approved.json).

| Task | Basic idea | Status |
| --- | --- | --- |
| [LIVE04](active/live-testing/LIVE04/README.md) | Prove the installed online test environment works from start to finish. Installation and GitHub settings are ready; real test results and cleanup evidence are still needed. | IN_PROGRESS |
| [ASSESS07](active/live-testing/ASSESS07/README.md) | Collect real online proof that all required user journeys, safety checks and cleanup pass automatically after a matching successful deployment. B takes the current handoff. | IN_PROGRESS / B claimed; live proof pending |

## B's existing monitor

| Task | Basic idea | Status |
| --- | --- | --- |
| [ASSESS10](active/monitoring/ASSESS10/README.md) | Check that B's existing Codex monitor actually runs about every five minutes and reads fresh AWS results. A's monitor has been removed. | READY / unclaimed |

## Remaining technical closeout

| Task | Basic idea | Status |
| --- | --- | --- |
| [NP00](active/closeout/NP00/README.md) | Finish the remaining technical obligations from the previous batch. The model-off safety checkpoint is verified; other closeout evidence still belongs here. | IN_PROGRESS |

## Later, before wider use

These tasks wait for the managed ASSESS07 baseline. OPS00 completes and verifies the GitHub operations path before the implementation sequence; ordinary approved operations must not repeatedly depend on A opening CloudShell.

| Task | Basic idea | Status |
| --- | --- | --- |
| [OPS00](active/operations/OPS00/README.md) | Complete and prove the bounded GitHub operations path; prepare any unavoidable access setup once. | BLOCKED / unclaimed; after ASSESS10 |
| [OPS01](active/operations/OPS01/README.md) | Prepare group storage and safe archiving for wider use, after the real online test baseline is verified. | BLOCKED / unclaimed |
| [OPS02](active/operations/OPS02/README.md) | Add clear retention, export and authorized deletion of private data before wider use. | BLOCKED / unclaimed |
| [OPS03](active/operations/OPS03/README.md) | Make AI jobs recover safely across worker restarts and retries, with current permissions and spending limits checked. | BLOCKED / unclaimed |

## After operations: finish the interface and basics

The [basic completion roadmap](../basic-completion-plan.md) explains what exists and what still needs actual proof. These tasks are prepared for the shared queue; B can take them after OPS01–03 complete, one at a time. Within UX01/UX03, bounded Luna helpers may inspect screens read-only; the direct worker owns all changes and verification. This schedules no helper or deployment now.

| Task | Basic idea | Status |
| --- | --- | --- |
| [UX01](active/ui-ux/UX01/README.md) | Review the screens and complete participant journey on desktop and phone; record a short verified issue list. | BLOCKED / unclaimed; after OPS03 |
| [UX02](active/ui-ux/UX02/README.md) | Fix essential navigation, progress/error messages, phone layouts and accessibility issues from the review. | BLOCKED / unclaimed; after UX01 |
| [UX03](active/ui-ux/UX03/README.md) | Verify matching deployed screens/journeys and simple start instructions; record remaining technical obligations for FIN01–03. | BLOCKED / unclaimed; after UX02 |

## After UX: finish technical debt and group construction

This is the new [technical completion folder](active/technical-debt/README.md). Keep original debt/NP00 evidence and the saved claim; FIN01 reconciles actual remaining work through its proper handoff. UX03 is the interface/journey checkpoint, and FIN03 is final basic project closure.

| Task | Basic idea | Status |
| --- | --- | --- |
| [FIN01](active/technical-debt/FIN01/README.md) | Finish actual inherited technical debt and missing evidence without reopening proved fixes. | BLOCKED / unclaimed; after UX03 |
| [FIN02](active/technical-debt/FIN02/README.md) | Check group creation, invitations, membership changes, decision bindings, progress and participant isolation. | BLOCKED / unclaimed; after FIN01 |
| [FIN03](active/technical-debt/FIN03/README.md) | Reconcile final actual completion, matching deployed results and B's independent approved GitHub operation. | BLOCKED / unclaimed; after FIN02 and required original closeout |

## Where earlier work went

[Historical tasks](historical/README.md) contain completed work, superseded plans and closed previous batches. They retain original evidence and unfinished obligation mappings. Moving a task there does not mean its missing live checks passed.

New tasks use active/<group>/<TASK-ID>/README.md and ticket.md. When finished or superseded, move the folder into the appropriate historical group, preserve original evidence, update links and record the relocation. Do not keep duplicate live tickets at the old flat paths. [Relocation manifest](relocations.json) maps all 73 original task documents, including the two earlier policy follow-up tickets.
