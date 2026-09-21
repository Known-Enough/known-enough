# Parallel task board

Scheduling revision: September 20, 2026. Tickets are authoritative for detailed gates/status; update this summary when handing off. Model means the human-selected DIRECT worker, with no mandatory Astra coordinator. A/B prefixes identify subsystems; B can implement available A tasks using the [transfer procedure](agent-workflow.md#b-can-cover-a-when-capacity-changes).

Current knowledge: A01 implemented and REVIEW here; B01 completed and B02 in progress according to the user. B's code, commit IDs and verification are not present in this clone. Do not restart B01/B02 or claim their checks passed locally. The accepted foundation enables current work despite historical review records; final human acceptance of A01 remains outstanding.

## Work available now

- A: claim A02 (Terra medium) for HTTP client/forms preparation. A03 (Luna medium) and A06 (Luna medium) are also ready alternatives. Serialize overlapping frontend files.
- B: continue B02 (Astra high, already active). Present a reviewable slice for B02.5 without restarting. When safely between implementation tasks, B can claim an available A task, especially if A lacks tokens.
- No new implementation task is claimed by this planning update. B02's existing B claim is preserved. Separate clones use main for future work; legacy task branches await authorized integration.

## First parallel batch: local product

| Task | Direct model / effort | Prerequisite | Outcome / current state |
| --- | --- | --- | --- |
| [A01](tasks/A01.md) | Terra / medium | Foundation | Existing UI, REVIEW |
| [A02](tasks/A02.md) | Terra / medium | A01 implementation available | Client/forms against contracts; READY |
| [A03](tasks/A03.md) | Luna / medium | A01 implementation available | Receipts/accessibility with mocks; READY |
| [A06](tasks/A06.md) | Luna / medium | A01 implementation available | Demo/trial/setup drafts; READY |
| [B01](tasks/B01.md) | Sol / high | Foundation | REPORTED_DONE; synchronize evidence |
| [B02](tasks/B02.md) | Astra / high | B01 in B's clone | REPORTED_IN_PROGRESS; B retains claim |
| [B02.5](tasks/B02.5.md) | Astra / high | Reviewable B02 slice | Consent/projection midpoint; evidence needed here |
| [B03](tasks/B03.md) | Terra / medium | B02 usable implementation | Local server; B02.5 required for integration acceptance |
| [A03.5](tasks/A03.5.md) | Astra / high | A02 + A03 preparation | Independent frontend boundary checkpoint |
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

A04/A05 preparation can start before G01 when their own prerequisites are ready. B04.5 is a milestone inside B04, not a requirement to finish B04 before reviewing it. Only the remaining critical B04 implementation waits for that review. External testers still require G02 and the relevant operational readiness.

## Tracking and evidence

- [A handoff](handoff-A.md) / [A log](work-log-A.md)
- [B handoff](handoff-B.md) / [B log](work-log-B.md)
- [Review records](reviews/README.md)
- [Historical execution](task-execution.md) / [verification](verification.md)

Foundation tickets [F00](tasks/F00.md), [F01](tasks/F01.md), [F02](tasks/F02.md) preserve historical evidence. Their displayed models apply only to future follow-up; do not rerun completed foundation tasks because assignments changed.
