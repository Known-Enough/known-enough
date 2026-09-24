# Shared task queue

Scheduling revision: September 22, 2026; sequential priority and current model IDs aligned September 23, 2026. Both users follow one project-wide queue, with one active task at a time. A/B task prefixes are stable historical IDs, not user assignments or permanent subsystem ownership. Tickets are authoritative for status, prerequisites and current claims; follow the [sequential claim/transfer procedure](agent-workflow.md#shared-pool-claims-and-transfers). Either user gets the same next task. Existing active claims and independent review requirements remain in force.

Current integration: foundation, A01, workflow refactor, B01 and B02 are on main at the user’s direction. See [main integration](main-integration.md) for combined verification/publication state and [B02.5](reviews/B02.5.md) for review evidence. No new implementation task is claimed by integration.

## Project-wide priority

- **Current task: B04 invitation issuance/redemption.** Claim recorded at baseline `3013297` on clean `main`; actual worker is GPT-6 Codex with variant/effort unexposed (not claimed as the ticket's `gpt-6-sol` / high target). Bounded behavior: organizer issues single-use invites only for pre-provisioned pending memberships; redemption requires the membership's exact verified subject and atomically activates that member. Token storage is hash-only, expiry is application-enforced, and invalid/wrong-subject/expired/replayed tokens share a generic response. Pause after the first reviewable implementation slice for sequential B04.5 review. No cloud action or publication is implied.
- A05 mock preparation is complete and remains REVIEW after independent A03.5 privacy follow-up PASS; its own human acceptance remains pending.
- Then follow the critical path through [A04](tasks/A04.md) → [A04.5](tasks/A04.5.md) → [G02](tasks/G02.md), then [A05](tasks/A05.md) → [B05](tasks/B05.md) → [A05.5](tasks/A05.5.md). B06 follows B05 when its cloud actions are explicitly authorized. Continue with the AI extension [T01](tasks/T01.md) → [T02](tasks/T02.md) after their prerequisites, then trial/demo integration [A06](tasks/A06.md) → [A06.5](tasks/A06.5.md) → [G03](tasks/G03.md).
- A04, A06 and T01 remain READY candidates only when their ticket prerequisites hold. The queue order applies equally to either user; A/B prefixes do not decide ownership. A02/A03/A03.5, A02.5 and B03 remain REVIEW; G01 is DONE. Do not restart completed B01/B02.

## Foundation and local product

These rows record dependency and review state. They are not simultaneous work lanes; only one task may be active project-wide.

| Task | Direct model / effort | Prerequisite | Outcome / current state |
| --- | --- | --- | --- |
| [A01](tasks/A01.md) | `gpt-6-sol` / medium | Foundation | DONE; integrated UI, combined checks passed |
| [A02](tasks/A02.md) | `gpt-6-sol` / medium | A01 implementation available | Client/forms against contracts; REVIEW (actual worker recorded in ticket/log) |
| [A03](tasks/A03.md) | `gpt-6-luna` / medium | A01 implementation available | Receipts/accessibility with mocks; REVIEW (actual worker: Codex GPT-5) |
| [A06](tasks/A06.md) | `gpt-6-luna` / medium | A01 implementation available | Demo/trial/setup drafts; READY |
| [B01](tasks/B01.md) | `gpt-6-sol` / high | Foundation | DONE; source/evidence integrated, combined checks passed |
| [B02](tasks/B02.md) | `gpt-6-astra` / high | B01 on main | DONE; integrated and verified |
| [B02.5](tasks/B02.5.md) | `gpt-6-astra` / high | Reviewable B02 slice | DONE; PASS, evidence reconciled |
| [B03](tasks/B03.md) | `gpt-6-sol` / medium | B02 usable implementation | REVIEW; local HTTP integrated from `27a110c`, live acceptance pending |
| [A03.5](tasks/A03.5.md) | `gpt-6-astra` / high | A02 + A03 preparation | REVIEW; preparation PASS rechecked on `bc02dc6`; human acceptance pending |
| [A02.5](tasks/A02.5.md) | `gpt-6-sol` / medium | A02, A03.5, reviewed B02/B02.5, B03 | REVIEW; synchronized repairs, combined evidence in G01 |
| [G01](tasks/G01.md) | `gpt-6-astra` / high | A02.5, A03.5, B03, B02.5 current evidence | DONE; local integration checkpoint independently reviewed and human accepted 2026-09-23 |

Task prerequisites determine eligibility; the project-wide priority above determines order. G01 is accepted. B04's exact unified code correction passed independent B04.5 review, but B04 remains REVIEW pending human acceptance/integration and real-adapter evidence. B03 acceptance still requires review of B02 final critical delta. Integration and human review cannot be replaced with synthetic browser tests.

## Authenticated product and later gates

Work through these tasks in priority order, one at a time, after their stated prerequisites are satisfied.

| Task | Direct model / effort | Prerequisite | Outcome |
| --- | --- | --- | --- |
| [A04](tasks/A04.md) | `gpt-6-luna` / medium | A03.5; agreed session interface | Session/reconnect UX using injected responses |
| [A05](tasks/A05.md) | `gpt-6-luna` / medium | A02, A03.5 | REVIEW; host-simulation language draft and form fallback; A03.5 privacy follow-up PASS |
| [B04](tasks/B04.md) | `gpt-6-sol` / high | G01 | IN_PROGRESS; local checks pass; single-use room-invitation replay/redemption is not implemented |
| [B04.5](tasks/B04.5.md) | `gpt-6-astra` / high | G01 + B04 design/first implementation | REVIEW; exact-code follow-up PASS on `a058cc5` |
| [A04.5](tasks/A04.5.md) | `gpt-6-luna` / medium | A04, completed B04, B04.5, G01 | Real sessions across browser contexts |
| [G02](tasks/G02.md) | `gpt-6-astra` / high | A04.5, B04, B04.5 | Privacy/security gate before external testers |
| [B05](tasks/B05.md) | `gpt-6-sol` / high | Reviewed B04/B04.5 | Owner extraction/jobs and safe routing |
| [A05.5](tasks/A05.5.md) | `gpt-6-luna` / medium | A05, B05, A04.5 | Live extraction with owner confirmation |
| [B06](tasks/B06.md) | `gpt-6-sol` / high | B05; explicit approval for cloud actions | Infrastructure/operations and authorized deployment |
| [A06.5](tasks/A06.5.md) | `gpt-6-luna` / medium | A06, G01, G02, operational B06, T02 | Integrated transitions, human trials, recording evidence |
| [G03](tasks/G03.md) | `gpt-6-astra` / high | A05.5, A06.5, operational B06, G02, T02 | Release readiness; no automatic publish |

A04/A05 preparation does not technically depend on G01, and A03.5 passes for the exact recorded artifact. G01 is DONE for the reviewed local checkpoint; B04 is paused for the sequential B04.5 review of the unified artifact. Earlier B04.5 verdicts remain scoped to their named branch artifacts. A05 mock preparation remains REVIEW pending its separate human acceptance. A04 still requires an agreed session interface. External testers still require G02 and operational readiness.

## AI facilitator extension

Existing A05/B05/A05.5 cover private extraction and confirmation. These neutral-ID tasks add the missing shared-objective and explanation experience without duplicating that work. This extension follows the core identity, persistence and privacy gates in the single queue.

| Task | Direct model / effort | Prerequisite | Outcome / current state |
| --- | --- | --- | --- |
| [T01](tasks/T01.md) | `gpt-6-luna` / medium + `gpt-6-astra` independent review | Current product/contracts; existing AI ticket scope | READY, unclaimed; bounded interaction/privacy design and evaluation specification |
| [T02](tasks/T02.md) | `gpt-6-sol` / high | Reviewed T01, B05, A05.5, G02; authorized live calls | BLOCKED; implement and verify AI facilitator; independent review of new boundaries |

A06 can draft a clearly labeled future AI narrative after T01; A06.5's final integrated recording and G03 require T02 evidence. Initial G02 enables T02; T02's changed boundaries require follow-up G02 review before release. This is not a dependency cycle or authorization to deploy/spend.

## Tracking and evidence

- [A handoff](handoff-A.md) / [A log](work-log-A.md)
- [B handoff](handoff-B.md) / [B log](work-log-B.md)
- [Review records](reviews/README.md)
- [Historical execution](task-execution.md) / [verification](verification.md)

Foundation tickets [F00](tasks/F00.md), [F01](tasks/F01.md), [F02](tasks/F02.md) preserve historical evidence. Their displayed models apply only to future follow-up; do not rerun completed foundation tasks because assignments changed.
