# Decision-loading runner repair

Status: CODE_READY; focused checks 5/5 PASS. No new live run.

The previous [run](20261019T180154Z/report.md) received HTTP 200 for decision creation, then immediately asserted its title. The screenshot shows the loading shell. Source confirms that both this shell (heading “Your decision”) and the loaded view reuse `open-decision-title`; the runner waited only for that heading to become visible. Later read-only inspection showed the correct saved decision.

Creation and opening now share a bounded readiness check requiring the acknowledged decision ID on the open dialog and its exact expected heading. A loading shell or another decision cannot satisfy it. A genuine missing/incorrect view times out as `DECISION_VIEW_NOT_READY`. No creation retry was added.

Validation: `node --test scripts/e2e03/session-runner.test.mjs` passed 5/5. The added local Chromium fixture checks loading placeholders, another decision with the same title, eventual correct readiness, and a wrong title that must still fail. No website credentials, live app requests, AWS writes, AI calls or new decision records were used in this repair.

The earlier live result remains BLOCKED. Its acknowledged synthetic draft and decision must be reconciled from the private fixture mapping before further writes; do not create duplicates. This runner change needs no application deployment.
