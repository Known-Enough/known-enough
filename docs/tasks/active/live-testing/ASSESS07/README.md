# ASSESS07 — Managed verification of corrective changes

Collect real online proof that all required user journeys, safety checks and cleanup pass automatically after a matching successful deployment.

**Status:** IN_PROGRESS — reusable GitHub-only run approvals are active. A's [one-time activation](https://github.com/Known-Enough/known-enough/actions/runs/37157321175) succeeded and verified the updated test service's code and unchanged settings. A can approve a specific number for B in chat; the agent records it through A's GitHub login. No recurring CloudShell step or new script is needed. Activation itself did not add runs or start a live test.

**What happened:** Both authorized automatic runs published the matching release and passed public checks, primary metadata, preflight, fixture startup, model, privacy, and cleanup. QA01 signup/login and QA02 admissions passed in both. QA03's draft request failed in both: the first report says `HTTP_TRANSPORT_FAILED`; the second's fixed safe diagnostic says `HTTP_REQUEST_ABORTED`. QA04–QA07 were blocked. Each run recorded one model attempt and one synthetic signup message. Together, the two fixture starts consumed the transferred two-use allowance. See the [first report](../../../../review-artifacts/ASSESS07-first-a-automatic-run.json) and [second report](../../../../review-artifacts/ASSESS07-second-a-automatic-run.json).

**What failed:** Our script wrote an AWS command incorrectly by adding `true` after a switch that takes no value. The AWS CLI rejected that command before contacting AWS. Earlier parser fixes missed the cause. The corrected command now passes the actual read-only AWS preflight; no slot has been installed and no B test has started.

**Next steps:** Record only the exact user-authorized count/recipient through the [GitHub approval workflow](../../../../../infra/live-qa/github-run-approvals.md). B then starts an authorized staging deployment; matching tests follow automatically. A approves, B uses the runs, and original cost/email/expiry/cleanup limits remain. The first actual receipt consumption and full seven-journey live qualification are still pending.

The earlier A takeover is retained below as history; the user has now reassigned the remaining live run to B. After ASSESS07, the shared board schedules the next eligible task.

[Latest actual report](../../../../review-artifacts/ASSESS07-second-a-automatic-run.json).

**Related work:** [LIVE04](../LIVE04/README.md), [NP05](../../../historical/superseded/NP05/README.md).

[Full ticket](ticket.md) · [Task guide](../../../README.md) · [Current board](../../../../task-board.md)
