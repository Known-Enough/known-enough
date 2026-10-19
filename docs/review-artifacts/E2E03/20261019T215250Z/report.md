# E2E03 — 2026-10-19T21:52:50Z

**RUNNING.** Startup evidence is recorded before browser actions. The serving API is source `9569a82` (API SHA-256 `54a4c508…`); the existing frontend is Amplify job 150. [API and worker publication](https://github.com/Known-Enough/known-enough/actions/runs/39311668948) · [schedule restored](https://github.com/Known-Enough/known-enough/actions/runs/39329850471).

Two synthetic users will sign in and reconcile the existing two-member decision before answer-state reads. No new group, draft, or decision will be created.

| Case | Result |
| --- | --- |
| 01 — two private saves | NOT_RUN |
| 02 — one outcome/two approvals | NOT_RUN |
| 03 — optional assistant | NOT_RUN |

[Events](events.jsonl) · [Summary](summary.json)
