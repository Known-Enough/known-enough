# Account-read and E2E03 wait stability repair

Status: CODE_READY; publication pending. TypeScript no-emit, changed-source ESLint, Node syntax, Python AST and whitespace checks passed. No unit, browser or live product test was run for this repair.

The latest E2E03 check saw U2 `/account` HTTP503. The same-window sanitized server logs show `account.status` -> `SESSION_STORAGE_UNAVAILABLE` -> `TransactionCanceledException`; the old logs do not identify the canceled command or subreason. This repair addresses verified source weaknesses without claiming the historical command is proven.

Managed activation reads now retry only `TransactionCanceledException` with exactly three well-formed cancellation entries, all `None`/`TransactionConflict`, including at least one conflict. There are at most three read attempts with short jittered waits. Every underlying attempt charges the same request budget and uses the original abort signal/deadline. Permission, validation, conditional-denial, unknown and unclassified failures are not eligible. The SDK remains configured for one attempt; writes and unknown write outcomes are not automatically repeated by this change.

A rejected activation-read promise is removed from the per-operation cache, using identity comparison to avoid deleting a newer promise. Successful parallel reads still share one atomic result. The account-only fallback can therefore make a fresh fenced read instead of immediately replaying a cached rejection. Full marker validation and commit-time activation/admission conditions remain exact.

New safe `known-enough.storage-read` diagnostics identify the fixed command/stage, read attempt, retry/failure/recovery, allowlisted exception and cancellation codes. Account-status requests attach the server UUID, allowing exact matching through the existing sanitized log reader. No raw provider message, stack, item value, username, email, token, private answer or model output is logged.

The E2E03 runner no longer parses or waits for every HTTP body, and removes the unused body cache. It reads only necessary catalog responses, with a five-second body limit and bounded navigation. An explicit read-only refresh visits the groups root in the same session, avoiding a decision route that may never request `/groups`; old catalogs are cleared before navigation. GET failures collect only allowlisted categories/opaque UUIDs through a separate three-second body limit. The startup report no longer embeds an obsolete diagnosis from an earlier run.

No schema, permissions, resource, data migration, model or user-account change is needed. The current acknowledged fixture and prior answer stay preserved. Publication uses the compatible coordinated API/worker workflow; frontend release is unnecessary. E2E03 remains BLOCKED until a new explicitly requested live check reconciles both owners before any further save.

AWS's [TransactGetItems reference](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactGetItems.html) documents transaction conflicts and ordered cancellation codes. This repair uses those codes only for the specific read operation; it does not infer a transient conflict from the exception name alone.
