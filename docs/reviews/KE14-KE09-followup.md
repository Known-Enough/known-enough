# KE14 focused KE09 follow-up — changed boundaries

**Latest scoped correction verdict: PASS** on `b0699fe..95db9b5`; see the [independent R1/R2 follow-up](#ke14-r1r2-followup). The original findings and verdict below remain historical evidence. KE14 remains REVIEW for live qualification.

**Original verdict: CHANGES_REQUESTED** on `44602dff26a92b088b085f0ac92730d72b3cd614..9f0e11fe53ed16a635e4f123410cc06df7981cf6`, 2026-09-30 UTC. Independent reviewer: User B / Codex GPT-6, exact variant and effort unexposed (KE14 Sol/high ticket target). User A's implementation claim was released. This is the named sequential model/session/storage/privacy follow-up, confined to KE14's 17-file manifest in [fix checkpoint](../ke14-fixes.md). The manifest's 17 current file hashes match. No implementation was edited in this review.

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


<a id="ke14-r1r2-followup"></a>

## Independent R1/R2 correction follow-up — 2026-09-30

**Verdict: PASS** on `b0699fe57127e8e0c7959e02cbd963b3dc872d51..95db9b58da4dbff3f600ab338430a59eb2fa9882`. Reviewer: User A / Codex GPT-6, exact variant/effort unexposed; no configured Astra/high claim. User A did not author User B’s three-file correction. Clean User A clone on `main`, successful ff-only pull, ahead/behind 0/0; B’s claim released before this sole review. User A authored earlier KE14 implementation, so this independent verdict is confined to B’s R1/R2 correction and does not independently certify that underlying backend/model/session/storage code.

- **R1 closed:** the confirmation surface shows current frame version, required/optional approval roster, public variable types/precision/domains/options, and public rules. An explicit review checkbox gates `CONFIRM_FRAME` and is scoped to the context token and frame version. Inspected parsing and parent remount boundaries; an independent browser probe changed the options, rules, semantic context and version and verified fresh unchecked/disabled confirmation, visible new terms, and re-enablement only after explicit review.
- **R2 closed:** all seven closed operators now name referenced variables and operative values; ranges distinguish inclusive/exclusive bounds, mutual exclusion names the selection limit, and implication exposes both literals. Compared semantics with the contract and kernel. Preferences name their variable and cost. Valid complex owner-draft rendering and an independent money/enum/implication probe passed; a display-only render contained no private variable, amount, draft or confirmation controls. Rendering stays in React text nodes and uses public-only frame rules; the correction adds no authorization, consent, private public projection or command-envelope changes.

### Fresh evidence

All three executable hashes exactly match [B’s correction checkpoint](../ke14-confirmation-correction.md); repository implementation files were unchanged. Pinned Node **24.21.0**, npm **11.19.0**, bundled Chromium.

- `npx vitest run apps/web/src/connected-decision.test.ts apps/web/src/ke14-review.test.ts`: **5/5** (three committed regressions plus two independent probes).
- `npx playwright test tests/e2e/ke14-connected.spec.ts tests/e2e/ke14-review.spec.ts --workers=1`: **3/3** (two committed scenarios, including exact replay after unknown outcome, plus independent revision/confirmation probe).
- Fresh `npm ci` then `npm run check` in exact source archive `/tmp/ke14-r1r2-review-95db9b5`: **exit 0**, **417 unit/integration passes / 2 optional DynamoDB Local skips**, hosted preview **1/1**, E2E **47/47**, references **7/7**, planning **15/15**, lint/dependency boundaries **199**, typecheck and both builds/scans passed. Existing ignored generated output in the working clone was preserved. Full log `/tmp/ke14-r1r2-full-check.log`, SHA-256 `95f593dc26285e697eff9d751a4a9f7701b3bf8268e9e4a80732b2cfcf5d2fba`.

Independent probes were temporary review artifacts, never implementation edits: `/tmp/ke14-r1r2-probes/ke14-review.test.ts` SHA-256 `4ac54456e54722b5d1996966347588f194ab237f1ad83548373ada352948a84b`; `/tmp/ke14-r1r2-probes/ke14-review.spec.ts` SHA-256 `fae8997325b02ab2747ffcbc43f81adcab7d8de3c11b1d95c78f0fa84977a1a8`. To reproduce, copy them into the respective `apps/web/src` and `tests/e2e` locations in an archive of `95db9b5` and run the focused commands above. The probes were removed from the archive before the full check. Focused browser log: `/tmp/ke14-r1r2-focused-browser.log`, SHA-256 `94ead83d89406bd03a4e637f50cedd308e5dcd9393aa47df4224c8e2aed0b0bf`.

No new actionable finding on this bounded correction. This clears the informed-confirmation correction gate only. It does not certify actual Cognito/DynamoDB/cloud concurrency, provider retention, deployed model output, the older KE10 release debt or User A’s earlier implementation. No source changes, real participant actions, cloud writes or paid calls occurred. KE14 remains REVIEW and KE15 BLOCKED until separately authorized backend/model deployment and real synthetic two-scenario qualification. Review claim released after documentation verification and synchronization.
