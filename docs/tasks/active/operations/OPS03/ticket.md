# OPS03 — Recoverable distributed model jobs

- Status: BLOCKED — wider-use scope requires managed ASSESS07 baseline before wider-use implementation/claims; unclaimed. No implementation runs alongside A cloud/NP00.
- Origin: FA16 in [assessment](../../../../full-assessment.md), tracked by ASSESS06.
- Priority: before broader enrollment/real-person/distributed claims respectively, after ASSESS08/07.
- Worker/model: select at claim under current workflow; architectural changes use the required architecture checkpoint, never an automatic model switch.

## Concrete remaining work

Persist ID-only deliveries, distributed leases, expiry and bounded retry/dead-letter classification. Reload current verified admission/context/consent before every provider call and result transaction; preserve cumulative budget CAS. Raw conversation turns remain transient and are never queued. Test restart/duplicate-worker/lease loss/stale admission and exact budget charges. Prepare exact queue/permissions/cost proposal before cloud provisioning.

## Completion

Focused regression and pinned npm run check, code/privacy self-inspection, named architecture review if reinstated by scheduling, migration/recovery evidence and separate managed proof. Maintain own log/handoff; commit and push verified source using [skip ci]. Current bounded synthetic pilot may continue only within [operational limits](../../../../operational-limits.md). This ticket grants no cloud change, paid call, deletion, participant consent or NP00 takeover.
