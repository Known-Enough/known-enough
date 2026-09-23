# @deal-table/adapters

This server-only package must never be imported by the browser. Both repositories are trusted storage infrastructure, not authorized client APIs. Call the application to enforce membership, room scope, versions, and permissions; do not expose repository methods or log stored records.

## In-memory repository

InMemoryRoomRepository implements the application port for local development. It serializes callbacks per room, clones state before transitions, commits on successful completion, and discards a working copy when a callback throws. State is lost on process restart; it provides no cross-process transaction or durability guarantee.

## DynamoDB repository

DynamoDBRoomRepository accepts a low-level AWS SDK DynamoDBClient and one table name. It reads STATE, GUARD, and only the candidate REPLAY item with TransactGetItems. Changed transitions atomically write STATE, conditionally update the observed GUARD version/counters, and conditionally insert a new REPLAY receipt with TransactWriteItems. It retries bounded transaction conflicts and returns a redacted retryable error for storage failures or unknown outcomes.

The codec allowlists and validates the versioned private STATE envelope and exact STATE/GUARD/REPLAY keys. Replay rows contain only hashes, incarnation, and a strict command result. Candidate receipts are supplied to the application only after the application callback authorizes against current membership. Pending exception/disclosure decisions reserve history and encoded STATE capacity; ordinary, permission-history, safety-reserve, and total receipt counters are guarded with every write. No TTL is used for consent or replay retention.

The adapter does not create tables, configure IAM/Cognito, deploy infrastructure, or establish live cloud behavior. Its integration tests send the actual SDK transaction commands to a deterministic local transactional fake; those tests do not replace DynamoDB Local or a live account review. B04 remains subject to its B04.5 code review, human acceptance, and G02/live gates.
