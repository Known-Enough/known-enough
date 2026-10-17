# E2E02 findings repair

Status: IN_PROGRESS/B, 2026-10-17T02:15:20Z. Baseline `88c84e7cf42b9689532f6e49f468dfbce1a20d29`.

User asks to fix all issues in [the completed report](run-2026-10-16-234411Z/report.md). Preserve the report as historical evidence.

| Finding | Repair/evidence | Status |
| --- | --- | --- |
| 09/15 direct answer saves return 422 | Trace native admission and application transition, preserve private ownership and explicit consent | Investigating |
| 11 saved AI draft create returns 409 | Trace saved editor/frame and native creation identity/version binding | Investigating |
| 12 generated dates unmarked | Enforce visible tentative AI suggestion disclosure without relying on model prose | Investigating |
| 13 stale-save conflict/late AI result unresolved | Preserve local edits; add supported readback/reconciliation and correct delayed-response helper | Investigating |
| 07 verified-email prerequisite unavailable | Use verified own-account provider identity without exposing another account or relying on hosted user-info scope | Investigating |
| Worker hash readback disagrees with release receipt | Inspect actual installed worker and publication/readback logic before compatible release | Investigating |
| 08 membership read failures and dependent 10/15/16 coverage | Check roster transition and regressions for proposal, answers, completed outcomes and stale approvals | Investigating |

One direct worker; no new automation, account reset, IAM scope expansion or unknown-request replay. Local tests and source/target readbacks distinguish code verification from live acceptance.
