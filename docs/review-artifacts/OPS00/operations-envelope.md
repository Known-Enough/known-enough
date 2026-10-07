# OPS00 operations envelope — coding baseline

Source f1ab2555504bb9ef93a6ddfc64b1ad76032aff54. Own B verified; no installed permission change or provisioning. Latest standing authorization supersedes old approval expiry/ceilings, while technical request bounds, usage CAS, participant authority and cleanup remain.

| Required operation | Existing evidence | Missing bounded contract |
| --- | --- | --- |
| Publish frontend/API | Own B deployment37557946340 and release37557999023 source2630c9f SUCCESS in their release jobs | Reuse existing roles; do not add a parallel deploy role |
| Inspect resource configuration | Existing shared OIDC inspector metadata collection37538524405 PASS, overall report failed historical assertions | Collection is not permission for migration/deletion |
| Partition account/group/draft/binding state | Existing room Dynamo adapter has version/guard/replay and352/360KiB bounds; group partitioning is OPS01 work | Exact forward key schema, revision guards, immutable recovery manifest and journal must be fixed before apply |
| Archive | Existing release role does not define archive data permission | Organizer/operator authority, retention/replay preservation, ID-only journal, interrupted-stage resume and readback |
| Export/erase | No verified managed erasure workload | Owner-specific authority, dependent jobs/consent invalidation, bounded page cursor, deletion journal; backup/provider retention remains separate |
| Distributed job delivery | Model job source exists; release role has no SQS provisioning statement | ID-only message schema, lease expiry/attempt/dead-letter bounds, fresh admission/consent and cumulative budget CAS before calls |

## Minimal workload separation

Account092954139775/regionus-east-1 and Known-Enough/known-enough main OIDC subject remain explicit. Separate setup-only delegation from runtime migration/archive/retention/job execution. No workload self-edit of IAM policies/trust, wildcard administrator, arbitrary tables/buckets/queues, control AUTH/TOTAL reset, private payload in workflow inputs/artifacts, or cross-account credentials. Resource names/partition prefixes for new operations are deliberately unresolved until the corresponding data contracts are fixed; unresolved means reject apply, not allow wildcard fallback.

## Repeatable plan contract to implement next

A checked source SHA and operation-specific plan digest bind exact account/region/resource/key schema, expected current revision, bounded affected IDs/count and preservation/rollback conditions. Preflight rejects missing/unknown operations, unrelated targets and incomplete contracts. Apply consumes only a verified plan; durable private journal records plan identity, step/checkpoint and conditional revision, separate from runner temporary files. Resume reads and validates journal/installed state, never blindly replays creation, erasure or provider calls. Safe output includes only source/plan hashes, operation, status and count; no private records, bearer material or refusal details. Technical negative cases include wrong target/hash/revision, partial recovery, duplicate plan and forbidden IAM/control reset.

This document is preparation, not CODE_READY or installed proof. Next implement/test the plan validator and exact bounded setup proposal after confirming group/storage/job contracts; final cloud installation/readback/representative workload belongs to the coding-first final phase. Preserve A NP00 runtime/IAM scope.
