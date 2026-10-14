# FIX — Observed product failures

Fix problems encountered in the published application, with real evidence and clear user-facing errors. Keep one active task at a time; preserve the existing ZZ design and reuse operations infrastructure.

| Task | Outcome | Status |
| --- | --- | --- |
| [FIX01](FIX01/README.md) | An approved organizer can create and review a new decision draft inside a group; failures explain the actual problem. | BLOCKED / claim released; exact API-role model grant required |
| [FIX02](FIX02/README.md) | Save and view profile descriptions/photos through the compatible installed API, including permitted group-member profiles. | DONE / B; live profile/privacy/cleanup passed |
| [FIX03](FIX03/README.md) | Sign in inside the app's own styled screen, with Cognito authentication behind the scenes. | DONE / B; live branded authentication/recovery/cleanup passed |
| [FIX04](FIX04/README.md) | One command lists pending access requests; another approves explicitly selected users. | BLOCKED / claim released; checked CLI ready, missing installed operator reads |

User directs sequential FIX02 → FIX03 → FIX04, proceeding past a concrete external dead end. FIX01 is preserved at its checked missing-access checkpoint; FIX02 passed; FIX03 passed and is released; FIX04 is released at its exact IAM blocker; no active implementation claim. No new worker, automation, deployment or test has been started by task preparation.

[Task guide](../../README.md) · [Task board](../../../task-board.md)
