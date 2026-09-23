# B04 production adapter design — pending independent review

This is a design proposal for B04. No AWS resources have been created and no cloud behavior is claimed as verified.

## Identity boundary

- The production HTTP handler accepts only an `Authorization: Bearer` access token. `aws-jwt-verify` checks the Cognito user pool issuer, signing key/signature, expiry, `token_use=access`, and one of two configured app client IDs. Missing, malformed, expired, wrong-pool, wrong-client, ID-token, and tampered tokens fail closed as 401 without logging token contents or verifier details.
- A participant app-client token maps only its verified Cognito `sub` to a participant principal. The application still checks that subject against current room membership before reading owner state or returning a replay result. Client input never selects an owner or subject.
- A separate display app client maps to a read-only display principal only when the signed `cognito:groups` claim contains exactly one `deal-table-display-<roomId>` group. Group membership is an administrator-managed entitlement; the display client must not allow public sign-up or client-side group assignment. No display principal can read `/me` or write commands.
- Group removal cannot revoke an already issued self-contained access token. Before live use, configure a short access-token lifetime (proposed maximum 15 minutes), document that revocation delay, and verify it against the deployed user-pool configuration. G02 must review this bound. No user-pool configuration exists yet.
- The local `NON_PRODUCTION` header identity handler remains loopback-only and refuses to start when `NODE_ENV=production`. It is not used as a fallback by the Cognito handler.

## Persistence and transaction proposal

Use one DynamoDB table and two items for each room, sharing `PK=ROOM#<roomId>`: `SK=STATE` stores the complete private `RoomRecord` with a schema version; `SK=GUARD` stores the monotonically increasing repository commit version. No public browser imports or reads these rows.

- Read the state and guard together with `TransactGetItems` and consistent transactional isolation.
- For a changed transition, `TransactWriteItems` replaces `STATE` and conditionally increments `GUARD` only when its observed version still matches. The two actions address different items, so the guard protects each complete state replacement atomically. Creation conditionally inserts both items.
- On a conditional/transaction conflict, reload and rerun the application transition with bounded retries and jitter. The current application keeps solver work outside the transaction and transition callbacks perform no external I/O. Retried callbacks may consume unused opaque IDs; only the committed result is returned. Exhaustion returns a retryable server error, never a stale success.
- Replay receipts remain part of the room state. Each HTTP request resolves verified identity first, then the application reads current membership and authorizes before checking the receipt.
- Consent expiry remains enforced by the application clock and every relevant state transition. DynamoDB TTL is not used to authorize, expire, or revoke grants.
- DynamoDB imposes a 400 KB limit per item and a 4 MB transaction limit. `RoomRecord` currently contains growing replay and agreement histories with no retention cap; B04.5 must approve a safe bounded-size strategy before the adapter is implemented. Reject oversize writes explicitly; never silently drop consent or agreement evidence.

## Proposed runtime IAM boundary

The API execution role should have only `dynamodb:TransactGetItems` and `dynamodb:TransactWriteItems` on the one configured table, with `dynamodb:LeadingKeys` constrained to `ROOM#*` if confirmed compatible with the actual key shape. It receives no `Scan`, table-management, Cognito user/group administration, Bedrock, SQS, or wildcard-resource permissions in B04. JWKS retrieval uses Cognito's public HTTPS JWKS endpoint and requires no Cognito API permissions. The display group is provisioned by a trusted administrator/control plane outside the request role. No IAM policy has been written or deployed; B04.5 must review the action/resource/key conditions before infrastructure work.

## Evidence state

Local signature verification and HTTP scope tests are being added first. The DynamoDB adapter, race tests against DynamoDB Local or AWS, IAM policy, user-pool setup, and live cloud acceptance remain unimplemented. No cloud credentials or deployment have been used.
