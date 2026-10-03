# ASSESS07 — Managed verification of corrective changes

Collect real online proof that all required user journeys, safety checks and cleanup pass automatically after a matching successful deployment.

**Status:** IN_PROGRESS — the one-use allowance helper is fixed and its real AWS read-only check passes. A still needs to apply it in CloudShell before B can execute the single authorized live cycle. Both prior starts stay spent; expiry remains `2026-10-04T00:00:00Z`.

**What happened:** Both authorized automatic runs published the matching release and passed public checks, primary metadata, preflight, fixture startup, model, privacy, and cleanup. QA01 signup/login and QA02 admissions passed in both. QA03's draft request failed in both: the first report says `HTTP_TRANSPORT_FAILED`; the second's fixed safe diagnostic says `HTTP_REQUEST_ABORTED`. QA04–QA07 were blocked. Each run recorded one model attempt and one synthetic signup message. Together, the two fixture starts consumed the transferred two-use allowance. See the [first report](../../../../review-artifacts/ASSESS07-first-a-automatic-run.json) and [second report](../../../../review-artifacts/ASSESS07-second-a-automatic-run.json).

**What failed:** Our script wrote an AWS command incorrectly by adding `true` after a switch that takes no value. The AWS CLI rejected that command before contacting AWS. Earlier parser fixes missed the cause. The corrected command now passes the actual read-only AWS preflight; no slot has been installed and no B test has started.

**Next steps:** A pastes the checked block in the [runbook](../../../../../infra/live-qa/two-extra-runs.md) into CloudShell. After `THIRD_RUN_APPROVED_FOR_B` with one remaining, B pulls `main`, signs into GitHub as `Battosai1806`, and starts one staging deployment. GitHub automatically runs the matching live tests. B needs no AWS credentials or separate test click. Focused12/12 and full project checks passed; full seven-journey live acceptance remains unproved.

The earlier A takeover is retained below as history; the user has now reassigned the remaining live run to B. After ASSESS07, the shared board schedules the next eligible task.

[Latest actual report](../../../../review-artifacts/ASSESS07-second-a-automatic-run.json).

**Related work:** [LIVE04](../LIVE04/README.md), [NP05](../../../historical/superseded/NP05/README.md).

[Full ticket](ticket.md) · [Task guide](../../../README.md) · [Current board](../../../../task-board.md)
