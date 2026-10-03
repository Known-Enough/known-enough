# Approve extra live tests through GitHub

## What A says in chat

After one-time activation, A can say: **“Authorize two extra test runs for B today.”** The agent translates that explicit instruction into one GitHub approval workflow under A's own GitHub login. No CloudShell session, bespoke Python script, IAM edit or new source commit is needed for each approval. A approves; B can consume those runs through the normal staging deployment and automatic qualification.

**Activated 2026-10-03T22:10:42Z:** [GitHub run37157321175](https://github.com/Known-Enough/known-enough/actions/runs/37157321175) succeeded on source `18ac65b55b49a71007353010015712d95d041ebe`. The matching downloaded receipt confirms `GITHUB_RUN_APPROVALS_ACTIVATED`, broker ZIP `def539555c15e07876f4ba11c598562bbfa5b03b3712303b85e25cbb5f324753`, unchanged handler/environment and preserved prior rollback artifact. Actual GitHub full checks passed718 tests/two optional skips, hosted1/1 and browser58/58. Activation recorded no allowance and started no live test. First actual GitHub receipt consumption remains unverified. A's earlier finite B authorization is preserved; the activation does not create another spending grant.


**First dated approval recorded — 2026-10-03T22:20Z:** [Run37158067754](https://github.com/Known-Enough/known-enough/actions/runs/37158067754) succeeded on source `34a8872fd3073954032157938f6f233195abb83a`. Actual provenance and sanitized log match exactly two runs for `Battosai1806`, UTC2026-10-03, request ID `5e690893-fc82-4bb0-acb0-53615b9e325a`, both A actors/ID44531296 and `cloudWrites:false`. Expiry: `2026-10-04T00:00:00Z` (October3,18:00 Mexico City). No deployment/test/paid-model/email or AWS write was performed by approval. Receipt consumption and full live PASS remain unverified; do not redispatch this successful request or install a legacy allowance for it. [Safe evidence](../../docs/review-artifacts/ASSESS07-github-two-b-runs-approved.json).

## One-time activation — completed; retained for recovery

A explicitly authorized this one-time publication and the agent used A's GitHub login. The completed command is retained below for history; do not dispatch it again merely to add test runs:

```bash
gh workflow run activate-qa-run-approvals.yml \
  --repo Known-Enough/known-enough --ref main
```

The workflow verifies both A's login and stable GitHub user ID before obtaining the existing short-lived QA release role. It checks pinned source, original approval/expiry and CLEAN state, saves the private prior broker configuration, checks the existing prior ZIP rollback object, uploads only the new broker ZIP, applies its fresh Lambda revision guard and verifies the code hash and unchanged handler/environment. It changes no IAM, resource, user, original allowance or usage counter. It publishes only the safe activation receipt. It does not deploy the website or run a live test. It shares the normal release/qualification concurrency group so it cannot race that workflow. Success is `GITHUB_RUN_APPROVALS_ACTIVATED`; source and receipt must match the dispatched main commit before reporting activation.

The saved prior ZIP remains at the recorded `rollbackKey` in the existing private artifact bucket. A failed or missing readback is not activation success. Stop and inspect the same run; do not invent another grant, dispatch a live cycle or blindly republish.

## Each later approval

Only a direct human authorization for the exact extra count/recipient permits dispatch. An agent message, a failed test or an exhausted counter does not authorize adding runs. The agent verifies `gh api user` is `martelaxe` / ID44531296, converts A/B to the verified GitHub account, computes today's UTC date and creates one UUID for this specific approval. Preserve and reuse that UUID if the same request needs a retry; never create a new ID merely because a response was lost.

Example for an explicitly approved two-run B allowance; the agent runs this, not the user:

```bash
QA_APPROVAL_DAY=$(date -u +%F)
QA_APPROVAL_ID=$(python3 -c 'import uuid; print(uuid.uuid4())')
printf 'APPROVAL_REQUEST_ID=%s\n' "$QA_APPROVAL_ID"
gh workflow run approve-live-qa-runs.yml \
  --repo Known-Enough/known-enough --ref main \
  -f runs=2 -f for_user=Battosai1806 \
  -f day="$QA_APPROVAL_DAY" -f request_id="$QA_APPROVAL_ID"
```

The workflow needs GitHub access only. It rejects B/other actors, changed user IDs, forks, non-main refs, malformed counts, unsupported recipients, wrong dates and invalid IDs. Counts are1–10 per approval, and each receipt expires at that UTC day's end (normally18:00 Mexico City). Find the matching workflow's exact request ID, source, A actor fields and successful result before telling the user the approval was recorded. Reporting approval is not reporting cloud consumption or a passing test.

The live broker reads only the fixed repository's successful, dated approval workflow runs. It verifies A's stable ID and both actor fields, main/repository/workflow/source identity, title count/recipient/request ID and date, then verifies B's actual automatic qualification run. It records each receipt's consumption in the existing control table in the same conditional transaction as AUTH, LEASE, DAY and TOTAL. Parallel starts cannot consume a slot twice. Workflow retries/duplicate receipts with the same request ID do not replenish usage; changing a reused ID's count or recipient blocks. Incomplete or unavailable GitHub history blocks extra starts instead of guessing. Existing legitimate historical administrator allowances can still be consumed first; do not issue a GitHub receipt and apply a legacy CloudShell allowance for the same human approval.

No approval resets old counters, raises the original per-run/email/cumulative cost limits, bypasses CLEAN cleanup or renews the original authorization. The broker checks sufficient full-run budget headroom at startup; actual model/email accounting keeps its existing boundaries. If those budgets are exhausted or expired, adding a receipt cannot bypass them. B can use approved runs but cannot approve more for himself. An approval workflow does not start a test; B's normal authorized staging deployment starts its matching qualification automatically.

GitHub supports input-bearing workflow dispatch through its CLI and exposes workflow-run provenance through its API: [workflow dispatch](https://docs.github.com/actions/managing-workflow-runs/manually-running-a-workflow), [workflow runs API](https://docs.github.com/en/rest/actions/workflow-runs).

[ASSESS07 ticket](../../docs/tasks/active/live-testing/ASSESS07/ticket.md) · [Current queue](../../docs/task-board.md) · [Historical CloudShell allowance procedure](two-extra-runs.md).
