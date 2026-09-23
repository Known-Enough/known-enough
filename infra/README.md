# B04 production adapter design — pending B04.5 follow-up

This is a local design proposal for B04. No AWS resources have been created and no cloud behavior is claimed as verified. B04.5 returned CHANGES_REQUESTED on the first design/slice; the prior revision addressed R1/R3/R4, and this follow-up addresses R2a/R2b/R5. Do not expand the DynamoDB adapter until independent review clears.

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
- Replay receipts have no TTL and are never silently pruned. Per room, admit at most 4,096 ordinary new receipts, plus up to 192 permission-decision receipts and 320 successful safety-action receipts in reserved capacity. The permission bound is three owners times 32 exception-history entries plus 32 disclosure-history entries. Maintain separate GUARD counters for ordinary receipts, committed permission decisions, and successful safety actions. A permission decision receipt counts against the 192 lifetime permission bound whether it used ordinary or reserved capacity, so the reserved portion is only the remaining bound after ordinary traffic. Keep safety-action accounting separate; the current 320 ceiling is a proposed hard maximum, not evidence that every possible withdrawal pattern fits. The maximum REPLAY rows are 4,608 per room. Existing authorized keys always replay before quota evaluation.
- First authorize the current principal against STATE and validate the request before returning any quota result. Once ordinary capacity is reached, a deterministic admission rejection returns ROOM_CAPACITY_REACHED (HTTP 409) without committing a mutation, adding a REPLAY row, or incrementing a counter. The same unchanged key may be reevaluated after capacity changes; the client may issue a separate safety or consent command immediately. Do not spend permission or safety reserves on ordinary traffic. At ordinary capacity, a valid pending DECIDE_EXCEPTION or DECIDE_DISCLOSURE may consume one remaining permission slot only when the transition appends its bounded history record; a successful REVOKE_EXCEPTION, REVOKE_DISCLOSURE, or WITHDRAW_APPROVAL may consume a safety slot only when it commits that safe state change. An invalid, stale, or unsuccessful attempt consumes no reserved slot. If the matching reserve or encoded-size ceiling is exhausted, return known-no-commit ROOM_CAPACITY_REACHED (409) with no receipt/counter/state write. Application-level capacity results that are durably recorded under available quota remain ordinary semantic results with replay receipts. Keep 503 RETRYABLE_SERVER_ERROR for transient failures, exhausted transaction conflicts, storage outages, or uncertain commit outcomes; the client retains the exact envelope only for those uncertain outcomes. No request is reported as successfully applied without its receipt.
- Bound retained state histories before appending: at most 32 exception grants and 32 disclosure grants per owner, 64 immutable agreement receipts per room, and 32 published disclosure receipts per room. Reaching a history cap returns ROOM_CAPACITY_REACHED before the append; existing evidence is retained. Revocation, approval withdrawal, and application-clock expiry remain available at history capacity. When generating exception offers, reserve one exception-history slot per individual outstanding offer (including multiple overlapping offers for one owner), and reserve one disclosure-history slot for the owner's possible current-context preview. Do not issue any prompt unless every allowed response can be recorded. An exception decline fills its reserved exception slot and ends the round; a disclosure decline fills its reserved disclosure slot while preserving the already active exception. A disclosure preview and its later decision use the same reserved disclosure slot. These pending-response reservations are also bounded by the remaining permission-decision receipt allowance. Published words remain public once published, even if the grant is later revoked. Consent expiry continues to use application-clock checks; DynamoDB TTL is not used for authorization, expiry or revocation.
- Encode STATE as a strict envelope `{schemaVersion: 2, roomId, record}` with the `replays` property removed from `record`; GUARD and REPLAY rows use their own explicit versions. Validate `roomId` against both the envelope and partition key. Decode STATE as a schema-versioned JSON payload. Its DynamoDB item size must be measured conservatively before commit: normal state transitions are limited to 352 KiB and valid safety/expiry/withdrawal updates to a hard 360 KiB, below DynamoDB's 400 KB item maximum. If a normal write reaches its ceiling, return known-no-commit ROOM_CAPACITY_REACHED (409) without consuming the idempotency key, receipt, or counter; the unchanged key can be reevaluated after a revocation or expiry shrinks the state, and the client can submit a reserved safety action immediately. If a safety/expiry write exceeds the hard 360 KiB ceiling, return the same known-no-commit result without spending the safety reserve. Replay items are limited to 8 KiB each; deterministic item-size rejection also returns 409 without a receipt. The state ceiling includes key names and encoded payload bytes; no oversized write is truncated or partially committed. Use retryable 503 only when the commit outcome is transient or uncertain.
- Decode private STATE with a strict allowlist schema: validate every nested contract/private field, reject extra or malformed fields, require the record's roomId to equal the ROOM#... partition key, and validate the exact STATE/GUARD sort keys. If both STATE and GUARD are absent, return null to the authorized application transition and do not surface a matching orphan REPLAY row; the existing application then returns the same non-enumerating 404 NOT_FOUND used for an existing room outside the caller's scope. A matching orphan replay receipt never authorizes access. Never reuse room IDs; if trusted creation cannot guarantee non-reuse, quarantine an absent pair with orphan rows rather than binding old replay data to a new room. Exactly one missing primary row, a mismatched key/room, malformed JSON, or an unsupported schema version fails closed as a redacted retryable server error. Room creation is allowed only when both primary items are absent and uses conditional puts. Do not auto-migrate unknown or older versions during requests; use an explicit reviewed migration that preserves every consent/agreement receipt.
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

The current B04 slice has local signature and HTTP tests. The pending B04.5 follow-up must inspect the known-no-commit capacity outcomes, absent STATE/GUARD semantics, pending decision/history reservations, production verifier tests, and proposed transaction/IAM policy before a DynamoDB adapter is added. The adapter, race tests, codec tests (including near-limit size, revocation at capacity, duplicate replay and malformed/mismatched rows), IAM policy, user-pool setup, and live cloud acceptance remain unimplemented. No cloud credentials or deployment have been used.
