# B02 application integration

Run `npm test -- tests/integration` with the pinned Node/npm runtime. These tests drive the real application, in-memory repository and B01 solver through public methods with synthetic identities and an injected clock. They cover negotiation, independent permissions, owner/public boundaries, exact approvals, replay, expiry, semantic changes and competing mutations. `npm run check` includes this directory.

Trusted principals in these tests are supplied by the test composition root; they are not authentication. No HTTP, Cognito, DynamoDB or cloud tests are claimed.

B04's Cognito adapter tests sign synthetic access tokens with a generated RSA
key and verify them with the real `aws-jwt-verify` implementation against a
local JWKS cache. They check signature/issuer/client/token-use/expiry and the
participant/display principal mapping. This is local cryptographic evidence,
not a live Cognito user-pool, group-administration, or key-rotation check.
