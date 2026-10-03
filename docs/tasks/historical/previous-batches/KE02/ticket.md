> Historical ticket view. Links follow the current layout; [original bytes](original.md.txt) retain the old paths and evidence. This folder does not schedule work.

# KE02 — Small deterministic trust kernel — closed previous batch

- Status: DONE — user-directed administrative closure, 2026-09-30.
- Claim: Closed for scheduling by the user's new-batch direction; preserve all saved work.

This is administrative closure of the old plan. Prior technical results and unfinished criteria are preserved below; no new check, review PASS, volunteer trial, live qualification or release acceptance is claimed. Remaining technical obligations route to [NP00](../../../active/closeout/NP00/ticket.md). Future product work follows [NP00–NP04](../../../../next-phase.md) and the [shared board](../../../../task-board.md). Reviews, human trials and submission preparation are deferred as mapped there. Historical claims and next-step instructions below cannot select current work.

## Historical ticket record

<!-- pre-NP-original-body -->

# KE02 — Small deterministic trust kernel

- Status: DONE — technical ticket criteria and required checks passed; project-level sign-off remains deferred.
- Claim: User-directed start recorded 2026-09-27T09:53:50Z. Direct worker: Codex GPT-6; exact runtime variant and effort are not exposed, so `gpt-6-luna` / high is the required task target but not claimed as verified runtime selection. Clean synchronized `main` baseline: `b91cb2e79e9011c819f52b542edacccb3944c417`; `git pull --ff-only origin main` succeeded and HEAD/origin are 0/0. Sequential phases: bounded design and capacity decisions, then implementation by this same direct worker; no separate reviewer. Bounded files: `packages/domain/src/index.ts`, new `packages/domain/src/known-enough-kernel.ts` and `known-enough-kernel.test.ts`, `docs/known-enough-architecture.md`, this ticket, `docs/task-board.md`, `docs/handoff-B.md`, `docs/work-log-B.md`, and `docs/tasks/KE03.md` for a status-only prerequisite release after KE02. No KE03 implementation is claimed. Tests will consume existing `packages/test-support/src/known-enough-fixtures.ts`; no fixture/contract refinements, application migration, dependency, root config, lockfile, CI, AWS/model calls, or external action planned. Amend this list before changing any additional file.
- Direct worker, sequential phases: `gpt-6-luna` / high for both design and implementation by user direction for the KE01–KE08 MVP. Record the actual model/effort and handoff; Markdown does not switch the session. Bundle design and kernel review into KE09 after the first MVP; do not create a separate pre-implementation architecture review.
- Prerequisite: [KE01](../KE01/ticket.md) is DONE with its technical checks recorded. Retained B04/B04.5 implementation and independent correction evidence are available; project-level sign-off is deferred and does not block this task.
- Scope/files: packages/domain/**; focused packages/contracts/** refinements; packages/test-support/**; relevant tests; architecture decisions. Also this ticket, the current board/handoff and claimant’s own log. Name exact files and baseline at claim; coordinate contract/root/lock/CI changes.

## Outcome

Implement only mechanical validation of supported candidate values and confirmed rules. The Luna/high design phase defines the rule evaluator and capacity model. Record decisions and transfer to the Luna/high implementation phase without a separate reviewer session; include the integrated design/kernel artifact in KE09 after the first MVP. No general optimizer.

## Design phase — complete; transferred to implementation

Normative design is recorded in [architecture: KE02 deterministic validation](../../../../known-enough-architecture.md#ke02-deterministic-validation-design--2026-09-27) and [KE03 storage handoff](../../../../known-enough-architecture.md#ke03-storage-and-response-reservation-handoff). Direct-worker design decisions:

- Pure, single-candidate evaluator; caller supplies the trusted current snapshot and clock. Recompute evaluation rather than trusting `CandidateProposal.validation`.
- Require current frame confirmation/readiness for all required participants and block unresolved unsupported conditions. Check all typed required values and finite rules. Preferences do not alter validity; HARD rules never yield to permissions.
- NEGOTIABLE failures need the exact active owner/constraint-version/context-scoped unexpired permission, matching adjustment and exact candidate dependency. Disclosure dependencies are independently checked against exact proposal, audience and expiry. Rebuild and hash only public facts and require them to match the candidate/public proposal identity.
- Safe outcome has only a coarse status. Internal diagnostics contain bounded IDs/codes, never source text or private values.
- Per candidate: at most 20 participants, 64 variables, 128 definition rules, 64 total active confirmed constraints, 64 assignments, 20 references/rule and a one-million-step budget. Strict evaluator input ≤360 KiB.
- KE03 supports five current participants using an explicit versioned bridge from v4's three-owner record. Retain 352-KiB ordinary / 360-KiB protected state ceilings, 8-KiB GUARD/REPLAY bounds, 192 room-wide and 32 per-owner permission history/response limits, and B04.5's per-offer/per-preview byte reservations. Measure encoded Dynamo attributes and reserve pending responses before offering; do not assume v2 schema maxima fit together.

The initial claim's exact file scope remains in force. Implementation now proceeds in `packages/domain/src/known-enough-kernel.ts` and its test, with the claimed index and architecture files. No separate architecture reviewer is scheduled; integrated evidence goes to KE09.


## Acceptance

1. Beyond KE01, use the retained B04/B04.5 local technical foundation and synchronized review evidence. Project sign-off is deferred; do not restart old tickets.
2. Validate references, enum membership, numeric ranges, totals, percentages, dates, hard limits, rule applicability, current context, proposal identity and required permission scope/version/expiry. Return private diagnostics internally and safe public status only.
3. Define bounded evaluation cost and fail closed for unsupported rules/unknown inputs. HARD constraints cannot be weakened by a model or permission; an explicitly confirmed owner revision is separate.
4. Run generic validator and arithmetic/property tests covering invalid references, hard-limit failures, stale/revoked permissions, overflow/precision and mutually exclusive assignments. Validate Christmas, hypothetical purchase and a TeamTable regression bridge.
5. Document the five-participant storage/count/byte limits and pending-response reservations needed by KE03. Keep kernel code free of AWS/model/UI dependencies; include these decisions and the completed kernel artifact in the KE09 review bundle after the MVP.

## Checks and handoff

Run focused kernel/property/fixture checks and pinned npm run check. When criteria and checks pass, record evidence and mark DONE; hand off directly to KE03 without per-task human review. Include the design/kernel artifact in KE09's single post-MVP review.

Before development, use a separate clean clone on `main`, successfully run `git pull --ff-only origin main`, recheck current claims and record the bounded claim. One task at a time. Only reviews explicitly named in this ticket are gates; do not add broad or repeated review sessions. Follow the [token-efficient review policy](../../../../agent-workflow.md#review-scope-and-token-efficiency). No implicit publication, merge, deployment, paid calls/resources or external messages.

Follow the [workflow](../../../../agent-workflow.md), [current queue](../../../../task-board.md), [product](../../../../known-enough-product.md), [architecture](../../../../known-enough-architecture.md) and [migration mapping](../../../../known-enough-pivot.md).


## Completion — 2026-09-27

Implemented and exported `evaluateKnownEnoughCandidate` from the domain package. The pure kernel bounds the strict UTF-8 input envelope to 360 KiB, checks current frame/readiness and exact public proposal/hash identity, validates every supported typed rule with exact integer arithmetic, enforces owner-private reference boundaries, ignores candidate-supplied evaluation claims, applies HARD/NEGOTIABLE/PREFERENCE semantics, and verifies exact active negotiation/disclosure dependencies and expiry. Public projection is exactly `{ status }`; internal diagnostics contain only bounded codes and IDs.

Focused coverage includes Christmas, hypothetical purchase, and granted/ungranted TeamTable compatibility cases; constraint reference/ownership failures; hard-rule non-override; expired/revoked grants; exact consent variable scopes and text hashes; unresolved readiness; byte/active-constraint bounds; mutually exclusive assignments; generated exact decimal sums and safe-integer boundaries. The KE02 suite passed 15/15.

Pinned Node 24.21.0/npm 11.19.0 `npm run check` passed after the final code changes: 7 reference checksums; 15 planning checks; lint and 99 import-boundary references; typecheck; 262 passing tests / 1 skipped; production and hosted-preview builds; hosted-preview browser check 1/1; end-to-end browser tests 41/41. No contract, fixture, dependency, lockfile, application, storage, or cloud files changed. The design/kernel artifact is reserved for the single KE09 review bundle; no separate KE02 reviewer or project acceptance is claimed. KE03's prerequisite status is released to READY as a documentation-only queue update; no KE03 implementation starts here.
