# @deal-table/application

B02 implements the local TeamTable command lifecycle using the B01 solver and a transactional repository port. Never import this server package into the browser.

```ts
import { DealTableApplication } from '@deal-table/application';
import { InMemoryRoomRepository } from '@deal-table/adapters';

const app = new DealTableApplication({
  repository: new InMemoryRoomRepository(),
  clock: { now: () => new Date().toISOString() },
  ids: { next: () => crypto.randomUUID() },
});
```

The trusted composition root calls `createRoom({roomId, schedule, roster, policy, organizerSubject, memberships})`. Each membership maps an authenticated subject to one public member ID. `TrustedPrincipal` is supplied by a trusted identity adapter; accepting this object from a browser would bypass authentication. B02 has no credential verifier or HTTP endpoint. Tests use explicitly synthetic principals.

- `execute(principal, envelope)` validates and applies all twelve contract commands, returning safe `CommandResult` values. Authentication and current role/membership checks precede command validation and replay lookup. Schema-valid authorized successes and state failures bind their idempotency key to the accepted body (except transport requestId); failed transitions are rolled back. Changed bodies conflict, and revoked access cannot retrieve a cached result.
- `getPublicSnapshot(principal, roomId)` builds a separate allowlisted view. It never exposes private conditions, costs, grant IDs, offers or refusal details. Current-context published receipts are restricted to their audience; a standalone organizer cannot read roster-only disclosure text. Old-context receipts remain in server history, not the active public projection.
- `getOwnerSnapshot(principal, roomId)` resolves the owner from stored membership. It accepts no caller-selected owner ID. Returned values are detached from stored state.
- `pendingSolveJob(service, roomId)` returns only the pending job ID and room ID. `runSolveJob(service, roomId, jobId)` executes directly, with context/epoch checks before and after asynchronous solving. Duplicate or stale work cannot republish a result. This local job interface is not an SQS worker.
- `closeRoom(organizer, roomId, expected)` is a local lifecycle method with the same version guard. Closed rooms reject new mutations.

Owners submit a draft, then CONFIRM_INPUTS with explicit reviewedIntervals. Every confirmed input change creates a new semantic context and invalidates old permissions, approvals and jobs. Owners then ACCEPT_CONTEXT to explicitly reconfirm both the current public setup and their displayed preserved input values/coverage. This fresh action rebinds unchanged evidence without another semantic revision, allowing sequential owner confirmations to converge. A schedule edit discards old confirmation/coverage and requires explicit new review. Coverage is never automatically filled from the schedule.

Once all owners confirm, REQUEST_SOLVE queues a bounded local solve. The finite concession search considers only invited negotiable conditions and proposes a proven feasible scope; hard conditions are immutable. There is one concession round per context. Allowing an exception queues recomputation after all offers are decided. Disclosure refusal leaves the exception and proposal usable. Every participant must separately approve the exact proposal ID/version/hash. Finalization rechecks required grant versions and expiry inside the same serialized transaction used by revocation. Withdrawal or permission expiry removes active agreement; internal agreement history remains.

The clock and ID source are explicit dependencies. Production IDs must be unpredictable valid opaque IDs; tests intentionally use deterministic IDs. Default permission and proposal lifetimes are fifteen minutes and are configurable. Expiry is checked in application transitions and reads, including immediately after asynchronous hashing before publication/finalization. No reliance on storage TTL.

Roster edits can remove access, but cannot manufacture authenticated bindings for new public names. Trusted membership provisioning, real authentication, HTTP, durable storage and distributed transaction verification are subsequent tasks. In-memory tests establish only local process behavior.

Run `npm test -- packages/application tests/integration` for the synthetic real-solver lifecycle and transaction tests. Run `npm run check` for the integrated repository check.
