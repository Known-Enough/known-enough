# E2E04 browser recorder

Bounded adapter for the fifteen-account, six-case task in `docs/tasks/active/e2e/E2E04/`.

The user explicitly authorized installed Node24.19. The adapter uses the checkout's Playwright1.63 and installed Windows Chrome. The browser is controlled through normal UI actions, with one live page and separate contexts/session files for each alias. Credential and session files remain in the machine-local private directory; their values never enter public evidence.

`node scripts/e2e04/session-runner.mjs --prepare <UTC_RUN>` writes startup evidence without launching the browser. Publish that checkpoint before `--serve <UTC_RUN>`. The controller consumes sequential JSON commands from its private `commands.jsonl`; each command has a unique action ID. Its private durable cursor prevents transport replay after an interruption. Never enqueue another action until the prior result is recorded.

Each write is guarded in the private fixture checkpoint. A confirmed HTTP rejection can be reconciled explicitly; an unknown write must be inspected read-only before continuing. Outcome requests are recorded before network dispatch; approvals are checked against the pinned proposal before dispatch. No operation creates accounts, deploys code, changes schedules/usage allowances, or retries paid calls.

On this WSL checkout, `atomic-write.py` performs native host replacement/fsync through the existing WSL runtime. This avoids Windows `EPERM` when replacing files through a UNC path. HTTP observations append sanitized records immediately; meaningful action boundaries update the compact report and summary.

A controller stop without a terminal event is incomplete. Preserve its private stderr, journal and pending action, then reconcile before resuming. Keep the prior E2E03 fixture and all historical reports intact.
