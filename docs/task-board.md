# Known Enough — shared task queue

One project-wide priority queue, one active implementation or review at a time. Either user gets the same next eligible task. Tickets own status, prerequisites and claims; the [workflow](agent-workflow.md) governs synchronization and transfer. The [pivot record](known-enough-pivot.md) maps every old ticket and distinguishes source presence from acceptance. New product work follows [product](known-enough-product.md) and [architecture](known-enough-architecture.md).

## Current gate and claim

**KE13A REVIEW: AWS staging preparation complete**, explicitly prioritized by the user ahead of generic product implementation. Claim finished by initiating user / A log; actual Codex GPT-6, variant/effort unexposed. AWS CLI v2 is installed; `known-enough-staging-ro` is authenticated and STS verified the `ReadOnlyAccess` role in `us-east-1`. The user configured the Identity Center user and read-only assignment. The earlier root CLI session was logged out. No Known Enough application resources or deployment are underway. Baseline: clean `main` after a successful `git pull --ff-only origin main`, local KE00 checkpoint `a5d1833` (one commit ahead of `origin/main` `65359eb`). See [KE13A](tasks/KE13A.md) and the [staging runbook](../infra/staging-runbook.md).

**KE00 remains REVIEW**: its documentation-only pivot audit is ready for human acceptance. This user-authorized preparation does not accept KE00, and KE01 remains BLOCKED until KE00 acceptance and a fresh claim. No generic product implementation is active.

**Retained foundation gate:** B04/B04.5 remain REVIEW pending human acceptance. Their source and latest independent R11/R12 PASS are already integrated through origin/main `65359eb`; there is no local-only B04 delta in this checkout. KE01 may define contracts after KE00 acceptance; KE02 and later backend implementation additionally require the retained B04/B04.5 human gate. Managed Cognito/DynamoDB/IAM and deployment acceptance remain future evidence, not prerequisites disguised as completed tests.

**AWS staging sequence:** [KE13A](tasks/KE13A.md) prepares the runbook; [KE13B](tasks/KE13B.md) is the future sequential `gpt-6-sol` / high implementation handoff, still gated by the accepted product/backend prerequisites and explicit scope authorization; [KE13](tasks/KE13.md) remains the separate live deployment and operational acceptance gate. KE13A is REVIEW and its claim is released; no task is active. KE00 and B04/B04.5 statuses are unchanged.

| Task | Direct model / effort | Prerequisite / gate | Status and outcome |
| --- | --- | --- | --- |
| [KE13A](tasks/KE13A.md) | Current Codex GPT-6; exact variant/effort unexposed | User-authorized early preparation | REVIEW — prep and read-only SSO STS check complete; human review remains |
| [KE13B](tasks/KE13B.md) | `gpt-6-sol` / high, selected by the human at claim | Accepted KE00, B04/B04.5 and KE12; reviewed KE13A handoff; explicit bounded implementation/cloud authorization | BLOCKED — authenticated API, DynamoDB persistence and least-privilege IAM implementation; sequential independent review required |

## Sequential Known Enough queue

Implementation successors require acceptance of the preceding scope. The independent KE09 review starts from KE08 REVIEW with the writer paused, then its verdict and human acceptance gate KE10; implementation REVIEW never releases downstream implementation on its own. Preparation/mock evidence never substitutes for required live evidence. No later task may be claimed by skipping an unresolved gate.

| Task | Direct model / effort | Prerequisite / gate | Status and outcome |
| --- | --- | --- | --- |
| [KE00](tasks/KE00.md) | `gpt-6-astra` / high scheduled; actual GPT-6, variant unexposed | User-directed first task | REVIEW — pivot audit and authority reset; human acceptance pending |
| [KE01](tasks/KE01.md) | `gpt-6-astra` / high | KE00 human acceptance | BLOCKED — generic contracts and critical review |
| [KE02](tasks/KE02.md) | `gpt-6-astra` / high design, then `gpt-6-sol` / high implementation | KE01 + B04/B04.5 human acceptance | BLOCKED — small trust kernel |
| [KE03](tasks/KE03.md) | `gpt-6-sol` / high | KE02 | BLOCKED — application and versioned storage adaptation |
| [KE04](tasks/KE04.md) | `gpt-6-sol` / medium | KE03 | BLOCKED — TeamTable regression bridge |
| [KE05](tasks/KE05.md) | `gpt-6-luna` / medium | KE04 | BLOCKED — Known Enough product shell |
| [KE06](tasks/KE06.md) | `gpt-6-sol` / high | KE05 | BLOCKED — injected AI decision architect |
| [KE07](tasks/KE07.md) | `gpt-6-sol` / high | KE06 | BLOCKED — private participant conversation/confirmation |
| [KE08](tasks/KE08.md) | `gpt-6-sol` / high | KE07 | BLOCKED — candidate generation/private negotiation |
| [KE09](tasks/KE09.md) | `gpt-6-astra` / high, independent session | KE08 paused for review | BLOCKED — privacy/consent gate; later sequential follow-ups |
| [KE10](tasks/KE10.md) | `gpt-6-sol` / high | Accepted KE09 + authorized real model calls for live acceptance | BLOCKED — Bedrock and async jobs |
| [KE11](tasks/KE11.md) | `gpt-6-sol` / high | KE10 + current critical follow-up | BLOCKED — authenticated multi-participant sessions |
| [KE12](tasks/KE12.md) | `gpt-6-sol` / high | KE11 | BLOCKED — stateful simulated Alexa+ shared assistant |
| [KE13](tasks/KE13.md) | `gpt-6-sol` / high | KE13B accepted + KE12 and all earlier gates + explicit live deployment authorization | BLOCKED — separate deployed AWS/operations evidence |
| [KE14](tasks/KE14.md) | `gpt-6-sol` / high | KE13 operational acceptance | BLOCKED — Christmas and hypothetical purchase qualification |
| [KE15](tasks/KE15.md) | `gpt-6-luna` / medium | KE14 + current independent privacy gate + authorized volunteer access | BLOCKED — actual synthetic-data trials/UX corrections |
| [KE16](tasks/KE16.md) | `gpt-6-luna` / medium | KE15 | BLOCKED — truthful demo/submission materials |
| [KE17](tasks/KE17.md) | `gpt-6-astra` / high, independent session | KE16 and all current review/live evidence | BLOCKED — final release gate |

Independent reviews are sequential gates, including KE01/KE02/KE03 critical changes and KE09 follow-ups after KE10–KE13. An implementation pauses while its reviewer claims the single active slot. Final human acceptance/publication authorization is separate from PASS. No model name is evidence of execution.

## Retained acceptance and historical evidence

| Tickets | Current retained status | Meaning |
| --- | --- | --- |
| [F00](tasks/F00.md), [F01](tasks/F01.md), [F02](tasks/F02.md), [A01](tasks/A01.md), [B01](tasks/B01.md), [B02](tasks/B02.md), [B02.5](tasks/B02.5.md), [G01](tasks/G01.md) | DONE | Historical foundation/local TeamTable acceptance; do not restart |
| [A02](tasks/A02.md), [A03](tasks/A03.md), [A03.5](tasks/A03.5.md), [A02.5](tasks/A02.5.md), [B03](tasks/B03.md) | REVIEW | Preserve exact implementation/review scope and pending human acceptance; adapt useful work through KE tasks |
| [A05](tasks/A05.md) | REVIEW | Reviewed mock draft UX and A03.5 follow-up PASS; human/live acceptance not inferred |
| [B04](tasks/B04.md), [B04.5](tasks/B04.5.md) | REVIEW | Integrated retained identity/storage foundation; independent correction PASS, human acceptance pending |

[All eleven replaced future tasks](known-enough-pivot.md#complete-old-task-mapping) are SUPERSEDED: A04, A04.5, B05, A05.5, B06, T01, T02, A06, A06.5, G02 and G03. Their historical bodies/statuses remain visible for provenance but cannot schedule work. G02's protection survives in KE09 and post-model/session/cloud follow-up; G03 becomes KE17. No old REVIEW task is automatically accepted or forced through obsolete requirements.

## Tracking

[KE00 handoff / A](handoff-A.md), [A log](work-log-A.md), [B historical handoff](handoff-B.md), [B log](work-log-B.md), [review records](reviews/README.md), [integration](main-integration.md), [verification history](verification.md), [original queue](reference/pre-pivot/task-board-2026-09-26.md.txt). Historical handoffs do not override this queue or ticket status. Sharing/pushing remains separately authorized; local logs are not cross-clone locks.
