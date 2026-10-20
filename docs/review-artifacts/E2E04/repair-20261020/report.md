# E2E04 repair

Status: CODE_READY; compatible publication and live qualification pending. Direct user request covers the two failed cases among six, plus review of the strict drafting-label criterion. Own Battosai1806; pulled76549c0d first.

## Evidence and changes

- Exact eight-job readback confirms both failed summaries are terminal DEAD / INVALID_OUTPUT, one attempt each, with actual usage recorded. Six questions succeeded. [Readback](original-jobs.json). Raw historical model output was deliberately not retained, so its precise rejected field cannot be established.
- A four-topic OUTCOME can carry four irrelevant model indexes, exceeding the three-suggestion limit. The adapter now validates a bounded strict wire object, discards indexes/prose for server-rendered facts/boundaries, and retains the three-option limit for actual OPTIONS suggestions. Tool schema now declares item bounds, maxItems and no additional properties. Current results/approvals always come from fresh server state; invalid authority fields and uncertain calls remain rejected.
- Confirmed atomic decision conflicts previously retried immediately. Six bounded retries now back off25–224ms per attempt, honor the original signal/request budget and revalidate the same authority/replay key. Unknown write acknowledgments are never retried. Initial save503 root cause is not conclusively established; safe correlated READ/WRITE conflict diagnostics were added for qualification. SDK messages/items remain private.
- Two chat assertions predated the permitted conversational-prose design. They now assert strict authority-field rejection and suppression of model-supplied outcome claims. Their old failures and one unrelated roster assertion all reproduced on76549c0d.

140 focused tests PASS, one unrelated baseline assertion excluded; TypeScript/changed-source ESLint, eight release guards, diagnostic-reader syntax and whitespace PASS. [Checks](checks.json). No full-suite PASS is claimed.

Next: existing guarded API/worker publication, restore the original enabled schedule, then bounded fresh-decision qualification. Keep the prior agreed15-owner decision, original terminal failed requests and cumulative usage. No new agent/chat/automation/IAM setup.

## First live qualification and retention-gate follow-up

[20261020T085500Z](../20261020T085500Z/report.md) failed at U04:503, own readback not saved. Three prior saves succeeded once; one AI draft passed the explicitly stated exact labels without correction. No outcome/approval/assistant calls. The new decision diagnostic did not appear for the exact request, pointing before that path; historical raw SDK cause remains unverified.

The managed lifecycle adapter also issued condition-only retention barriers with no contention recovery. These now retry only exact fully classified atomic TransactionConflict rejections, at most six attempts, retaining every source/policy/account/stamp check and charging additional physical requests to the same deadline/budget. Actual lifecycle mutations, ConditionalCheckFailed, malformed cancellation and uncertain acknowledgments are not replayed. Safe pre-decision gate diagnostics distinguish ACKNOWLEDGE and ASSERT_RETAINED without SDK messages/items or identities.210 focused tests pass/one previously reproduced unrelated baseline excluded; TypeScript, changed-source lint, reader syntax and whitespace pass.
