# PRIV01 — Reject aliased repository paths for private auth snapshots

Status: READY / deferred / unclaimed; scheduling hold while A owns NP00. No implementation started.

Evidence recorded 2026-10-06 by own B account Battosai1806 on source `f27332e319df4c54a888fc5affa355941d1495b9`.

`scripts/assess11-auth-config.mjs` checks private output paths using lexical `resolve()`. A nonexistent child beneath an external symlink to the workspace passes that check; `mkdirSync()` would follow the parent alias into the repository. A temporary symlink-only probe confirmed lexical acceptance and real parent equality. It created no workspace directory and wrote no snapshot or private data; temporary files were removed. This is a demonstrated path-boundary gap, not evidence of a past disclosure.

Duplicate search found existing LIVE04 protections for its own private directories, but no task or regression covering the ASSESS11 helper's aliased parent. Preserve that existing implementation and reuse its appropriate guards rather than invent another policy.

Bounded implementation scope after a verified sequential claim: `scripts/assess11-auth-config.mjs`, `tests/integration/assess11-auth-config.test.ts`, this task and necessary B tracking. No inspector, IAM, workflow, cloud, root configuration or A-owned source changes.

Acceptance:

- Resolve and validate existing parents before creating a private output directory; reject repository aliases, unsafe symlink traversal and inappropriate permissions without writing provider snapshots.
- Preserve exclusive output creation, owner-only storage, exact account/pool/client checks, strict public allowlists and cleanup.
- Add meaningful temporary-directory regressions for parent symlink into repository, valid external private directory and existing output collision; use synthetic fixtures only.
- Run focused checks and pinned full checks before source integration. No live AWS operation is required for this filesystem fix.

Next action: reconcile the single active owner and record a bounded claim before implementation. Keep ASSESS11's separate installed policy/schema/readback obligations; this task does not satisfy them.
