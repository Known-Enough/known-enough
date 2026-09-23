# B04 production adapter design — pending B04.5 follow-up

This is a local design proposal for B04. No AWS resources have been created and no cloud behavior is claimed as verified. B04.5 returned CHANGES_REQUESTED on the first design/slice; this revision addresses R1–R3 for follow-up review. Do not expand the DynamoDB adapter until that review clears this design.

## Identity boundary

- The production HTTP handler accepts only an `Authorization: Bearer` access token. `aws-jwt-verify` checks the configured Cognito user-pool issuer, signing key/signature, expiry, `token_use=access`, and one of two configured app client IDs. Missing, malformed, expired, wrong-pool, wrong-client, ID-token, and tampered tokens fail closed as 401 without logging token contents or verifier details.
- A participant app-client token maps only its verified Cognito `sub` to a participant principal. The application checks that subject against current room membership before reading owner state or returning a replay result. Client input never selects an owner or subject.
- A separate display app client maps to a read-only display principal only when the signed `cognito:groups` claim contains exactly one `deal-table-display-<roomId>` group. Group membership is an administrator-managed entitlement; the display client must not allow public sign-up or client-side group assignment. No display principal can read `/me` or write commands.
- Group removal cannot revoke an already issued self-contained access token. Before live use, configure a short access-token lifetime (proposed maximum 15 minutes), document that revocation delay, and verify it against the deployed user-pool configuration. G02 must review this bound. No user-pool configuration exists yet.
- The local `NON_PRODUCTION` header identity handler remains loopback-only and refuses to start when `NODE_ENV=production`. It is not used as a fallback by the Cognito handler.

## Persistence and transaction design

Use one DynamoDB table. Each room has `PK=ROOM#<roomId>`; `SK=STATE` stores the bounded private room state and `SK=GUARD` stores the monotonically increasing repository commit version and replay counters. Replay receipts use `SK=REPLAY#<sha256(replay-key)>` and are separate items so command traffic cannot grow STATE. No public browser imports or reads these rows.

- Read STATE and GUARD together with `TransactGetItems`. For a command, include only its matching REPLAY item in that transactional read; do not query or hydrate every room replay. Extend the repository transaction options with an optional replay-key hash and a safety-action candidate. For a request, derive a candidate only from the already verified principal plus raw string room/type/idempotency fields; the application later validates the envelope and recomputes the key after current membership authorization. The adapter may read that one matching receipt in the transaction but must not return it until the application callback has authorized against current room membership. A malformed or unauthorized request never learns whether a candidate row exists. It supplies the application transition a transient `RoomRecord` with zero or one matching receipt, rather than loading the whole replay history. For a changed transition, `TransactWriteItems` replaces STATE, conditionally increments GUARD at its observed version, and conditionally inserts that one REPLAY item. Creation conditionally inserts STATE and GUARD together. All room writers follow this guard discipline.
- Store only SHA-256 hashes of the canonical replay identity and canonical command body, plus the strict `CommandResult`; do not persist participant subjects or full private command bodies in replay records. The replay key digest binds principal kind, verified subject, room, command type and idempotency key. Authorization and current membership checks still happen before the receipt is returned. A body hash mismatch for the same key remains `IDEMPOTENCY_CONFLICT`.
- Replay receipts have no TTL and are never silently pruned. Per room, admit at most 4,096 ordinary new idempotency keys plus a reserved maximum of 320 successful safety actions (`REVOKE_EXCEPTION`, `REVOKE_DISCLOSURE`, or `WITHDRAW_APPROVAL`). Until the ordinary allowance is exhausted, every command receipt—including a safety-action receipt—uses that ordinary count. The reserved allowance therefore only needs to cover the possible 192 still-active permission grants (32 exception and 32 disclosure grants for each of three owners), up to 64 completed-agreement withdrawals, and one partially approved current proposal. Existing keys always replay. Once the ordinary allowance is reached, a new ordinary key returns a redacted retryable 503 without running or committing its transition. A safety command may consume its reserved slot only when it performs the requested safe state change; a rejected safety attempt at that point also returns retryable 503 without consuming the key. No request is reported as successfully applied without its receipt.
- Bound retained state histories before appending: at most 32 exception grants and 32 disclosure grants per owner, 64 immutable agreement receipts per room, and 32 published disclosure receipts per room. Reaching a history cap returns `ROOM_CAPACITY_REACHED` before the append; existing evidence is retained. Revocation, approval withdrawal, and application-clock expiry remain available at history capacity. Published words remain public once published, even if the grant is later revoked. Consent expiry continues to use application-clock checks; DynamoDB TTL is not used for authorization, expiry or revocation.
- Encode STATE as a strict envelope `{schemaVersion: 2, roomId, record}` with the `replays` property removed from `record`; GUARD and REPLAY rows use their own explicit versions. Validate `roomId` against both the envelope and partition key. Decode STATE as a schema-versioned JSON payload. Its DynamoDB item size must be measured conservatively before commit: normal state transitions are limited to 352 KiB and valid safety/expiry/withdrawal updates to a hard 360 KiB, below DynamoDB's 400 KB item maximum. If a normal write reaches its ceiling, return retryable 503 without consuming the idempotency key so it can be retried after a revocation or expiry shrinks the state. Replay items are limited to 8 KiB each. The state ceiling includes key names and encoded payload bytes; no oversized write is truncated or partially committed.
- Decode private STATE with a strict allowlist schema: validate every nested contract/private field, reject extra or malformed fields, require the record's roomId to equal the `ROOM#...` partition key, and validate the exact STATE/GUARD sort keys. Missing STATE and GUARD, only one of the pair, a mismatched key/room, malformed JSON, or an unsupported schema version fails closed as a redacted retryable server error. Room creation is allowed only when both items are absent. Do not auto-migrate unknown or older versions during requests; use an explicit reviewed migration that preserves every consent/agreement receipt.
- On conditional/transaction conflicts, reload and rerun the application transition with bounded retries and jitter. The solver runs outside the repository transaction; transition callbacks perform no external I/O. Retried callbacks may consume unused opaque IDs and bounded synchronous concession solving, but only committed results are returned. Exhaustion maps to the same retryable 503 path, never `422 INVALID_COMMAND` or a fabricated stale success. Expected-version mismatches remain semantic `STALE_CONTEXT` results; do not rewrite their versions.

## Runtime IAM boundary

The proposed adapter uses `TransactGetItems` for room reads, and `TransactWriteItems` with `Put` for STATE/replay/creation and `Update` for GUARD. The underlying item actions are therefore only `dynamodb:GetItem`, `dynamodb:PutItem` and `dynamodb:UpdateItem`; no `DeleteItem`, `ConditionCheckItem`, `Query`, `Scan` or table-management action is used by this design.

The following policy is a review example, not a deployed policy. Replace the placeholders with the one exact table ARN and confirm the final adapter action set before implementation:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "RoomTransactionsOnly",
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem"
      ],
      "Resource": "arn:aws:dynamodb:REGION:ACCOUNT_ID:table/DealTableRooms",
      "Condition": {
        "ForAnyValue:StringEquals": {
          "dynamodb:EnclosingOperation": [
            "TransactGetItems",
            "TransactWriteItems"
          ]
        },
        "ForAllValues:StringLike": {
          "dynamodb:LeadingKeys": [
            "ROOM#*"
          ]
        }
      }
    }
  ]
}
```

The transaction authorization follows AWS's underlying item-action rules and `dynamodb:EnclosingOperation` examples: [IAM for DynamoDB transactions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis-iam.html). `dynamodb:LeadingKeys` must use a `ForAllValues` modifier; `StringLike` supplies the `ROOM#*` prefix match: [DynamoDB condition keys](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/specifying-conditions.html).

Policy outcomes to verify against the final adapter (no IAM simulation has been run): the listed actions on the one table and `ROOM#*` keys are allowed only when enclosed by the two transaction APIs; direct `GetItem`/`PutItem`/`UpdateItem` calls are denied by the missing `EnclosingOperation`; any other table is denied by the exact Resource ARN; keys outside `ROOM#*` are denied by the leading-key condition. These are implicit denies because the policy grants no other access. The prefix is a storage namespace boundary, not a caller membership check; verified application authorization remains mandatory.

JWKS retrieval uses Cognito's public HTTPS JWKS endpoint and requires no Cognito API permissions. The display group is provisioned by a trusted administrator/control plane outside the request role. No IAM policy has been written or deployed.

## Evidence state

The current B04 slice has local signature and HTTP tests. Follow-up review must inspect the corrected production verifier tests, error path, history limits and proposed transaction/IAM policy before a DynamoDB adapter is added. The adapter, race tests, codec tests (including near-limit size, revocation at capacity, duplicate replay and malformed/mismatched rows), IAM policy, user-pool setup, and live cloud acceptance remain unimplemented. No cloud credentials or deployment have been used.
