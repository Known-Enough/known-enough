# Finish the basic Known Enough app

User direction, 2026-10-03. This roadmap records remaining work; the [shared board](task-board.md) controls claims and order. B's two actual deployment/test cycles failed QA03_CREATE after QA01/02 PASS, with CLEAN cleanup; ASSESS07 remains BLOCKED/claimed. [Matching evidence](review-artifacts/ASSESS07-b-final-two-cycle-result.json). New [ASSESS11](tasks/active/live-testing/ASSESS11/README.md) investigates the user's public signup failure before monitor/OPS; QA signup PASS does not prove the primary website's signup. Its investigation can follow an explicit safe handoff rather than wait for all-seven PASS. Later tasks retain their prerequisites. One task runs at a time; A's saved NP00 closeout stays preserved.

## What exists

The core app implements accounts, groups and invitations; decision drafting and clarification; private participant input; negotiation; separate disclosure permission; and approval of the exact shared outcome. The website and AWS test environment are installed. GitHub can publish a matching release and start its tests automatically. Routine testing uses the worker's own GitHub login, without sharing A's AWS credentials.

Current evidence snapshot: the latest actual online qualification is [37147658807](https://github.com/Known-Enough/known-enough/actions/runs/37147658807), source `47c2d8233ae839049969fcc00c6a30137403483b`. Publishing/public checks, signup/email/login and invitations passed. Decision draft generation failed; four later journeys were blocked. All seven automated journey scripts exist, but a complete real pass is missing. The checked prompt correction still needs publication and live verification. Latest source checks passed718 application tests,58 browser tests and one hosted-preview test, with two optional skips; those are local/test-environment checks, not seven online journey passes.

A's [two-run approval for B](https://github.com/Known-Enough/known-enough/actions/runs/37158067754) is recorded. Its dated extra starts expire October3,18:00 Mexico City (`2026-10-04T00:00:00Z`). B's repository claim is recorded; actual allowance consumption and a B live run are not yet verified. Original spending/email/cleanup/expiry limits remain. This roadmap creates no new runs, renewal or deployment authorization.

## What is left, in order

| Task | Plain-language purpose | Ready now? |
| --- | --- | --- |
| [ASSESS07](tasks/active/live-testing/ASSESS07/README.md) | Repair the demonstrated decision failure and prove all seven online journeys pass automatically. | BLOCKED / same B claim; both approved cycles failed QA03_CREATE. |
| [ASSESS11](tasks/active/live-testing/ASSESS11/README.md) | Fix the user's public signup error and make safe debugging evidence easy to find. | READY / unclaimed, next priority after current claim's completion or explicit safe handoff; does not require all-seven PASS to diagnose. |
| [ASSESS10](tasks/active/monitoring/ASSESS10/README.md) | Prove B's existing monitor actually checks fresh results and notices failures. | After signup investigation/current cycle. |
| [OPS00](tasks/active/operations/OPS00/README.md) | Complete the approved GitHub operations path, so OPS does not repeatedly need A to run AWS commands. | After ASSESS07 managed baseline, ASSESS11 and ASSESS10, before OPS01. |
| [OPS01](tasks/active/operations/OPS01/README.md) | Keep groups from sharing one storage bottleneck and add safe archiving. | After OPS00 and managed baseline. |
| [OPS02](tasks/active/operations/OPS02/README.md) | Give private data clear retention, export and authorized deletion behavior. | After OPS01. |
| [OPS03](tasks/active/operations/OPS03/README.md) | Let unfinished AI work recover after restarts without duplicated work or charges. | After OPS02. |
| [UX01](tasks/active/ui-ux/UX01/README.md) | Review the existing screens and complete participant journey on desktop and phone. | After OPS03. |
| [UX02](tasks/active/ui-ux/UX02/README.md) | Fix the important usability, layout and accessibility problems found in that review. | After UX01. |
| [UX03](tasks/active/ui-ux/UX03/README.md) | Verify the interface/journey checkpoint and simple start instructions; route remaining debt to FIN01–03. | After UX02. |
| [FIN01](tasks/active/technical-debt/FIN01/README.md) | Reconcile and finish actual inherited technical debt through preserved claims/handoffs. | After UX03. |
| [FIN02](tasks/active/technical-debt/FIN02/README.md) | Check group construction, membership/decision links and safe progress across distinct participants. | After FIN01. |
| [FIN03](tasks/active/technical-debt/FIN03/README.md) | Prove final basic completion and independent GitHub operation; reconcile actual original closeout. | After FIN02 and required NP00/LIVE04/OPS/UX proof. |

[LIVE04](tasks/active/live-testing/LIVE04/README.md) remains the online-delivery umbrella. [NP00](tasks/active/closeout/NP00/README.md) preserves older unfinished technical obligations; historical DONE labels do not satisfy missing proof. Resolve it through its existing A handoff, without a concurrent writer.

B can implement app changes, review screens and run authorized GitHub tests. Existing release access covers code/artifact publication and tests against installed resources. The checked-in release path does not provision new storage/job resources or grant general role editing; actual installed access must be verified before deciding any change. OPS00 defines the exact OPS01–03 operations, reuses sufficient access and prepares any unavoidable narrow administrator delegation once. Then ordinary operations inside that approved envelope run through GitHub, with actual B evidence and durable recovery, without per-task AWS logins or CloudShell scripts. New outside-envelope permissions/costs still need their specific authorization. A finite run approval cannot replace expired/exhausted original spending authority. This roadmap does not install that capability or claim it is already verified.

## Bounded Luna reviews

Within UX01 and UX03, B may use up to three Luna helpers to inspect different parts of the same claimed task: first-use/navigation, phone/keyboard/layout, and clarity of private versus shared information and approvals. Helpers inspect and return evidence; the direct worker owns changes, verification and integration. Prefer the minimum number needed, bounded pages and a short issue list. Do not have helpers independently change files, claim project tasks, deploy, run paid suites or send email. A review using synthetic/local data must say so. Actual B authentication and automatic execution still need their own evidence.

This user-directed exception permits these reviews within one parent UX task; it does not start parallel implementation or another mandatory independent-review session. It creates no helpers now and does not switch any existing session's model.

## When the basics are finished

- A matching deployed app passes all seven real online journeys, with clean test cleanup and unchanged authority/privacy safeguards.
- Storage, data lifecycle and job-recovery tasks meet their actual technical and authorized managed criteria. Any remaining pilot limits are visible and accurate.
- The current desktop/phone layouts, keyboard navigation and loading/error/retry states are checked. A newcomer can complete the core journey without developer help.
- Existing Family Christmas and Shared Purchase demonstrations have source-matching evidence; synthetic estimates and supported limits are clearly labeled. Reuse valid unaffected evidence; do not call an offline demo a live pass.
- FIN01 closes actual inherited obligations, FIN02 proves group construction and FIN03 reconciles final NP00/LIVE04/OPS/UX evidence, working start instructions and remaining limits. Ordinary operations inside the OPS00 approved envelope need no repeated administrator handoff. No blocker is hidden by moving a ticket into history.

This finishes a tested basic demo/pilot. Human trials, wider public enrollment, Alexa/voice integration, new integrations and hackathon submission materials are separate later work, not additions to these UX tasks. Participant consent and owner approvals remain product requirements. No human sign-off gate is reinstated by this roadmap.
