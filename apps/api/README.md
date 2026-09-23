# @deal-table/api

The local API is a Node HTTP composition for the synthetic TeamTable room. It
remains deliberately non-production: its local handler uses fixed test labels,
an in-memory repository and no cloud deployment. It refuses to start when
`NODE_ENV=production`. B04's first slice also exports a separate authenticated
handler and Cognito access-token resolver; those do not provide durable
persistence, infrastructure, or a complete production composition.

Run it with the pinned Node runtime:

```sh
npm run dev --workspace @deal-table/api
```

It listens on `http://127.0.0.1:8787` (or a bounded `PORT` value), creates the
fictional `room-synthetic`, and runs queued local solver work internally. Do
not send service credentials over HTTP.

Every non-preflight request must use the fixed allowlisted header:

```text
X-Deal-Table-Test-Identity: NON_PRODUCTION maya
```

The built-in labels are `NON_PRODUCTION maya`, `NON_PRODUCTION leo`,
`NON_PRODUCTION nina`, `NON_PRODUCTION organizer`, and
`NON_PRODUCTION display`. They map on the server to fixed synthetic principals;
the caller cannot select a subject, role, or display room. They are test
identities only, not authentication. A composition test can inject a different
fixed `NON_PRODUCTION ...` map through `createLocalApiHandler`.

The HTTP surface is:

- `GET /rooms/:roomId/public`
- `GET /rooms/:roomId/me`
- `POST /rooms/:roomId/commands`

Commands require `Content-Type: application/json`, are limited to 64 KiB by
default, and must include the strict `CommandEnvelope` whose `roomId` equals
the path. An optional `X-Request-Id` is used only for read/error correlation;
invalid or absent values become `invalid-request`. Browser requests from the
local Vite origins may use CORS with the identity and request-ID headers.
When a command reports `QUEUED`, its local solver job finishes before the HTTP
response returns, but the result's version is the command version; refetch the
authorized snapshot before sending a dependent command.

The adapter authenticates its fixed local label and checks the route scope
before parsing a command body or reaching the application replay cache. Missing
or invalid identity is `401`; absent, cross-room, nonmember, and other-owner
resources use the same `404` error shape. Known but insufficient scopes, such
as display writes or organizer owner reads, are `403`. Command schema failures
are `422`; application stale/idempotency errors retain their contract `409` or
`422` mapping. Error bodies contain only `ok`, `requestId`, `error.code`, and
`error.httpStatus`; no message or resource diagnostic is emitted.

The library exports `createLocalApiHandler`, `createLocalApiServer`, and
`listenLocalApi` for integration tests and local composition. It also exports
`createApiHandler` for a server composition that supplies an identity resolver,
and `createCognitoIdentityResolver` / `createCognitoIdentityResolverFromEnv`.
The Cognito resolver verifies access-token signatures and required pool/client
claims before reading the signed `sub` and `cognito:groups` claims. A token with
no `deal-table:display:<room-id>` group becomes a participant principal whose
room membership is still checked by the application. Exactly one such group
creates a read-only display principal for that room; malformed or multiple
display groups fail closed. Configure the environment factory with
`COGNITO_USER_POOL_ID` and `COGNITO_CLIENT_ID`.

An authenticated handler still needs a durable repository and a secure hosting
composition before it is suitable for production. `listenLocalApi`
and the runnable entry bind loopback addresses only; `createLocalApiServer`
returns an unbound Node server, so a custom composition must also bind it only
to loopback. Never import this server package into the browser.
