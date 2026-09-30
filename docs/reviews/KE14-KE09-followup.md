# KE14 focused KE09 follow-up — changed boundaries

**Verdict: CHANGES_REQUESTED** on `44602dff26a92b088b085f0ac92730d72b3cd614..9f0e11fe53ed16a635e4f123410cc06df7981cf6`, 2026-09-30 UTC. Independent reviewer: User B / Codex GPT-6, exact variant and effort unexposed (KE14 Sol/high ticket target). User A's implementation claim was released. This is the named sequential model/session/storage/privacy follow-up, confined to KE14's 17-file manifest in [fix checkpoint](../ke14-fixes.md). The manifest's 17 current file hashes match. No implementation was edited in this review.

## Findings

1. **R1 — Frame confirmation does not show the facts being confirmed.** [ConnectedDecision](../../apps/web/src/connected-decision.tsx) renders objective, description and variable labels at the “Shared frame” confirmation surface (lines 86–90). It omits the variable types, enum choices, required flags, public rules and required approval roster. `CONFIRM_FRAME` commits the exact `frameVersion`, yet a participant cannot inspect material AI-created frame terms there. The KE14 connected test clicks confirmation without checking those terms. Show the current public frame's material terms and make the exact revision clear before the confirmation action; cover changed options/rules in a focused browser regression.
2. **R2 — An opaque private rule can still be confirmed.** The same component's `ruleText` returns only “Combined condition” for `SUM_EQUALS`, `ALL_DIFFERENT`, `MUTUALLY_EXCLUSIVE` and `IMPLIES` (lines 18–25), while the draft checkbox and `CONFIRM_CONSTRAINTS` button remain enabled (lines 102–109). The v2 contract and owner extraction accept those closed operators when valid. A participant may therefore make an authoritative private hard/negotiable confirmation without seeing the operative rule. Render every supported closed operator in reviewable terms, or prevent its confirmation and require clarification. Add a regression with a complex valid private draft. A preference review should also name the referenced variable, not display only its value.

Both findings concern informed participant confirmation, not a known server authorization bypass. The API authorization, creator-bound replay, catalog projection and runtime stop paths inspected here had no additional actionable finding on this diff. This verdict does not certify those boundaries, the older KE10 release debt, managed Cognito/DynamoDB behavior, provider retention, or deployed model calls.

## Independent checks and limits

- Clean synchronized `main` at `9f0e11f`, successful ff-only pull, ahead/behind 0/0 before claim. Inspected changed source, ticket, qualification/fix evidence, exact manifest, contract/operator acceptance, key focused tests and prior KE09 policy. No AWS credentials, write, model call or real participant data.
- Fresh focused Vitest: **61/61** across six API/application/KE14 suites; `npm run typecheck` passed. Fresh KE14 connected Playwright: **2/2**. These passing tests cover scripted scenarios and do not cover the two missing presentation states.
- Author's pinned full clean-archive check on the identical 17 executable hashes: 414 tests passed / 2 optional skips, hosted browser 1/1, E2E 47/47, references 7/7, planning 15/15, lint/boundaries 199, types/builds. Inspected as dated evidence, not rerun by this reviewer.

KE14 remains REVIEW and KE15 BLOCKED. After the bounded UI correction and focused/full checks, obtain a separate focused follow-up on the changed review surface. Separately authorized cloud/model deployment and live two-scenario qualification remain required for KE14 DONE.

## Subsequent correction handoff — 2026-09-30

User B implemented R1/R2 after this independent verdict. The [checked correction](../ke14-confirmation-correction.md) names the exact changed files and tests. This original verdict remains CHANGES_REQUESTED until a different reviewer inspects the correction; the correction author does not self-close either finding.
