# DEBT01 — Reconcile the old Mail.tm test mailbox

- Status: DEFERRED / unclaimed.
- Scheduling: User direction 2026-10-12T06:12:52.805354+00:00: only consider this when nothing else useful/eligible remains. No monitor, repeated login attempt, support message or new worker is requested.
- Origin: OPS03 original fixture run38184300709, source246a1d8552810e46efdc635ba956ed459bbd9ad2, runId1ea949f1-4fc2-4bc5-981c-371819e8d57b.
- Evidence: [Original mailbox handoff](../../../../review-artifacts/OPS03/b-mailbox-provider-handoff.md), [recovery blocker](../../../../review-artifacts/OPS03/b-mailbox-recovery-blocker.json), [interim durability correction](../../../../review-artifacts/OPS03/b-interim-fixture-durability.json).

## Known facts

One synthetic mailbox creation intent has no saved account ID. The original credentials returned HTTP401 during recovery38198897701. Existence/deletion remains UNKNOWN; no absence or successful cleanup is inferred. Private checkpoints/support request stay in their existing protected location; do not copy addresses, passwords or tokens into repository/chat.

## User-approved deferral

This specific old mailbox is no longer a prerequisite for OPS03 continuation or new independent synthetic tests. Preserve the original checkpoint; do not recreate the same address or mark the old run CLEAN/PASS. Use new separate run-owned fixtures and retain normal consent, usage, privacy and cleanup for new work. No global cleanup safeguards or unresolved paid-provider outcome accounting are removed. OPS03 still needs genuine installed provider/result/recovery/usage evidence.

## Eventual resolution

If this becomes the only useful work, inspect changed provider evidence or obtain account-specific absence/deletion or restored ownership evidence through an authorized support path. External messaging still needs its own explicit authorization. Record the exact sanitized result/time/reference, verify any deletion using the current owned provider API, and close only this old cleanup issue on actual evidence. Until then, report DEFERRED/UNKNOWN in final known limits, never DONE.
