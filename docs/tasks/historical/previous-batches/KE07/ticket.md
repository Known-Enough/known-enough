> Historical ticket view. Links follow the current layout; [original bytes](original.md.txt) retain the old paths and evidence. This folder does not schedule work.

# KE07 — Private participant AI conversations — closed previous batch

- Status: DONE — user-directed administrative closure, 2026-09-30.
- Claim: Closed for scheduling by the user's new-batch direction; preserve all saved work.

This is administrative closure of the old plan. Prior technical results and unfinished criteria are preserved below; no new check, review PASS, volunteer trial, live qualification or release acceptance is claimed. Remaining technical obligations route to [NP00](../../../active/closeout/NP00/ticket.md). Future product work follows [NP00–NP04](../../../../next-phase.md) and the [shared board](../../../../task-board.md). Reviews, human trials and submission preparation are deferred as mapped there. Historical claims and next-step instructions below cannot select current work.

## Historical ticket record

<!-- pre-NP-original-body -->

# KE07 — Private participant AI conversations

- Status: DONE — technical criteria and required checks passed on 2026-09-27.
- Claim: User A; actual worker Codex GPT-6, runtime variant/effort unexposed. User-directed `gpt-6-luna` / high is the target and is not claimed as verified runtime selection. Clean synchronized `main` baseline `0c86a2d53d2d7f58f769afbbb9253afb63625d37`; `git pull --ff-only origin main` succeeded in `/tmp/known-enough-ke07`.
- Direct worker: `gpt-6-luna` / high by user direction for the KE01–KE08 MVP; record actual model/effort, never infer it from this file.
- Prerequisite: [KE06](../KE06/ticket.md) is DONE with its acceptance checks recorded; all named earlier gates remain satisfied.
- Bounded scope/files: `packages/application/src/{owner-conversation.ts,owner-conversation.test.ts,index.ts}`; `apps/api/src/{http-core.ts,known-enough-http.test.ts}`; `apps/web/src/{known-enough-home.tsx,owner-conversation-mock.ts,owner-conversation-mock.test.ts,style.css}`; `tests/e2e/scaffold.spec.ts`; `docs/known-enough-architecture.md` retention rules; this ticket, board, A handoff and A log. Contracts/schema, domain kernel, old A05 files, root manifest/lock, CI, cloud, live model, real identity and shared persistence were unchanged.

## Outcome

Adapt A05’s reviewed draft review and form fallback into a generic owner-private conversation. Use injected extraction responses initially; a model interpretation is never an authoritative condition until the owner confirms it.

## Acceptance

1. Show hard versus preferred budgets and negotiable conditions in plain language. Owner can confirm, edit, reject or clarify; invalidate previous review when the text/draft/context changes.
2. Construct owner context from the verified owner, own conversation/confirmed conditions and public frame only. Wrong-owner/cross-room access fails; no other owner conversation enters prompts, memory, logs or replies.
3. Test hard maximum versus preference, negation, conditionals, contradictory statements, changes of mind, ambiguity, prompt injection and private motivations that must not become public facts.
4. Define minimal raw-text retention, deletion after confirmation where feasible and retry/backup limits; do not promise immediate erasure of all copies. Use synthetic statements only.
5. Preserve A05 confirmation invalidation/fallback evidence, adapt its tests explicitly and obtain critical follow-up for changed consent boundaries. Real Bedrock extraction remains KE10.

## Checks and handoff

Run focused owner isolation/confirmation and browser evaluations plus pinned npm run check. When criteria and checks pass, record evidence and mark DONE; hand off directly to KE08 without per-task human review.

Before development, use a separate clean clone on `main`, successfully run `git pull --ff-only origin main`, recheck current claims and record the bounded claim. One task at a time. Only reviews explicitly named in this ticket are gates; do not add broad or repeated review sessions. Follow the [token-efficient review policy](../../../../agent-workflow.md#review-scope-and-token-efficiency). No implicit publication, merge, deployment, paid calls/resources or external messages.

Follow the [workflow](../../../../agent-workflow.md), [current queue](../../../../task-board.md), [product](../../../../known-enough-product.md), [architecture](../../../../known-enough-architecture.md) and [migration mapping](../../../../known-enough-pivot.md).

## Completion — 2026-09-27

- Added `OwnerConversationArchitect` and `POST /decisions/:decisionId/owner-conversation/draft` behind an optional injected model port. The route uses the authenticated principal; the application resolves only that member's owner snapshot and requires every required participant to have confirmed the current frame before extraction. The model receives the public frame, that owner's private variables/confirmed constraints/current draft, and only the bounded conversation turns supplied for this request. Cross-decision and nonmember requests fail before model invocation.
- Interpreter output is strict and context/version metadata is assigned by the server. Existing application validation stores only a private structured draft; owner selection/confirmation remains the existing `CONFIRM_CONSTRAINTS` action. Draft IDs, semantic/context/owner versions are checked through the existing path. Raw turns and the model's free-text summary are not stored or logged; persisted summaries/questions are fixed safe text. Confirming an empty selection rejects all proposed conditions and clears the draft.
- Added a lazily loaded local-only UI prototype with one finite fictional sample. It separates a hard $2,000 maximum, a preferred $1,500 budget and a direct-flight trade-off. Arbitrary wording, negation, conditional ambiguity, contradictions and prompt injection return clarification instead of a condition. Editing invalidates the prior review; the UI supports local confirm, clarify/edit, reject and clear. The UI makes clear the profile is unverified, the fixture is not live AI, and nothing is shared, persisted or sent over the network. A synthetic personal motivation is excluded from the structured result.
- Retention policy added to [architecture](../../../../known-enough-architecture.md#owner-conversation-retention-ke07): raw turns are request-scoped; no transcript in app logs, traces, caches, retries or persistence; structured confirmed constraints remain private only as needed for decision lifecycle. The existing confirmation path clears the draft. Managed provider/backup deletion windows must be documented before future live integrations; no instant erasure promise is made.
- Existing A05 invalidation and fallback tests remain unchanged and passed as part of the suite. No consent authority changed; the existing explicit owner confirmation remains required, so no extra consent-boundary review was triggered. No live model, identity provider, AWS/cloud, shared UI state, paid call, deployment or external publication.
- Actual worker: Codex GPT-6; runtime variant/effort unexposed. The user-directed `gpt-6-luna` / high target is recorded, not claimed as verified runtime selection. Work began from clean synchronized `main` baseline `0c86a2d53d2d7f58f769afbbb9253afb63625d37` in `/tmp/known-enough-ke07`; its pull from `origin/main` succeeded.
- Pinned Node 24.21.0 / npm 11.19.0 `npm run check` passed: reference hashes 7/7; planning 15/15; import boundaries 126; typecheck; 294 tests passed with two opt-in skips; production build/bundle scanner; hosted preview build/scanner/browser 1/1; E2E 43/43. Focused owner application/API/mock tests passed (11/11).
- KE07 is DONE; KE08 is now READY and next. KE00 remains DONE; B04/B04.5 remain REVIEW.
