# Known Enough — architecture direction

Status: KE00/KE01 direction, updated 2026-09-27. KE01 implements the v2 generic runtime schemas, strict projection DTOs and canonical identities; KE02/KE03 implement evaluation and application/storage behavior. [Contract v2](contracts.md#ke01-generic-contract-v2) is the executable boundary. The [pivot audit](known-enough-pivot.md) distinguishes existing source from targets. Preserve the current repository and adapt its boundaries.

## Responsibility split

AI understands objectives, identifies missing information, drafts decision structures, interprets statements, generates candidates, discovers trades and drafts explanations. A small universal trust kernel validates known rule types and universal invariants. Participants remain authoritative over their own confirmed conditions, permissions and approvals.

Mechanical validity means “valid under the confirmed rules this system supports.” It does not establish the best human choice or the truth/completeness of an AI interpretation. Participant confirmation and clear unsupported-condition handling remain essential. No separate deterministic travel, purchase or household optimizer is planned.

## Proposed records

The names below are implemented as schema-version-2 runtime contracts in `KnownEnough`; they do not implement persistence, authentication or the decision runtime.

| Record | Required semantics | Visibility |
| --- | --- | --- |
| DecisionDefinition | ID, objective, description, roster, status, frame revision/context, AI-drafted variables/options, confirmed decision criteria | Public frame after confirmation; draft authority explicit |
| DecisionVariable | Bounded type, scope, identifier, allowed values/units and references | Public definitions only where deliberately shared |
| AIConstraintDraft | Owner, source summary, structured interpretation, draft/owner/context versions, ambiguity | Owner and authorized backend only |
| ConfirmedConstraint | Owner, HARD/PREFERENCE/NEGOTIABLE classification, known validation rule, confirmation time/revision, active/superseded status | Owner and trusted negotiation processing |
| ValidationRule | Closed set of typed operators, bounded operands and valid references | Public rules or private rules according to origin; never publish by default |
| CandidateProposal | Values, exact context, validation outcome, internal permission dependencies, public projection, proposal version/hash | Internal candidate split from strict public proposal |
| NegotiationQuestion | Intended owner, affected negotiable condition, exact adjustment, conditions, context, expiry, permission consequence | Intended owner only; internal diagnostics are separate |
| DisclosurePermission | Owner, exact normalized text/hash, exact audience, context, version, expiry and publication/revocation state | Owner/backend; only published text becomes public |
| FinalApproval | Verified owner, exact current proposal/version/hash/context and time | Internal authority; only permitted approval indicators public |
| PublicDecisionSnapshot | Allowlisted frame, coarse status, public proposal, permitted approval indicators and published disclosures | Current members/scoped display/shared AI |
| OwnerDecisionSnapshot | Current caller's drafts, confirmed conditions, questions, permissions and approval | Verified owner only |

The v2 value vocabulary, exact arithmetic and ordering rules are recorded in [Contract v2](contracts.md#values-missing-data-and-bounded-rules). Values use an exact safe integer coefficient/scale or integer minor units/basis points/seconds, explicit units/currency, Gregorian date or canonical UTC instant plus display timezone. Missing and unknown are distinct; unknown and unsupported conditions block readiness. No currency conversion or implicit rounding is performed.

The closed v2 operators are COMPARE, IN, RANGE, SUM_EQUALS, ALL_DIFFERENT, MUTUALLY_EXCLUSIVE and two-literal IMPLIES. Preferences are separate from hard admissibility. The contracts validate structure and references; KE02 implements evaluation. No arbitrary expression or executable code is accepted.

## Three AI contexts

| Context | May receive | Must exclude | Authority |
| --- | --- | --- | --- |
| Owner-private | Verified caller, own conversation and confirmed conditions, public frame, questions intended for that owner | Other owners' raw conversations or private values | Draft/clarify only; explicit owner confirmation required |
| Trusted negotiation | Public definition, all current confirmed structured conditions/preferences, active grants, proposal state | Unnecessary raw explanations, provider secrets | Candidate and question generation; no consent mutation |
| Public/shared | Allowlisted public facts, current public proposal/status, permitted approval indicators, published disclosures authorized for the audience | Private conditions, budgets, motivations, hidden ratings, refused disclosures, conflict attribution and private grant IDs | Read/explain public state only |

The v2 shared snapshot omits per-participant private-input readiness; only an owner's own snapshot carries that status. The shared coarse status may say clarification is needed without identifying the owner or exposing the unsupported condition. Construct separate contexts and tool sets on the server. Partition conversation memory, caches, retries, traces and job storage as well as initial prompts. Participant text and public objectives are untrusted input. Prompt instructions or model safety features cannot replace authorization and projections.

**Explanation boundary:** trusted negotiation output is potentially private even when labeled “public explanation.” It must not be copied directly into a public DTO. Rebuild explanation inputs from allowlisted public facts and currently published disclosures, then use approved templates or the public-only context. Validate structured claims against current state. Do not expose free-form private-context prose as public output merely because a model labeled it safe.

**Owner-question boundary:** a negotiation model has access to other owners' structured constraints. Its free-form suggested question is therefore not automatically safe to send even to the intended owner. Carry only validated references to that owner's negotiable condition, a proposed bounded adjustment and public facts into the owner-private wording context/template. Reject cross-owner references and explanations of other participants' hidden needs. Proposed values derived from private inputs also need an explicit publication/visibility policy before appearing in any shared candidate; final approval must not retroactively authorize an earlier leak. The KE01 contracts enforce owner-scoped references and public allowlists; KE09 tests these boundaries against the implemented code and application flows.

## Trust kernel and enforcement

Reuse server identity and ownership checks. The kernel validates shape, references, known operators, confirmed numeric hard limits, dates/options, totals, percentages and mutually exclusive assignments. Numeric constraints use explicit units/precision. Preference ranking is distinct from hard admissibility; qualitative unsupported conditions cannot be silently treated as satisfied. Invalid candidates are rejected or repaired within bounded attempts.

The application enforces current membership, permission ownership, hard-versus-negotiable scope, expiry, context and final approval. The repository enforces atomic concurrency. Schema validation and a matching hash establish neither authorization nor a committed transaction. AI cannot overwrite a confirmed HARD condition; only a new explicit owner revision can replace it.

The three independent permissions remain: negotiated change, exact-text/audience disclosure and final approval. A declined optional disclosure leaves a valid concession usable. Refusal ends that request without repeated pressure; KE01 defines equivalent-request identity so paraphrasing cannot reopen it automatically. Missing information yields clarification, not inferred consent.

### KE02 deterministic validation design — 2026-09-27

The domain kernel evaluates one complete candidate against one trusted decision snapshot. It has no solver, model, clock read, I/O or mutation; the caller supplies `now`, current frame confirmations, required participants' ready IDs, unresolved condition IDs and the exact active constraints/permissions. Candidate validation claims are ignored and recomputed.

Evaluation order is structural and exact: validate the full definition/candidate/current context and owner constraint references; require current confirmations and ready input for each required participant; stop readiness on any unresolved unsupported condition; require every required value and validate its declared units/domain; then evaluate all definition rules and active owner constraints. `PREFERENCE` affects no validity result. Public and trusted definition rules and `HARD` constraints always apply. A `NEGOTIABLE` rule that fails may be admitted only by an active, unexpired negotiation permission for the same decision/context, owner, exact constraint ID/version and a typed adjustment rule that accepts this candidate. That exact permission ID/version/kind/expiry must be in the candidate dependency list. No permission can bypass a hard rule.

The kernel independently rebuilds public facts from only `PUBLIC` candidate values, requires exact proposal ID/version/context parity with the supplied public proposal, compares canonical public facts and recomputes the KE01 SHA-256. Consent-required/private values never enter public facts. Disclosure dependencies are separately checked against decision/context/semantic/proposal ID+version, owner, the exact audience retained on the referenced permission version (whose members must be current participants), and expiry; exact text permissions require the stored text hash to match the text. A matching hash remains identity evidence, not authorization.

Public outcome is only `VALID`, `INVALID`, `NEEDS_CLARIFICATION` or `NEEDS_PERMISSION`. Internally, bounded diagnostics may identify an owner, constraint, rule and variable by ID; they never contain private text, values or reasons. Callers build public responses from the one-field status projection, never by spreading the internal result. Known hard failures produce INVALID; missing/stale context or unresolved unsupported input produces NEEDS_CLARIFICATION; a failed negotiable rule without a current exact grant produces NEEDS_PERMISSION.

Hard evaluation bounds: 20 participants; 64 variables; 128 definition rules; 64 active confirmed constraints total per decision; 64 typed candidate assignments; 20 references per rule; 64 membership alternatives and 64 enum-set members per value; 64 candidate permission dependencies. Thus at most 192 rule evaluations and 3,840 referenced operands per candidate. The worst nested membership comparison bound is `192 × 64 × 64 = 786,432` enum-set member comparisons; all-different uses a bounded set lookup rather than pairwise comparisons. A one-million-step work budget is checked while evaluating. The strict UTF-8 JSON envelope is capped at 360 KiB. Over-limit input never passes; it returns a bounded clarification/capacity diagnostic. These bounds describe one candidate and do not authorize unbounded candidate generation. The implementation is `packages/domain/src/known-enough-kernel.ts`, exported through the domain entry point; its focused tests cover the Christmas, purchase and TeamTable fixtures, grant expiry/revocation, exact disclosures, owner-private reference isolation, and arithmetic boundaries. Its public response projection contains only the coarse status.

### KE03 storage and response-reservation handoff

The generic contract allows 20 participants, but the first generic application slice must store and exercise five. B04's retained DynamoDB STATE v4 is a three-owner TeamTable record and cannot accept five by renaming fields. KE03 must introduce an explicit new stored schema/version bridge and preserve old v4 reads/history; KE02 does not migrate records.

Keep the retained B04/B04.5 operational ceilings until KE03 records a reviewed replacement: ordinary state item ≤352 KiB; protected state item plus outstanding response reservations ≤360 KiB, below DynamoDB's 400 KB item maximum. GUARD and REPLAY records remain separate and each ≤8 KiB. Current permission history is ≤192 decisions per room and ≤32 per owner. Per owner, exception history plus pending offers is ≤32; disclosure history plus current preview plus a possible future preview reservation is ≤32. Across the room, retained history plus pending offers/previews and one prospective disclosure response for each offer without an existing disclosure/preview is ≤192.

Reserve before issuing a request: each pending exception offer reserves its maximum exception record plus 768 bytes of transition overhead. A pending disclosure preview reserves its maximum disclosure record plus 768 bytes. An offer that can still produce a preview reserves the maximum preview and final disclosure record plus two 768-byte transition allowances. KE03 should retain B04's actual schema-derived UTF-8/Dynamo-attribute measurement and atomic reservation transfer; JSON length alone does not prove stored item size.

For five-owner records, enforce the 64-total-active-constraint, 20-variable/128-definition-rule and 360-KiB kernel-envelope bounds above, while also measuring the complete proposed STATE item under the retained 352/360-KiB ceilings and accounting for response reservations. Schema maxima are not a promise that all maximum-sized strings/arrays fit together in storage. KE03 must reject before write when the combined serialized record plus future-consent reservations exceeds capacity, and must keep revocation/withdrawal within the protected reserve. No AWS writes or migration are part of KE02.

## Lifecycle and proposal identity

Proposed progression:

```text
CREATING → DEFINING → COLLECTING_PRIVATE_INPUT → READY → REASONING
  → PRIVATE_NEGOTIATION → REASONING → PROPOSED → APPROVING → AGREED
```

REASONING can proceed directly to PROPOSED without a question. Alternative outcomes are NEEDS_CLARIFICATION, NO_AGREEMENT, SUPERSEDED and CLOSED. KE03 specifies all transitions, cancellation, withdrawal and recovery. Private negotiation recipients/refusals never appear in shared status. A schema-valid definition draft does not itself authorize the shared frame.

Keep semantic revision/context, concurrency control version, owner/draft revision and proposal version distinct. Material changes to objective, roster, variables/options, decision criteria or confirmed conditions conservatively supersede dependent jobs, grants, proposals and approvals. Permission decisions increment control state without invalidating the context they authorize. Relevant revocation, expiry or proposal replacement clears stale approval authority.

Public hashes contain canonical public proposal facts, proposal version and an opaque unpredictable context token, never low-entropy private input hashes or internal grant identifiers. KE01 specifies exactly which public facts are approved and canonicalizes all relevant values with independent test vectors. Retain current hash behavior for legacy DTOs rather than silently reinterpreting an old hash.

Each required current participant approves the same exact proposal. Finalization transactionally rechecks roster, matching approvals, current context, active necessary permission versions and expiry. Revocation/finalization use the same guard. An agreement records a decision; it executes no purchase, contract or real-world operation. Superseding it preserves truthful historical receipts.

## Package boundaries and persistence

Keep npm workspaces and existing technical package IDs during the pivot. Web imports contracts, never application/domain code or server fixtures. API and workers call application services; adapters implement repository/model/job ports; the domain/kernel stays free of AWS, HTTP, React and model calls. Composition roots select adapters. No new service fleet or agent framework is required.

Retain [Cognito verification](../apps/api/src/cognito-identity.ts), [HTTP authorization](../apps/api/src/http-core.ts), application membership/invitations and redacted errors. Current invitations require a pre-provisioned authenticated subject, return a token once, expire, and redeem once. Lost issue responses cannot recover that token before reissue eligibility; retry after committed redemption is not a replay receipt. KE11 must handle these limits explicitly and specify trusted provisioning/delivery.

Retain the [STATE/GUARD/REPLAY repository](../packages/adapters/src/dynamodb.ts), strict [codec](../packages/adapters/src/dynamodb-codec.ts), auth-before-replay, size/receipt admission reservations and safe refusal/revocation capacity. Adapt stored domain fields with a deliberate schema version and migration/compatibility policy. Current STATE v4 hardcodes three owners/memberships/approvals and scheduling records. Five-person Christmas cannot work by renaming those fields. Re-prove count and byte bounds for the chosen generic limits, pending responses, history and retired participants before accepting writes. No unreviewed in-place migration or deletion of old evidence.

## Model jobs and operations

First implement injected interfaces for decision construction, owner interpretation, negotiation and public explanation. Deterministic synthetic responses exercise the actual application. They prove local orchestration only. [KE10](tasks/KE10.md) adds Bedrock and async runtime; [KE13](tasks/KE13.md) establishes authorized deployment evidence. The current workers package is a placeholder, not an existing SQS service.

Queue envelopes carry job IDs and authorized record references, never raw private text. Bind jobs to decision context, owner/draft version where relevant, job epoch and audience. Check before reading/calling and transactionally before applying results. Superseded/expired/duplicate work cannot publish or resurrect a proposal. Limit attempts, repair loops, latency, tokens, concurrency and retained data; include a kill switch, redacted failure categories and expiry. Store provider/model/region/configuration as operational metadata without prompt contents in logs.

Keep raw private conversations only as necessary; KE07/KE10 specify retention, deletion, retry retention and backup limits. Logical expiry must apply at read/use time, not rely on asynchronous storage cleanup. Actual service capabilities, region/model availability, IAM and costs must be verified in their implementation tasks. No paid calls or resource creation is authorized by this design.

## Review and open decisions

[KE09](tasks/KE09.md) independently reviews local generic code and tests. After Bedrock, session, shared-assistant or cloud changes, sequential follow-up review must cover those exact artifacts before external testers or release. Project-level sign-off is temporarily deferred; participant approvals and explicit external-action authorization remain separate. [KE17](tasks/KE17.md) reviews the actual release artifact; old TeamTable PASSes are never relabeled as new privacy evidence.

KE01 settles the shared-frame confirmation contract, bounded rule subset, qualitative clarification, private/public contribution projection, exact value/hash semantics and equivalent-request refusal identity. Ranking policy, pure evaluation and storage migration remain for KE02/KE03 and the later KE09 bundle. Ranking claims must name approved criteria and evaluated candidates; no claim of global optimality follows from heuristic AI search. The B04/B04.5 technical baseline remains available for KE02; project sign-off is deferred and does not block it. Cloud changes still require explicit authorization. Remaining decisions and risk owners are in the [pivot record](known-enough-pivot.md).
