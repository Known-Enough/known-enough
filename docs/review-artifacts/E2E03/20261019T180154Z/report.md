# E2E03 focused rerun 20261019T180154Z

State: **BLOCKED**. Started 2026-10-19 18:01:54Z; ended 18:03:58Z.

The account-loading repair is live. Both synthetic users signed in and loaded six groups; each GET /account returned 200. The installed API source is 5499a8e8a7116c8204b7da33fe161139120182b3, package dba8649429b815fb8ce03bdb9424128ca180633038214f34edbc7871e033aa58; frontend remained Amplify job 145. The 86/86 adapter test passed, including the username-directory fallback case.

| Case | Result | Actual result |
| --- | --- | --- |
| 01 — two private saves | BLOCKED | U1 draft save returned 200 and manual decision creation returned 200. The runner then raised CREATED_DECISION_TITLE_MISMATCH while the modal screenshot showed loading placeholders. A later read-only inspection showed the expected “Friday activity” heading and answer form. No private answer was saved. |
| 02 — one outcome/two approvals | BLOCKED | Dependent on completing case 01. Not attempted. |
| 03 — optional assistant | NOT_RUN | Optional; not attempted. |

The inconsistent title observations point to a possible runner/UI readiness race, but its exact cause is unverified. The masked failure screenshot is [u1.create-decision-failure.png](u1.create-decision-failure.png). The created synthetic draft and decision remain in the selected test group; reconcile them before any future write. App writes: 2 acknowledged (draft and decision); answer writes: 0; outcome/assistant/model/email requests: 0. Token usage was not read.

Release and environment evidence: [queue readback](https://github.com/Known-Enough/known-enough/actions/runs/39298494908), [schedule pause](https://github.com/Known-Enough/known-enough/actions/runs/39298610671), [API publication](https://github.com/Known-Enough/known-enough/actions/runs/39298683902), [schedule restored after empty tick](https://github.com/Known-Enough/known-enough/actions/runs/39298891247). The schedule is enabled again. [Events](events.jsonl) · [Summary](summary.json).
