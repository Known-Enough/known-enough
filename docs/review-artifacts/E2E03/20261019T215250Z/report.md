# E2E03 — 2026-10-19T21:52Z

**Result: BLOCKED.** Two synthetic users signed in and the same existing two-person group, draft and decision were visible to both. No new group, draft or decision was created. Serving versions: API source `9569a82` (API SHA-256 `54a4c508…`), worker `b6da4204…`, frontend Amplify job150. [API/worker release](https://github.com/Known-Enough/known-enough/actions/runs/39311668948) · [schedule restore](https://github.com/Known-Enough/known-enough/actions/runs/39329850471).

| Case | Result | Evidence |
| --- | --- | --- |
| 01 — two private answers | **BLOCKED** — U1 already had a saved answer. U2’s one save returned HTTP200 and its own page showed the saved answer. A later read-only refresh succeeded, but reopening the decision timed out, so persistence after reload and private-answer isolation were not fully verified. | [events](events.jsonl) · [summary](summary.json) · [U1 first failure](u1.login-failure.png) · [U2 reopen failure](u2.open-created-decision-failure.png) |
| 02 — one outcome and two approvals | NOT_RUN — case01 did not complete. | — |
| 03 — optional private assistant | NOT_RUN — optional. | — |

The first U1 `/account` read failed with browser `net::ERR_FAILED`; `/account/profile` returned200. One read-only refresh recovered and loaded the groups. Later, U2’s `/groups` read returned200, but reopening the decision timed out. During that navigation, several `/decisions/:id/me` requests failed with `net::ERR_FAILED`; one returned200, and a concurrent `/account` request failed similarly. No HTTP error response or server reference was available for the reopen failure. No repeated answer save was made.

This run made **one acknowledged app write**: U2’s private-answer command (HTTP200, own-page confirmation). No outcome or assistant request was sent; provider usage outside this run was not inspected. The existing synthetic answers remain in place. Next safe step: diagnose the browser network/open-decision failure, then read U2’s saved answer after reopening before any further write.
