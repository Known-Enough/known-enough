# Parallel task board

Scheduling revision: September 20, 2026. Tickets are authoritative for detailed gates/status; update this summary when handing off. Model means the human-selected DIRECT worker, with no mandatory Astra coordinator. A/B prefixes identify subsystems; B can implement available A tasks using the [transfer procedure](agent-workflow.md#b-can-cover-a-when-capacity-changes).

Current integration: foundation, A01, workflow refactor, B01 and B02 are on main at the user’s direction. See [main integration](main-integration.md) for combined verification/publication state and [B02.5](reviews/B02.5.md) for review evidence. No new implementation task is claimed by integration.

## Work available now

- A: A02/A03/A03.5 remain REVIEW pending human acceptance. Independent [A03.5 review](reviews/A03.5.md) records PASS for the exact uncommitted R2/R5 correction against `cfb3371`; all preparation findings closed. Fresh full check: 171/171 unit/integration, 29/29 browser. A02.5/A04/A05 are READY, unclaimed, subject to their own prerequisites and synchronization of this artifact; A06 remains ready.
- B: B03 source `27a110c` is integrated into main; REVIEW pending live A02.5/G01 acceptance. No new B task is claimed. B may claim eligible available work using the existing procedure.
- A02.5 is REVIEW by A / Codex GPT-5 (scheduled Terra/medium unavailable): explicit local UI/API transport and refreshed snapshots are implemented, with full-check evidence recorded. Its source changes require independent follow-up review; human acceptance and G01 remain separate. B02’s completed claim is released. Separate clones use main for future work; the integrated legacy task branches are historical pointers; no new work belongs on them.

## First parallel batch: local product

| Task | Direct model / effort | Prerequisite | Outcome / current state |
| --- | --- | --- | --- |
| [A01](tasks/A01.md) | Terra / medium | Foundation | DONE; integrated UI, combined checks passed |
| [A02](tasks/A02.md) | Terra / medium | A01 implementation available | Client/forms against contracts; REVIEW (actual worker recorded in ticket/log) |
| [A03](tasks/A03.md) | Luna / medium | A01 implementation available | Receipts/accessibility with mocks; REVIEW (actual worker: Codex GPT-5) |
| [A06](tasks/A06.md) | Luna / medium | A01 implementation available | Demo/trial/setup drafts; READY |
| [B01](tasks/B01.md) | Sol / high | Foundation | DONE; source/evidence integrated, combined checks passed |
| [B02](tasks/B02.md) | Astra / high | B01 on main | DONE; integrated and verified |
| [B02.5](tasks/B02.5.md) | Astra / high | Reviewable B02 slice | DONE; PASS, evidence reconciled |
| [B03](tasks/B03.md) | Terra / medium | B02 usable implementation | REVIEW; local HTTP integrated from `27a110c`, live acceptance pending |
| [A03.5](tasks/A03.5.md) | Astra / high | A02 + A03 preparation | REVIEW; PASS on exact uncommitted correction against `cfb3371`; human acceptance pending |
| [A02.5](tasks/A02.5.md) | Terra / medium | A02, A03.5, reviewed B02/B02.5, B03 | Actual local API integration |
| [G01](tasks/G01.md) | Astra / high | A02.5, A03.5, B03, B02.5 current evidence | Local end-to-end acceptance checkpoint |

A02/A03/A06 do not wait for B02/B03/G01. A03.5 does not wait for backend code. B03 acceptance still requires review of B02's final critical delta. Integration and human review cannot be replaced with synthetic browser tests.

## Second parallel batch: authenticated product

| Task | Direct model / effort | Prerequisite | Outcome |
| --- | --- | --- | --- |
| [A04](tasks/A04.md) | Terra / medium | A03.5; agreed session interface | Session/reconnect UX using injected responses |
| [A05](tasks/A05.md) | Terra / medium | A02, A03.5 | Draft review/form fallback preparation |
| [B04](tasks/B04.md) | Sol / high | G01 | Identity/persistence implementation |
| [B04.5](tasks/B04.5.md) | Astra / high | G01 + B04 design/first implementation | Midpoint before extending critical approach |
| [A04.5](tasks/A04.5.md) | Terra / medium | A04, completed B04, B04.5, G01 | Real sessions across browser contexts |
| [G02](tasks/G02.md) | Astra / high | A04.5, B04, B04.5 | Privacy/security gate before external testers |
| [B05](tasks/B05.md) | Sol / high | Reviewed B04/B04.5 | Owner extraction/jobs and safe routing |
| [A05.5](tasks/A05.5.md) | Terra / medium | A05, B05, A04.5 | Live extraction with owner confirmation |
| [B06](tasks/B06.md) | Sol / high | B05; explicit approval for cloud actions | Infrastructure/operations and authorized deployment |
| [A06.5](tasks/A06.5.md) | Terra / medium | A06, G01, G02, operational B06 | Integrated transitions, human trials, recording evidence |
| [G03](tasks/G03.md) | Astra / high | A05.5, A06.5, operational B06, G02 | Release readiness; no automatic publish |

A04/A05 preparation can start before G01 when their own prerequisites are ready; A03.5 now passes for the exact recorded artifact and releases its A04/A05/A02.5 blocks. A04 still requires an agreed session interface before relying on it. B04.5 is a milestone inside B04; remaining critical B04 implementation waits for that review. External testers still require G02 and operational readiness.

## Tracking and evidence

- [A handoff](handoff-A.md) / [A log](work-log-A.md)
- [B handoff](handoff-B.md) / [B log](work-log-B.md)
- [Review records](reviews/README.md)
- [Historical execution](task-execution.md) / [verification](verification.md)

Foundation tickets [F00](tasks/F00.md), [F01](tasks/F01.md), [F02](tasks/F02.md) preserve historical evidence. Their displayed models apply only to future follow-up; do not rerun completed foundation tasks because assignments changed.
