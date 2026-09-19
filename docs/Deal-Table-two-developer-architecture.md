# Deal Table — two-developer architecture and delivery plan

Prepared September 19, 2026. Status: implementation proposal, not deployed software.

## 1. Authority, scope, and staffing

Read alongside `Deal-Table-TeamTable-plan.md`. That document remains authoritative for the product, fictional fixture, ranking mathematics, privacy limitations, and demo. This document supersedes its **solo staffing, work allocation, and implementation sequencing**, not the product scope. The teammate's weekly availability is unconfirmed: do not assume twice the original 25–35 hours/week or promise a halved schedule.

Product: Deal Table. First template: TeamTable. One meeting, two duties, three participants, two ranking policies, one private concession round. Do not implement the old travel scenario or Roomcraft. Native Alexa is a stretch; an honestly labeled simulated host with real AWS integration is the committed direction, subject to rechecking current official hackathon rules before submission.

Developer A = initiating user: frontend, participant experience, demo, browser tests, integration coordination.
Developer B = teammate: solver, permission state machine, server, authentication, persistence, cloud infrastructure.
Both review the other's work. Astra is a bounded architect/reviewer, not a continuously polling manager. Both developers build.

No GitHub repository, credentials, paid resources, or deployment is created by this document. Source paths are listed in `Deal-Table-Astra-bootstrap-task.md`.

## 2. Bootstrap gate: establish this once

Developer A runs the initial Astra task in the chosen application folder. B does not independently scaffold another application. Bootstrap produces shared schemas, package boundaries, mock response fixtures, checks, and a runnable frontend. It does **not** implement B's solver or declare mock identities secure.

After both developers accept the bootstrap commit, B receives the same repository through a user-authorized Git remote or a file transfer. RkLop-specific absolute paths are migration inputs only; copied project documents and tests must work with relative paths on B's machine.

Agree on these before parallel feature work:

- Meaning of hard conditions, negotiable conditions, preferences, exception scopes, and explicit final approvals.
- Public versus owner-only response schemas.
- Command preconditions, stale-version errors, and mutation retry behavior.
- Example responses for blocked, private review, proposed, agreed, and superseded states.
- Ownership of shared types, root configuration, lockfile, and CI.

## 3. Repository structure and dependency rules

Use a small TypeScript npm-workspaces repository, one root lockfile, React/Vite for the web app. Preserve an existing working package manager if the target already has one. Pin the selected supported runtime/tool versions in the repository; verify compatibility during bootstrap rather than copying an old version from a planning document.

```text
apps/
  web/                    A: React screens, API client, UI-only mocks
  api/                    B: HTTP adapters, authentication, authorized handlers
  workers/                B: parse/solve jobs, retry and stale-result handling
packages/
  contracts/              Shared: runtime schemas and public/owner wire types
  domain/                 B: pure solver, ranking, state transition rules
  application/            B: commands, projection, repository/model/clock ports
  adapters/               B: in-memory and AWS implementations of those ports
  test-support/           Shared: synthetic fixtures, factories; never web imports
infra/                    B: AWS CDK, configuration, least-privilege policies
tests/
  e2e/                    A: browser flows; B reviews permission assertions
  integration/            B: auth, persistence, races, retries
docs/
  Deal-Table-TeamTable-plan.md
  Deal-Table-two-developer-architecture.md
  contracts.md
  decisions.md
  tasks/                  one short file per task, not a giant shared log
  reference/              dated research and non-production storyboard
planning-checks/          original arithmetic check, separate from production tests
AGENTS.md                 short repository instructions, not the whole specification
README.md                 setup, commands, simulation/deployment status
```

Dependencies: web imports contracts only, not domain/application/private fixtures. HTTP handlers and workers call application services; application calls domain and abstract ports; adapters implement the ports. Domain has no AWS, React, HTTP, or model dependency. Composition roots in API/workers select adapters.

The contracts package contains schemas, never live participant data. A browser may know the shape of an owner's response; it must not receive another owner's values. Add a lint/import boundary check and later inspect production artifacts for seeded private data or server-only imports.

Do not add microservices, Kubernetes, agent frameworks, a generic negotiation DSL, or a complex workflow engine. Folders express boundaries, not separately deployed services for every package.

## 4. Runtime architecture

Shared screen and personal screens call API Gateway/Lambda. Server-side authorization derives identity from verified Cognito credentials and room membership. A scoped display credential reads only the public projection. The organizer is not a private-data administrator.

Application services use a trusted deterministic solver plus a repository. Start with an in-memory repository for local behavior, then a DynamoDB adapter. In-memory tests do not establish cloud transaction correctness.

Bedrock later extracts one participant's input into a draft. The owner must review and confirm it. Shared conversational requests see only an allowlisted public projection and cannot invoke owner consent commands. The model never grants exceptions, submits approvals, edits policy, or makes feasibility authoritative.

SQS carries job IDs and references, not raw private text. Workers read authorized server-side records, check version at start and before publishing, and are idempotent. Start with direct deterministic local execution; add jobs for model calls and the documented cloud workflow. Short authorized snapshot polling is enough for the MVP.

Cloud target: Cognito, API Gateway, Lambda, DynamoDB, SQS/DLQ, Bedrock, S3/CloudFront, redacted CloudWatch, and CDK. Validate actual services, SDK versions, model access, region, deployment permissions, and cost controls before deployment. No real participant data in development fixtures or logs.

## 5. Contract v1: public data and private data

Bootstrap defines runtime validators and example JSON for these records:

| Record | Required concepts | Who receives it |
|---|---|---|
| PublicRoomSnapshot | opaque room/context IDs, timezone, schedule, shared roster, approved policy, coarse status, public proposal, permitted approval indicators, published disclosure receipts | room participants and scoped display |
| OwnerSnapshot | caller's confirmed inputs, drafts, pending private offers, own grants, own approval, owner revision | authenticated owner only |
| ProposalView | opaque proposal ID, public plan facts, context token, plan hash, validity, agreed policy label | room participants/display |
| ExceptionScope | affected negotiable condition, exact meeting slot/duration, no-duty predicate, roster/policy/context binding, expiry | relevant owner and trusted server |
| DisclosurePreview | exact text, audience, context, expiry, inference warning | relevant owner before publication |
| CommandResult | result/status, request ID, updated relevant version; structured errors | authorized caller |

Do not include private condition arrays, inconvenience ratings, per-person rejection reasons, private grant IDs, or per-slot conflict counts in public DTOs. Public errors must not reveal whether another participant's private record exists. Public proposal hashes contain public plan facts and an opaque context token, **not hashes of low-entropy private inputs**. Internal private dependency metadata remains server-side.

Use finite validated predicates, not arbitrary code or LLM-generated executable expressions. Every meeting condition includes date, timezone, and supported duration/interval coverage; a start-time check alone does not establish full meeting availability.

### Logical API surface

Final route names may be adjusted during bootstrap, keeping the semantics:

| Operation | Authorization and behavior |
|---|---|
| GET room public snapshot | room membership or read-only display scope |
| GET room /me snapshot | verified participant; server resolves owner |
| Submit/confirm own inputs | caller only, draft revision match, validated finite structures |
| Accept policy/context | each required participant accepts the public decision setup |
| Request solve | permitted coordinator/participant, current confirmed context; rate-limited |
| Allow/decline private exception | offer owner only, exact scope preview/version/expiry |
| Allow/decline disclosure | owner only, exact sentence and audience; independent of exception |
| Publish authorized disclosure | trusted command, rechecks grant and audience immediately |
| Accept/withdraw final approval | caller only, exact proposal hash and context |
| Revise public decision | coordinator; supersedes old context, requires fresh confirmations |

Unsafe mutations accept a caller-generated idempotency key and explicit expected version. Reject mismatches with a stable `STALE_CONTEXT` or `STALE_PROPOSAL` error; never silently apply against the latest version. Reusing a key with a different payload fails. Authorization always runs before returning a cached mutation result. HTTP 401/403/404/409/422 conventions are documented and tested consistently, including non-enumerating unauthorized responses.

## 6. State, hashes, and consent correctness

Keep these concepts separate:

- **Decision revision/context:** roster, schedule, policy, public history and confirmed-input versions. A semantic edit supersedes the whole decision context for this MVP.
- **Concurrency version:** monotonic server control version for permission and proposal mutations. Changing this is not automatically a new semantic decision.
- **Proposal identity/hash:** canonical public plan facts, opaque context token, and proposal version. Define canonical serialization and test stable hashing.
- **Individual permissions:** independent exception, disclosure, and final-approval records with owner, scope, expiry/revocation, and version.

An exception grant can unlock candidates under the existing semantic context; it must not immediately invalidate itself by incrementing the context to which it was just bound. A semantic edit does invalidate it. Relevant grant revocation or a new proposal clears matching final approvals. A disclosure choice alone must not alter feasibility or silently cancel an exception.

All three approvals bind the same current proposal. Finalization atomically verifies current room/proposal state, the complete roster's matching approvals, necessary active grant versions, and application-enforced expiry. Relevant state mutations use the same concurrency guard so a revocation/finalization race has a defined order. Retries re-read state; an outdated worker cannot resurrect an old proposal.

An agreement is a planning record, not a legal contract or real-world execution. A later revision or permission withdrawal must clearly supersede its active status while retaining accurate historical receipts. Do not rewrite history or claim a published disclosure was never seen. Domain state must also define decline, withdrawal, expiry, and closed-room behavior; no UI-only implementation of these rules.

Bootstrap writes the semantics and tests for serialization/contract validation; B implements the transactional behavior. Test DynamoDB behavior against the real adapter before claiming race safety. Cloud design reference: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html — implementation agent should verify current restrictions before writing transactions.

## 7. Ownership and change coordination

| Area | Owner | Required collaborator |
|---|---|---|
| web screens, client adapter, UX, browser tests | A | B for permission behavior |
| domain, application, API, workers, adapters, infrastructure | B | A for public contract compatibility |
| contracts and API semantics | B after bootstrap | A approves breaking changes |
| root manifests, lockfile, lint/build config, CI | A | B proposes dependency changes |
| product scope and demo narrative | A | B confirms technical truthfulness |
| security invariants, consent model | B | both approve changes |

During bootstrap A/Astra temporarily owns shared foundations; document the handoff to B. Ownership is coordination, not a ban on proposing fixes. Do not land changes in another lane without agreement. Shared contract updates land first with updated examples; dependent branches update after that. Do not let a supposedly isolated UI ticket modify authorization logic or broad root dependencies.

Use one task branch and one active implementation task per developer. No shared writable checkout over a synchronized drive. Review a named commit/diff, not an agent's uncommitted directory. Keep main runnable; use small pull requests and merge only with passing required checks and human review. Do not assume branch protection is configured until verified.

## 8. Milestones and dependency-aware task board

All tasks initially **NOT STARTED**; planning documents and the old fixture script are the only completed artifacts. Rough effort bands below are planning estimates in developer-hours, not model runtime or commitments.

| ID | Owner | Depends on | Deliverable and acceptance | Estimate |
|---|---|---|---|---:|
| F00 | A/Astra | chosen writable app folder | copy references safely; inspect workspace; short AGENTS, task files, setup instructions | 1–2h |
| F01 | A/Astra | F00 | workspace skeleton, locked tooling, lint/typecheck/test/build scripts, minimal CI definition | 2–4h |
| F02 | A/Astra + B review | F01 | validated v1 contracts, public-only mocks, documented state/version semantics and ownership | 3–5h |
| A01 | A | F02 | shared-table and owner screens with mock API adapter; loading/error/stale states; keyboard usable | 4–6h |
| B01 | B | F02 | exhaustive solver and both rankings; exact fixture and invalid-grant tests | 4–6h |
| B02 | B | B01 | application commands, in-memory repository, owner/public projections, versioned consent tests | 6–10h |
| A02 | A | A01, B02 | connect real local API adapter; forms complete initial negotiation without any LLM | 3–5h |
| B03 | B | B02 | local HTTP server, test identities explicitly non-production, request validation and error contracts | 3–5h |
| G01 | both | A02, B03 | milestone: real local solver drives UI, refusal works, three approvals, duration edit invalidates | 2–3h |
| A03 | A | G01 | private exception/disclosure receipts, mobile layout, reduced motion, browser regression suite | 5–8h |
| B04 | B | G01 | Cognito adapter, room membership/display scopes, DynamoDB repository, race/idempotency tests | 10–16h |
| A04 | A | A03, B04 | separate authenticated browser contexts, reconnect behavior, HTTP/session error handling | 3–5h |
| B05 | B | B04 | Bedrock owner-only draft extraction, SQS jobs, stale-result rejection, safe shared routing | 6–10h |
| A05 | A | A04; B05 for live model path | confirmed-language-input UX with form fallback; accurate host simulation label | 4–6h |
| G02 | both | A04, B04 | privacy/security checkpoint before inviting external testers | 3–5h |
| B06 | B | B05 + explicit cloud approval | CDK deploy, bounded retries/concurrency, redacted metrics, expiry, judge synthetic accounts | 4–8h |
| A06 | A | G01; live trial needs G02/B06 | real user trials, calendar/duty transitions, 2:45 video rehearsal, setup/submission draft | 8–12h |
| G03 | both | A05, A06, B06 | release test, threat-model review, fresh rules/access check, recording and submission readiness | 4–6h |

Clarification: A02 can implement against the contract while B03 is in progress, but its real HTTP verification is blocked until B03. G01 requires both; a mock-only screenshot cannot close it. Mark blocked tasks explicitly rather than pretending all work is parallel.

F00–F02 are the initial Astra bootstrap assignment. Add only a minimal rendered frontend to demonstrate the scaffold. Then give A01 to A and B01 to B. Do not have bootstrap Astra consume B01/B02 while B independently implements them.

Target sequence, conditional on both developers' availability: foundations Sep 19–22; local vertical slice Sep 23–29; auth/persistence Sep 30–Oct 6; model/cloud integration Oct 7–13; trials/polish Oct 14–18; freeze/record/docs Oct 19–21; submit Oct 22. Confirm B's hours and re-estimate after G01. Keep the existing scope even if capacity increases. If behind, cut native Alexa, speech, extra analytics, and elaborate animation first.

## 9. Test strategy and review gates

Every PR: relevant automated tests, lint, typecheck, build, self-review, and the other developer's review. Tests run with isolated state and an injectable clock. Unit tests need no cloud or model credentials. Establish commands during F01 and keep documentation synchronized with executable scripts.

Critical PRs: strong-model review before merge for identity, access control, projections, grants, versioning, hashes, transactions, IAM, or secret handling. Give reviewer base/head commit IDs, requirements, diff, test commands/results, and known gaps. Reviewer examines code and evidence, reports concrete reproducible findings, and does not silently rewrite the author's branch. A changed head commit needs follow-up review of the new diff.

Integration: G01/G02/G03, plus a brief check after roughly 3–5 small merged tasks if a milestone is taking longer. No permanent manager process, automatic model polling, or repeated full-repository audits after cosmetic changes.

Required adversarial tests include owner substitution, organizer escalation, display writes, cross-room reads, private data in public responses/logs, expired/wrong-scope grants, duplicate commands, same-key/different-body replay, three mismatched approvals, revoked-grant races, policy/roster/duration changes, stale jobs, and disclosure denied while exception remains usable. Public-only browser fixtures must be checked separately from server fixtures.

Ranking results: 12 structural plans, zero initially feasible, two under Nina's valid no-duty exception; inconvenience chooses B, balance-load chooses A. Test all enum cases and independent expectations; do not merely copy production implementation into the test oracle. The existing 15-check planning script is a reference, not the production solver/security suite.

No test pass proves cryptographic secrecy or eliminates inference from outcomes. The backend is trusted with private structured constraints. Explain limitations to users.

## 10. Efficient agent use and task handoffs

Suggested allocation: Astra/Sol for bounded architecture, difficult failures, and critical reviews; Terra for routine integration; Luna for narrow well-defined UI/tests/docs/mechanical tasks. Select based on availability and observed results, not an assumed fixed token ratio. Each human uses their own account; collaboration travels through files and PRs.

Each task file contains: ID, owner, status, branch, dependencies, objective, allowed files, acceptance checks, non-goals, and handoff. Status flow: READY -> IN_PROGRESS -> REVIEW -> DONE, with BLOCKED plus reason where needed. DONE requires evidence and integration, not the model saying it finished. Until a shared remote exists, A maintains task assignment and sends B a snapshot; do not assume two local files synchronize.

Handoff under about 250 words: changed behavior, affected contracts, commit, commands and actual outcomes, remaining risks, and next dependency. Keep test output as linked CI artifacts or local results when available, not enormous chat dumps. Start fresh conversations at unrelated task boundaries, not after every small fix. Escalate after two substantive failed attempts or immediately for safety-critical uncertainty.

Repository AGENTS should be short: reference these documents; encode ownership, no secret leakage, independent consents, preserve user changes, test commands, and approval boundaries. Do not paste all plans into AGENTS or create competing sources of truth. Official guidance: https://learn.chatgpt.com/docs/agent-configuration/agents-md.

## 11. Reviewer task template

Review the specified base-to-head diff against the relevant task and Deal Table invariants. Do not edit files, merge, or expand scope. Inspect implementation and tests independently of the author's summary. Prioritize unauthorized private access, stale permission reuse, incorrect feasible plans, broken API compatibility, and regressions. For each finding give severity, exact location, triggering sequence, expected versus actual behavior, and a minimal regression test. Separate verified failures from untested risks. Report commands actually run and limitations. If no actionable finding is supported, say so without claiming the system is secure.

## 12. Deferred decisions and release boundaries

Confirm B's availability, AWS account/region/model access, intended repository remote, and cloud spend approval when required. Do not block local foundation work on those decisions. Confirm current hackathon team eligibility and submission requirements against official rules; the dated source research is not an authority for current compliance.

The app prototype, paid AWS resources, public repository, and PRs are not created by this planning artifact. The next agent's bootstrap is local implementation only unless the user separately authorizes external actions.
