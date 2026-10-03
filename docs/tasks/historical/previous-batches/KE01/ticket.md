> Historical ticket view. Links follow the current layout; [original bytes](original.md.txt) retain the old paths and evidence. This folder does not schedule work.

# KE01 — Generic decision contracts — closed previous batch

- Status: DONE — user-directed administrative closure, 2026-09-30.
- Claim: Closed for scheduling by the user's new-batch direction; preserve all saved work.

This is administrative closure of the old plan. Prior technical results and unfinished criteria are preserved below; no new check, review PASS, volunteer trial, live qualification or release acceptance is claimed. Remaining technical obligations route to [NP00](../../../active/closeout/NP00/ticket.md). Future product work follows [NP00–NP04](../../../../next-phase.md) and the [shared board](../../../../task-board.md). Reviews, human trials and submission preparation are deferred as mapped there. Historical claims and next-step instructions below cannot select current work.

## Historical ticket record

<!-- pre-NP-original-body -->

# KE01 — Generic decision contracts

- Status: DONE.
- Claim: User-directed start recorded 2026-09-27T08:38:18Z. Direct worker: Codex GPT-6; exact model variant and effort are not exposed, so `gpt-6-luna` / high is the task target but is not claimed as verified runtime selection. Clean synchronized `main` baseline: `2455ef01f46423afdd27a0d234a6f05da8b71c41`; `git pull --ff-only origin main` succeeded and HEAD/origin are 0/0. Bounded files: `packages/contracts/src/index.ts`, new `packages/contracts/src/known-enough.ts` and `known-enough.test.ts`, `packages/contracts/src/contracts.test.ts`, new `packages/test-support/src/known-enough-fixtures.ts` and `known-enough-fixtures.test.ts`, `docs/contracts.md`, `docs/known-enough-architecture.md`, `docs/known-enough-pivot.md`, this ticket, `docs/task-board.md`, `docs/handoff-B.md`, and `docs/work-log-B.md`. No application migration, dependency, root configuration, lockfile, or CI changes planned.
- Direct worker: `gpt-6-luna` / high by user direction for the KE01–KE08 MVP; record actual model/effort, never infer it from this file.
- Prerequisite: [KE00](../KE00/ticket.md) is DONE with its product direction recorded; no new sign-off is needed.
- Scope/files: packages/contracts/**; synthetic fixtures in packages/test-support/**; docs/contracts.md and the Known Enough authority docs. Also this ticket, the current board/handoff and claimant’s own log. Name exact files and baseline at claim; coordinate contract/root/lock/CI changes.

## Outcome

Implemented schema-version-2 runtime contracts for DecisionDefinition and variables, public and owner snapshots, frame confirmations, drafts/confirmed constraints, finite rules, candidate evaluation/proposals, negotiation questions/refusals/permissions, disclosure permissions, approvals and version-bound command/result envelopes. Preserved v1 wire/hash behavior behind the `KnownEnough` namespace. No application migration is included.

## Settled contract decisions

See [Contract v2](../../../../contracts.md#ke01-generic-contract-v2) for the normative details. `NUMBER` uses exact coefficient/scale; money uses explicit currency/minor units; percent uses basis points; dates are civil Gregorian; datetimes are canonical UTC milliseconds plus display timezone; duration is seconds. Missing values are omitted, null is not a value, unknown/unsupported checks block readiness. Arrays preserve declaration/display order except for explicitly identified set semantics. Operators are finite and nonrecursive. Private-input readiness is returned only in the exact owner's snapshot; public status is aggregate. Owner snapshots scope the embedded public projection to that owner. Refusal identity binds typed request, constraint version and semantic context. Hashes cover only allowlisted public facts and do not authorize writes.

## Acceptance

1. Settle the bounded type/operator vocabulary, units/currency/rounding, date/timezone/duration semantics, missing/unknown values, array ordering and evaluation limits. Reject unknown fields recursively and all arbitrary executable expressions; no universal user-authored DSL.
2. Define draft versus confirmed frame authority, required participant confirmations/readiness, semantic and control versions, owner/draft/proposal versions, permission binding, refusal identity and stale-result behavior. Record decisions for unsupported qualitative conditions and public versus private proposal values.
3. Strictly separate public facts from owner/backend values and internal dependencies. Public hashing uses only specified public facts and an opaque context token, with stable canonical test vectors; hashes do not grant authority.
4. Christmas fixture parses with five participants; TeamTable is representable through a compatibility adapter; include a minimal hypothetical contribution/ownership example to expose type gaps. Reject malformed, cross-reference, duplicate-ID, private-leak and unsupported-rule fixtures without AWS/model dependencies.
5. Document migration/version decisions and consumer compatibility notes. Include the exact contract artifact and unresolved architecture questions in the single KE09 review bundle after the first MVP; do not schedule a separate KE01 reviewer task.

## Checks and handoff

- Focused suite: `npm test -- packages/contracts/src/known-enough.test.ts packages/test-support/src/known-enough-fixtures.test.ts` — 2 files, 15 tests passed. Covers five-person Christmas, TeamTable compatibility (with and without legacy grant), contribution/ownership projection, strict recursive rejection, canonical hash vector, refusal identity and owner/public privacy.
- Pinned toolchain: Node 24.21.0 / npm 11.19.0. `npm run check` exited 0: seven immutable reference hashes; 15 planning checks; lint and 96 import/dependency boundary references; typecheck; 247 tests passed, 1 skipped; production and hosted-preview builds; hosted-preview browser 1/1; Chromium end-to-end 41/41. Playwright Chromium 153.0.8010.12 and missing Ubuntu runtime libraries were staged under `/tmp`; no repository dependency, lockfile, system package or browser source changed.
- Documentation links/status and `git diff --check` passed. Existing v1 contract tests pass as part of the full suite.

Acceptance is complete and KE01 is DONE. Handoff directly to KE02, now the next eligible task; use the retained B04/B04.5 technical baseline. No separate KE01 reviewer or project sign-off is required. Include this exact contract, tests, KE02 kernel and KE03 storage diff, and remaining migration/auth/transaction/retention/evaluation questions in the one KE09 bundle after the MVP. Project sign-off remains deferred.

Before development, use a separate clean clone on `main`, successfully run `git pull --ff-only origin main`, recheck current claims and record the bounded claim. One task at a time. Only reviews explicitly named in this ticket are gates; do not add broad or repeated review sessions. Follow the [token-efficient review policy](../../../../agent-workflow.md#review-scope-and-token-efficiency). No implicit publication, merge, deployment, paid calls/resources or external messages.

Follow the [workflow](../../../../agent-workflow.md), [current queue](../../../../task-board.md), [product](../../../../known-enough-product.md), [architecture](../../../../known-enough-architecture.md) and [migration mapping](../../../../known-enough-pivot.md).
