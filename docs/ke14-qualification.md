# KE14 scenario qualification — needs changes

Historical qualification at `44602df`. The later [fix checkpoint](ke14-fixes.md) implements the recorded gaps and passes local checks; KE14 is now REVIEW for the required independent boundary follow-up. Live acceptance remains pending. The observations below are retained unchanged for their original artifact.

Qualification date: 2026-09-29. User A / Codex GPT-6, exact variant and effort unexposed; ticket target Sol/high. Source baseline `2f20192da333713bd2eaaff3a9fd01ec44f4955c`, clean ff-only pull before claim. This report and the two new test files form the qualification artifact; application, contracts, adapters, infrastructure and browser code were unchanged.

**Verdict: CHANGES_REQUIRED.** Offline checks demonstrate substantial Christmas and Purchase behavior, but neither scenario satisfies the ticket's complete deployed-artifact criterion. KE14 is PAUSED with this reviewable artifact; KE15 remains BLOCKED. Passing tests that assert a safe rejection do not make the rejected workflow qualified.

## Scenario observations

The [evaluation harness](../tests/evaluations/ke14.ts) and [integration scenarios](../tests/integration/ke14-qualification.test.ts) exercise real contracts, model adapters, bounded runtime, application and kernel with a scripted injected Converse transport. They make no AWS model calls, use no real participant data, and fabricate no usage/cost metrics. Test subjects are local principals, not managed authentication. In-memory storage is not deployment persistence evidence.

| Requirement | Actual evidence | Qualification limit |
| --- | --- | --- |
| Christmas constructed/confirmed frame | Scripted architect output becomes a server-validated frame; all five owners confirm it | Model adapter execution, not a real AI/provider-created deployed decision |
| Different private conditions | Maya's money cap, Leo's dates, Nina's negotiable destination, Ana's quiet accommodation and Raul's duration are extracted and explicitly confirmed | Scripted interpretations of synthetic fixture statements |
| Private condition and clarification | Ana's proximity condition leaves readiness NEEDS_CLARIFICATION and blocks reasoning. Explicit synthetic withdrawal retains her hard quiet-hotel condition; reconfirmation changes context and clears old frame confirmations | Proximity was withdrawn by the synthetic owner, never interpreted as satisfied or silently dropped; a distance condition remains unsupported |
| Negotiation and refusal | Mazatlán/USD 1,600 requires Nina's exact grant. A decline prevents an identical re-ask and publishes no candidate/refusal attribution | Destination-only public ENUM adjustment; no private numeric flexibility |
| Candidate and explanation | Granted Christmas candidate is kernel-valid; shared explanation contains validated public assignments. Four approvals remain APPROVING; fifth becomes AGREED. Wrong-hash approval fails | Permission is separate from approval; the public USD 1,600 offer happens to equal Maya's private cap, so field provenance rather than numeric substring absence establishes the distinction |
| Shared Purchase kernel/application | Private contributions USD 25,000/15,000/10,000 and public ownership 50/30/20 percent satisfy USD 50,000 total and individual caps. Owner sees only their contribution; two approvals remain APPROVING, third becomes AGREED | Definition, private cap drafts and complete candidate are supplied by trusted synthetic setup; **zero model calls** in this success path |
| Purchase invalid path | Moving one minor unit from Leo to Maya preserves the total but exceeds Maya's hard cap: INVALID, no public candidate | Demonstrates enforcement, not a model-backed allocation strategy |
| Purchase model path | Public ownership-only candidate returns NEEDS_CLARIFICATION because required contributions are absent. Full private catalog is rejected with INVALID_MODEL_OUTPUT before model invocation | Current model output/catalog intentionally accepts only public assignments; bypassing this boundary is not a fix |
| Purchase flexibility | A negotiable private money adjustment returns INVALID_COMMAND and creates no question/grant | Reviewed question vocabulary is public ENUM only. A public structure option subject to unchanged hard private caps could be an alternative, but is not implemented or qualified here |
| Revision/stale/privacy | Revision clears Christmas grants/approvals/frame confirmations. An in-flight Purchase completion after revision returns STALE. Public projections exclude private contribution variables/amounts, constraint/grant identities, raw-message canary and refusal records; another owner's view contains only their constraints | Public outcomes can still imply facts; no claim to eliminate unavoidable outcome inference |

## Exact deployed artifact and missing flows

Read-only Lambda readback on 2026-09-29 returned Active, runtime `nodejs24.x`, RevisionId `bed5f9e7-8460-48c6-b8a2-39f4b39d7995`, modified `2026-09-29T22:29:29Z`. Its base64 code checksum converts to SHA-256 `8e01ad21d9233b834b76e1aee77d32e37f6898f5827c49182c64d54fe1b26211`, matching the retained local ZIP. Amplify app `d143q5ravxp5av`, main job 2 remains SUCCEED; manual deployment job metadata returns no commit ID. The earlier [KE13 boundary report](reviews/KE13-deployed-boundaries.md) records GitHub workflow `36620734722` at `d0a482b080080ed22d8bce29691dea1aefd4a351`; that mapping is carried-forward evidence, not a commit field returned by this readback.

Inspection of [Lambda composition](../apps/api/src/ke13b-lambda.ts) and [HTTP routes](../apps/api/src/http-core.ts) confirms the current backend has **no architect, owner-conversation or negotiator ports**. Those optional authenticated model routes return 404 when absent. The HTTP surface has no authenticated path that persists an architect draft as a new decision. The [connected browser](../apps/web/src/connected-app.tsx) loads the seeded Christmas room/profile, provides invitations and a simulated public assistant; it has no complete frame/input/negotiation/approval workflow or Purchase selection. The separate loopback demo does not fill these managed-service gaps. KE13's live write/replay/persistence results remain valid for their operational scope and are not promoted to scenario success.

Local adapters retain Nova Lite configuration `amazon.nova-lite-v1:0`, `us-east-1`, temperature 0, max output 2,048 tokens, input/output limits 65,536/32,768 bytes, SDK one attempt; reasoning is bounded to two attempts. **Actual transport for this artifact is INJECTED, not Bedrock.** Staging has no active model service or model invocation permission in its reviewed runtime role. No deployment, IAM change, paid call, participant invitation or external message occurred.

## Required implementation before requalification

1. Persist server-validated architect drafts through an authenticated organizer operation with membership provisioning and stale/idempotency guards. Scope application/HTTP route tests explicitly before changes.
2. Define a reviewed backend allocation path for owner-private Purchase values. Keep the public model catalog/output allowlist intact; never make private contributions public to satisfy it. Specify owner value provenance/confirmation and how exact approval binds the complete trusted candidate. Choose conditional structure flexibility under unchanged hard caps, or explicitly design/review expanded numeric consent; the present artifact approves neither design.
3. Compose bounded model ports in the deployed Lambda and provide both connected participant workflows. Named implementation files include `apps/api/src/ke13b-lambda.ts`, `apps/api/src/http-core.ts`, `apps/api/src/model-runtime.ts`, `packages/application/src/known-enough.ts`, `packages/application/src/decision-negotiator.ts`, and `apps/web/src/connected-app.tsx`, with affected regression tests. Coordinate contracts/IAM/root files separately if required; this report is a proposed scope, not a claim that those changes passed.
4. Run focused checks and full pinned checks, then the existing KE09 follow-up limited to changed model/session/cloud boundaries. Only after a concrete reviewed implementation exists obtain separately required cloud/paid-call authorization, deploy exact artifacts, and repeat both complete scenarios with authorized synthetic participant access. Resolve existing KE10 stop/commit review debt before release-grade model claims. No new broad review gate is added.

The [workflow](agent-workflow.md) and [KE14 ticket](tasks/KE14.md) require material discovered changes to go through implementation and renewed focused review. The user's standing repository authorization excludes AWS deployments and paid calls; a generic request to proceed with KE14 does not approve either. These are actual missing capabilities, not a request for routine project acceptance.

## Verification

- Focused scenario/affected regression run: 50/50 passed across KE14 (10), DecisionNegotiator, model-runtime and fixture suites. Focused lint and typecheck passed.
- Full pinned `npm run check`: exit 0; 405 passed / 2 optional DynamoDB Local skips, hosted preview 1/1, E2E 45/45, references 7/7, planning 15/15, lint/boundaries 189 references, typecheck and both builds passed. Executed from a clean archive of the baseline plus the exact two new test files at `/tmp/ke14-qualification-2f20192`. The working clone's pre-existing ignored `.vercel/output` generated assets remain preserved; this avoids their previously documented unrelated lint failures.
- Documentation checks passed: 200 local Markdown targets, imported hashes 7/7, planning 15/15, KE14 PAUSED / KE15 BLOCKED / released claim consistency, and `git diff --check`. Tests/docs-only changes do not match Amplify workflow deployment filters.

Exact executable qualification hashes, equal to the files used in the full-check archive:

- `tests/evaluations/ke14.ts`: SHA-256 `2cfd371e25375a33621db4f6328a0029994d291c53a3a58b740914c6de9aace4`.
- `tests/integration/ke14-qualification.test.ts`: SHA-256 `906258a710d4e41e59eabc51ef1a05fda4ea7f03bc572e464413a0fc9d716251`.
