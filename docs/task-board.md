# Known Enough — shared task queue

[Task guide](tasks/README.md) explains each remaining task in plain language. [Historical tasks](tasks/historical/README.md) contain earlier work and the [previous board](tasks/historical/task-board-before-organization-2026-10-02.md).

## Current checkpoint — 2026-10-02

AWS installation, GitHub settings, publishing permissions and automatic deployment/test triggering are verified. Latest deployment37089181120 automatically started37089230162 on matching source bef9d0d. Publication, public checks and AWS metadata PASS. Real email verification/hosted login (QA01) and admission/invitations (QA02) PASS. Decision creation/owner confirmation (QA03) FAIL, four later journeys BLOCKED; privacy and CLEAN cleanup PASS. One model attempt and one synthetic message reported. [Actual matching report](review-artifacts/ASSESS07-email-login-pass-decision-failure.json). The report does not identify the failing QA03 substep. A corrects a reproduced test timing race (reading the old decision ID before creation completes) and prepares fixed decision-stage/HTTP diagnostics; the fourth run's exact failing substep remains unproved. Full live acceptance remains pending. Four fixture-started runs on UTC2026-10-03 used the installed daily allowance. The user now approves two extra one-time bounded runs for B and transfers this priority to B. AWS allowance is not changed by these docs: A's guarded dated two-run helper is now prepared; actual CloudShell readback remains pending. B pulls the updated broker and the next authorized release activates exception support before fixture startup. AUTH/usage/cumulative caps remain unchanged. Keep all prior usage, cumulative ceilings and original expiry.

A's recurring observer and completed one-time follow-up are deleted. B's existing Codex automation is unchanged; B's actual scheduled execution is not yet verified. No A monitor should be recreated.

## Work order and preserved claims

| Order | Task | Current status | What remains |
| --- | --- | --- | --- |
| 1 | [ASSESS07 — Real automatic qualification](tasks/active/live-testing/ASSESS07/README.md) | READY — B takeover authorized / unclaimed; live proof and allowance readback pending | Pull tested main, claim ASSESS07, prepare the one-time two-run allowance for A to apply if needed; publish and inspect the matching automatic all-seven/CLEAN report. |
| 2 | [ASSESS10 — B monitor verification](tasks/active/monitoring/ASSESS10/README.md) | READY / unclaimed; B-only verification after the current cycle | Identify B's existing automation, prove two unattended ticks and fresh AWS results, check stale/failure notification behavior. |
| Delivery umbrella | [LIVE04 — Online test delivery](tasks/active/live-testing/LIVE04/README.md) | IN_PROGRESS; installation/settings checkpoint passed | Finish its remaining managed proof through ASSESS07; no mandatory B manual launch. |
| Preserved closeout | [NP00 — Technical closeout](tasks/active/closeout/NP00/README.md) | IN_PROGRESS; A / Ricardo / martelaxe / WSL claim retained | Finish original remaining technical obligations; its model-off checkpoint is already verified. No concurrent writer. |
| Later | [OPS01 — Storage and archiving](tasks/active/operations/OPS01/README.md) · [OPS02 — Retention and erasure](tasks/active/operations/OPS02/README.md) · [OPS03 — Recoverable jobs](tasks/active/operations/OPS03/README.md) | BLOCKED / unclaimed | Managed ASSESS07 baseline first, then wider-use work under the shared queue. |

ASSESS10 is not a claim that B has started. A/B identity, execution worker, chat and task role remain distinct: A is Ricardo / martelaxe; B is Octavio / Battosai1806. A Mac session authenticated as A is not B. See [verified mapping](people-and-workers.md).

Latest user direction transfers ASSESS07 to B and approves two one-time extra synthetic cycles. A releases only ASSESS07 and stops that work; B claims after pulling main. Next is ASSESS10, then OPS01 → OPS02 → OPS03 as their prerequisites allow. NP00 remains A's preserved closeout; no concurrent writer or actual B start is claimed.

## Execution boundaries

Pull clean main with git pull --ff-only origin main before claiming work. Use the [workflow](agent-workflow.md) and the task's full ticket; preserve the existing claim and bounded file scope. This documentation reorganization claims no product implementation and releases no task. Only one implementation or review task runs at a time; explicit earlier bounded handoffs remain preserved in history.

Eligible authorized main application deployments already trigger the complete online qualification automatically. B reads GitHub results using B's own account; no personal AWS login or required Run workflow click. Five-minute monitoring reads health/results and must not repeatedly deploy, run the paid full suite or send verification emails.

The existing synthetic test grant expires 2026-10-09T03:16:41.171626Z: four runs/day, 28 total runs, USD 7 cumulative reserved-model ceiling and 56 synthetic messages. The user's two-run B exception is recorded in ASSESS07; its installed enforcement is not yet verified. No usage reset, recurring increase or renewal is implied. AWS writes, new resources, publication and spending outside the applicable authorization still need separate authorization. Real participant identity, consent and exact approval remain mandatory.

Verified documentation sync to origin main is standing-authorized and uses [skip ci]; it is not a deployment or test dispatch. Other clones must pull ff-only before their next task. Never force-push or discard unsaved work.

## Completed and superseded work

NP01–04, LIVE01–03 and ASSESS01–06/08–09 completed their recorded local criteria and are now in [completed history](tasks/historical/completed/README.md). Their unfinished online obligations remain LIVE04 / ASSESS07. NP05 is a [historical umbrella](tasks/historical/superseded/NP05/README.md), with all acceptance preserved and mapped to LIVE04. Pre-NP records are [administratively closed history](tasks/historical/previous-batches/README.md), with original evidence and hashes retained. None of these moves creates missing live acceptance.

Human trials, independent release review and submission preparation remain deferred under the current user direction; participant consent is not deferred. Older status/claim/priority paragraphs remain in the previous board and individual tickets for reference and do not schedule new work.

[A handoff](handoff-A.md) · [B handoff](handoff-B.md) · [A log](work-log-A.md) · [B log](work-log-B.md) · [Operational limits](operational-limits.md)
