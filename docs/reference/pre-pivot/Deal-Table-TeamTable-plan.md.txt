# Deal Table: TeamTable — active hackathon build plan

Version 2, September 19, 2026. Original solo capacity: 25–35 hours/week. This supersedes the weekend-trip scenario in `Deal-Table-build-plan.md`. Product and technical specification, not an implemented or deployed application.

> Staffing update: the user now has two developers. Use [the two-developer architecture and delivery plan](Deal-Table-two-developer-architecture.md) for ownership, shared contracts, task dependencies, and implementation sequencing. The product and demo specification below remains active; the solo schedule is historical. The second developer's weekly availability is not yet confirmed.

## 1. Decision from the shared conversation

The [shared conversation](https://chatgpt.com/share/6aaed8cf-10e0-83e8-a36a-0404536fc20b), read in the browser on September 19, recommends TeamTable: privately negotiate a team meeting and duty assignment. It also proposes selectable fairness policies, permission-gated disclosures, an audit view, and a three-participant MVP.

Adopt that scenario. Keep **Deal Table** as the product name and **TeamTable** as its first decision template; CommonGround was only a suggested alternative name, not an approved rename. The trip example becomes optional future reuse, not a second hackathon deliverable.

Product promise: **Agree on the work without having to explain your life.**

Initial audience: small, voluntary project teams arranging a launch rehearsal. The demo uses fictional people and schedules. The product proposes a plan; it does not assign employment shifts, evaluate workers, determine compensation, or change a real deployment. Participants can decline without publishing their reason.

## 2. Why the team scenario is stronger

The negotiation combines two different issues: when everyone meets and who takes weekend duties. A simple meeting poll does not naturally express "I can move that commitment if I do not also take a weekend duty." That conditional exchange is the central interaction.

Unlike a travel demo, it needs no hotel catalog, invented commercial availability, price feed, booking integration, or purchase. The required data can be fictional, transparent, and mechanically checked. The visual result is a real calendar-and-roles plan.

Confidential negotiation and scheduling optimization are established fields. Smartsettle is direct prior art for confidential preferences and negotiated packages. The proposed differentiation is the consumer interaction: public conversational table, private conditional exchanges, separately approved disclosures, transparent policy choice, and versioned unanimous agreement. Do not claim mathematical or category novelty. [Smartsettle process](https://info.smartsettle.com/about-us/process/)

## 3. The exact MVP

One decision: choose one 30-minute meeting and allocate two fixed weekend duties among three people. Inputs include participant-confirmed hard constraints, negotiable conditions, and task preference costs. Support two declared ranking policies. Run one private concession round and then unanimous approval.

Required screens: shared table; personal constraints; personal concession/disclosure approval; final personal approval; public agreement and disclosure ledger. Use separate participant identities, not production impersonation or an organizer who can see everyone's inputs.

Non-goals: arbitrary workforce rostering, employment decisions, live calendar write access, automatic deployment, payments, HR data, historical productivity scores, autonomous representatives, a general contract language, multiple device tracks, or several negotiation domains.

## 4. Demo fixture — fully specified and reproducible

All data below is fictional. Use the explicit timezone **America/Mexico_City**. Dates: Thursday October 8, Saturday October 10, and Sunday October 11, 2026. Do not silently convert schedule constraints to the viewer's browser timezone.

### Public decision space

- Meeting: Thursday 10:00–10:30, 11:00–11:30, or 14:00–14:30; everyone attends.
- Launch rehearsal lead: Saturday 10:00–12:00; Maya or Leo is qualified.
- Follow-up check: Sunday 10:00–11:00; Maya, Leo, or Nina is qualified.
- No participant may receive both weekend duties.
- Prior agreed duty-load points in the last four weekends: Maya 0, Leo 3, Nina 0. These fixture values are explicitly approved as shared information.
- New load points: lead = 2; follow-up = 1. These are agreed time weights, not performance ratings or claims that work difficulty is identical.

There are 3 meeting times x 2 qualified leads x 2 distinct follow-up assignees = **12 valid structural plans** before availability conditions. Enumerate them all. There is no need for a large optimization library for this version.

### Private confirmed conditions

| Person | Condition | Treatment |
|---|---|---|
| Maya | Meeting must start at or after 11:00 | Hard; never ask to relax |
| Leo | Meeting must start at or before 11:00 | Hard; never ask to relax |
| Nina | Thursday 11:00 is currently unavailable, but she permits a private question about an exception | Negotiable acceptance condition; blocks unless expressly granted |

Other candidate meeting times are available to Nina. All three are available for their qualified weekend roles before any exception changes the permitted package. Personal reasons are unnecessary and should not be requested.

The baseline contains **zero feasible plans**: Maya rules out 10:00; Leo rules out 14:00; Nina has not authorized 11:00. This explanation belongs to the fictional demo observer/private test fixture, not the shared application's output.

### Conditional exception

Only Nina receives: "Would Thursday, October 8 at 11:00 work if you take neither weekend duty in this plan?"

This is a trade across issues, not a vote or a request to ignore a hard constraint. Nina can decline, allow the scoped condition, or edit her input. The service must not repeatedly pressure her or ask for the personal reason behind her schedule.

If she allows it, the exception covers a bounded set of plans satisfying all of:

- Same room, participant roster, input/schedule revision, approved ranking policy, and expiry.
- Meeting exactly October 8 at 11:00 for 30 minutes in the fixture timezone.
- Nina is assigned neither the Saturday nor Sunday duty.
- No change to any other confirmed condition.

This intentionally permits two assignments of the remaining duties; it is not blanket calendar availability. Unlike the old trip plan's exact-package grant, v2 uses an explicitly previewed **scope predicate**. Final acceptance is still bound to one exact plan hash.

### The two resulting plans

| Plan | Meeting | Saturday lead | Sunday follow-up | Nina's weekend duties |
|---|---|---|---|---:|
| A | Thursday 11:00 | Maya | Leo | 0 |
| B | Thursday 11:00 | Leo | Maya | 0 |

Precisely two plans become feasible. Nina's concession does not mean any participant has accepted A or B.

## 5. Fairness: explicit policy, not an invented score

Agree on a ranking policy before negotiation. Any change to the policy requires participant confirmation and invalidates policy-bound grants and approvals. The final application does not let the organizer silently flip the policy to obtain a preferred result.

### Policy 1: lowest declared inconvenience

Each participant privately marks the inconvenience of a duty using a common, explained 0–3 scale. This is self-reported and strategically manipulable; do not present it as objective utility. In the fixture:

- Maya: lead cost 3, follow-up cost 0.
- Leo: lead cost 0, follow-up cost 1.
- Nina: qualified follow-up cost 0, irrelevant once the no-duty exception applies.

Plan A costs 3 + 1 = 4. Plan B costs 0 + 0 = 0. **Policy 1 selects B.** Those numbers remain private/internal; the normal public screen says which agreed policy was used, not each person's hidden ratings.

### Policy 2: balance recent duty load

Minimize the largest participant's prior + new load points; tie-break by spread, then declared inconvenience, then a stable plan identifier. Plan A yields Maya 2, Leo 4, Nina 0; largest load = 4. Plan B yields Maya 1, Leo 5, Nina 0; largest load = 5. **Policy 2 selects A.**

This policy protects against repeatedly assigning the work to the person for whom it is easiest. It is not universally fair: the team chooses a principle. These load points are public only because this fixture explicitly shares them; do not silently publish private history in other rooms.

For the demo, pre-agree Policy 2. Show the alternative policy only in an explicitly labeled comparison/observer view or in a second room; do not make the policy toggle a consent bypass. No percentage fairness gauge.

## 6. Three separate permissions

1. **Change permission:** "Allow Thursday at 11:00 only if I take no weekend duties." This updates the feasible plan set within the displayed scope.
2. **Disclosure permission:** "May I say this exact sentence to this exact audience?" This is independent of change permission. Refusal must not revoke the private concession or block a plan that can be explained without the optional sentence.
3. **Plan acceptance:** "I accept Plan A, revision 7." Everyone approves the same hash and terms. The assistant and organizer cannot approve for another participant.

Suggested optional disclosure: "A conditional availability exception makes the proposed plan possible." Nina sees a warning that a small group might still infer who changed availability from the plan. She can allow the sentence or select "Use the exception without this announcement." The shared table can simply say "A feasible plan is ready" if the latter is chosen.

Avoid the shared conversation's claim that an aggregate conflict count is automatically privacy-safe. Do not expose "only one person blocks this" or per-slot conflict counts by default. Hiding a name is not a guarantee against inference.

Disclosure grants bind exact normalized text, audience/member set, room revision, expiry, and status. Check immediately before publication. Once heard/read by others, a disclosure cannot be made secret again; revocation stops future publication, not human memory. The ledger records the sentence that was actually shared, never unpublished secrets.

## 7. Demo narrative — target 2:45

| Time | Visual | Live behavior |
|---|---|---|
| 0:00–0:15 | Three private cards around a shared table | Establish the meeting + two duties; fictional observer montage |
| 0:15–0:35 | Participants confirm rules in separate personal windows | Server stores confirmed structures, not guessed interpretations |
| 0:35–0:50 | "No plan meets the current conditions" | Solver checks all 12 structural plans |
| 0:50–1:15 | Nina's phone receives a conditional exchange | Private scope is previewed; she allows it |
| 1:15–1:30 | Exact disclosure sentence and audience | She declines the announcement; the process still continues |
| 1:30–1:55 | Thursday meeting and two weekend roles assemble into Plan A | Recompute, apply agreed load policy, publish public fields only |
| 1:55–2:10 | Three separate acceptances | Atomic commit against matching plan hash/revision |
| 2:10–2:25 | Shared assistant is asked who was unavailable | No private access; returns a safe explanation without identities or reasons |
| 2:25–2:40 | Organizer changes meeting length from 30 to 60 minutes | Version changes; old exception and approvals become invalid; no auto-reuse |
| 2:40–2:45 | Product statement and actual AWS labels | "Agree on the work. Keep your reasons." |

The 60-minute edit is a seeded demo input, not a claim about the real people. It must invalidate the 30-minute exception even if its start time is unchanged. Revised end-time availability must be reconfirmed; do not extrapolate from start-time checks. Keep the world consistent: the original domain permits only 30-minute sessions; a changed duration makes it a new decision revision, not a supported silent extension.

A continuous backup demo should also show refusal, zero-concession success, and hard-impossible failure. Never promise to prove complete inference resistance by refusing one hostile question.

## 8. Visual product direction

The central visual is a calendar with three fixed slots, two role tiles, and three participant seats. At first the elements cannot form an approved plan. The private exchange appears on a separate phone surface. When authorized, the meeting and duty tiles move into one coherent plan; acceptance adds a seal to that version, not to the whole session forever.

Use calm neutral surfaces with restrained teal for current agreement and amber for a pending decision. Avoid fake locks flying around, unearned security badges, 3D avatars, or an opaque spinning "agents debating" screen. Animate real state changes for 250–400 ms, respecting reduced motion.

The public screen never receives hidden owner rules. It can show participants have submitted and that a plan is ready. It cannot show compatibility heatmaps, named dissent, or private friction scores. The optional demo observer montage contains only fictional accounts and is separately labeled; it is not a production organizer feature.

The disclosure ledger shows exact approved public statements, publication time, audience, and relevant version. It is not a ledger of what people refused to reveal. Each owner separately sees their private permissions and receipts.

## 9. Architecture and Amazon integration

Primary track: **Alexa+**. Commit to the explicitly permitted simulated Alexa+ web experience, with an actual AWS backend. Native MCP is a stretch after an 8-hour access/compatibility spike. The official toolkit is documented as US-only; do not assume access based on the current user's location or make a native integration promise before testing. [Alexa+ overview](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-overview.html)

Frontend: React + TypeScript + Vite. Responsive shared/private surfaces. Authenticated participant identities through Cognito; a separate read-only shared-display credential. AWS API Gateway + Lambda handlers; DynamoDB for revisioned state; SQS for parse/solve jobs; Bedrock for private language extraction and public intent routing; S3/CloudFront for the static app. Redacted CloudWatch metrics. AWS CDK infrastructure. Short polling of authorized snapshots is sufficient initially.

Bedrock is not the arbitrator. It extracts owner-confirmed constraints and routes permissible requests. A pure deterministic solver checks all candidates. A state machine enforces permission and acceptance transitions. Public wording starts with templates, making privacy enforcement easier to test than free-form summaries.

The private parser receives one owner's input at a time. The shared narrator receives only the public projection. The trusted solver receives structured inputs across participants. No model needs everyone's raw personal explanations. Never collect them unnecessarily.

Use one coherent workflow rather than three LLM agents pretending to be people. Separate contexts and permission scopes matter more than the number of agents.

Native stretch: official MCP SDK, required 2025-11-25+ protocol, Streamable HTTP, tested OAuth/PKCE, and only public/shared tool results on a shared Alexa surface. Keep private submission/permission endpoints out of shared discovery. Long inference work should use jobs, not block a latency-sensitive MCP request; test actual host polling behavior. MCP Apps is optional and host-tested, not assumed to mirror a phone or control Fire TV.

## 10. Solver and state specification

Enumerate 12 plans for this fixture. A general version supports a small bounded slot/role domain (e.g. <=1,000 candidates) before introducing OR-Tools. Use integer minutes and explicit dates/timezone. Validate qualifications, distinct assignments, capacity, full-duration availability, and confirmed acceptance conditions.

Algorithm:

1. Apply immutable structural rules and participant-confirmed hard conditions.
2. Apply negotiable acceptance conditions, except where an active scoped exception evaluates true for this exact candidate and current revision.
3. Rank feasible plans using the participant-approved policy.
4. If none are feasible, search only allowable exceptions that participants explicitly invited. Never generate a relaxation for a hard condition.
5. Propose a minimal supported scope; for the fixture, Thursday 11:00/30 minutes coupled to no weekend duties for Nina.
6. Recompute after a grant, then ask for exact final approval from everyone.

Do not claim globally minimal concessions from a heuristic. For this finite fixture, exhaustive checking can establish exact feasibility and best ranking within the stated options. Unsupported or missing data yields "needs clarification", never assumed acceptance.

State machine: COLLECTING -> READY -> SOLVING -> PRIVATE_REVIEW -> PROPOSED -> APPROVING -> AGREED. Alternatives: NO_AGREEMENT, SUPERSEDED, CLOSED. Disclosure status is independent, not a prerequisite to PROPOSED when no disclosure is needed.

Core records:

- DecisionRevision: slots, role definitions, roster, policy, public history, confirmed-input revision.
- Constraint: owner, type, finite predicate, source, confirmed timestamp/revision.
- ExceptionGrant: owner, affected constraint, allowed candidate-scope predicate, context hash, expiry, revocation.
- DisclosureGrant: owner, exact text hash, explicit audience, context, expiry, publication/revocation status.
- Proposal: canonical plan facts, context hash, referenced grant versions, public explanation.
- Approval: authenticated subject, proposal hash, context hash, timestamp.
- Agreement: atomically verified matching approvals and grants; never an automatic deployment.

A policy/schedule/roster/input change increments the decision revision, cancels relevant jobs, and supersedes outstanding grants/proposals/approvals. For the MVP, conservatively invalidate all rather than attempt selective dependency preservation. Exception acceptance does not increment the input revision it is bound to; record permission events separately and create a new proposal against the unchanged context. Revocation updates the control revision so a concurrent final acceptance cannot commit stale consent.

Use DynamoDB transactions or equivalent conditional writes for the agreement transition. Idempotent mutation keys and queue consumers are mandatory. A worker checks current context both before and after solving. No private text in queue payloads or logs.

## 11. Access and privacy threat model

Trusted boundary: backend + permitted model processing. Untrusted boundaries: participants, organizer, shared display, browser clients, user text, and external inputs. This is not cryptographic private computation.

Participant identity comes from verified authentication, not a supplied owner ID. Public endpoints return an allowlisted DTO constructed separately from private state. The organizer can manage public options but cannot impersonate participants or inspect their private conditions. The shared display cannot mutate consent. Single-use invitations do not grant cross-participant access.

Privacy is limited by the information in final plans, published statements, timing, and repeated queries. Rate limiting alone does not solve inference. Restrict public feasibility probes to agreed decision revisions, avoid owner-attributed diagnostics, and obtain informed consent for the plan facts that must become public. Do not advertise "zero leakage."

Reject one deliberate disclosure attack in the demo, but document the broader threat model and test authorization systematically. Anonymous aggregate conflict counts are not part of the default public response. Refusal is not announced by name.

Delete raw draft text after confirmed extraction by default. Enforce logical deletion and expiry at read time; DynamoDB TTL is not immediate. Document backup retention rather than claiming all copies instantly disappear. Judge accounts use synthetic data and remain usable through the end of judging.

## 12. Build schedule — September 19 to October 22

Budget: **120 core hours** over about 4.7 weeks; up to approximately 45 additional hours if the user's actual capacity is near 35 hours/week. Submit October 22; deadline October 23 noon PDT. Do not plan as though two elapsed days are still available.

| Dates | Core hours | Outcome |
|---|---:|---|
| Sep 19–24 | 22 | Fixture, threat model, domain schemas, enumeration, two ranking policies, solver tests; interview/flow validation |
| Sep 25–Oct 1 | 25 | Identity, private rule confirmation, shared projection, secure endpoints, first complete form-driven flow |
| Oct 2–8 | 25 | Bedrock extraction, shared tool routing, queued jobs, scoped exceptions, independent disclosure grants, exact-plan approval |
| Oct 9–15 | 25 | Deployed AWS flow, calendar/role animation, permission ledger, security and concurrency tests, group trials |
| Oct 16–21 | 19 | Fixes, recording, setup documentation, judge accounts, real friction log, submission draft |
| Oct 22 | 4 | Submission/link/access verification and contingency |

Extra time: native Alexa experiment (8-hour initial cap), voice polish, more user trials, and deployment hardening. Do not add another decision domain. If behind: drop native Alexa, speech, elaborate animation, and extra analytics first. Preserve access control, truthful simulations, refusal, and consent invalidation.

## 13. First implementation tickets and acceptance criteria

**DT-01 — Domain schema and fixture (3 h):** Explicit local dates/timezone, 3 meeting slots, 2 roles, 3 participant records, and policy. Fixture data prominently synthetic. Reject unknown operators and unconfirmed rules.

**DT-02 — Enumeration and feasibility (4 h):** Exactly 12 structural plans, zero baseline feasible, exactly two after the valid scoped grant. Failed/expired/revoked/wrong-context grants admit none. Same-person double duty never passes.

**DT-03 — Ranking (3 h):** Declared-inconvenience chooses B; balance-load chooses A. Stable ties. No model-generated fairness score. Policy change invalidates prior policy-specific permission context.

**DT-04 — Identity and private/public separation (8 h):** Three independent identities, organizer and display scopes, owner-only reads/mutations, public projection tests. Secret values absent from page payloads and shared tool responses.

**DT-05 — Confirmed input UI (6 h):** Hard/negotiable/preference distinctions, structured form fallback, owner review of every model extraction, timezone and duration visible. Reasons optional and unnecessary.

**DT-06 — Exception plus disclosure (8 h):** Separate grant records; exact scope preview; decline works; withholding announcement does not prevent solving; publication requires current audience/text permission.

**DT-07 — Proposal and agreement (8 h):** Canonical plan hash, three individual approvals, transactional finalization, decline/withdrawal behavior, revision invalidation, duplicate-request safety.

**DT-08 — AWS and Alexa-style simulation (12 h):** Actual Bedrock tool routing/extraction, real async workflow and persistent state. UI clearly labeled simulated Alexa+; hosted roles work on separate devices/browser contexts.

**DT-09 — Demo polish and verification (8 h):** Calendar/roles transition based on actual solver state; synthetic observer montage separate from production; narrative fits 2:45. Rest of schedule covers infrastructure, hardening, evaluation, recruiting, docs, and contingency.

## 14. Tests that establish the core claim

- Feasibility: no concession, scoped concession, denied concession, hard-impossible, and zero-concession-success cases.
- Scope: 30 -> 60 minutes invalidates the exception; Nina assigned any weekend duty fails the scope; wrong roster or policy invalidates it.
- Independence: grant an exception while denying its optional disclosure; proposal remains feasible, sentence is absent.
- Consent: three approvals must match; changing a role, duration, member, or policy invalidates them; concurrent revoke/finalize never uses stale authority.
- Security: owner-ID substitution, organizer escalation, display-write attempt, invite replay, private values in logs, prompt injection, unauthorized public tool calls.
- Ranking: exact fixture outputs plus exhaustive comparisons against independently computed rankings.
- UX: mobile/keyboard/reduced-motion; reconnect; loading/error states; explanation of privacy limitations; no shaming for refusal.
- Model: at least 40 statements testing must/prefer, negation, strict time bounds, conditions, ambiguous availability, and unsupported instructions. Publish sample size and observed performance, not a guarantee.

The accompanying planning check verifies fixture arithmetic only. It is not a security audit or the application's production solver.

## 15. Submission and operational checklist

The committed path is the explicitly permitted Alexa+ web simulation; show it working and identify the simulated host. AWS Builder requires documented real use. Deadline October 23 noon PDT; English submission, working source/setup, video under three minutes, required product feedback, and judge access through November 20. Rules currently permit a public open-source repository or an appropriately shared private repository; consult the current collaborator list rather than relying on an old handle. Recheck immediately before submitting. [Official rules](https://amazonappdev2026.devpost.com/rules)

A public licensed repository is the simplest planned route, but no publishing occurs without the user's implementation workflow. Never commit credentials, real participant inputs, or unlicensed assets. Keep a genuine friction log from day one.

Suggested cloud spending envelope to approve before deployment: $50–$100 for prototyping, not a verified cost quote. Enforce per-session model limits, queue retry limits, concurrency caps, room lifetimes, and a model kill switch; billing alarms alone do not cap spend. No cloud resources or paid services have been created as part of this planning task.

## 16. Go/no-go test

Show a rough version to two groups. They should understand the conditional exchange without a tutorial, distinguish permission to share from permission to change, and know the service can process their private conditions. At least one group should prefer the workflow to a poll for the demonstrated cross-issue decision. If all they see is "Doodle with private forms," improve the conditional negotiation interaction before investing in presentation.

The product should remain useful if native Alexa onboarding is unavailable. It should remain truthful if no deal exists. Its most important technical claim is that **no person or model can silently trade away another person's confirmed condition or reuse stale consent**.

## References

- [Shared conversation and TeamTable recommendation](https://chatgpt.com/share/6aaed8cf-10e0-83e8-a36a-0404536fc20b): read September 19; treated as reference, not unquestioned technical authority.
- [Hackathon rules](https://amazonappdev2026.devpost.com/rules): checked September 19.
- [Alexa+ MCP overview](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-overview.html).
- [Alexa+ quickstart](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-quickstart.html).
- [Bedrock structured output](https://docs.aws.amazon.com/bedrock/latest/userguide/structured-output.html).
- [MCP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).
- [DynamoDB transactions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html).
- [Lambda with SQS](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html).
- [Smartsettle process](https://info.smartsettle.com/about-us/process/).
