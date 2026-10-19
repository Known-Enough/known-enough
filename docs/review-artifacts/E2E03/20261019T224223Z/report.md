# E2E03 — 2026-10-19T22:42Z

**RUNNING; case01 PASS.** Runtime `1117433` / API `9e9c3672`, worker `37bcbd5c`; frontend `656c3dc` / Amplify151 ([publication](../network-read-publication.json)).

Both users signed in, reconciled the same existing two-member fixture and reopened it. Fresh owner reads matched U1's one selected option and U2's two selected options, with distinct authenticated owners, 2/2 responses, and neutral “Ready for outcome” decision chips. Prior acknowledged writes were preserved; no answer was resubmitted. Group-wide chips are not asserted because this reused group also contains other decisions.

| Case | Result |
| --- | --- |
| 01 — private answers persist | PASS (resumed acknowledged saves; fresh owner persistence/readback) |
| 02 — one outcome, two approvals | NOT_RUN; next |
| 03 — optional assistant | NOT_RUN (outside this run) |

Outcome requests0; assistant requests0; no product writes yet.

[Events](events.jsonl) · [Summary](summary.json) · [U1 masked screenshot](case01-u1.png) · [U2 masked screenshot](case01-u2.png).
