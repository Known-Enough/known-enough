# PRIV01 — Reject aliased repository paths for private auth snapshots

Status: READY / unclaimed; next eligible task for B's existing persistent chat, 2026-10-06T17:17:44Z. A's inactive NP00 is paused with its saved work preserved; the earlier global hold is superseded by the [bounded sequential handoff](../../../../b-next-task-handoff.md). Assignment is not evidence that implementation started.

Evidence recorded 2026-10-06 by own B account Battosai1806 on source `f27332e319df4c54a888fc5affa355941d1495b9`.

`scripts/assess11-auth-config.mjs` checks private output paths using lexical `resolve()`. A nonexistent child beneath an external symlink to the workspace passes that check; `mkdirSync()` would follow the parent alias into the repository. A temporary symlink-only probe confirmed lexical acceptance and real parent equality. It created no workspace directory and wrote no snapshot or private data; temporary files were removed. This is a demonstrated path-boundary gap, not evidence of a past disclosure.

Duplicate search found existing LIVE04 protections for its own private directories, but no task or regression covering the ASSESS11 helper's aliased parent. Preserve that existing implementation and reuse its appropriate guards rather than invent another policy.

Bounded implementation scope after a verified sequential claim: `scripts/assess11-auth-config.mjs`, `tests/integration/assess11-auth-config.test.ts`, this task and necessary B tracking. No inspector, IAM, workflow, cloud, root configuration or A-owned source changes.

Acceptance:

- Resolve and validate existing parents before creating a private output directory; reject repository aliases, unsafe symlink traversal and inappropriate permissions without writing provider snapshots.
- Preserve exclusive output creation, owner-only storage, exact account/pool/client checks, strict public allowlists and cleanup.
- Add meaningful temporary-directory regressions for parent symlink into repository, valid external private directory and existing output collision; use synthetic fixtures only.
- Run focused checks and pinned full checks before source integration. No live AWS operation is required for this filesystem fix.

Next action: clean ff-only intake and verified own-account single-task claim, then implement the named local fix and regressions. A has no active competing writer; no further ownership approval is required. Keep ASSESS11's separate installed policy/schema/readback obligations; this task does not satisfy them.

## Verified completion — 2026-10-06

DONE / B. Existing-parent symlink traversal and repository aliases are rejected before directory creation; new output remains exclusive and owner-only. Synthetic regressions cover repository/external aliases, valid output and snapshot collision preservation. Pinned focused7 and full784 application(two optional skips)/hosted1/browser61 plus references/planning/lint/types/build/boundaries PASS. No AWS action or private snapshot used. Earlier assignment text is historical. Next ASSESS11 under the synchronized sequential handoff.
