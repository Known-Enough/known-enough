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


## Current contract amendment — run116,2026-10-07

This supersedes run115's sequential-read and per-call-only limits for the new inactive source. PartitionTransport supports consistent batched reads. Dynamo batches at most100 distinct keys per request and restores input order; processed missing keys become null while unprocessed keys are retried under the same context. Unknown/foreign/duplicate/contradictory response keys fail closed. At most145 keys enter one batch-port call. The shared operation context limits total underlying requests to64 and elapsed time to20seconds across read coherence, callback, directory checks, CAS retries and commit. SDK attempts stay one. A non-batch transport uses at most eight concurrent reads; default Dynamo batches issue one request at a time. Budget exhaustion aborts the shared signal. Deadline or lost acknowledgement during an already submitted commit leaves its outcome UNKNOWN and requires replay/reconstruction; it is not proof of rollback. A delayed callback cannot start persistence after its deadline.

Additional private immutable directory rows have schemaVersion1/storage revision1.

| Lookup | PK | SK | Retained facts |
| --- | --- | --- | --- |
| Email owner | EMAIL#email-HMAC | CLAIM | subject and original emailHash |
| Invitation | INVITATION#token-SHA256 | TARGET | groupId,tokenHash,recipientHash,original expiresAt |
| Decision group | DECISION#decision-id | GROUP | decisionId and groupId |

Account creation automatically conditions and writes its email claim atomically with the account. Newly added invitation tokens and decision bindings automatically claim their exact directory rows in the guarded group/child transaction. Any existing claim blocks recreating that identifier; an idempotent retry resumes its already persisted parent. Conditional collision retries from fresh parent state; another owner is rejected with PARTITION_IDENTITY_CONFLICT, without exposing that owner. Normal mutations cannot change account email identity, invitation recipient/lifetime or clear a prior acceptance. Duplicate persisted invitation tokens are invalid. Directory puts cannot overwrite revision1 and no deletion primitive is exposed. Removed/expired tokens retain their private directory facts; lookup is discovery only. The verified service must still check current account approval, group membership/version and actual invitation/expiry/recipient or decision binding inside the joined commit fence before authorizing anything. No HTTP lookup route/public directory payload is added.

Directory rows count against the same100-key/3.5MB atomic limit;64 new decision bindings require at least two forward batches because each binding adds its claim. Full migration preparation/journal/validation are still pending, not supplied by those storage tests. The new proposed table remains uninstalled; BatchGetItem and transactional parent/directory SDK operations require exact effective-role/resource mapping and proof in the final OPS00 setup package. No deployment or permission change is inferred.

Run116 focused evidence covers100+28 chunking/input order, consistent partial/unprocessed responses, foreign/duplicate results, shared request/deadline/CAS limits, bounded fallback concurrency, shared email/token/decision races, immutable invitation facts/acceptance, retained-token non-resurrection, lost acknowledgement reconstruction and private/corrupt directory rejection. All SDK responses are mocked; managed-service behavior remains UNKNOWN.31 focused regressions PASS before the pinned full check; final full/source sync results are recorded in the ticket and monitor log. Remaining membership/list pagination and joined application decision authority are not yet implemented. Next archive/recovery/migration source work preserves these retained identifiers and A NP00 boundaries.


Final run116 checked source at2026-10-07T09:13:00.199792+00:00:31 focused PASS; pinned full exit0,815 application(two optional skips),hosted1,browser62,refs7/planning15/lint/boundaries/types/build. Same four inactive source/test paths; no managed proof or task release.
