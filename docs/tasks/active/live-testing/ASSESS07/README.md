# ASSESS07 — Managed verification of corrective changes

Collect real online proof that all required user journeys, safety checks and cleanup pass automatically after a matching successful deployment.

**Status:** READY.

**Next step:** B pulls main, claims this first-priority task and verifies the prepared decision-test correction online. The user approved two extra synthetic runs for B, including their matching deployment/automatic tests. AWS's daily allowance has not been changed: The guarded one-time command is now prepared in [the two-run runbook](../../../../../infra/live-qa/two-extra-runs.md) for A to apply in CloudShell. B pulls the updated broker and releases it through the authorized automatic workflow before using extra slots. A's actual allowance readback remains pending. Only A has AWS administrator access; existing GitHub roles cannot change the approval record. Keep accumulated usage, total cost limits, cleanup and original expiry. Real email/login/invitations pass; the full journey is still unverified.

A has released this claim for B. After completion: ASSESS10, then OPS01 → OPS02 → OPS03 under their existing gates.

[Latest actual report](../../../../review-artifacts/ASSESS07-email-login-pass-decision-failure.json).

**Related work:** [LIVE04](../LIVE04/README.md), [NP05](../../../historical/superseded/NP05/README.md).

[Full ticket](ticket.md) · [Task guide](../../../README.md) · [Current board](../../../../task-board.md)
