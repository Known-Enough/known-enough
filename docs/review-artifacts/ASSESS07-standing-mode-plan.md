# ASSESS07 standing-mode migration — first scheduled source inspection

Source: `bb1eb9dd319b34f008b0965fa21a704d54635512`; B / Battosai1806; observed 2026-10-04T19:40:50Z onward. This is diagnosis and baseline verification, not installed migration or live acceptance.

The current authorization schema is an exact legacy allowlist in `scripts/live-qa/config.mjs`. A migration must introduce an explicit validated standing mode rather than a distant fake expiry or counter reset. Preserve privacy/retention controls and finite individual request limits. Reject malformed configuration.

Affected execution boundaries verified in source:

- `release.mjs:assertInstalledEnvelope` rejects missing/expired legacy authority before publication; `install.mjs` also checks dated authority.
- `broker.mjs:auth` rejects expiry; provisioning reads daily totals and falls back to A-only GitHub/legacy extras above the daily count. Synthetic signup has a daily-message ceiling.
- `fixture-core.mjs:beginLease` couples the 45-minute operational lease to authority expiry; `reserveAttempt` also checks authority expiry. Keep operational lease timeout, single-use run IDs and CLEAN/concurrency checks.
- `cumulative.mjs:reserveTotal` rejects legacy cumulative ceilings. Standing mode must retain validated monotonic safe-integer usage and transactional version guards while removing administrative cumulative ceilings. `authorizationTransaction` preserves existing totals and rejects non-CLEAN lease transitions; retain these checks.
- `budget.mjs:budgetedTransport` checks authority expiry again after transactional token/cost reservation and before provider invocation. Keep per-request reservation and usage evidence.
- `github-allowance.mjs` trusts only A approval receipts; standing runtime must use verified normal workflow/source/actor provenance without requiring a dated approval receipt. Retain legacy history and tests rather than delete past evidence.

Next implementation: add validated explicit standing authorization and shared authority-active helper, update all execution boundaries together, add regression coverage for expired legacy versus standing mode, usage preservation, malformed state, lease/CLEAN refusal and finite request limits; prepare conditional AUTH migration through project workload access without resetting TOTAL/DAY/receipt history. Run focused then pinned full checks before source push; publish sequentially and verify installed schema/code plus matching seven journeys/CLEAN. Direct AWS CLI is unavailable locally; verify actual delegated workload capabilities before migration, report missing IAM precisely and repair within standing project authority. No new approval receipt is required by current human direction.

Baseline focused Vitest: live-qa-cumulative, live-qa-github-allowance, live-qa-runner; 3 files/38 tests PASS. No executable bytes changed in this checkpoint.
