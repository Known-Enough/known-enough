# E2E03 — 2026-10-19T22:42Z

**Result: BLOCKED at the final U1 reopen; the main flow reached agreement.** Runtime `1117433` / API `9e9c3672`, worker `37bcbd5c`; frontend `656c3dc` / Amplify151 ([publication](../network-read-publication.json)).

| Case | Result | Actual evidence |
| --- | --- | --- |
| 01 — private answers persist | **PASS** | Both users signed in, reconciled/reopened the existing fixture and matched their own different saved choices through fresh owner reads. Both decision chips were neutral “Ready for outcome.” Prior acknowledged saves reused; no answer resubmission. [U1 image](case01-u1.png), [U2 image](case01-u2.png). |
| 02 — outcome and two approvals | **BLOCKED at final verification** | One outcome request returned the common option **Board games** in 25.4 seconds. Each distinct owner explicitly approved the same proposal (HTTP 200 twice). U1 initially saw 1/2; U2's fresh owner read then returned **AGREED, 2/2**. U1's final reopen failed, so cross-user final persistence is not fully verified. |
| 03 — optional assistant | NOT_RUN | Outside this bounded run. |

U1's final public-decision GET failed twice with browser `net::ERR_FAILED` at 22:48:03Z, followed by runner `DECISION_VIEW_NOT_READY`. No HTTP status or server UUID was available. Other preceding account/group/owner reads returned HTTP 200; navigation-aborted reads are separately logged. No browser JavaScript error was observed. The raw initiating cause remains unproven; the [bounded server log read](server-readback.json) shows six storage conflicts recovered automatically, with no matching early gateway failure. Correlation is window-only.

**Usage:** one outcome request, two approvals, zero assistant or answer-save requests. The [owned-job readback](owned-job-readback.json) confirms SUCCEEDED, one attempt, 2,419 input / 28 output tokens. Actual provider-call count and billed cost are not recorded; the reservation is not billed cost.

[Events](events.jsonl) · [Summary](summary.json). Case02's failure screenshot was unavailable because the runner's existing global two-image cap was exhausted by case01; the event records this reason. The browser is closed. The fixture and confirmed agreement are retained. Next: read U1's result without repeating any outcome/approval, and diagnose the public-read transport/rate/CORS path. Group-wide chips were not asserted because the reused group contains other decisions.
