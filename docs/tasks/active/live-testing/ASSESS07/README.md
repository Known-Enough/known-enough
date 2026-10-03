# ASSESS07 — Managed verification of corrective changes

Collect real online proof that all required user journeys, safety checks and cleanup pass automatically after a matching successful deployment.

**Status:** IN_PROGRESS — reusable A-only GitHub run approvals are prepared. A still needs to authorize one-time publication of the updated test broker. After activation, a chat instruction such as “Authorize two extra test runs for B today” can be applied through A's GitHub login. No recurring CloudShell step or new script is needed. No new run approval or live test was performed during preparation.

**What happened:** Both authorized automatic runs published the matching release and passed public checks, primary metadata, preflight, fixture startup, model, privacy, and cleanup. QA01 signup/login and QA02 admissions passed in both. QA03's draft request failed in both: the first report says `HTTP_TRANSPORT_FAILED`; the second's fixed safe diagnostic says `HTTP_REQUEST_ABORTED`. QA04–QA07 were blocked. Each run recorded one model attempt and one synthetic signup message. Together, the two fixture starts consumed the transferred two-use allowance. See the [first report](../../../../review-artifacts/ASSESS07-first-a-automatic-run.json) and [second report](../../../../review-artifacts/ASSESS07-second-a-automatic-run.json).

**What failed:** Our script wrote an AWS command incorrectly by adding `true` after a switch that takes no value. The AWS CLI rejected that command before contacting AWS. Earlier parser fixes missed the cause. The corrected command now passes the actual read-only AWS preflight; no slot has been installed and no B test has started.

**Next steps:** Activate the prepared feature through the [GitHub approval workflow](../../../../../infra/live-qa/github-run-approvals.md) after A authorizes publishing. Then record only the exact user-authorized allowance. B starts an authorized staging deployment; matching tests follow automatically. A approves extra runs, B uses them, and the original cost/email/expiry gates remain. Full seven-journey live acceptance remains unproved.

The earlier A takeover is retained below as history; the user has now reassigned the remaining live run to B. After ASSESS07, the shared board schedules the next eligible task.

[Latest actual report](../../../../review-artifacts/ASSESS07-second-a-automatic-run.json).

**Related work:** [LIVE04](../LIVE04/README.md), [NP05](../../../historical/superseded/NP05/README.md).

[Full ticket](ticket.md) · [Task guide](../../../README.md) · [Current board](../../../../task-board.md)
