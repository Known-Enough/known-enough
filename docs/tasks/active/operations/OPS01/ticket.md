# OPS01 — Partition group state and archive safely

**Coding-first scheduling — user direction, 2026-10-06:** The coding phase follows the checked coding checkpoint of OPS00, not deferred administrator installation. Complete storage/archive/migration code and tests now; defer required resource/data migration installation and managed proof. Follow [the current two-phase queue](../../../../coding-first-plan.md); record CODE_READY and release a checked claim if mandatory cloud proof remains, without calling the whole task DONE. Older administrator-first scheduling dependencies below are superseded; original technical acceptance remains. No new worker or active claim is created by this update.

- Status: IN_PROGRESS / B — partition/storage/archive coding. Administrator installation/required managed acceptance deferred to final cloud phase.
- Origin: FA15 in [assessment](../../../../full-assessment.md), tracked by ASSESS06.
- Priority: follow the shared queue after ASSESS07 → ASSESS10 → OPS00, then OPS01 → OPS02 → OPS03; before broader enrollment/real-person/distributed claims respectively.
- Worker/model: select at claim under current workflow; architectural changes use the required architecture checkpoint, never an automatic model switch.

## Concrete remaining work

Partition accounts/groups/drafts/bindings without losing current admission, roster, idempotency or consent guards; provide organizer/operator-authorized archive with resumable journal and retention-aware replay history. Preserve current main data with a validated forward migration and immutable recovery. Test realistic byte limits, concurrent unrelated groups, disable/removal at commit, archive retry/crash and no consent resurrection. Prepare the exact resource/key/data migration plan and obtain its applicable authorization; execute it through the verified OPS00 GitHub path. Do not substitute a recurring A-only CloudShell command for managed readiness.

## Completion

Ordinary operations inside the OPS00 approved envelope must work through B's own GitHub account. If an actual required capability is missing, repair the bounded automation before claiming completion; do not widen access speculatively or hide a repeated administrator handoff. New outside-envelope permissions/costs still require specific authorization.

Focused regression and pinned npm run check, code/privacy self-inspection, named architecture review if reinstated by scheduling, migration/recovery evidence and separate managed proof. Maintain own log/handoff; commit and push verified source using [skip ci]. Current bounded synthetic pilot may continue only within [operational limits](../../../../operational-limits.md). This ticket grants no cloud change, paid call, deletion, participant consent or NP00 takeover.


## B OPS01 claim and source intake — 2026-10-07T08:11:21.713735+00:00

IN_PROGRESS/B sole active task after OPS00's checked CODE_READY release. Own Battosai1806/ID143764700, synchronized source `e90ea9eaffd7b8539b49a88ec3be362b00636319`, same persistent chat/30-minute automation; no helper/new worker. Actual root GPT-6, exact variant/effort unavailable. Initial bounded implementation scope is new `packages/adapters/src/partitioned-group-repository.ts`, its focused `.test.ts`, and OPS01 contract/migration/archive tests/evidence/tracking. Existing application/group/admission interfaces will be read first; record exact additional paths before any edit. A NP00 runtime/admission/inspector/IAM/private recovery and unsaved files are excluded. No administrator/deployment/migration/data operation in this intake.

Actual read-only intake found current group storage in `packages/adapters/src/group-repository.ts`: one NP#GROUPS/STATE record,300000-byte checked JSON bound,six conditional retries and a global version shared by decision admission fences. Existing decision Dynamo storage separately reserves352/360KiB and conditions version/incarnation/replay. New partitioning must preserve fresh account/group admission and decision-at-commit fencing, with bounded migration/recovery/archives; it cannot weaken those guards or silently switch installed storage. No OPS01 executable change/test result yet. Next code the compatible inactive partition contract/adapter and focused unrelated-group/concurrency/authority regressions, using OPS00 recovery primitives; installation/managed proof stays in the final cloud phase.
