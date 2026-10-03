# OPS01 — Partition group state and archive safely

- Status: BLOCKED — wider-use scope requires managed ASSESS07 baseline before wider-use implementation/claims; unclaimed. No implementation runs alongside A cloud/NP00.
- Origin: FA15 in [assessment](../../../../full-assessment.md), tracked by ASSESS06.
- Priority: before broader enrollment/real-person/distributed claims respectively, after ASSESS08/07.
- Worker/model: select at claim under current workflow; architectural changes use the required architecture checkpoint, never an automatic model switch.

## Concrete remaining work

Partition accounts/groups/drafts/bindings without losing current admission, roster, idempotency or consent guards; provide organizer/operator-authorized archive with resumable journal and retention-aware replay history. Preserve current main data with a validated forward migration and immutable recovery. Test realistic byte limits, concurrent unrelated groups, disable/removal at commit, archive retry/crash and no consent resurrection. Prepare exact IAM/data migration proposal; actual cloud migration needs A authorization.

## Completion

Focused regression and pinned npm run check, code/privacy self-inspection, named architecture review if reinstated by scheduling, migration/recovery evidence and separate managed proof. Maintain own log/handoff; commit and push verified source using [skip ci]. Current bounded synthetic pilot may continue only within [operational limits](../../../../operational-limits.md). This ticket grants no cloud change, paid call, deletion, participant consent or NP00 takeover.
