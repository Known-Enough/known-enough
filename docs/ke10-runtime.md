# KE10 — bounded model runtime

## Implementation and limits

The server composition is [createKnownEnoughModelRuntime](../apps/api/src/model-runtime.ts). Pass its `architect`, `ownerConversation` and `negotiator` services to the existing Known Enough API handler options. The handlers continue to resolve identity before invoking a model. The existing fictional loopback app retains its injected deterministic models; no environment variable silently connects it to AWS. Live composition requires explicit paid-call authorization and operator attestations about invocation logging and retention. These flags are not proof of AWS settings or independent review.

This checkpoint provides a process-local asynchronous queue and actual Bedrock SDK adapter. It creates no AWS resources, distributed queue, deployed worker, authenticated cloud session or durable job store. The worker delivery entrypoint accepts only `{jobId}` and resolves an opaque capability in the same runtime process. A restart discards unfinished jobs; the user resubmits. A later distributed transport must resolve authorized records, enforce durable leases and retain the same transaction guards; this process-local queue must not be presented as a cross-process lease. KE13B owns deployed backend/IAM integration.

| Role | Model context | Output authority |
| --- | --- | --- |
| Architect | Objective, participant display data and allowed options | Validated public draft; current actor/draft generation and deadline checked before return. No persistence or confirmation. |
| Owner | Public frame, authenticated owner's structured variables/conditions/draft and bounded active conversation | Structured private draft only. No confirmation, grant or approval. Owner/context/draft/control versions and membership checked before inference and inside the storage transaction. |
| Negotiation | Trusted structured constraints, definition, active permission references and public-only candidate catalog | Existing kernel validates the candidate. Commit checks current member, context, control version, job ID/epoch, dependencies and expiry. Questions still pass the KE09 same-owner public-enum boundary. |
| Public explanation | Existing public projection | Deterministic public-value formatter; no model receives private context to write a public explanation. |

Every provider request has a fresh system prompt and one input message. There are no tools, shared history store, prompt resource IDs, request metadata or prompt-cache markers. Provider output cannot supply authorization. The adapter accepts only a complete assistant text response containing one JSON object; application schemas and deterministic validation remain mandatory. Nova Lite does not provide structured-output enforcement, so invalid shapes fail closed. See the [official model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-lite.html).

## Bounds and failure behavior

| Control | Default / hard bound |
| --- | --- |
| Configuration | `amazon.nova-lite-v1:0`, `us-east-1`, standard Converse, temperature 0 |
| Provider attempt | SDK `maxAttempts: 1`; no hidden SDK retry |
| Architect / owner | One call; no automatic replay of raw owner turns |
| Negotiation | At most two calls (one repair); only structured context reused, no prior model prose |
| Output | 2,048 requested tokens, 32,768 UTF-8 bytes accepted |
| Input | 65,536 UTF-8 bytes including system prompt; this is a byte limit, not a measured tokenizer count |
| Queue | At most 32 admitted entries by default; configurable maximum 64; conservative accounting includes unsettled transports |
| Concurrency | Two provider tasks per runtime, configurable 1–4 |
| Queue plus provider deadline | 8 seconds per attempt by default, configurable 100 ms–30 seconds; waiting consumes the same budget |
| Application result lifetime | 30 seconds; checked again in the output transaction / architect return |
| Retained metadata | Queue envelope is opaque job ID only; emitted metrics contain role/outcome/duration or role/token counts only |

`runtime.stop()` is asynchronous: callers must await it. It permanently closes model-job admission, rejects outstanding queue callers, aborts transports and waits for output-persistence transactions already in flight. A transaction already submitted to storage may finish before `stop()` resolves; no tracked model-result write can commit after it resolves. The runtime enablement check also runs before architect return, inside owner and proposal output transactions, and inside owner-question transactions. If stop or authority change occurs after a candidate needs permission and no question was issued, an exact candidate guard releases it when that candidate is still current, returning the decision to readiness. Previously issued owner questions remain bound to their original context; stop does not roll back a committed result. Disabling inference never invents an answer or consent: the application returns its existing coarse error/clarification path and cancels only the exact failed reasoning job. A timed-out transport retains its concurrency slot until it settles, so a provider ignoring abort cannot cause unlimited replacement calls. A hung transport can reduce capacity until the process restarts.

Raw turns stay in bounded transient request/closure memory; queue entries are not serialized and no retry/DLQ/log/metric receives those turns. Timers remove queued references on expiry; completion/cancellation removes entries and listeners. JavaScript garbage collection and an uncooperative transport do not promise immediate physical erasure. The SDK request exists until its transport settles. There is no application raw-turn backup. Structured drafts and confirmed conditions retain the existing bounded decision lifecycle. Provider retention is a separate boundary.

Conservative control-version checks discard results after any decision control change, including an unrelated owner's update. A question also checks the control version reached after candidate validation, including each newly issued question. A user may need to resubmit. This sacrifices availability to avoid applying a result prepared under changed authority.

## Official capability verification — 2026-09-28

The [Nova Lite model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-lite.html) identifies `amazon.nova-lite-v1:0`, text/Converse support and regional availability. The [official Nova Converse example](https://docs.aws.amazon.com/nova/latest/userguide/code-examples-converse.html) uses this model with `us-east-1`. This implementation uses the direct regional model ID, not a cross-region inference profile. The [Converse reference](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html) documents messages, system instructions, inference parameters, output and usage. The selected SDK is pinned at `@aws-sdk/client-bedrock-runtime@3.1135.0`.

These are documentation checks, not account access, quota, latency, quality or billing evidence. Before paid use, verify that the account can invoke this exact model/region and recheck lifecycle/availability. Do not substitute another region/model or enable cross-region inference silently.

[Invocation logging](https://docs.aws.amazon.com/bedrock/latest/userguide/model-invocation-logging.html) can collect request/response content in AWS logging destinations; private workloads require verified disabled payload logging. Review the applicable [retention policy](https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html), model terms and account configuration before enabling the transport. Do not infer zero retention from the absence of app persistence, or assume project/Mantle controls apply to this Converse endpoint. The subsequent read-only AWS account/configuration results are recorded in the [KE10 ticket](tasks/KE10.md); no settings or permissions were changed.

The current `known-enough-staging-ro` profile is assigned `ReadOnlyAccess` and is only for checks. To run the KE10 Converse evaluation, a separate assigned role needs `bedrock:InvokeModel` scoped to `arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-lite-v1:0`. Keep using synthetic fixtures. Do not grant or invoke until the focused stop/commit follow-up passes and the user separately authorizes the paid call.

## Reusable evaluations

[Evaluation harness](../tests/evaluations/ke10.ts) runs the same construction, kernel-backed proposal, owner extraction-without-consent and privacy cases against a supplied Converse transport. [Injected responses](../tests/evaluations/ke10-injected.ts) are synthetic evaluation fixtures only. Permanent tests also cover strict envelopes, duplicated deliveries, concurrency/capacity, timeout, abort, kill switch including post-provider transactions, stale authority before/after inference and between candidate completion and question creation, raw-error redaction, malformed/truncated/tool output, input/output bounds, owner draft races, atomic expiry/control/membership checks, exact-job cleanup and two-call repair limits. Provider output errors map to a retryable server response.

The [live entrypoint](../tests/evaluations/ke10-live.ts) refuses to run unless all three explicit opt-ins are `yes`: `KE10_PAID_SMOKE_APPROVED`, `KE10_INVOCATION_LOGGING_DISABLED`, `KE10_RETENTION_REVIEWED`. Setting these variables does not grant permission; obtain separate user authorization and document the account/privacy checks first. Then run using pinned Node:

```sh
node --experimental-transform-types tests/evaluations/ke10-live.ts
```

Only synthetic fixtures are sent. A complete run makes three calls normally, at most four with one negotiation repair; each call has the bounds above. The maximum requested output allowance is 8,192 tokens across four calls. No cost or input token measurement is claimed in advance. The entrypoint emits configuration, passed case names and measured token counts on success; errors emit a fixed failure code, never model/provider text. Live failure is not converted into a mock PASS.

## Remaining gates

KE10 cannot be DONE on injected evidence. The stop/commit fix and delayed-storage regression are now checked locally. Required next evidence is the named focused independent follow-up on this changed boundary, then a separately authorized real-model evaluation with recorded account/region/model configuration and measured results. The user's exception for proceeding after KE09 self-review did not authorize paid calls or waive this release review. KE11 stays blocked. No deployment, cloud resource, external message or live acceptance is implied by a repository push.
