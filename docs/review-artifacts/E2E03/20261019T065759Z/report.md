# E2E03 run report — 2026-10-19

UTC run `20261019T065759Z`. Primary site: https://main.d143q5ravxp5av.amplifyapp.com/. Frontend publication: source `49c460abbbdd69b149255472440a01f1782c6b4b`, Amplify 149, [run 39209992152](https://github.com/Known-Enough/known-enough/actions/runs/39209992152); live root and four assets returned 200 with hashes in [preflight evidence](preflight.json). The publication note is in `docs/work-log-A.md`; its JSON receipt is absent in this checkout. Backend readback is API `912bb05a`, runtime source `6082ba78`, worker `6c4c94f8`, from [the current receipt](../../ALX02/conversation-repair-publication.json).

U1/U2 credentials were present with mode 0600; both accounts signed in and had approved access. Four shared synthetic groups were found. The selected group was U1-organized with exactly two members; no group or invitation was created.

| Case | Result | Actual result | Evidence |
| --- | --- | --- | --- |
| 01 — private answers and personal alerts | BLOCKED | The browser run ended without saving its phase/result summary. Answer-save acknowledgements and persistence are unverified; a later read-only UI check did not complete the fixture inspection. | [Preflight](preflight.json); no screenshots retained. |
| 02 — one outcome and two approvals | NOT_RUN | Dependent on case 01; no approval result is claimed. | — |
| 03 — optional private assistant | NOT_RUN | Not attempted. | — |

Run request counts, answer-save HTTP status, outcome UI requests, provider calls, tokens and cost are UNKNOWN. No request was deliberately resent. The status check did not establish whether `Friday activity` or a private save exists; preserve any such fixture. Next safe action: in an authorized user session, inspect the selected group and both owners' state for `Friday activity` before creating or saving anything. No outcome request or cleanup should occur until that readback succeeds. Claim released; E2E03 qualification remains BLOCKED.
