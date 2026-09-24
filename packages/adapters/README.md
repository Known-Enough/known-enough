# @deal-table/adapters

This server-only package must never be imported by the browser. Both repositories are trusted storage infrastructure, not authorized client APIs. Call the application to enforce membership, room scope, versions, and permissions; do not expose repository methods or log stored records.

## In-memory repository

`InMemoryRoomRepository` implements the application port for local development. It serializes callbacks per room, clones state before transitions, commits on successful completion, and discards a working copy when a callback throws. State is lost on process restart; it provides no cross-process transaction or durability guarantee.

## DynamoDB repository

`DynamoDBRoomRepository` accepts a low-level AWS SDK `DynamoDBClient` and one table. Room state uses `PK=ROOM#<roomId>, SK=STATE`; a separate `GUARD` row contains the monotonically increasing storage version and receipt counters; a candidate idempotency key is read from its `REPLAY#<hash>` row only after the application has authorized the current principal. Reads use `TransactGetItems`; changed transitions atomically condition the STATE replacement, GUARD update, and any new replay receipt in `TransactWriteItems`. Recognized conflicts and throttles use bounded retries; unknown outcomes fail with a redacted retryable server error.

The strict versioned codec validates private STATE/GUARD/REPLAY keys and payloads. Roster revisions preserve departed owners’ exception grants and disclosure decision metadata in a private archive, retain lifetime permission-history counters, and omit unshared wording, drafts, and confirmations. Replay rows contain hashes, incarnation, and a strict command result. Ordinary, permission-history, safety-reserve, and total receipt counts are guarded with every write. Pending exception/disclosure decisions reserve history slots and worst-case encoded STATE capacity, including the full possible exception ALLOW → disclosure preview → disclosure decision path. No TTL is used for consent or replay retention.

`tests/integration/dynamodb-repository.test.ts` exercises SDK transaction commands against a deterministic local transactional fake. `dynamodb.local.test.ts` uses the actual SDK against DynamoDB Local only when `DYNAMODB_LOCAL_ENDPOINT` is explicitly set, and accepts only an HTTP root on loopback. The emulator test checks duplicate creation and concurrent STATE/GUARD transactions. This helps test adapter behavior but does not establish managed-service races, IAM, production configuration, or deployment safety. The adapter does not create tables, configure IAM/Cognito, or establish live cloud behavior; B04 remains subject to independent code review, human acceptance, and G02/live gates.
