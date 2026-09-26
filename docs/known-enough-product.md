# Known Enough — product definition

Status: KE00 direction, 2026-09-26; implementation remains the historical TeamTable application until the migration tasks land. This document governs new product work. See the [architecture](known-enough-architecture.md), [migration record](known-enough-pivot.md) and [queue](task-board.md) for implementation and acceptance boundaries.

**Known Enough helps people decide together without everyone needing to know everything.**

## People and decisions

Known Enough is an AI-first group-decision facilitator for people with a shared objective and private limits, preferences or motivations. Families, friends, travel groups, housemates, founders and teams can describe a bounded decision in ordinary language. AI constructs a model, asks useful questions, explores trades and proposes outcomes. Humans confirm their own conditions, authorize disclosures and approve the exact outcome.

The long-term direction spans bounded group decisions. The hackathon proves two materially different scenarios using the same engine. It does not promise unrestricted reasoning, support for every human condition or automatic professional advice. Unsupported or ambiguous conditions require clarification; the application must not silently omit them or call them mechanically validated.

## Primary journey

1. **Create:** “What are you trying to decide?” A public conversation clarifies the objective and produces a draft decision frame, variables, options and required participants.
2. **Confirm the shared frame:** required participants confirm the public objective and decision criteria before they become authoritative. KE01 specifies the exact confirmation mechanism.
3. **Invite:** reuse verified identity, subject-bound membership and invitation handling; an organizer cannot become another participant.
4. **Talk privately:** each participant explains needs in their own conversation. AI distinguishes HARD, PREFERENCE and NEGOTIABLE conditions and shows an understandable interpretation. The owner confirms, edits or rejects it. Model output alone has no consent authority.
5. **Establish readiness:** the current frame and required owner inputs must be confirmed; missing or unsupported information is visible as clarification, never assumed acceptance.
6. **Explore:** trusted backend AI proposes candidates. A small deterministic trust kernel checks supported confirmed conditions, references, arithmetic and current authority. Bounded repair can follow invalid output.
7. **Negotiate privately:** AI may ask about an explicitly negotiable condition. The affected owner sees the exact adjustment, dependency and expiry, and can refuse. Hard limits cannot be traded away; refusal ends that request without repeated pressure.
8. **Present and explain:** show public proposal facts and authorized explanations. Private grant IDs, budgets, reasons and refusal details stay out of the shared surface. Optional exact-text disclosure has its own permission.
9. **Approve:** each required participant approves the same current proposal/version/context. Only atomic verification of all matching approvals makes it an agreement. Revision, expiry or relevant revocation invalidates stale authority.

Ordinary users do not write schemas, predicates, equations or solver objects. Keep technical implementation details out of their decision flow.

## Two hackathon scenarios

### Family Christmas — primary demonstration

Five synthetic family members choose a destination, dates, accommodation level and duration, with at most one or two additional options. Private inputs can include maximum/preferred budget, unavailable dates, accessibility needs, destination preferences, maximum duration and explicitly negotiable conditions.

Example owner interpretation: a $1,600 hard trip limit, a $1,200 preference and a maximum seven-day trip. A private question might ask whether December 23–29 works if the destination meets the preferred budget. A public proposal could name Cancún, those dates and a shared villa while keeping individual budgets private. Costs and availability are labeled synthetic estimates; no booking or live travel-price claim is implied.

Required demonstration: five participants, three materially different private constraints, one private condition, one private negotiation question, a valid candidate, a safe public explanation and unanimous exact approval. This is a target for KE14, not existing evidence.

### Shared Purchase Exploration — proof of generality

Synthetic participants explore hypothetical contributions, ownership percentages, timing and conditional flexibility. Use the same contracts, validator and proposal lifecycle. No separate purchase solver.

An acceptable result is “This hypothetical contribution structure satisfies all participants' currently confirmed conditions,” only when the supported checks and confirmations justify it. It does not recommend an investment, determine legal ownership, execute a purchase, move money or sign a contract. Legal, tax, mortgage, securities and financial-advisory conclusions remain outside the product. Unresolved professional questions remain explicit.

### TeamTable — retained history

The three-person meeting/duty scenario remains a regression fixture and optional developer template. Preserve the 12 structural plans, baseline infeasibility, two plans after the valid conditional grant, both rankings, UI evidence and historical reviews. Those results establish their original scope, not Known Enough's new AI behavior.

## Privacy and human authority

Use this promise:

> Your private inputs are processed by Known Enough to help the group reach a decision. Other participants do not receive those inputs unless you explicitly approve a disclosure or the final agreed outcome inherently reveals something.

Known Enough's backend and permitted AI service process private information inside the trusted boundary. Owner-private AI receives one owner's conversation. Trusted negotiation AI receives confirmed structured constraints across participants, with unnecessary raw explanations excluded. Shared AI receives only the public projection and authorized published disclosures.

No promise of zero leakage, mathematical privacy, confidential computation or prevention of all inference is made. Small groups can infer information from outcomes and timing. A disclosed statement cannot be made unread; revocation stops future publication. Keep raw text only as necessary under a documented retention policy. Use synthetic, non-sensitive data for hackathon testing.

Exception permission, disclosure permission and final approval are independent. AI cannot confirm for an owner, grant a concession, authorize a disclosure or approve an agreement. Organizers and shared assistants cannot exercise owner authority.

## Positioning and demonstration

Alexa+ remains the planned primary track: a stateful shared assistant that explains proposal and approval status from public information. Label the experience **simulated Alexa+** whenever a native host is absent. Native Alexa/MCP is optional and requires actual access verification before any claim.

AWS Builder is a secondary target based only on services actually used. Bedrock, Cognito, DynamoDB, Lambda/API Gateway and SQS are intended components, not a current deployment claim. The [demo direction](known-enough-demo.md) targets 2:30–2:45 and stays below three minutes. The supplied October 23 submission date is a planning assumption; KE16/KE17 must verify current official rules, track eligibility, access and deadlines before release.

Protect private conversations, generic decisions, AI proposals, trust checks, independent consent, exact approvals, Christmas, real Bedrock, the shared simulation and reproducible setup. Cut native integration, extra animations, sophisticated rankings, analytics, extra domains and unnecessary renames first. Keep honest labels, authorization, privacy isolation, confirmation and stale-context protection throughout.
