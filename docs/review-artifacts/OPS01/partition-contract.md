# OPS01 inactive partition boundary

Scheduled run115, 2026-10-07. This is an implemented source slice of the sole OPS01/B claim, not CODE_READY, installed migration or managed acceptance. Existing group/runtime/admission selection remains unchanged.

## Exact proposed storage

The Dynamo transport is pinned to proposed table `KnownEnoughPartitions`, region `us-east-1`. Final OPS00 setup must bind it to verified account092954139775, encryption, PITR, deletion protection, retained resource and no automatic TTL. That resource/delegation is not installed or included in OPS00's current setup template. No AWS call was made in this coding check.

| Record | PK | SK | Guard |
| --- | --- | --- | --- |
| Account | ACCOUNT#verified-subject | STATE | Storage revision, with current application approval/version fields |
| Group metadata | GROUP#group-id | STATE | Storage revision, organizer/member/roster version and child-ID lists |
| Draft | GROUP#group-id | DRAFT#draft-id | Storage revision and existing strict draft/frame/body/creation binding |
| Decision binding | GROUP#group-id | BINDING#decision-id | Storage revision and current group-version binding |

Keys use current bounded ID syntax; records have strict schemaVersion1 and safe positive storage revision. Application frame schema remains version2. Rows retain a352KiB JSON ceiling, reserving room beneath the service item limit. Atomic writes include at most100 distinct keys and a3.5MB serialized envelope ceiling. Normal mutations cannot remove retained account/group/draft/binding rows or clear/change an existing draft's createdDecisionId. A reserved createdDecisionId must have a retained matching decision binding; callback results are cloned before any commit. Archive/erasure require separate forthcoming lifecycle contracts.

## Authority and concurrency

The explicit server-side scope names at most16 account subjects and one group. Its callback receives only declared accounts and that complete group, never global state. Each transaction conditions every scoped account and group header, even for a read-only callback. Changed children advance the group header in the same atomic write. Unrelated groups condition a shared account without rewriting it, so their storage versions do not invalidate each other. Same-group collisions retry from fresh state, at most six times. SDK attempts are one per call, with30-second abort signals; only explicit conditional/transaction conflicts return retryable false. Other service failures retain a private cause under a fixed safe message. Private causes must never be serialized in public logs.

A snapshot reads headers/accounts, referenced children, then headers/accounts again to reject torn reads. Each coherent read attempt is finite (at most162 requests at maximum roster/child bounds), with at most six coherent attempts. Read batching/lazy child loading and request-wide latency bounds need assessment before runtime activation; this first slice does not claim production scale/performance.

The server-only fence exposes all conditional mutations for a future joined decision transaction; its readback is an early stale check, not an atomic decision commit. Existing DecisionAdmissionFence accepts one write, so this new port is deliberately not substituted there. Integration must record its exact additional file scope and preserve A's saved NP00 boundaries before expanding that interface. Authorization comes from the verified service callback and current participant/operator rules, never a caller-supplied HTTP scope.

## Checked behavior and remaining criteria

Focused regressions cover a collection larger than the old300000-byte shared-row ceiling, individually oversized UTF-8 drafts, concurrent unrelated/same-group writes, account disable and roster removal at conditional commit, draft-header invalidation, immutable reserved creation binding, corrupt/missing rows, undeclared writes, overflow, callback/service failure and exact SDK requests. All SDK behavior is mocked; generic atomic transport tests exercise shared persisted state across repository reconstruction. No distributed Dynamo guarantee or real managed PASS is inferred. Pinned full check results are recorded in the task/log after completion.

Remaining OPS01 work: compatible service scoped lookups and uniqueness indexes (including email/invitation/decision lookup), joined multi-row decision authority, account/operator and roster behavior, bounded reads, organizer/operator archive with resume/crash tests, immutable migration manifest and validated forward batches, replay retention/consent preservation, exact OPS00 resource/apply/authority contract and final-cloud installation/migration/recovery proof. No successor is claimed. A's NP00 remains paused/saved.

## Source self-inspection, run115

Two new regressions actually failed before repair: an unserializable callback result raised DataCloneError after committing the mutation; a reserved draft with no matching decision binding was accepted. The result is now cloned before persistence and strict state validation requires that binding. The updated16 focused regressions PASS. Earlier fixture failures (old public frame schema1 instead of2; option labels120 instead of100) were corrected without weakening validation. ESLint required retaining the private caught service cause; safe public messages remain fixed. Maximum child collections cannot be committed in one over100-key transaction; bounded forward batches retain all128 children across reconstruction. That demonstrates the storage primitive, not a complete migration/journal.
