# @deal-table/domain

B01 implements the pure exhaustive TeamTable solver for three participants, three meeting choices and two duties. It has no system clock, network, AWS, model or React dependency. Never import this package into the browser.

```ts
import { solveDecision } from '@deal-table/domain';

const result = solveDecision(currentServerSnapshot);
if (result.status === 'SOLVED') {
  // Server-only result; B02 must construct a separate allowlisted public DTO.
  const selectedFacts = result.selectedPlan.facts;
}
```

`SolveDecisionInput` supplies the explicit room/context, decision revision, policy, ISO timestamp `now`, schedule, roster, confirmed owner inputs and current owned exception records. All public entry points validate finite contract structures. Malformed input throws `DomainValidationError`; it is distinct from valid but missing, stale or unsupported information, which returns `NEEDS_CLARIFICATION`. Errors and clarification details are private server diagnostics, not HTTP responses or public logs.

`enumerateStructuralPlans({ schedule, rosterMemberIds })` returns qualified assignments with distinct duty owners. Everyone attends the meeting, so any meeting/duty overlap excludes that candidate; touching endpoints are allowed. `stablePlanId(facts)` encodes normalized public facts for deterministic tie-breaking. It is an internal identifier, not a wire proposal ID, proposal hash or authorization token. Enumeration is structural only; `solveDecision` supports 30-minute meetings and returns clarification for 60-minute revisions.

Each owner's `availabilityReview` binds explicitly assessed intervals to the current context and confirmed input revision. Required meeting and assigned-duty intervals must be fully covered by that review. Within reviewed coverage, the union of `HARD_AVAILABILITY` intervals is the immutable available envelope: missing coverage blocks the candidate. Outside reviewed coverage, availability is unknown. Adjacent or overlapping intervals can cover a full interval; gaps cannot. An empty positive envelope never means available. A negotiable condition can further block that envelope, and an exception never expands hard availability.

An applicable exception must be active, unexpired at `now`, invited by its negotiable condition, and match the owner, condition, room, context, decision/input revisions, exact roster set, policy, exact dated meeting and no-owner-duty predicate. Every overlapping negotiable condition needs authorization. Grant versions are retained as private dependencies for later application checks. B02 must load authoritative owner/grant records and recheck them atomically when accepting/finalizing proposals; these supplied IDs are not authentication.

`solveDecision` returns:

- `SOLVED`: feasible plans, ranked plans and one selection.
- `NO_AGREEMENT`: no candidate is feasible.
- `NEEDS_CLARIFICATION`: current confirmations, supported intervals, availability or required duty costs are missing. A potentially feasible unknown candidate prevents selecting a claimed optimum. Unknown data on an independently blocked candidate does not prevent `NO_AGREEMENT`.

Inconvenience minimizes the sum of assigned duty costs, then stable plan ID. Load balance minimizes maximum prior-plus-new load, then spread, then inconvenience, then stable ID. Input arrays are not mutated. Scores, candidate sets, grant references and clarifications are private; never spread a result or ranked plan into a public DTO. Disclosure and final approval are intentionally absent from feasibility inputs and remain independent application permissions.

Run `npm test -- packages/domain` from the repository root. The production tests independently assert the exact 12/0/2 fixture and both policy choices, scope failures, interval coverage, unknowns and ranking ties. B02 state transitions, projections, identity and transactional authorization are outside B01.
