# KE14 authorized AI activation — 2026-09-29

**Nova Lite activation and both managed AI create/read/reload-replay smoke PASSED on the existing reviewed staging artifact.** Earlier rejected objectives remain dated evidence below. A [two-file model correction](ke14-live-model-correction.md) discovered during diagnosis is prepared/tested but unintegrated, awaiting the required independent follow-up. The user approved synthetic staging use and at most eight paid smoke requests; conservative counter consumed eight create/replay HTTP attempts, including durable replays. KE14 REVIEW, KE15 BLOCKED; A implementation/activation claim released, full participant qualification remains pending.

## Exact activation and access

- Existing account `092954139775`, `us-east-1`, Lambda `known-enough-stage-api`; reviewed ZIP SHA-256 `017aae3553a16edbd7b3c019956b388f3e6c16bd08a238e1f705a785c220c6ca` remained unchanged. Active/Successful after the revision-guarded update at `2026-09-30T02:35:23Z` (September 29 client date); revision `cbe67771-af08-405d-9c34-8b581e5b0684`.
- Root bootstrap installed only the separate runtime-role inline policy `KnownEnoughStageNovaLite`. It grants **only** `bedrock:InvokeModel` on `arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-lite-v1:0`. Exact JSON readback matched. Custom-policy simulation 6/6 and effective runtime-role simulation 5/5 passed: selected model allowed, another model/region, streaming and IAM mutation denied. No managed role policy attached; existing DynamoDB/log policy retained.
- Scoped `KnownEnoughStage1Release` performed the Lambda environment update using the current revision ID. `KE14_MODEL_MODE=BEDROCK`, paid-call/logging/retention review guards `true`, and the strict five-person subject directory were installed. All other environment/runtime/role/handler/memory/timeout/network/layers/KMS/tracing settings compare unchanged. The release operator's scope was not expanded to invoke Bedrock.
- Five directory subjects were reverified against unique enabled real Cognito identities. Private binding hash `a176b0d20e22cb70017eca50a4ceecf8b4195de3a762a8cf8884743cc5558c37`; directory contents and credentials remain outside the repository. No human participant password, group, membership or consent changed.
- Existing authenticated routes and [Amplify frontend](https://main.d143q5ravxp5av.amplifyapp.com/) retained; no redundant code/frontend release. Prior exact-source full check reused: 417 unit/integration passes / 2 optional skips, hosted 1/1, E2E 47/47. Configuration-only work does not claim a new application-suite run.

## Privacy and paid-call scope

Read-only preflight and post-update checks confirm Nova Lite ACTIVE and no model invocation logging configuration. Account retention remains `inherit`; the actual [AWS logging](https://docs.aws.amazon.com/bedrock/latest/userguide/model-invocation-logging.html) and [retention](https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html) settings were reviewed. Disabled invocation logging is not a zero-retention guarantee. No account-wide retention setting was changed. Use synthetic inputs.

The existing reviewed adapter uses regional Nova Lite, forced data-only tool output, temperature 0, maximum 2,048 output tokens, one SDK attempt, bounded queues/deadlines and strict application validation. Activation enables paid requests for registered participants; eight is the smoke authorization limit, not a global billing cap. Subsequent approved staging use incurs model charges. AI output cannot confirm frames, grant permissions or approve proposals on behalf of participants.

## Observed post-activation checks

- **HTTP 6/6**, plus direct deployed-Lambda mock identity **401**. Signed-out/invalid-bearer creation denied; exact-origin CORS/preflight works and unrelated origin has no usable CORS.
- **Actual Cognito PKCE/browser and API smoke:** pre-existing agent-owned QA display gets public **200**, null viewer, strict public payload and no private controls; owner/foreign-room **404**, commands **403**, new creation **403**. Unbound participant room/owner/write/foreign-room **404**, creation **403**. Both tampered tokens **401**, access token lifetime 900 seconds, browser errors 0, sign-out clears session storage. These denials precede provider invocation and make no paid model request.
- **CloudWatch:** 82/82 platform events, zero tested secret/private markers, including actual temporary QA passwords/tokens. Dedicated QA users globally signed out/disabled and local passwords/tokens removed. Previously issued offline JWTs remain bounded by their remaining 15-minute lifetime; immediate revocation is not claimed.
- **Observed initial positive-path smoke:** the user ran the script in their own signed-in participant session. Both Christmas and Shared Purchase returned **422 / NEEDS_CLARIFICATION**, attempts 2, with neither decision created. This reaches the reviewed model architecture path, which rejects nonempty clarification questions before a creation transaction. It is actual managed provider-path evidence, not a successful scenario. The default brief objectives did not produce a usable frame; no clarification questions are exposed by the current creation error response.
- **Historical retry preparation:** an opened local `participant-ai-smoke.js` lets the human use their own participant session to create Christmas/Purchase draft decisions and read back saved public/own snapshots. It prints only sanitized JSON, stores public request envelopes for replay across reload, caps creation/replay HTTP attempts at eight, and never confirms a frame or grants consent/approval. The operator did not invoke a paid model directly or access a human token. The updated script carries forward the two attempts and specifies complete public draft scope; six requests remain within the approval. No endpoint success or paid-provider qualification is inferred from AWS activation or local scripted tests.

## Evidence and remaining qualification

Protected local artifacts: `/tmp/ke14-ai-activation-fb9d466`. Public-summary hashes:

- `nova-policy.json`: SHA-256 `23a695b4d013519a1a11021a747207ae9654781842e3c8d9a1e50235e6d06057`.
- `policy-simulation.json`: SHA-256 `6c7578be107d821a9e24bc04bfc003bb0e302978e3f0101af1ac1bbf890189d8`.
- `effective-role-simulation.json`: SHA-256 `cee1f83d2dd1feadbc3f85d9b69b586a7f58f4878c586a7e951c405376dc6a03`.
- `activation-verified.json`: SHA-256 `bc8316d7e499c5b9be81659bd08ed4e89ce9880b66e7c7e1f1bd7e5eb6eea201`.
- `privacy-preflight.json`: SHA-256 `619ac3cd5488a1baed7616d3aa5bf11096693f162fa618cd208bea42bbf48499`.
- `http-smoke-results.json`: SHA-256 `d2a61f9b228a9423412319d5fb0853b86bc6f5b3bbe4b00a259b428fc834cc37`.
- `browser-results.json`: SHA-256 `fd6bf39c79f2c8a3a6f1b83abf10fcfa9c53423e01fea937ad56ea5fa87bc5e8`.
- `log-scan-results.json`: SHA-256 `826de8f6ec6a1e76799738f4366acec41f5b993fb641bebc716a3f418d516f3c`.

Next: capture the clarified-objective retry and participant-owned positive creation/read/reload replay results on this artifact, then complete the ticket's full Christmas and Purchase paths: each participant joins and reviews/confirms their own current frame, private drafts/conditions, refusal/revision/staleness, safe candidate explanations and exact unanimous approval. The registered accounts currently awaiting password setup must be completed by their owners; this checkpoint does not impersonate them. KE15 stays BLOCKED. No booking/purchase, external message, data migration or Stage 0 modification occurred. Model disablement via the same guarded environment update is the safe first rollback; new creation receipts need the current compatible codec.


## Completed positive smoke and page reload — 2026-09-29

- v2 Christmas creation/public/own reads **200**, six public variables/five approvers, no private field markers and no automatic consent; Purchase **422 INVALID_COMMAND**.
- v3 exact public Purchase schema yielded **200** for both decisions and both public/own reads; Christmas replayed its original receipt, Purchase created with four public variables/three approvers.
- After reload, identical v3 bodies returned **200** for the same two decision IDs, same persisted context and all public/own reads, no private field markers or automatic consent. Counter **8**; no further smoke request. Existing server replay lookup precedes every model call. This proves live draft creation and durable replay, not consent or agreement.
- Independent transaction readbacks: state v6, creator-bound body receipts present, exact directory membership, only creator active, zero frame/private-condition confirmations and no proposal. Purchase has seven full definition variables, including three owner-private contribution variables omitted from its four-variable public frame. No state was manually inserted or modified.
- Source and deployed ZIP/guards still match the reviewed original activation; new local adapter correction is not deployed. Post-model log scan had 197 platform events and zero tested private/subject markers (later final scan recorded separately below).

Protected sanitized result files: `participant-second-result.json`, `participant-third-result.json`, `participant-reload-result.json`, `christmas-dynamo-readback.json`, `purchase-dynamo-readback.json` and `post-model-log-scan.json`, under the original activation artifact directory. Hashes:

- `participant-second-result.json`: SHA-256 `6fbc5fa22a7c67dc432f099bb2dbca4153fff75b0a4759d4041d67e224712efb`.
- `participant-third-result.json`: SHA-256 `ece928090863e9d0b4f8d27a6dda821b59478c05b0af716504aee97bf233fa2b`.
- `participant-reload-result.json`: SHA-256 `01db61aae5d00e9e0519fc7357ddb9c5744f85a4d81c93c08034a6641c3c1e04`.
- `christmas-dynamo-readback.json`: SHA-256 `b1c2a640bb28b19fcdb2080e5b5b7cc7f1e4f39e7d29fd69f6e757fc5e8ee869`.
- `purchase-dynamo-readback.json`: SHA-256 `62f7bf1b4375e41d5a25255ce7a23bd5de5c958d9d510da18582b815f90cd61e`.

Next is the existing independent review of the exact [model correction artifact](ke14-live-model-correction.md), then integration/deployment of approved changes and the full ticket qualification. Each participant still needs their own join, current frame/condition confirmation, refusal/revision/stale checks, scoped consent and exact proposal approval. No live owner-interpretation/negotiation success or unanimous agreement is claimed.

Final post-reload privacy scan: **197/197 platform events, zero tested private/registered-subject markers**. `post-model-log-scan.json` SHA-256 `9db87ae672072afb238e2a7b2bc2477b149344fcd43e187495e97502152f80a0`. Invocation logging/retention and guarded Lambda configuration readback remain unchanged; no raw model response was logged or collected.
