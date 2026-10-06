# PRIV01 — Keep private debugging files outside the project

Fix the demonstrated case where a folder shortcut could direct private signup debugging files into the repository. Preserve private storage and test both unsafe and valid paths.

**Status:** READY / unclaimed; B's next task. No AWS operation is needed for this fix. A's saved NP00 work is paused and does not hold this separate implementation.

**Next step:** Claim this task in B's existing chat, fix the helper and run its focused and full checks. Complete it before ASSESS11 invokes the helper on real AWS data.

[Full ticket](ticket.md) · [Current handoff](../../../../b-next-task-handoff.md) · [Shared board](../../../../task-board.md)

## Verified completion — 2026-10-06

DONE / B. Existing-parent symlink traversal and repository aliases are rejected before directory creation; new output remains exclusive and owner-only. Synthetic regressions cover repository/external aliases, valid output and snapshot collision preservation. Pinned focused7 and full784 application(two optional skips)/hosted1/browser61 plus references/planning/lint/types/build/boundaries PASS. No AWS action or private snapshot used. Earlier assignment text is historical. Next ASSESS11 under the synchronized sequential handoff.
