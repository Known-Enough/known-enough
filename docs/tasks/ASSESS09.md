# ASSESS09 — Unblock Cognito setup and safely resume

- Status: IN_PROGRESS — B local repair; A cloud execution remains paused.
- Worker: B / Octavio / Battosai1806, Codex GPT-6 (exact runtime variant/effort not exposed). Clean main ff-only baseline 3d2d68af2c1c2b7980ad56328a032e368e2f30c9e92, 2026-10-02; no subagents. Claimed only the narrow scope below, including a dedicated same-pin Cognito repair helper and focused tests.
- Authority: user explicitly requests this priority repair on 2026-10-02, with narrow scope and minimal token use. A retains AWS execution/NP00. No credential sharing, new spending or unsolicited cloud writes.

## Exact failure and preserved state

User ran the c84d4b3 recovery helper against deployment source 30fa91ad914c1dc1732680784ee368e2f30c9e92. Package preparation matches API ZIP 6a0cd3eb5b35b1c993917962b9f5f3eb415a6eb75f9b25f98141c1ee36708b4a, then actual apply stops at PRIMARY_POOL_READBACK_FAILED. This is not another package/runtime error. Primary update-user-pool precedes the failed comparison: AWS may already have changed Cognito, and the journal may retain pending=enable-signup. Confirm state; never blindly retry, clear pending, replace snapshots or advance the source pin.

Private config/state/rollback remain in A's CloudShell HOME. Preserve original expiry 2026-10-09T03:16:41.171626Z, all granted limits, retained tables and original backup. Earlier IAM NoSuchEntity and runtime/cwd repairs are recorded in [LIVE04](LIVE04.md) and [A handoff](../handoff-A.md); preserve them. ASSESS08 remains historical local completion, not cloud acceptance.

## Narrow work and completion

Scope: scripts/live-qa/primary.mjs Cognito request/readback and pending reconciliation; aws.mjs/recovery helper only where necessary; focused primary regressions; one concise repair handoff, this ticket and own B log/handoff. Coordinate/amend scope before other code; no root/lock, NP00 or unrelated reassessment. Prior B corrective scopes are complete; A pauses installation while this repair is prepared.

1. Establish why the intended complete UpdateUserPool request differs from DescribeUserPool readback. Check official service shapes/default normalization, array/object ordering and propagation. Do not assume harmless normalization or weaken checks to accept genuine configuration loss/drift. Inspect corresponding client and rollback comparisons to prevent the same immediate next failure.
2. Add permanent focused regressions for the actual difference, preservation of unrelated settings and genuine drift rejection. Reuse existing passing evidence; no broad review or speculative rewrite.
3. Prepare guarded reconciliation of this exact interrupted enable-signup step using original snapshots, intended request and current read-only evidence. If A must supply evidence, give one small non-secret diagnostic block; B needs no AWS credentials. Update a checkpoint only after proving the exact authorized state. Ambiguous/unrelated changes remain blocked. Preserve the original journal/backup and deployment artifacts; a new source pin must not bypass them.
4. Publish one verified, immutable copy-and-paste CloudShell repair/resume block for A with explicit success output and remaining checks. Carry forward the corrected IAM adapter, pinned PATH and original source build cwd. No approval renewal or counter reset.

DONE requires meaningful focused regressions and one final pinned npm run check for changed executable code, self-inspection, concise handoff and origin main sync with [skip ci]/verified equality. Documentation-only updates need links/reference/status checks. Actual cloud reconciliation/readback and B/manual plus automatic test proof remain [ASSESS07](ASSESS07.md). Do not mark managed success from local tests.
