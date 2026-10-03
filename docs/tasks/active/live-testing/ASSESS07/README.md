# ASSESS07 — Managed verification of corrective changes

Collect real online proof that all required user journeys, safety checks and cleanup pass automatically after a matching successful deployment.

**Status:** IN_PROGRESS — A/Mac is continuing because B is unavailable. One of the two transferred test cycles remains.

**What happened:** The user applied the pinned transfer in CloudShell; the readback confirmed two remaining uses until `2026-10-04T00:00:00Z`. A then ran staging deployment [37145958639](https://github.com/Known-Enough/known-enough/actions/runs/37145958639). It succeeded and automatically started qualification [37145997504](https://github.com/Known-Enough/known-enough/actions/runs/37145997504) on the same source. Release, public comparison, primary metadata, and cleanup passed. QA01 signup/login and QA02 admissions passed. QA03's draft request lost its browser connection; four later journeys were blocked. The report recorded one model attempt and one synthetic signup email. One allowance use remains. See the [sanitized report](../../../../review-artifacts/ASSESS07-first-a-automatic-run.json).

**Next step:** A added a privacy-safe category for known browser connection errors; only fixed labels such as timeout or connection reset can appear, never browser error text. Its focused and full local checks passed. Publish it through the matching main deployment, let GitHub start the second qualification automatically, and inspect the report. The allowance expires at `2026-10-04T00:00:00Z`; do not renew it or reset usage. Full seven-journey acceptance remains unproved.

Earlier B execution instructions are retained in the ticket as history; the user has now asked A to proceed because B is unavailable. After ASSESS07, the shared board schedules the next eligible task.

[Latest actual report](../../../../review-artifacts/ASSESS07-email-login-pass-decision-failure.json).

**Related work:** [LIVE04](../LIVE04/README.md), [NP05](../../../historical/superseded/NP05/README.md).

[Full ticket](ticket.md) · [Task guide](../../../README.md) · [Current board](../../../../task-board.md)
