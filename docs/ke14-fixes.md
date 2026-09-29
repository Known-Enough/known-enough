# KE14 fixes — implementation checkpoint for focused review

User A / Codex GPT-6, exact variant and effort unexposed; target Sol/high. Started 2026-09-29 from clean synchronized `44602dff26a92b088b085f0ac92730d72b3cd614`. The user explicitly requested the fixes. This is an implementation/self-check record, **not an independent privacy PASS or deployed scenario qualification**. KE14 reaches REVIEW for the already required focused KE09 follow-up; KE15 remains BLOCKED.

## Implemented behavior

- Registered authenticated participants can create an AI-drafted synthetic Christmas or Shared Purchase frame through `POST /decisions`. The server directory determines roster and subject bindings; clients cannot supply memberships, activate invitees, or confirm for another owner. Only the creator initially joins; all others redeem their own subject-bound invitations. Frame creation records zero confirmations/approvals.
- A deterministic creator/key decision ID and durable hash of the public scenario/objective provide creation retry identity. Authorization precedes receipt lookup. An identical retry returns current state without a new model call; a changed body conflicts; an inactive creator cannot replay. Concurrent duplicate writes use conditional repository creation and verify the winning durable receipt. No private conditions enter this receipt or public hashes.
- Server-declared synthetic complete offers now have an optional trusted catalog path. The model still receives/selects only public catalog assignments; the negotiator maps an exact public choice to the corresponding server-owned complete offer before the same kernel checks. Private model assignments still fail. Duplicate public projections are rejected before provider invocation rather than ambiguously choosing hidden values. Model contexts still contain permitted confirmed structured private constraints within the trusted provider boundary.
- Purchase has two hypothetical contribution structures and public ownership percentages, three private contribution variables, a backend total rule and owner-confirmed hard caps. Conditional flexibility uses the existing public ENUM negotiation question; numeric consent vocabulary and hard limits are unchanged. Each owner sees only their proposed private contribution and explicitly reviews it alongside the public proposal before final approval. Public outcome inference remains possible.
- Connected participants can create/select/load decisions, confirm the frame, privately request an interpretation, explicitly select conditions, answer their own question, explore proposals, inspect their own private proposal values, approve the exact current proposal and withdraw their own approval. Displays receive public-only UI. Context/owner/proposal changes reset review state; stale loads cannot repopulate cleared private state. Unknown command outcomes preserve the identical envelope for retry, with server replay preventing a second mutation. Unresolved input visibly blocks exploration. Raw owner text clears after interpretation; the backend stores sanitized structured drafts only.
- Optional Lambda composition wires these services only under explicit approved model configuration. It remains **disabled by default**. Creation uses the registered service rather than exposing the standalone architect route to arbitrary authenticated pool accounts. Existing Cognito membership/display authorization remains in force. Creation writes are now part of runtime stop tracking: stop closes admission and drains admitted model-result writes before resolving; a new creation guard checks enabled state and the 30-second creation lifetime before repository admission.

This remains a bounded demonstration using static synthetic offers, not a domain-specific optimizer, purchase execution, financial/legal recommendation or arbitrary private-value generation. Christmas proximity remains unsupported unless the owner clarifies or explicitly withdraws it; the scripted successful fixture withdraws it and retains quiet accommodation. No historical fixture bytes or TeamTable behavior were rewritten.

## Storage and deployment configuration

`creationBodyHash` is an optional backend-only field in the generic STATE v6 record codec. Existing v5/v6 records remain readable without it and are not rewritten by this task. Existing STATE/GUARD/REPLAY item limits and transactional creation remain enforced. A prior strict reader cannot read new records containing this extension; a backend rollback must preserve the new reader or explicitly handle those new scenario records. It is not safe to assume downgrading the codec reads new records. No managed DynamoDB creation replay/cold-start result is claimed.

Configuration to review before any paid deployment:

| Setting | Required value |
| --- | --- |
| `KE14_MODEL_MODE` | absent or `DISABLED` today; only explicit `BEDROCK` enables services |
| `KE14_PAID_CALLS_APPROVED` | `true` after separate human authorization |
| `KE14_INVOCATION_LOGGING_DISABLED` | `true` after live configuration readback |
| `KE14_RETENTION_REVIEWED` | `true` after current account/model retention review |
| `KE14_MEMBER_BINDINGS` | JSON array of five exact server-registered `{participantId, displayName, subject}` records for maya/leo/nina/ana/raul; no client or mock subjects in staging |

Flags are guards, not authorization or evidence. Paid models retain the existing Nova Lite configuration in `us-east-1` with one SDK attempt, 2,048 output tokens, 65,536/32,768 byte bounds, bounded queue/deadlines and two reasoning attempts. The runtime role still needs separately reviewed model invocation permission before enablement. Existing queue state is process-local, not a durable distributed lease; abandoned jobs may need controlled recovery after process loss; no recovery evidence is claimed here. New room displays need their own exact Cognito scope; existing Christmas display membership does not automatically grant access to new rooms. No account, IAM, Lambda environment/ZIP, data migration, paid call, invitation to a real person or external message was changed/sent here.

Pushing this checkpoint to main is repository synchronization authorized by the workflow. The previously authorized main-branch Amplify workflow may deploy the public frontend automatically; that does **not** deploy the API/Lambda or enable models. The current backend returns unavailable/404 for new model services until a separately authorized reviewed deployment occurs. Do not present the UI preview as complete live KE14 acceptance.

## Evidence and review scope

Focused checks: scenario/application/catalog/codec/runtime/client tests, offline signed Cognito HTTP auth tests and two connected-browser tests. Both scenarios pass locally through real adapters/application/kernel with an explicitly scripted transport; Purchase's three browser sessions reach unanimous agreement, and a lost-response retry records exactly one frame mutation. The stop test holds a creation repository write behind a barrier and proves awaited stop remains pending until it settles. Cold replay reconstructs a repository/application/service from encoded STATE and makes no second provider call. No fabricated usage/cost figures.

Initial browser failures exposed the existing `/decisions/` client path restriction; the exact `/decisions` path was added while foreign/unrelated paths remain rejected. Test expectations were corrected for valid request bodies, sequential control-version refresh and public structure labels versus private variable IDs. The boundary scanner required query parsing via URLSearchParams. No unrelated root/lint exceptions were added. The initial full run passed 413 tests and 47 browser tests; the stop-tracking correction changed code and justified a fresh final full run. Final results follow below.

Review only the changed authenticated creation/replay/storage extension, trusted complete-catalog projection and ownership approval, connected session/private controls, Lambda model enablement and creation stop tracking. Existing KE10 corrected stop/commit code/debt still needs its named independent follow-up; reuse the existing barrier regression instead of broadening this into a new architecture audit. The implementation author cannot self-certify these boundaries. After PASS, obtain separate concrete cloud/paid-call authorization, deploy exact API/config artifacts and run both complete managed scenarios. Preserve the original [qualification findings](ke14-qualification.md) as dated evidence.

Executable manifest: SHA-256 `8d41455b7a3edbddda056d2adf5d82b628c3f057d3ccca1f37ad4069d94cebb7` over the sorted UTF-8 `path hash\n` entries below. These 17 files must match the full-check archive. Review the diff from baseline `44602df` to the commit containing this checkpoint; docs/status changes do not imply acceptance.

```text
apps/api/src/http-core.ts 2f2a876f71bbf6540f3b61fa84beb5d4de272d1a50a5517a127dd20200d97002
apps/api/src/ke13b-lambda.ts f23e03286a23fd908a63e785ca73dc1d7dbdf88812e040e1b6888a04d0a6a289
apps/api/src/model-runtime.ts bdb7418cc43ce130bfca96b368a910399438d0e260bc5b547251a5c723f8568f
apps/api/src/scenario-service.test.ts ced8099584d18e594872ed73e5a388df2c8338613f5cb64e2b70db5aa0386e8a
apps/api/src/scenario-service.ts 81c0d0f4a66171840b902e78f6a92a5d73b8f3e01c50b34cb7ba5d5b9a873e07
apps/web/src/cognito-session.test.ts f8b9dc4b6615d965ffc571eb4902ddca5d5e61571b1de70a8a012a5411d1b58d
apps/web/src/cognito-session.ts 8242020259da57f4f12d66b40b65dc1dce7c76235a257d4b254349ac5fce2233
apps/web/src/connected-app.tsx edfac32cc17d70b1bd3f4cc8094015566c1b5ecf06a3361db21c92b8881f780a
apps/web/src/connected-decision.tsx d76c6887ee00312c5c1d7c72cae88316767471fdb42b20afb2f7ca02000f4246
packages/adapters/src/dynamodb-codec.ts 0a2d3986c3b89c61369f8efb67bf8134487275ae81b779bb3cba53549f46d5b5
packages/application/src/decision-negotiator.ts b8088bc14fdf39e53ae5fa94614f1b598828982ebc89c67515fa2800f8e3f7f4
packages/application/src/known-enough.ts a0d4407f3b1debc1dc517e5a63ef4c627dd60aa6466d3a65733b7c7e63a51d3b
packages/application/src/types.ts 5f9f1c8e5305c7ce2164f747dd2f6f99a787354bdd6ebe544c78f7060f09868f
tests/e2e/ke14-connected.spec.ts 037a795da31736d0f10bd4f3769efd15b3fa4c791930d7d94bd8894bf8bd416f
tests/evaluations/ke14-api.ts 1967239340ec3905b92482d00ea729994e90b7cdd0cbc8ece80bbbf679c47856
tests/evaluations/ke14-fixed.ts c9605d739a1d77712e5368bcc43cebf400fd91adb16a657b45e95bc01d3538dd
tests/integration/ke14-fixed-http.test.ts 6eea88b0462637f9183dcaaa945aef1b64f1fa35451141f2f0b66325ce42c571
```

Final pinned check exit 0: 414 passed / 2 optional DynamoDB Local skips, hosted preview 1/1, E2E 47/47, references 7/7, planning 15/15, lint/boundaries 199 references, typecheck and both builds. All 17 executable files match `/tmp/ke14-fixes-44602df` byte-for-byte; pre-existing ignored Vercel generated assets remain preserved. Final documentation checks follow.

Documentation validation passed: 203 local Markdown targets, imported hashes 7/7, planning 15/15, whitespace, REVIEW/BLOCKED/released-claim consistency. Pre-push fetch confirmed main at baseline `44602df`, ahead/behind 0/0.
