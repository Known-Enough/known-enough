# ASSESS07 — Larger per-run AI allowance

User instruction received on 2026-10-06 UTC (October 5, Mexico City): “Can you extend the allowance a lot please?” This authorizes installation and verification of a substantially larger allowance in the existing B-owned ASSESS07 task. Request ID: `qa05-allowance-2026-10-06`. No new task, worker, dated receipt or routine human approval is required.

## Requested installed limits

The checked-in legacy allowance helpers use 250,000 reserved tokens, 250,000 cost micros and 200 model attempts per full run. These are source evidence, not fresh installed readback. Increase the token and reserved-cost ceilings tenfold from that baseline:

| AUTH field | Requested minimum per full QA run |
| --- | ---: |
| `maxTokensPerRun` | 2,500,000 |
| `maxCostMicrosPerRun` | 2,500,000 ($2.50 reserved model cost) |
| `maxAttemptsPerRun` | 200 |

Use the greater of the fresh verified existing value and each requested minimum; never reduce an existing allowance or multiply it again on every scheduled execution. Preserve `attemptCostMicros`, signup/email limits, per-call output/input/time bounds, model retry limits, participant consent and privacy checks. Reserved cost is the application's conservative accounting, not a claim of measured AWS billing.

## B's next action in the same task

1. Inspect the installed standing AUTH limits and sanitized aggregate reservation counters. The matching live run [37407814655](https://github.com/Known-Enough/known-enough/actions/runs/37407814655) passes QA01–04 but reports QA05 `BUDGET_EXHAUSTED`; the exact exhausted dimension is not yet established.
2. Implement the necessary bounded configuration update through the existing verified GitHub workload/broker path. Its broker already has conditional AUTH-update capability; no personal AWS credentials or new broad administrator role should be required. If source changes are necessary, they remain in this ASSESS07 claim and require focused and pinned full checks.
3. Apply only with verified account/source/operator identity, standing authority, CLEAN cleanup and no competing active lease. Guard AUTH, LEASE and TOTAL versions; preserve all historical usage and existing counters. Do not reset usage or alter a running suite's reservation state.
4. Record numeric before/after ceilings and actual installed readback, then inspect one matching automatic qualification through all seven journeys, usage, privacy and cleanup. Do not call the extension applied based only on this document or a successful code publication.

Status at publication: **authorized and handed to the existing worker; not yet installed or verified**. Direct delivery to B's persistent chat returned an unavailable `durable` host; the shared board is the available instruction path. B remains the sole implementation worker; A has made only this documentation handoff and preserves NP00.
