# E2E03 final agreement readback — COMPLETE

**Run:** 2026-10-19 23:08:25–23:10:08 UTC. U1 and U2 reopened the same existing synthetic decision after the owner-read repair. Both saw the saved agreement and their own private answers. The decision list showed “Decision agreed” for both.

| Required scenario | Result | Evidence |
| --- | --- | --- |
| 01 — distinct private answers persist | PASS. The earlier run recorded both acknowledged saves; this run freshly read both owners and confirmed their distinct saved selections. | [Earlier action report](../20261019T224223Z/report.md), [U1 screenshot](case02-u1.png), [U2 screenshot](case02-u2.png) |
| 02 — one outcome and two approvals persist | PASS. The earlier run recorded one outcome request and two acknowledged approvals of the same proposal; this run freshly verified AGREED, 2/2 approvals and the pinned proposal in both owner views. | [Earlier action report](../20261019T224223Z/report.md), [U1 screenshot](case02-u1.png), [U2 screenshot](case02-u2.png) |
| 03 — optional assistant | NOT_RUN; outside the required acceptance. | — |

The final check made **no application writes**, no new outcome or assistant request, and no repeated approval. U1/U2 owner identities were distinct; both readbacks reported their own saved selections and the exact agreed proposal. Historical final-reopen transport cause remains unproven, but the repaired live path now passed for both users.

Serving release: runtime/API/frontend `1f7d441c4913090fb08bd216c3759d7fd2f4cd57`; API ZIP `e8338c82…70436`; worker ZIP `c4258495…448fa0`; Amplify job 152.

[Action events](events.jsonl) · [Summary](summary.json) · [Publication repair](../owner-read-repair.md)
