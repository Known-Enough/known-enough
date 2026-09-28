# Model job worker

`createModelWorker(jobs)` accepts a strict opaque `{jobId}` delivery and uses the supplied process-local `BoundedModelJobs` runtime. The queue schedules its own bounded asynchronous processing; this entrypoint also supports duplicate delivery checks without replaying completed work. Unknown IDs have no effect. No message contains prompts, owner IDs, conditions, grant IDs or raw conversation text.

Run the worker and the transient request registry in the same process. This is not an SQS consumer or durable distributed lease; restarting drops active requests and requires resubmission. Do not serialize the registry or add a raw-input dead letter queue. The API composition and authoritative application transactions enforce context/version/epoch/expiry checks.

See [KE10 runtime operations and evidence limits](../../docs/ke10-runtime.md). Paid Bedrock calls, shared cloud deployment and independent release review remain separate gates.
