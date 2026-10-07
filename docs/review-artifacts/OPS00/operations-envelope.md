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

## Durable journal persistence boundary

The offline validator now revalidates the original plan against the independently supplied envelope on every recovery. It accepts no caller-supplied checked hash and emits only the canonical identity; it is not an apply engine.

Next storage adapter must implement create-if-absent by planHash and revision-conditional progress writes. A read returns the current journal plus its storage revision; a write compares that revision and plan identity, rejects regressions in completedItems and prohibits returning COMPLETE to APPLYING. Two workers racing the same step must leave exactly one recorded progression. COMPLETE may contain fewer than maxItems because maxItems is a bound, not an asserted actual affected-row total; successful completion also requires operation-specific readback, not just journal state.

The private recovery manifest must be durable independently of GitHub runner lifetime. Its hash binds the plan; object/record contents stay outside public artifacts. Setup must name an exact managed journal resource and recovery location before any apply workflow is enabled. A runner-local file cannot establish recoverability across runners. No generic file journal or proposed AWS resource is reported as installed durability.

Required adapter tests: duplicate create, stale expected revision, interrupted step/re-read, regressing count, terminal-state reversal, wrong plan identity and two competing writers. Apply remains disabled until the operation's partition/retention/job contract provides exact readback and rollback. OPS00 remains IN_PROGRESS, not CODE_READY; final cloud phase retains installation/permission and representative workload proof.

## Managed journal resource proposal — not installed

Proposed dedicated table `KnownEnoughOperationsJournal`, account092954139775/us-east-1; PK=`PLAN#<64-hex-planHash>`, SK=`JOURNAL`. Avoid writing recovery journals into existing AUTH/LEASE/TOTAL or participant tables. A journal row contains only validated plan/resource identity, storage revision, bounded completed count and phase. Read consistently; create condition `attribute_not_exists(PK)`; advance condition compares stored revision, and new revision is the validated increment. Conditional conflicts are resumable stale-work errors, never a reason to overwrite current state. Reject extra/malformed records before exposing a journal to the service.

This is an exact setup proposal, not permission/readback proof. PAY_PER_REQUEST and encrypted storage with point-in-time recovery must be included in the reviewed setup plan; no TTL should silently remove active recovery records. Final retention depends on OPS02's approved policy. Runtime delegation should allow GetItem/PutItem on this exact table only, with LeadingKeys restricted to PLAN# identifiers. It must not allow DeleteTable, IAM editing, control counter resets or arbitrary table creation. Setup/bootstrap role and runtime role remain distinct.

Next implement an injected Dynamo transport adapter for this schema with strict ARN/region/table checks, consistent reads and actual conditional request tests; do not enable live apply until exact resources are installed and independently verified. Private recovery manifests still need their own bounded durable location/retention contract. The current fake-port test establishes atomic-port usage, not an AWS installation or managed restart test.
