# Known Enough — shared task queue

One project-wide priority queue, one active implementation or review at a time. Either user gets the same next eligible task. Tickets own status, prerequisites and claims; the [workflow](agent-workflow.md) governs synchronization and transfer. The [pivot record](known-enough-pivot.md) maps every old ticket and distinguishes source presence from acceptance. New product work follows [product](known-enough-product.md) and [architecture](known-enough-architecture.md).

## Current gate and claim

**Token-efficient execution:** routine tasks advance on their focused checks; no separate project-level human sign-off blocks task progress. At KE08, show the first end-to-end MVP for one product testing/feedback pass, then run the single KE09 architecture/privacy review. Preserve B04/B04.5 technical evidence, KE13B's focused backend/IAM review, KE13 live operations verification, KE17 final technical review, and follow-ups only for material changes to reviewed boundaries.

**MVP model choice (2026-09-27):** use `gpt-6-luna` / high for all direct work on KE01–KE08. This changes only the model/effort assignment; task order, scope and technical review gates stay the same. Astra remains assigned to the KE09 post-MVP architecture/privacy checkpoint, KE17 and any post-MVP architectural change the user explicitly decides needs it. Other post-MVP assignments are unchanged.

**Temporary sign-off deferral (2026-09-27):** project-level human acceptance is paused until the user reinstates it. Record technical outcomes and retain existing statuses; do not mark work accepted on the user's behalf. This does not waive participant consent/approval behavior or explicit authorization for cloud changes, spending, paid calls or publication.

**KE02 is IN_PROGRESS** from synchronized `main` `b91cb2e`; Codex GPT-6 is the direct worker and exact runtime variant/effort are not exposed. See [ticket](tasks/KE02.md) and [B handoff](handoff-B.md). Do not start another task concurrently. Stage 0 is deployed and online: [https://d23eowhnwtqts3.cloudfront.net/](https://d23eowhnwtqts3.cloudfront.net/). It is the fixed synthetic hosted mock only; there is no authentication or shared state. See the [runbook](../infra/staging-runbook.md) for resources, hashes, CLI identities, verification and cleanup. Completed tasks, reviewed checkpoints and documentation-only updates are pushed to `origin/main`; the other clone must pull before starting the next task.

**[KE13C policy follow-up](tasks/KE13C-policy-followup.md) remains REVIEW with independent PASS** on exact `f1893e3..6238700`; P1/P2 are closed for that draft. Its reviewed release policy and exact OAC-only bucket policy were used for the Stage 0 deployment. This does not accept KE13 operational evidence. The hosted-preview build remains DONE and unchanged: user accepted the reported PASS on `a5d1833..a625498` on 2026-09-27. The review records two non-blocking permanent-check gaps. See [KE13C](tasks/KE13C.md), [build review](reviews/KE13C.md), and [policy review](reviews/KE13C-policy.md).

**KE00 DONE**: user accepted the documentation-only pivot audit on 2026-09-26. **KE01 DONE**: schema-v2 contracts, privacy projections, fixtures, canonical public hash and documented compatibility decisions passed the ticket checks; see [ticket](tasks/KE01.md) and [Contract v2](contracts.md#ke01-generic-contract-v2). KE02 now owns the single active implementation claim.

**Retained foundation evidence:** B04/B04.5 remain REVIEW with their source and latest independent R11/R12 PASS integrated through origin/main `65359eb`; there is no local-only B04 delta in this checkout. Their project-level human sign-off is deferred and no longer blocks KE02. Do not mark either task DONE or accepted. KE01 follows completed KE00; KE02 still requires KE01 and uses the retained B04/B04.5 technical baseline. Managed Cognito/DynamoDB/IAM still require live technical evidence and explicit cloud authorization.

**AWS staging sequence:** [KE13A](tasks/KE13A.md) preparation is DONE; [KE13C](tasks/KE13C.md) deployed the Stage 0 static public-fixture preview; [KE13B](tasks/KE13B.md) remains the future sequential `gpt-6-sol` / high backend implementation, gated by KE12 and its named technical reviews; [KE13](tasks/KE13.md) remains separate authenticated operations verification and requires explicit authorization for each cloud change. The old KE13A-P candidate was not used; its temporary setup permission set was removed. B04/B04.5 remain REVIEW with project sign-off deferred.

| Task | Direct model / effort | Prerequisite / gate | Status and outcome |
| --- | --- | --- | --- |
| [KE13C](tasks/KE13C.md) | Current Codex GPT-6; exact variant/effort unexposed | User-authorized Stage 0; KE00 and KE13A accepted | DONE — accepted mock deployed; HTTPS returns 200; no shared application state |
| [KE13C policy follow-up](tasks/KE13C-policy-followup.md) | Current Codex GPT-6; exact variant/effort unexposed | Reported CHANGES_REQUESTED against `f1893e3`; accepted build stays separate | REVIEW — independent focused PASS; policy used for Stage 0; final KE13 operations remain pending |
| [KE13A-P](tasks/KE13A-provisioner-policy.md) | Requested sequential Sol/high for IAM; focused docs fix by current Codex GPT-6, exact variant/effort unexposed | Explicit CLI setup authorization; candidate review remains separate | REVIEW — candidate not used; temporary setup permission set removed; no assignment planned |
| [KE13A](tasks/KE13A.md) | Current Codex GPT-6; exact variant/effort unexposed | User-authorized early preparation | DONE — prep and read-only SSO STS check complete; user accepted |
| [KE13B](tasks/KE13B.md) | `gpt-6-sol` / high, selected by the human at claim | KE12; B04 technical baseline; reviewed KE13A handoff; explicit bounded implementation/cloud authorization | BLOCKED — authenticated API, DynamoDB persistence and least-privilege IAM; one focused architecture review after its first shared-state vertical slice |

## Sequential Known Enough queue

Routine implementation successors become eligible when the prior task reaches DONE with its ticket checks recorded; no separate user sign-off is required. KE08 is the MVP product test/feedback checkpoint, followed by the one KE09 privacy/architecture review before real model calls. KE13B retains one focused review of the authenticated backend/IAM boundary before KE13 operational verification. Preparation/mock evidence never substitutes for required live evidence. No later task may skip a named technical gate or explicit authorization.

| Task | Direct model / effort | Prerequisite / gate | Status and outcome |
| --- | --- | --- | --- |
| [KE00](tasks/KE00.md) | `gpt-6-astra` / high scheduled; actual GPT-6, variant unexposed | User-directed first task | DONE — user accepted the pivot audit on 2026-09-26 |
| [KE01](tasks/KE01.md) | `gpt-6-luna` / high target; runtime variant/effort unexposed | KE00 DONE | DONE — v2 generic contracts, privacy allowlists, fixtures and compatibility notes; full check passed |
| [KE02](tasks/KE02.md) | `gpt-6-luna` / high target; runtime variant/effort unexposed | KE01 + retained B04/B04.5 technical baseline | IN_PROGRESS — sequential bounded design then deterministic kernel implementation |
| [KE03](tasks/KE03.md) | `gpt-6-luna` / high | KE02 | BLOCKED — application and versioned storage adaptation |
| [KE04](tasks/KE04.md) | `gpt-6-luna` / high | KE03 | BLOCKED — TeamTable regression bridge |
| [KE05](tasks/KE05.md) | `gpt-6-luna` / high | KE04 | BLOCKED — product shell waits for KE04 |
| [KE06](tasks/KE06.md) | `gpt-6-luna` / high | KE05 | BLOCKED — injected AI decision architect |
| [KE07](tasks/KE07.md) | `gpt-6-luna` / high | KE06 | BLOCKED — private participant conversation/confirmation |
| [KE08](tasks/KE08.md) | `gpt-6-luna` / high | KE07 | BLOCKED — candidate generation/private negotiation |
| [KE09](tasks/KE09.md) | `gpt-6-astra` / high, independent session | KE08 paused for review | BLOCKED — privacy/consent gate; later sequential follow-ups |
| [KE10](tasks/KE10.md) | `gpt-6-sol` / high | KE09 independent PASS + separately authorized real model calls | BLOCKED — Bedrock and async jobs |
| [KE11](tasks/KE11.md) | `gpt-6-sol` / high | KE10 + current critical follow-up | BLOCKED — authenticated multi-participant sessions |
| [KE12](tasks/KE12.md) | `gpt-6-sol` / high | KE11 | BLOCKED — stateful simulated Alexa+ shared assistant |
| [KE13](tasks/KE13.md) | `gpt-6-sol` / high | KE13B implementation + independent PASS, KE12 and all earlier technical gates + explicit live deployment authorization | BLOCKED — separate deployed AWS/operations evidence |
| [KE14](tasks/KE14.md) | `gpt-6-sol` / high | KE13 operational evidence recorded | BLOCKED — Christmas and hypothetical purchase qualification |
| [KE15](tasks/KE15.md) | `gpt-6-luna` / medium | KE14 + current independent privacy gate + authorized volunteer access | BLOCKED — actual synthetic-data trials/UX corrections |
| [KE16](tasks/KE16.md) | `gpt-6-luna` / medium | KE15 | BLOCKED — truthful demo/submission materials |
| [KE17](tasks/KE17.md) | `gpt-6-astra` / high, independent session | KE16 and all current review/live evidence | BLOCKED — final release gate |

Named independent reviews are sequential technical gates; do not create additional per-task or per-commit reviews. KE09 reviews the accumulated KE01–KE08 artifact once after the MVP; material later model/session/cloud changes get focused KE09 follow-up, and KE13B has its named backend/IAM review. KE08 product feedback is informational; KE13 operational verification and KE17 final technical review require recorded evidence, not separate project sign-off. No model name is evidence of execution.

## Retained acceptance and historical evidence

| Tickets | Current retained status | Meaning |
| --- | --- | --- |
| [F00](tasks/F00.md), [F01](tasks/F01.md), [F02](tasks/F02.md), [A01](tasks/A01.md), [B01](tasks/B01.md), [B02](tasks/B02.md), [B02.5](tasks/B02.5.md), [G01](tasks/G01.md) | DONE | Historical foundation/local TeamTable acceptance; do not restart |
| [A02](tasks/A02.md), [A03](tasks/A03.md), [A03.5](tasks/A03.5.md), [A02.5](tasks/A02.5.md), [B03](tasks/B03.md) | REVIEW | Preserve exact implementation/review scope; project sign-off deferred; adapt useful work through KE tasks |
| [A05](tasks/A05.md) | REVIEW | Reviewed mock draft UX and A03.5 follow-up PASS; project sign-off deferred and live evidence remains separate |
| [B04](tasks/B04.md), [B04.5](tasks/B04.5.md) | REVIEW | Integrated retained identity/storage foundation; independent correction PASS; project sign-off deferred and nonblocking for KE02 |

[All eleven replaced future tasks](known-enough-pivot.md#complete-old-task-mapping) are SUPERSEDED: A04, A04.5, B05, A05.5, B06, T01, T02, A06, A06.5, G02 and G03. Their historical bodies/statuses remain visible for provenance but cannot schedule work. G02's protection survives in KE09 and post-model/session/cloud follow-up; G03 becomes KE17. No old REVIEW task is automatically accepted or forced through obsolete requirements.

## Tracking

[KE00 handoff / A](handoff-A.md), [A log](work-log-A.md), [B historical handoff](handoff-B.md), [B log](work-log-B.md), [review records](reviews/README.md), [integration](main-integration.md), [verification history](verification.md), [original queue](reference/pre-pivot/task-board-2026-09-26.md.txt). Historical handoffs do not override this queue or ticket status. Completed task commits and verified documentation-only updates are pushed to `origin/main` under the standing user authorization; the other clone must pull before the next task. Local logs are not cross-clone locks.
