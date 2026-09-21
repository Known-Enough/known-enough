# @deal-table/adapters

`InMemoryRoomRepository` implements the application `RoomRepository` port for local B02 development. Never import this server package into the browser.

Each room has a serialized transaction queue. A transition receives a cloned room; successful completion atomically replaces stored state and returns a detached value. A thrown error discards the working copy and releases the queue. Creation also uses the same per-room queue and rejects duplicate rooms. Different rooms are independent.

The repository is trusted server infrastructure, not an authorized client API. Call application methods to enforce membership, scopes, versions and permissions. Do not expose `transaction` directly to browser callers. Stored state is private and must never be logged or spread into public responses.

State is process-local and lost on restart. There is no DynamoDB, cross-process lock, credential verification or cloud deployment. B04 must independently implement and verify durable conditional transaction behavior; these tests do not establish cloud safety.
