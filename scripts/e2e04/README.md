# E2E04 browser recorder

Bounded adapter for the fifteen-account, six-case task in `docs/tasks/active/e2e/E2E04/`.

The user explicitly authorized installed Node24.19. The adapter uses the checkout's Playwright1.63 and installed Windows Chrome. The browser is controlled through normal UI actions, with one live page and separate contexts/session files for each alias. Credential and session files remain in the machine-local private directory; their values never enter public evidence.

`node scripts/e2e04/session-runner.mjs --prepare <UTC_RUN>` writes startup evidence without launching the browser. Publish that checkpoint before `--serve <UTC_RUN>`. The controller consumes sequential JSON commands from its private `commands.jsonl`; each command has a unique action ID. Its private durable cursor prevents transport replay after an interruption. Never enqueue another action until the prior result is recorded.

Each write is guarded in the private fixture checkpoint. A confirmed HTTP rejection can be reconciled explicitly; an unknown write must be inspected read-only before continuing. Outcome requests are recorded before network dispatch; approvals are checked against the pinned proposal before dispatch. No operation creates accounts, deploys code, changes schedules/usage allowances, or retries paid calls.

On this WSL checkout, `atomic-write.py` performs native host replacement/fsync through the existing WSL runtime. This avoids Windows `EPERM` when replacing files through a UNC path. HTTP observations append sanitized records immediately; meaningful action boundaries update the compact report and summary.

A controller stop without a terminal event is incomplete. Preserve its private stderr, journal and pending action, then reconcile before resuming. Keep the prior E2E03 fixture and all historical reports intact.

## Five-account variant — 2026-10-22

`five-account-runner.mjs` uses the explicit machine-local E2E04_CREDENTIALS file, selects test04 through test08 and labels them U01–U05. It reuses the two-account recorder, has one live page with separate contexts, never overwrites an existing session while restoring, and normalizes date labels only in test assertions. Production code is unchanged. Actual run and corrections: [five-user report](../../docs/review-artifacts/E2E04/five-20261022T164211Z/report.md).

Use `--prepare <UTC_RUN>` before `--serve <UTC_RUN>`, with E2E04_DEPENDENCIES pointing to the installed project dependencies and E2E04_CHROMIUM to the installed executable. Submit one browser command at a time and inspect its acknowledgment before dependent work. The per-write private guard prevents blind repetition. `finish` preserves own sessions privately, closes the browser and records the terminal result. An expired session requires a normal sign-in; it is not permission to reuse another user's session. Eight assistant-send ceiling and one explicit draft request; no ordinary chat post requests AI. The automatic outcome starts after the last saved answer, without a manual negotiation command.
