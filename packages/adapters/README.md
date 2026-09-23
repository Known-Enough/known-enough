# @deal-table/adapters

This server-only package implements the application `RoomRepository` port. Never import it into the browser.

## In-memory repository

`InMemoryRoomRepository` is local process-only. Each room has a serialized transaction queue. A transition receives a clone; successful completion atomically replaces stored state and returns a detached value. A thrown error discards the working copy. Duplicate creation is rejected; different rooms are independent. State is lost on restart and is not coordinated across processes.

## DynamoDB repository

`DynamoDBRoomRepository` stores one room aggregate per DynamoDB item in a table with string partition and sort keys named `PK` and `SK`. Keys are `ROOM#<roomId>` and `STATE`. The item has a private monotonic `storageVersion` and the private application `record`. Create is conditional; transactions use a strongly consistent read followed by a conditional full-item replace on the read storage version, with bounded retries after conflicts. This keeps each room transition and its replay result in one atomic item. The storage fence is separate from public decision/control versions.

The transition callback can run again after a concurrent write. It must not perform external side effects; send messages, jobs, and network actions only after the application transaction commits. Conditional retries are bounded and a highly contended room may return `ConcurrentRoomUpdateError` to its caller.

A DynamoDB item cannot exceed 400 KB. Since the full room record, retained agreement history, and replay results share one item, growth can eventually exceed that hard service limit; this layout is only suitable while each room remains below it. DynamoDB TTL is not used for authorization or expiry: application reads/transitions enforce logical expiration. Do not expose `transaction` as a client API, log stored records, or spread private records into public snapshots.

`dynamodb-room-repository.test.ts` simulates conditional writes for fast unit coverage. `dynamodb-room-repository.local.test.ts` exercises the actual SDK against DynamoDB Local only when `DYNAMODB_LOCAL_ENDPOINT` is explicitly set, and accepts only an HTTP root on loopback. DynamoDB Local helps test adapter behavior but does not establish managed-service races, IAM, production configuration, or deployment safety.
