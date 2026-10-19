# E2E03 live retest 20261019T183505Z

State: **BLOCKED — case 01 failed**. Both synthetic users signed in and confirmed the same existing group, draft and `Friday activity` decision. No group, draft or decision was created. Opening the decision worked for both users; `/account`, `/account/profile` and group-list reads returned HTTP 200 throughout the observed browser actions, so the earlier account-loading 503 did not recur in this run.

U1’s private answer saved once (`POST /decisions/:id/commands` HTTP 200) and the owner readback matched. U2’s one save was rejected with HTTP **409 `STALE_CONTEXT`**, reference `998fac95-f718-4113-91d8-c0802b401bb1`. U2 had opened the decision before U1 saved. The likely issue is that U2’s page still held the earlier decision version; the server’s exact conflict details were not logged. The save was not repeated, and U2’s saved state remains unconfirmed. A later read-only refresh timed out in the runner without an observed app HTTP error; the runner was interrupted after recording it, so its exit code/time are unavailable.

| Case | Result | Actual result |
| --- | --- | --- |
| 01 — two private saves | FAIL | U1 save/readback passed; U2 save rejected as stale context. |
| 02 — one outcome/two approvals | NOT_RUN | Depends on both answers. |
| 03 — optional assistant | NOT_RUN | Optional; not attempted. |

Observed app writes: **2 requests** (one accepted, one rejected). No outcome, assistant, model, email or signup request occurred. Token usage was not read. No duplicate fixture was made.

Evidence: [event journal](events.jsonl), [summary](summary.json), [U2 stale-save screenshot](u2.save-answer-failure.png), [refresh-timeout screenshot](u2.refresh-failure.png). Next safe step: read U2’s own saved-answer state once, then repair stale-context refresh/recovery before rerunning. Do not resend the rejected save before that readback.

Serving runtime remained API `5499a8e8a7116c8204b7da33fe161139120182b3`, worker `33f5d50edb119df13ba570993bfea388d42dfb8c56883e506efb2748ca6eb674`, frontend Amplify job `145`.
