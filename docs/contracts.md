> **Implementation baseline / historical TeamTable semantics (2026-09-26).** The document below retains its dated B02 description; executable schemas/source and B04 evidence describe later implementation. New generic contracts belong to [KE01](tasks/KE01.md) under the [Known Enough architecture](known-enough-architecture.md). No generic contract is implemented by KE00. See the [baseline audit](known-enough-pivot.md#b04-foundation-integrated-source-pending-acceptance).

# Contract v1 — B02 local application

Executable authority: [schemas and hash implementation](../packages/contracts/src/index.ts). Either user may claim contract work through the shared pool, with coordinated consumer review for breaking changes. Package version 0.1.0, wire schemaVersion 1. B02 implements local application transitions and an in-memory repository. B03 provides the future HTTP boundary; verified authentication and durable transactions remain later adapter work.

## Examples and boundaries

[Public JSON examples](../apps/web/src/mocks/public) cover collecting, blocked (`NO_AGREEMENT`), private review, proposed, agreed and superseded. The page loads only collecting. They are synthetic illustrative responses, not evidence that a solver ran. [Owner example](../packages/test-support/fixtures/owner-private-review.json) and [all command examples](../packages/test-support/fixtures/commands.json) are server/test-only. [Results](examples/command-results.json) cover success and every error code.

PublicRoomSnapshot carries approved shared roster/load points, explicit timezone/schedule, approved policy, coarse status, optional current proposal, approved member IDs and published disclosure receipts. No named refusal, conflict counts, private conditions/costs/grant IDs. Approval indicators say only who has accepted this proposal; no rejection reasons. PRIVATE_REVIEW never identifies its recipient. SUPERSEDED clears active proposal and approvals; historical records are a later separate read surface.

OwnerSnapshot contains only the authenticated caller's confirmed structures, explicit availabilityReview receipt, drafts, private offers, disclosure previews, own permissions and own approval. Knowing this schema grants no access to values. Owner identity is an output resolved by the server, not an accepted command parameter. Strict schemas reject unknown keys at every object level rather than silently stripping suspected leaks. Server projections must construct allowlisted objects independently. DTO validity does not prove authorization, hash equality, current expiry or cross-record consistency.

Finite conditions: HARD_AVAILABILITY lists explicitly covered full intervals; NEGOTIABLE_UNAVAILABLE blocks an interval unless expressly authorized and may invite one exception question. Duty costs are integers 0–3. No reasons required. Availability outside confirmed coverage is unknown. Dates are valid ISO calendar dates; integer minutes and explicit America/Mexico_City are never converted to browser timezone. Wire slots support 30 or 60 minutes so the seeded duration revision can be represented; the initial domain supports 30-minute choices. A 60-minute edit is a new context requiring reconfirmed full-interval coverage, never extrapolated acceptance.

ExceptionScope binds condition, room, opaque context, decision/input revisions, exact roster set, policy, exact dated meeting interval, owner-no-weekend-duty predicate and expiry. The backend must verify the affected condition is negotiable and belongs to the caller, the offer is current, and every candidate satisfies it. The predicate is a finite enum, not executable code.

DisclosurePreview binds exact normalized sentence, SHA-256 text hash, explicit audience member set, room/context/revision, expiry and an inference warning. Normalize Unicode NFC, CRLF/CR to LF and trim outer whitespace **before** preview; preserve internal spaces/case/punctuation. UTF-8 SHA-256 hashes that exact text. The backend must verify hash and current audience/grant immediately before publication. Declining disclosure does not cancel the exception or prevent an otherwise feasible proposal. Revocation stops future publication; it cannot erase what people already read. Public receipts contain only actually published text/audience/time/version, never private grant IDs.

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

Every mutation includes schemaVersion, requestId, roomId, idempotencyKey, expected {contextToken, decisionRevision, controlVersion}, type and strict payload. Client owner IDs are rejected. SUBMIT_INPUT_DRAFT / CONFIRM_INPUTS bind owner/draft revisions. CONFIRM_INPUTS also requires reviewedIntervals (1–20 full dated intervals) explicitly assessed by the owner; the server never fills coverage from the schedule. ACCEPT_CONTEXT reconfirms both the displayed public setup and the caller's preserved confirmed values/coverage at the expected version. It rebinds that unchanged receipt to the current context without creating another semantic revision. It never broadens coverage or restores old permissions. Schedule edits discard prior confirmation/coverage and require new explicit input confirmation. REQUEST_SOLVE requires confirmed current context and bounded public probes. DECIDE_EXCEPTION and DECIDE_DISCLOSURE bind exact preview/version and ALLOW or DECLINE independently. REVOKE_EXCEPTION / REVOKE_DISCLOSURE bind grant/version. ACCEPT_PROPOSAL / WITHDRAW_APPROVAL bind proposal ID/version/hash plus expected context. REVISE_DECISION is coordinator-only; its roster carries `submitted: false` for every member because the new context requires fresh submissions, and every duty qualification must name a member of that same payload roster. PUBLISH_DISCLOSURE is trusted-service-only. Display credentials never mutate. Application methods exist locally; no HTTP handler exists yet.

Command validation establishes strict shape and finite consistency within one payload. It does not authenticate the caller, authorize coordinator/service roles, verify stored records or apply semantic invalidation; the application enforces stored membership/role and state preconditions while a future verified identity adapter must authenticate incoming credentials.

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

## Application enforcement acceptance

B02 implements decline, withdrawal, expiry and closed-room rules, per-owner access/projection, idempotency, semantic invalidation, independent consents and stale-job checks before/after solving. Atomic finalization checks entire roster's matching approvals, exact proposal/context, current active grant versions and expiry under the same control-version guard used by revocation. B04 tests real DynamoDB races; an in-memory test cannot prove cloud transaction safety. Clock is an explicit dependency. Shape tests here are deliberately not labeled security or concurrency tests.

## B02 compatibility review

Required CONFIRM_INPUTS.reviewedIntervals and OwnerSnapshot.availabilityReview are changes to the pre-release v1 contract. A01 also consumes OwnerSnapshot, so its synthetic owner adapter must include the new receipt; that compatibility adjustment is part of the main integration. Strict owner/command consumers must update together. ConfirmedInputs and all public DTOs remain unchanged. The owner review receipt must match its confirmed input revision/context; both may remain stale against the outer snapshot so the owner can inspect them before reconfirming. B’s separate Astra review assessed the contract change. The user then authorized the final main integration, with A-lane Astra checking owner receipt binding, explicit confirmation coverage and browser compatibility. See [current integration evidence](main-integration.md).


# KE01 generic contract v2

Executable artifact: [`KnownEnough` namespace and v2 schemas](../packages/contracts/src/known-enough.ts), exported without changing the existing v1 root exports by [`packages/contracts/src/index.ts`](../packages/contracts/src/index.ts). Synthetic contracts and adapters live in [test-support fixtures](../packages/test-support/src/known-enough-fixtures.ts). This is a schema and canonical public-identity layer only. KE02 supplies pure rule evaluation; KE03 adapts application persistence and transitions. KE01 changes no v1 DTO, v1 `hashPublicProposal` behavior, application consumer, dependency, stored record or migration.

## Values, missing data and bounded rules

- `NUMBER` is an exact safe-integer coefficient and scale 0–6 with an explicit bounded unit code. Comparison aligns scales using integer arithmetic; there is no floating point or implicit rounding. Values match their variable's exact unit and scale.
- `MONEY` is a safe-integer `amountMinor`, explicit three-uppercase-letter currency code and `minorUnit` 0–4. The code is syntactically checked, not validated against a currency registry. No exchange, rounding or mixed-currency sum is inferred.
- `PERCENTAGE` is integer basis points from 0 through 10,000 (0–100%). `DATE` is a validated Gregorian civil date without timezone. `DATETIME` is an exact UTC millisecond instant plus a canonical IANA display timezone; the instant is authoritative and no local-time/DST conversion is inferred. `DURATION` is integer seconds, 0 through ten years. Boolean, enum, participant and enum-set values use explicit discriminators and declared domains.
- Omission means missing: optional variables may be absent and required variables may not. `null` is not a value. Unknown evaluation is explicit in `unknownRuleIds`; unknown or unsupported checks require `NEEDS_CLARIFICATION` and never count as satisfied. Qualitative source text remains owner-only in `unsupportedConditions` until clarified into a supported typed condition.
- Public frame arrays retain declaration/presentation order. Enum option order is display order. Participant/variable ID lists and `ENUM_SET` members have set semantics; duplicate IDs/members fail. Membership values and set-operator operands are also sets. Public proposal serialization sorts required participant IDs and assignments by variable ID and sorts enum-set members; it does not mutate caller input. Negotiation identity additionally canonicalizes membership values and set-operator operands.
- The finite operator union is `COMPARE`, `IN`, `RANGE`, `SUM_EQUALS`, `ALL_DIFFERENT`, `MUTUALLY_EXCLUSIVE` (boolean variables), and `IMPLIES` (two atomic EQ/NE conditions). It has no recursive expression tree, custom predicate or executable expression. `required` is a variable completeness flag; preferences use a separate bounded private criterion and do not weaken hard validation.
- Limits: 20 participants; 64 variables; 128 frame rules; 20 referenced variables per set rule; 64 enum options; 64 private constraints; 65,536 UTF-8 bytes for a definition and 32,768 for a command. No arbitrary recursion is accepted.

## Frame authority, versions and request identity

A participant's `FrameConfirmation` binds decision ID, frame version, semantic version, opaque context token, participant ID and time. The schema does not establish identity; the server binds this ID to its verified caller. The shared snapshot requires every currently required participant's current frame confirmation before input/proposal states, but omits per-owner private-input readiness. An owner snapshot carries only that caller's readiness. The server derives public READY and later candidate states only after all required participants' readiness records are current. Neither snapshot authenticates the participant; the server verifies identity and membership.

Semantic/context version binds meaning and invalidates confirmations, constraints, grants, proposals and approvals when meaning changes. `controlVersion` guards every write against concurrent state changes. `ownerVersion`, `draftVersion` and `proposalVersion` scope owner input, interpretation and one proposal respectively. Every command supplies expected context, semantic, control and owner versions plus an exact action payload. The envelope deliberately has no actor/owner field. Authentication, authorization-before-idempotency, atomic mutation, permission expiry and stale-state checks remain server/application responsibilities. Stale commands fail with explicit 409 result codes; consumers refresh and obtain fresh confirmation instead of rebasing silently.

A refused negotiation is identified by decision, context/semantic version, target, constraint ID/version and canonical typed adjustment; the owner-only refusal receipt stores the matching constraint version. Generated rule IDs and visibility labels, and free-form wording, do not change identity. Equivalent paraphrases/representations therefore resolve to one refusal in the same context; a new semantic context yields a different identity. This hash is a stable identity key, not a refusal or permission itself.

## Public and owner projections

`DecisionDefinition` is the trusted full definition. The separate `PublicDecisionFrame` schema cannot carry owner IDs or `OWNER_PRIVATE` variables/rules. `PublicProposalFacts` permits only values for frame variables explicitly marked `PUBLIC`; its canonical SHA-256 covers exactly schema version, decision ID, opaque context token, semantic version, proposal version, required participant IDs and those public typed assignments. `CONSENT_REQUIRED` descriptors may be in the frame, while their values stay out of proposal facts and hashes.

An owner-only snapshot requires its public projection to be scoped to that exact owner and contains only that verified owner's readiness, private variable definitions/values, draft, confirmed constraints, questions, refusals, permissions and own approval. A shared snapshot contains a strict allowlist, aggregate coarse status, public facts/hash, frame confirmations, permitted approval indicators and published disclosure records; it does not identify who needs private clarification. A viewer-scoped snapshot includes only disclosures naming that viewer. An unscoped projection includes a disclosure only when every current roster member is in its audience. The server derives a public aggregate READY state only after all required owner readiness records are current. Variable disclosures bind the exact current proposal/context and named variable IDs to an audience; exact text and variable value publication remain distinct permission kinds. Private candidate dependencies, refusal identities and owner values are not public. A consented disclosure does not become a hashed public proposal fact.

The stable v2 hash test vector and refusal-identity cases are in [`known-enough.test.ts`](../packages/contracts/src/known-enough.test.ts). The historical v1 hash vector and wire contract remain in the original `contracts.test.ts`; new consumers opt into `KnownEnough` and schema version 2.

Runtime schema validity and matching hashes do not prove actor identity, owner access, grant status/expiry, text-hash equality, current persisted state, transaction ordering or atomic agreement. Projection factories must construct fresh allowlisted objects; adapters recheck the exact stored versions and permissions before any write/publication. These guarantees are not claimed by KE01.

## Migration and KE09 bundle

No persisted migration is part of KE01. Existing STATE v4 and v1 consumers remain unchanged; KE02/KE03 must select and test a deliberate stored-schema bridge before generic records are written. The first KE09 bundle after the MVP will include this exact contract artifact and tests, plus the KE01–KE03 kernel/storage diff and unresolved decisions: storage version and migration/rollback strategy; transaction/read consistency, maximum aggregate size and pending-receipt reservations for five or more participants; verified identity and consent-revocation atomicity; text-hash normalization/equality enforcement; owner/private-data retention, deletion and backup behavior; and evaluation/preference scoring policy. KE09 must inspect code and tests and resolve the privacy/model boundary before real model calls.


### KE09 correction compatibility — 2026-09-28

Independent follow-up is pending. Generic CandidateEvaluation ID arrays now allow the aggregate 192 evaluated rules; the application deduplicates receipt names without dropping rule evaluation or scoped private diagnostics. Owner snapshot history permits repeated constraint IDs across distinct context/version tuples while requiring unique active IDs and exact question/refusal version references. Negotiation identity treats equality as singleton membership; generated questions accept only public enum-choice adjustments on the target owner's condition.

PublishedDisclosure carries `proposalVersion` on all new records. The field is optional only in the stored historical shape to keep old STATE v5 receipts decodable without an implicit migration; PublicDecisionSnapshot refinement requires it to equal the current proposal version. The application excludes legacy unversioned receipts and historical contexts/proposals from current projections. No v1 contract or public proposal hash fields changed. See the [KE09 correction policy](known-enough-architecture.md#ke09-correction-policy--2026-09-28-independent-review-pending) for publication and revision authority.
