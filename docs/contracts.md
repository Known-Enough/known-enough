# Contract v1 — bootstrap baseline

Executable authority: [schemas and hash implementation](../packages/contracts/src/index.ts). Ownership transfers to B after bootstrap, with A reviewing breaking changes. Package version 0.1.0, wire schemaVersion 1. This document specifies behavior for B02/B03; the bootstrap implements validation/serialization only, no server or state machine.

## Examples and boundaries

[Public JSON examples](../apps/web/src/mocks/public) cover collecting, blocked (`NO_AGREEMENT`), private review, proposed, agreed and superseded. The page loads only collecting. They are synthetic illustrative responses, not evidence that a solver ran. [Owner example](../packages/test-support/fixtures/owner-private-review.json) and [all command examples](../packages/test-support/fixtures/commands.json) are server/test-only. [Results](examples/command-results.json) cover success and every error code.

PublicRoomSnapshot carries approved shared roster/load points, explicit timezone/schedule, approved policy, coarse status, optional current proposal, approved member IDs and published disclosure receipts. No named refusal, conflict counts, private conditions/costs/grant IDs. Approval indicators say only who has accepted this proposal; no rejection reasons. PRIVATE_REVIEW never identifies its recipient. SUPERSEDED clears active proposal and approvals; historical records are a later separate read surface.

OwnerSnapshot contains only the authenticated caller's confirmed structures, drafts, private offers, disclosure previews, own permissions and own approval. Knowing this schema grants no access to values. Owner identity is an output resolved by the server, not an accepted command parameter. Strict schemas reject unknown keys at every object level rather than silently stripping suspected leaks. Server projections must construct allowlisted objects independently. DTO validity does not prove authorization, hash equality, current expiry or cross-record consistency.

Finite conditions: HARD_AVAILABILITY lists explicitly covered full intervals; NEGOTIABLE_UNAVAILABLE blocks an interval unless expressly authorized and may invite one exception question. Duty costs are integers 0–3. No reasons required. Availability outside confirmed coverage is unknown. Dates are valid ISO calendar dates; integer minutes and explicit America/Mexico_City are never converted to browser timezone. Wire slots support 30 or 60 minutes so the seeded duration revision can be represented; the initial domain supports 30-minute choices. A 60-minute edit is a new context requiring reconfirmed full-interval coverage, never extrapolated acceptance.

ExceptionScope binds condition, room, opaque context, decision/input revisions, exact roster set, policy, exact dated meeting interval, owner-no-weekend-duty predicate and expiry. B must verify the affected condition is negotiable and belongs to the caller, the offer is current, and every candidate satisfies it. The predicate is a finite enum, not executable code.

DisclosurePreview binds exact normalized sentence, SHA-256 text hash, explicit audience member set, room/context/revision, expiry and an inference warning. Normalize Unicode NFC, CRLF/CR to LF and trim outer whitespace **before** preview; preserve internal spaces/case/punctuation. UTF-8 SHA-256 hashes that exact text. B must verify hash and current audience/grant immediately before publication. Declining disclosure does not cancel the exception or prevent an otherwise feasible proposal. Revocation stops future publication; it cannot erase what people already read. Public receipts contain only actually published text/audience/time/version, never private grant IDs.

## Versions and proposal hash

Decision revision/context changes when roster, schedule, policy, public history or confirmed inputs change. Use an unpredictable opaque context token, never a hash of low-entropy private inputs. Conservatively invalidate all old grants/proposals/approvals/jobs for semantic edits. Policy changes require fresh participant confirmation.

Control version is a separate monotonic concurrency guard. Accepting an exception changes control version and permission history without changing the semantic context it authorizes. Relevant revocation/new proposal clears matching final approvals. Disclosure choice is independent of feasibility. Owner revision guards drafts/confirmation. Proposal version identifies one public proposal.

`hashPublicProposal` validates PublicHashPayload and computes lowercase hex SHA-256 over UTF-8 canonical JSON. Exact fields: schemaVersion, roomId, contextToken, proposalVersion, rosterMemberIds, policy and plan (dated meeting, duties/intervals/qualification/load facts and assignees). No proposal ID, expiry, approval list, explanation or private dependency metadata enters this hash. Those remain separately version-bound by the server. Text is hashed exactly, with no implicit Unicode normalization for plan labels.

Canonicalization sorts object keys lexicographically using JavaScript code-unit ordering, roster IDs and duty qualification IDs ascending, and assignments by duty ID. IDs are ASCII. Preserve other arrays. JSON.stringify supplies string escaping and integer representation; strict validation rejects unsupported/nonfinite values, unknown fields and duplicate IDs. No whitespace. Input is not mutated. Cross-language implementations must match the independent vector in proposed.json and contract tests. A hash is not a signature or permission to approve.

## Logical HTTP surface and command preconditions

| Route | Command / permission |
| --- | --- |
| GET /rooms/:roomId/public | membership or scoped read-only display |
| GET /rooms/:roomId/me | verified participant; server resolves owner |
| POST /rooms/:roomId/commands | validated CommandEnvelope, per-command authorization |

Every mutation includes schemaVersion, requestId, roomId, idempotencyKey, expected {contextToken, decisionRevision, controlVersion}, type and strict payload. Client owner IDs are rejected. SUBMIT_INPUT_DRAFT / CONFIRM_INPUTS bind owner/draft revisions. ACCEPT_CONTEXT records each member's confirmation. REQUEST_SOLVE requires confirmed current context and bounded public probes. DECIDE_EXCEPTION and DECIDE_DISCLOSURE bind exact preview/version and ALLOW or DECLINE independently. REVOKE_EXCEPTION / REVOKE_DISCLOSURE bind grant/version. ACCEPT_PROPOSAL / WITHDRAW_APPROVAL bind proposal ID/version/hash plus expected context. REVISE_DECISION is coordinator-only; its roster carries `submitted: false` for every member because the new context requires fresh submissions, and every duty qualification must name a member of that same payload roster. PUBLISH_DISCLOSURE is trusted-service-only. Display credentials never mutate. No handler exists yet.

Command validation establishes strict shape and finite consistency within one payload. It does not authenticate the caller, authorize coordinator/service roles, verify stored records or apply semantic invalidation; B02/B03 implement those checks.

Authenticate and authorize before idempotency lookup or detailed validation errors. Cache keys scoped to verified actor, room, operation and idempotency key. Same key and identical payload returns original authorized result even if current control version has advanced; same key/different payload returns IDEMPOTENCY_CONFLICT. Auth loss must not return cached private results. Do not blindly retry version conflicts: refresh authorized snapshot and reconfirm changed terms with the participant. Transport retries reuse original payload/key. Semantic retries need a new key and current versions. Payload identity includes all accepted envelope data except requestId (transport correlation); no implicit mutation to latest version.

| Code | HTTP | Public behavior |
| --- | --- | --- |
| UNAUTHENTICATED | 401 | missing/invalid identity |
| NOT_FOUND | 404 | identical shape for absent room/object and cross-room/nonmember/other-owner access |
| FORBIDDEN | 403 | known authorized room, insufficient action scope (e.g. display write) |
| STALE_CONTEXT | 409 | expected decision/context/control/owner/draft mismatch |
| STALE_PROPOSAL | 409 | proposal ID/version/hash mismatch after authorized context check |
| IDEMPOTENCY_CONFLICT | 409 | same key, different payload |
| INVALID_COMMAND | 422 | schema/finite structure invalid |
| NEEDS_CLARIFICATION | 422 | unsupported or unconfirmed interval/data |

Errors expose only code/status/requestId, no arbitrary messages or existence diagnostics. UI maps codes to safe text. Schema tests enforce these shapes/status mappings; non-enumerating handler behavior must be tested in B03/B04. Success reports APPLIED or QUEUED and updated relevant version; refetch /me for owner revision. Correlate errors using the original requestId, not reflected invalid client content.

## Deferred enforcement acceptance

B02 must implement decline, withdrawal, expiry and closed-room rules, per-owner access/projection, idempotency, semantic invalidation, independent consents and stale-job checks before/after solving. Atomic finalization checks entire roster's matching approvals, exact proposal/context, current active grant versions and expiry under the same control-version guard used by revocation. B04 tests real DynamoDB races; an in-memory test cannot prove cloud transaction safety. Clock is an explicit dependency. Shape tests here are deliberately not labeled security or concurrency tests.
