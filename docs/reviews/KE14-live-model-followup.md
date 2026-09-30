# KE14 live model correction follow-up

**Verdict: PASS** on the exact two-file review artifact, SHA-256 `730b18b636b18272e02de019d53f5616432e72e2973aed98d29a0e853fa2df89`. Review completed 2026-09-30 UTC (2026-09-29 in the user's timezone). Reviewer: User B / Codex GPT-6, exact runtime variant and effort unexposed; the ticket's Sol/high target is not runtime evidence. Implementation owner: User A. Review base: clean `main` at `b199e87959f4518e173be5cd6e44bebfa16fb41f`; the review patch applied without conflicts and changed only `packages/adapters/src/bedrock-models.ts` and `packages/adapters/src/bedrock-models.test.ts`.

## Scope and findings

Reviewed only the negotiation tool schema/normalizer, architect prompt additions, the new adapter regression, and relevant application/runtime checks. The exact reproducible patch is [KE14-live-model-correction.patch](../review-artifacts/KE14-live-model-correction.patch). No source was integrated or deployed in this review.

- The negotiation tool now requires `candidateIndex`, which is already declared in the schema. `normalizeToolOutput` copies the indexed server-provided catalog entry, removes the selector, and leaves the existing strict application/kernel validation in place. Missing, invalid, or out-of-range indices become an empty candidate and are rejected downstream; the model does not author public values.
- The architect prompt distinguishes unresolved public scope from later private participant information and says not to invent private values. It grants no confirmation or other authority; the existing application validates the public draft and allowed option labels.
- The regression checks that every root required tool field is declared and present in the scripted response. It fails against the previous undeclared `values` requirement and passes with the corrected `candidateIndex` requirement.

No actionable finding remains on this bounded patch. One limit remains for later live qualification: the architect adapter sends the objective, participant display data, and allowed-option strings; it does not send structured variable IDs, option IDs, or variable types. Therefore the new prompt's conditional instruction to preserve explicitly supplied identifiers cannot establish an identity guarantee for identifiers absent from that input. Existing schema and allowed-label validation remain authoritative. The changed prompt has not been tested against live model output, as the implementation note states.

## Independent checks

- Fresh separate clone on `main`; `git fetch origin` and `git pull --ff-only origin main` succeeded with `HEAD == origin/main` before applying the patch.
- Pinned Node 24.21.0 / npm 11.19.0; `npm ci` succeeded.
- `npm test -- packages/adapters/src/bedrock-models.test.ts`: **12/12 passed**.
- Negative control restored the old `required: ['values', ...]` declaration in the isolated review clone: the new regression failed as expected (exit 1); the corrected patch was restored immediately afterward.
- `git diff --check` passed. The author's recorded full check (418 passes / 2 optional skips, hosted 1/1, E2E 47/47) was inspected as supplied evidence, not rerun by this reviewer.

No AWS writes, paid model calls, deployment, real participant actions, or external messages occurred. This PASS clears only the named independent review gate for the model patch. KE14 remains REVIEW pending integration/deployment and complete synthetic Christmas/Purchase participant qualification; KE15 remains BLOCKED.
