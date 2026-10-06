# OPS03 — Recoverable distributed model jobs

**Coding-first scheduling — user direction, 2026-10-06:** The coding phase follows the checked coding checkpoint of OPS02, not deferred administrator installation. Complete durable job/lease/retry code and tests now; defer missing queues/permissions/runtime installation and managed proof. Follow [the current two-phase queue](../../../../coding-first-plan.md); record CODE_READY and release a checked claim if mandatory cloud proof remains, without calling the whole task DONE. Older administrator-first scheduling dependencies below are superseded; original technical acceptance remains. No new worker or active claim is created by this update.

- Status: BLOCKED / unclaimed until OPS02 coding checkpoint; then coding phase eligible. Administrator installation/required managed acceptance deferred to final cloud phase.
- Origin: FA16 in [assessment](../../../../full-assessment.md), tracked by ASSESS06.
- Priority: follow the shared queue after ASSESS07 → ASSESS10 → OPS00, then OPS01 → OPS02 → OPS03; before broader enrollment/real-person/distributed claims respectively.
- Worker/model: select at claim under current workflow; architectural changes use the required architecture checkpoint, never an automatic model switch.

## Concrete remaining work

Persist ID-only deliveries, distributed leases, expiry and bounded retry/dead-letter classification. Reload current verified admission/context/consent before every provider call and result transaction; preserve cumulative budget CAS. Raw conversation turns remain transient and are never queued. Test restart/duplicate-worker/lease loss/stale admission and exact budget charges. Prepare exact queue/permissions/cost contracts through OPS00 before authorized provisioning; actual approved operations use its verified GitHub path, not a per-task A-only CloudShell command.

## Completion

Ordinary operations inside the OPS00 approved envelope must work through B's own GitHub account. If an actual required capability is missing, repair the bounded automation before claiming completion; do not widen access speculatively or hide a repeated administrator handoff. New outside-envelope permissions/costs still require specific authorization.

Focused regression and pinned npm run check, code/privacy self-inspection, named architecture review if reinstated by scheduling, migration/recovery evidence and separate managed proof. Maintain own log/handoff; commit and push verified source using [skip ci]. Current bounded synthetic pilot may continue only within [operational limits](../../../../operational-limits.md). This ticket grants no cloud change, paid call, deletion, participant consent or NP00 takeover.
