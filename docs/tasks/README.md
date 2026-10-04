# Task guide

**Latest authorization — 2026-10-04T16:34:21Z:** A recorded **ten additional B runs** through [approval37217250492](https://github.com/Known-Enough/known-enough/actions/runs/37217250492), valid until **today October4,18:00 Mexico City**. [Verified receipt](../review-artifacts/ASSESS07-b-ten-more-runs-approved.json). ASSESS07 is RESERVED/B in preserved worker `01a1044b-4cc8-7c00-b5ee-a24a17ded137` at synchronized assignment `2c1323ded789fdedeb393f3c18342c6c470a1e4e`; read-only intake is complete and explicit start follows this guide reconciliation; current workload guards and matching all-seven/CLEAN proof remain. Original budgets/usage are unchanged, no test started, and ASSESS11's signup configuration/live gates remain separate. Read this and the current board/claim log before older release instructions.

Start here to understand what is left. Every task has its own folder: README.md explains the basic idea and next step; ticket.md contains its full requirements, claim and evidence. The [shared board](../task-board.md) decides the current order. One implementation task at a time; a folder move does not release an existing claim.

**Earlier blocked-task transition — 2026-10-04 (historical):** B released ASSESS07 and later ASSESS11 with checked synchronized pending-work handoffs. The fresh ten-run receipt and renewed ASSESS07 reservation above supersede that earlier routing; ASSESS11 remains BLOCKED/deferred/unclaimed. For future genuine external blockers, save and synchronize a checked checkpoint, record all pending work, release the B claim and select the next eligible task. Keep one active task, all technical dependencies and A's NP00 claim. The existing five-minute monitor follows the current claim, rather than remaining attached indefinitely to released ASSESS07.

**B conversation dispatch — user direction, 2026-10-03:** The existing five-minute automation assigns one `gpt-6-sol` / `max` conversation per eligible claim and resumes the same worker until verified completion or explicit release. The [claim log](../claim-log.md) records assignments and excludes claimed work from availability. ASSESS07 already has its dedicated B worker; later tasks retain their prerequisites. Its extra two-run receipt expired at 2026-10-04T00:00:00Z, so first reconcile actual results; no new live start or budget renewal is implied.

## Online testing

**Historical pre-release evidence — 2026-10-04 UTC:** B used both approved cycles; both deployments succeeded and both matching qualifications failed QA03_CREATE after QA01/02 PASS, with QA04–07 blocked and CLEAN cleanup. ASSESS07 was BLOCKED with the same B worker at that checkpoint; the latest explicit release above supersedes that assignment. [Two-cycle evidence](../review-artifacts/ASSESS07-b-final-two-cycle-result.json). ASSESS11 addresses the user's public signup error before ASSESS10 and OPS; exact cause remains unknown. QA signup PASS was on the separate test website. The safe release now permits its local investigation without all-seven PASS. No third cycle is granted.

**Historical installation/approval checkpoint:** Installation, GitHub settings and automatic test triggering were verified. Real QA signup/email/login and invitations passed; decision creation failed, blocking four later journeys. The earlier [October3 approval](../review-artifacts/ASSESS07-github-two-b-runs-approved.json) and later [two-cycle approval](https://github.com/Known-Enough/known-enough/actions/runs/37167291403) remain history; they do not authorize another dispatch. Existing GitHub workloads use the worker's own GitHub account without personal AWS credentials or a separate test click. Full live acceptance remains unproved.

| Task | Basic idea | Status |
| --- | --- | --- |
| [LIVE04](active/live-testing/LIVE04/README.md) | Prove the installed online test environment works from start to finish. Installation and GitHub settings are ready; real test results and cleanup evidence are still needed. | IN_PROGRESS |
| [ASSESS07](active/live-testing/ASSESS07/README.md) | Verify the saved QA03 repair with matching deployment and all-seven/CLEAN automatic qualification. | RESERVED / B; renewed preserved worker intake, original guards required |
| [ASSESS11](active/live-testing/ASSESS11/README.md) | Fix both reported signup paths, log useful safe errors and implement consistent basic password rules (minimum6, no required character classes). Separate primary proof from QA signup tests. | BLOCKED / deferred / unclaimed; checked local source synchronized, separate primary signup/cloud/live gates pending |

## B's existing monitor

| Task | Basic idea | Status |
| --- | --- | --- |
| [ASSESS10](active/monitoring/ASSESS10/README.md) | Check that B's existing Codex monitor actually runs about every five minutes and reads fresh AWS results. A's monitor has been removed. | READY / unclaimed |

## Remaining technical closeout

| Task | Basic idea | Status |
| --- | --- | --- |
| [NP00](active/closeout/NP00/README.md) | Finish the remaining technical obligations from the previous batch. The model-off safety checkpoint is verified; other closeout evidence still belongs here. | IN_PROGRESS |

## Later, before wider use

These tasks wait for the managed ASSESS07 baseline, ASSESS11 public signup verification and ASSESS10. OPS00 completes and verifies the GitHub operations path before the implementation sequence; ordinary approved operations must not repeatedly depend on A opening CloudShell.

| Task | Basic idea | Status |
| --- | --- | --- |
| [OPS00](active/operations/OPS00/README.md) | Complete and prove the bounded GitHub operations path; prepare any unavoidable access setup once. | BLOCKED / unclaimed; after ASSESS10 |
| [OPS01](active/operations/OPS01/README.md) | Prepare group storage and safe archiving for wider use, after the real online test baseline is verified. | BLOCKED / unclaimed |
| [OPS02](active/operations/OPS02/README.md) | Add clear retention, export and authorized deletion of private data before wider use. | BLOCKED / unclaimed |
| [OPS03](active/operations/OPS03/README.md) | Make AI jobs recover safely across worker restarts and retries, with current permissions and spending limits checked. | BLOCKED / unclaimed |

## After operations: finish the interface and basics

The [basic completion roadmap](../basic-completion-plan.md) explains what exists and what still needs actual proof. These tasks are prepared for the shared queue; B can take them after OPS01–03 complete, one at a time. UX01 starts with one required bounded read-only Luna review of signup/first use; additional bounded helpers in UX01/UX03 remain optional. The direct worker owns all changes and verification. The urgent signup fix stays in ASSESS11 before OPS; later UI work verifies it and fixes remaining presentation issues. This starts no helper or deployment now.

| Task | Basic idea | Status |
| --- | --- | --- |
| [UX01](active/ui-ux/UX01/README.md) | First Luna screen review: clear signup/sign-in, no confusing repeated controls, consistent styling; then the complete desktop/phone participant journey. | BLOCKED / unclaimed; after OPS03 |
| [UX02](active/ui-ux/UX02/README.md) | Fix verified navigation/signup wording, improve existing CSS/forms/buttons and remove repeated content; retain accessibility and clear progress/errors. | BLOCKED / unclaimed; after UX01 |
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
