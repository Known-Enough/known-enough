# ASSESS07 — Managed verification of corrective changes

Collect real online proof that all required user journeys, safety checks and cleanup pass automatically after a matching successful deployment.

**Status:** IN_PROGRESS — B retains the same dedicated worker/claim. [Two new runs are approved](https://github.com/Known-Enough/known-enough/actions/runs/37167291403), valid until October4,18:00 Mexico City. B must verify current budget/expiry/cleanup/counters before testing; approval is not consumption or a live PASS. The October3 receipt is expired history; original usage and spending limits remain unchanged.

**What happened:** Both authorized automatic runs published the matching release and passed public checks, primary metadata, preflight, fixture startup, model, privacy, and cleanup. QA01 signup/login and QA02 admissions passed in both. QA03's draft request failed in both: the first report says `HTTP_TRANSPORT_FAILED`; the second's fixed safe diagnostic says `HTTP_REQUEST_ABORTED`. QA04–QA07 were blocked. Each run recorded one model attempt and one synthetic signup message. Together, the two fixture starts consumed the transferred two-use allowance. See the [first report](../../../../review-artifacts/ASSESS07-first-a-automatic-run.json) and [second report](../../../../review-artifacts/ASSESS07-second-a-automatic-run.json).

**Current blocker:** In the latest actual online run, signup/login and invitations worked, but decision draft generation failed. The checked prompt correction still needs API publication and real verification; the four later journeys were blocked by that failure. Earlier CloudShell command problems have been superseded by the active GitHub approval flow.

**Next steps:** B pulls clean main, verifies GitHub login `Battosai1806`, claims this task and starts the existing staging deployment. Matching tests run automatically, with no AWS login, CloudShell or separate test click. Inspect source-matching results and clean test cleanup before using a second authorized cycle. Use at most two dated extra starts before their deadline. Record actual receipt consumption and all-seven results; approval alone is not a passing test. [Approval evidence](../../../../review-artifacts/ASSESS07-github-two-b-runs-approved.json) · [Approval runbook](../../../../../infra/live-qa/github-run-approvals.md).

The dated earlier takeover and one-use requests remain in the ticket as history; current execution follows this verified two-run B receipt and the shared sequential board.

[Latest actual report](../../../../review-artifacts/ASSESS07-second-a-automatic-run.json).

**Related work:** [LIVE04](../LIVE04/README.md), [NP05](../../../historical/superseded/NP05/README.md).

[Full ticket](ticket.md) · [Task guide](../../../README.md) · [Current board](../../../../task-board.md)
