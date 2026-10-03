# ASSESS07 — Managed verification of corrective changes

Collect real online proof that all required user journeys, safety checks and cleanup pass automatically after a matching successful deployment.

**Status:** IN_PROGRESS — one additional bounded live cycle is authorized, but its slot is not installed yet. A has fixed and pushed the CloudShell helper so it reveals a safe AWS error code and assigns the one remaining run to B after the guarded update. The user assigned B to run one deployment and automatic test after successful readback. The prior two extra starts remain spent; the new slot expires at `2026-10-04T00:00:00Z`.

**What happened:** Both authorized automatic runs published the matching release and passed public checks, primary metadata, preflight, fixture startup, model, privacy, and cleanup. QA01 signup/login and QA02 admissions passed in both. QA03's draft request failed in both: the first report says `HTTP_TRANSPORT_FAILED`; the second's fixed safe diagnostic says `HTTP_REQUEST_ABORTED`. QA04–QA07 were blocked. Each run recorded one model attempt and one synthetic signup message. Together, the two fixture starts consumed the transferred two-use allowance. See the [first report](../../../../review-artifacts/ASSESS07-first-a-automatic-run.json) and [second report](../../../../review-artifacts/ASSESS07-second-a-automatic-run.json).

**What failed:** Both helper attempts stopped while reading the `AUTH` DynamoDB record (`GetItem`), before making the guarded change. The second printed `Unknown` because the helper missed the AWS CLI's error output. CloudShell had opened a new recovery shell, where the old `$DIR` variable was gone; `/approve.py` was therefore only a missing temporary file. No test slot was added and no test started.

**Next steps:** The CloudShell startup repair is done. A runs the latest pinned helper; it checks both AWS output streams and prints a safe error category if the read fails again. On successful readback, the one-use slot is assigned to B. B then pulls `main`, signs into GitHub as `Battosai1806`, and starts the staging deployment once; GitHub automatically starts its matching live qualification. B does not need AWS credentials or a separate test-workflow click. The exact CloudShell command is in the [runbook](../../../../../infra/live-qa/two-extra-runs.md). Full seven-journey acceptance remains unproved.

The earlier A takeover is retained below as history; the user has now reassigned the remaining live run to B. After ASSESS07, the shared board schedules the next eligible task.

[Latest actual report](../../../../review-artifacts/ASSESS07-second-a-automatic-run.json).

**Related work:** [LIVE04](../LIVE04/README.md), [NP05](../../../historical/superseded/NP05/README.md).

[Full ticket](ticket.md) · [Task guide](../../../README.md) · [Current board](../../../../task-board.md)
