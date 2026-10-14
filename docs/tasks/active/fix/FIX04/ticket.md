# FIX04 — Simple commands to list pending requests and approve users

**Status:** READY / unclaimed. **Priority:** P1. **Intended worker:** B / own `Battosai1806`. Queue after FIX03; preserve current FIX01 and other genuine active work. Exactly one task.

## Requested outcome

The user needs one command to find all users who requested application access, and a separate command to accept chosen users. Deliver complete copy-and-paste blocks and a short plain-language guide. Do not approve any real account during task preparation or verification without its explicit selection.

Required interface (names are illustrative; freeze actual commands in the guide):

```text
access-users list --pending
access-users approve --username EXACT_USERNAME
access-users approve --username FIRST_USERNAME --username SECOND_USERNAME
```

The listing is read-only. Approval changes only the named users' application-admission state. It does not grant AWS access, create group memberships, change passwords or confirm unverified email.

## Existing implementation and gap

The legacy [group operator CLI](../../../../../scripts/group-operator.mjs) already lists/approves accounts, but uses `NP_GROUP_TABLE_NAME` and the aggregate repository. It is not verified for the current partitioned runtime. Reuse its appropriate business rules, not an obsolete table or a blind overwrite.

Current [partition group session](../../../../../packages/adapters/src/partition-group-session.ts) stores admission as PENDING/APPROVED with versions and may store `profile.loginUsername`. Registration/account intake and identity mapping must be read from current source and actual metadata, preserving FIX01–03 changes. A Cognito user can exist without a pending application account; listing Cognito alone is not the requested queue. The existing [signup intake](../../../../../apps/api/src/signup-intake.ts) and approved server identity path control registration; don't resurrect the obsolete manual Request access/name gate.

## Intake, authority and scope

After FIX03's checked handoff, pull main ff-only, inspect claims/running jobs and claim only FIX04 using B's own account. Reuse current installed project roles and the existing persistent chat/schedule. Relevant tests and necessary narrow project setup are authorized under [standing authority](../../../../project-automation-authority.md), despite the earlier manual-test pause. Preserve credential ownership, private account data, source/target checks, saved NP00 and current operations runtime. No new chat, monitor or task execution is created here.

Scope: native admission/operator service and focused tests; current partition repository/directory access only as required; minimal CLI/setup or GitHub workflow using existing access; FIX04 guide/evidence and tracking. Declare actual files at claim time. An admin web dashboard, automatic approval of everyone and unrelated account-policy changes are outside this task.

## Implementation plan

1. **Discover the real queue and operator path.** Verify current account/region/table/schema/migration and trusted admission records. Use the supported partition access path and directory, not broad raw scans or the retired aggregate by default. Verify the actual operator permission rather than inferring it from fixture-only approval code or configuration.
2. **List all pending users.** Handle pagination, explicit limits and concurrent changes; do not silently truncate. State that results reflect the observed queue, not an immutable global snapshot. Print enough privately in the operator terminal to select an exact account: username, display name, PENDING status and stored request time if available. Resolve a missing username through a trusted provider identity lookup, never a caller-supplied name. Missing request dates must be reported as unavailable. Exclude passwords, tokens, photos, descriptions, email hashes and private decision/group data. Zero pending users is a clear successful result.
3. **Approve only explicit targets.** Resolve exact username to the trusted immutable account subject, confirm verified-email registration and PENDING status, reread version and perform the native conditional transaction. Preserve all other account/profile/group fields and transaction/source fences. Reject unknown/ambiguous users and stale state; never select by display name. Already-approved is an explicit idempotent no-op; rejected/disabled accounts must not be silently re-enabled. For multiple targets, return per-user outcomes and partial-failure information, without implying cross-user atomicity or approving anyone else. Fresh readback must confirm each successful change.
4. **Make the commands easy to run.** Prefer the existing installed GitHub operator access when it supports this scope, with one command to launch and retrieve a private result. Otherwise provide an A CloudShell block using its current account credentials. Do not require shared AWS keys, copying private configuration into chat, repeated approvals or temporary `/tmp` state across sessions. Pin source/checksums, use a durable home setup folder when needed and provide a repeat command that doesn't reinstall tools unnecessarily. If a narrow permission is genuinely absent, prepare one concrete setup block and explain its exact scope; routine listing/approval should work after setup.
5. **Keep private output private.** Never publish usernames, emails, subjects or full account records in GitHub artifacts/public logs or repository receipts. A GitHub-triggered path must use private results rather than echo account data into the workflow log. Public evidence contains counts, static categories and source/run references only. Record list requests and explicitly selected approval outcomes in a bounded sanitized operator audit, without unrelated personal data.

## Checks and acceptance

- Focused tests cover empty queue, all-page listing, missing identity mapping, wrong target account, exact/ambiguous/unknown username, unverified/non-pending rejection, already-approved no-op, stale-version races and multiple selected users with partial failure. Verify privacy and preservation of unrelated fields; normal participant credentials cannot list or approve accounts.
- Run pinned focused checks and `npm run check` for executable changes. Do not hide pre-existing failures or weaken current assertions. Publish/configure only any needed compatible operator path and verify actual effective access.
- With owned synthetic pending accounts, demonstrate a real complete list and approval of a selected account, leaving another pending account unchanged. Rerun approval to prove no duplicate mutation; verify the accepted user can load its account/groups while pending users remain restricted. Approval creates no automatic group membership. Perform normal test cleanup and record actual usage; no human user is approved as a test fixture.
- Deliver `docs/tasks/active/fix/FIX04/commands.md` with the actual two complete commands, a concrete placeholder username example, one-time setup only if needed, expected output, error recovery and private-output instructions. Also provide the short blocks directly in B's final chat response.
- Record UTC/source, actual storage/permission path, changed files, checks, live outcomes and any setup dependency in `docs/review-artifacts/FIX04/access-commands.md` during implementation. Keep board/batch/ticket/claims and B work-log/handoff/monitor receipts consistent, with the same short summary as the chat answer. DONE requires usable verified commands; command sketches or mocked approvals alone are insufficient.

If verified accounts fail to enter the queue because intake is broken, capture the exact gap and coordinate with FIX01/FIX03 evidence. Do not repair it by inventing pending records from every Cognito user, auto-confirming signup or changing approval policy. Finish independent CLI work before reporting a precise remaining dependency.

## Preparation — 2026-10-14

A created this queued B task from clean synchronized main `e8c24f1`, inspected the legacy CLI and native account state, and preserved FIX01 → FIX02 → FIX03 order. No application change, live listing of people, approval, cloud mutation, test dispatch or B FIX04 execution occurred during task creation.

[FIX batch](../README.md) · [Task guide](../../../README.md) · [Board](../../../../task-board.md)
