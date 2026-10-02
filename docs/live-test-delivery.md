# Live test delivery — finish online testing

> Current user clarification, 2026-10-02: routine qualification must run automatically after eligible successful deployments. Manual Run workflow is optional; no B click/dispatch acceptance gate remains.

User direction, 2026-10-01: prepare the missing online setup and real NP03/NP04 tests so B can run them independently, and automatically run approved checks after GitHub deployments. This plan replaces the single broad NP05 handoff with four deliverable tasks. It does not mark online work complete or authorize unspecified cloud writes, resource costs, paid AI or email. No implementation starts in this planning update.

## What the user receives

B prepares the code, a tested setup package and automatic checks first. A receives one documented CloudShell entry command that validates the account, explains the exact changes/cost limits, installs the approved package, and automatically verifies the result. After installation, A or B uses their own GitHub account to deploy through approved workflows, launch tests, and read results. Routine runs need no personal AWS login, manual account approval, email-code copying, project sign-off or human inspection.

The setup command is a required future deliverable, not an existing working command. Tests represent fictional people; each simulated owner performs its own explicit confirmations and exact approvals. Automating tests never authorizes decisions for real people.

## Four tasks

| Order | Task | Intended worker | Current status | Concrete result |
| --- | --- | --- | --- | --- |
| 1 | [LIVE01 — Build the online setup package](tasks/LIVE01.md) | B | READY / unclaimed | Repeatable setup, test accounts, secure automatic login, isolated data, cleanup and rollback |
| 2 | [LIVE02 — Test the real user journey](tasks/LIVE02.md) | B | BLOCKED on LIVE01 preparation | Real website/service tests carrying NP03/NP04 assertions; no local login/API/model substitute in live lanes |
| 3 | [LIVE03 — Run checks after every deployment](tasks/LIVE03.md) | B | BLOCKED on LIVE02 preparation | Trusted GitHub deployment/test orchestration, release identity checks and one complete report |
| 4 | [LIVE04 — Install once and prove B can run everything](tasks/LIVE04.md) | A installs; B qualifies | BLOCKED on LIVE01–03 and approved setup/budgets | Installed package, complete passing live report, automatic post-deployment run and actual B dispatch |

LIVE01–03 finish on their preparation criteria, with online execution explicitly pending LIVE04. LIVE04 requires actual service results. A blocked or omitted required lane cannot be reported as complete online qualification. NP01–NP04 remain local DONE; NP05 retains historical acceptance and maps its unfinished work into this sequence. NP00 retains its claim and model-disable work.

## Scheduling and ownership

The user authorizes B to prepare LIVE01 → LIVE02 → LIVE03 sequentially while A/Luna finishes the existing NP00 claim. This is a bounded scheduling exception, extending the prior B preparation exception. B must use a separate clean clone on main, pull ff-only, inspect claims, and record exact files/baseline before implementation. No subagents. Only one B delivery task runs at a time.

B must not edit NP00's current shared-inspection workflow/scripts/policies, model-disable runbook, active runtime/admission cleanup or A's log. Reuse shared-check outputs read-only. New setup/tests/workflows live in their named task scope. Changes to shared application source, contracts, root configuration, lockfile or existing deployment workflow require a recorded exact amendment and coordination before edits. A handles shared board updates during overlapping claims; B records its own ticket/log/handoff. Neither silence nor this plan releases NP00. LIVE04 begins through a recorded operations handoff after preparation and target coordination; it must not compete with NP00 cloud changes.

## Online environment and access

Use one persistent, separately approved isolated QA environment for writable journeys, running the same release artifacts as the deployment being tested. The existing group repository stores an aggregate item, so names/prefixes do not isolate test writes. Do not give tests write/reset access to the existing human/shared aggregate. Keep primary-site public checks and isolated-QA journey results separately labeled; QA success is not proof that primary staging has the same configuration. Include the prepared NP05 primary feature rollout and configuration comparison in the final setup package.

GitHub obtains narrowly scoped temporary AWS access. Separate deployment, metadata collection, synthetic-account setup/operator actions and test-login reads. B receives no A credentials. The trusted runner automatically admits only the exact synthetic accounts, retrieves only dedicated test secrets, and cleans only run-owned records. Serialize writable runs with a lease and block further writes after incomplete cleanup. Reports contain allowed hashes/status/counts, not passwords, tokens, raw private inputs or account attributes.

Actual signup/email verification uses a controlled test mailbox and automatic code retrieval. Precreated accounts support ordinary login checks but do not count as signup/email-delivery evidence. Include approved, pending, rejected, disabled, wrong-recipient, outsider and display-only states. Never weaken participant authentication for automation.

## Automatic tests and costs

Checks start only after a successful authorized deployment and target readiness. Bind the run to the immutable source SHA, exact frontend/backend artifact hashes and actual deployed receipt. Verify receipt provenance before accepting target hashes; do not update expected hashes merely to make an observed deployment pass. A superseded deployment cannot test a newer artifact under the old SHA.

Only trusted main workflow code executes with secrets or AWS access. If using workflow_run, verify upstream repository, workflow, event/ref, conclusion and SHA, and never execute uploaded scripts or PR/fork code. Keep manual dispatch for A/B, pin actions, limit concurrent runs and provide always-run sanitized reports even after failures. A report must visibly distinguish failure, unmet setup, skipped coverage and passing checks.

Model and email lanes need explicit setup authorization with fixed recipients/model, per-run attempts/tokens/messages, timeouts, per-period ceilings and expiry. Enforce AI limits server-side including SDK/provider retries; billing alarms are not hard caps. Routine deployment checks use only the approved recurring envelope. Missing or exhausted authorization produces visible blocked coverage, never an invented pass. No repeated human approval within that envelope; changes to spending, cloud scope or real recipients still require authorization. Optional invitation email is separately labeled; required signup verification cannot be replaced by administrator confirmation.

## Completion means

An actual B account launches a complete passing report through GitHub without A's session. A subsequent authorized GitHub deployment triggers the appropriate real tests automatically against the matching release, including cleanup. The report proves managed login, group/invitation state, new decision/private inputs/negotiation/exact agreement, denial/privacy/recovery and required real hosted screens. AI/signup-email evidence is real and budgeted. No human is required to approve fictional accounts, retrieve verification codes, read screens or judge routine results. Automated assertions determine the outcome. Human product feedback and release/submission remain outside this work.

Reuse [the detailed live assertion/access plan](live-automated-plan-tests.md), [NP03 screen inventory](np03-screen-inventory.md), [NP04 qualification](np04-qualification.md), [NP05 deployment preparation](../infra/np05-deployment.md) and [shared staging checks](shared-staging-checks.md). Do not rebuild the app or replace meaningful local regression tests.

## Automatic qualification — user clarification, 2026-10-02

User requires automatic tests, without B clicking Run workflow. Manual dispatch is optional diagnostics and is no completion prerequisite. After A's two installed-target/enabled repository settings are saved, eligible application/API/harness pushes to main run Deploy Known Enough staging to AWS Amplify; successful matching deployments automatically start Live QA release and qualification via the existing workflow_run trigger. Preserve provenance/current-main guards, all seven journeys, exact artifact receipts, CLEAN cleanup, finite cost/expiry/counters and real-person consent. A or B reads the report from their own GitHub account without personal AWS credentials. B's normal authorized code push can supply actor evidence; no contrived deployment or message is sent here. Required proof is an actual complete matching automatic PASS, still pending. This supersedes earlier mandatory B/manual-dispatch wording; history remains dated.
