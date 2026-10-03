# ASSESS07 — Managed verification of corrective changes

Collect real online proof that all required user journeys, safety checks and cleanup pass automatically after a matching successful deployment.

**Status:** IN_PROGRESS — the user authorized one additional bounded live cycle on 2026-10-03. The two earlier extra starts are spent. A has prepared a one-use, guarded allowance extension that preserves those two uses and all existing per-run/cumulative limits and the original midnight expiry. A must apply it in CloudShell before deployment.

**What happened:** Both authorized automatic runs published the matching release and passed public checks, primary metadata, preflight, fixture startup, model, privacy, and cleanup. QA01 signup/login and QA02 admissions passed in both. QA03's draft request failed in both: the first report says `HTTP_TRANSPORT_FAILED`; the second's fixed safe diagnostic says `HTTP_REQUEST_ABORTED`. QA04–QA07 were blocked. Each run recorded one model attempt and one synthetic signup message. Together, the two fixture starts consumed the transferred two-use allowance. See the [first report](../../../../review-artifacts/ASSESS07-first-a-automatic-run.json) and [second report](../../../../review-artifacts/ASSESS07-second-a-automatic-run.json).

**Next step:** A runs the pinned allowance helper in CloudShell. If it reports exactly one remaining use before `2026-10-04T00:00:00Z`, send that result here; I will dispatch the single authorized deployment and inspect its automatic qualification. Full seven-journey acceptance remains unproved.

Earlier B execution instructions are retained in the ticket as history; the user has now asked A to proceed because B is unavailable. After ASSESS07, the shared board schedules the next eligible task.

[Latest actual report](../../../../review-artifacts/ASSESS07-second-a-automatic-run.json).

**Related work:** [LIVE04](../LIVE04/README.md), [NP05](../../../historical/superseded/NP05/README.md).

[Full ticket](ticket.md) · [Task guide](../../../README.md) · [Current board](../../../../task-board.md)
