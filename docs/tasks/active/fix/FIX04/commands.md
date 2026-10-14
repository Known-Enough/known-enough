# FIX04 — Find pending requests and approve selected users

Current copy/paste commands and small shell wrappers are grouped in [scripts/cloudshell-commands](../../../../../scripts/cloudshell-commands/README.md).

The latest private [test-email exception](shared-test-email.md) permits separate PENDING accounts for the selected testing address; each exact username still needs approval. If this tool was installed before the new server publication, repeat the frozen setup block below to refresh its checked source/API hash. This refresh makes no AWS write.

Status: DONE under user-directed A takeover. Own-A live list, selected approval, idempotence, signup recovery and cleanup passed in [38603820489](https://github.com/Known-Enough/known-enough/actions/runs/38603820489). Use the updated frozen tool source below; no real user was approved during proof. B own execution is not claimed.

Use A's own CloudShell session in AWS account `092954139775`. Keep command output in the private terminal; do not paste usernames, emails, account records, tokens, configuration or private files into chat or GitHub. The tool reports only the username/display name/PENDING status/eligibility and observation time; request dates are not stored and appear as `null` (unavailable). A listing observes all pages, rather than an immutable global snapshot.

## Administrator setup receipt — already applied

A already supplied FIX04_OPERATOR_POLICY_READBACK_PASS and actual own-role live proof now passes. The original setup block below is retained for recovery/history; it is not a next action. Standing project authority covers this repair. B cannot perform it because the installed role and boundary both deny IAM writes. No credentials are copied and existing CloudShell credential-provider variables are preserved.

```bash
set -euo pipefail
umask 077
mkdir -p "$HOME/.known-enough/fix04-setup"
curl --fail --silent --show-error --proto '=https' --tlsv1.2 \
  'https://raw.githubusercontent.com/Known-Enough/known-enough/9144a8707db17c68237c4b4d2ee97e06e3aeb6f9/scripts/fix04/install-access.py' \
  -o "$HOME/.known-enough/fix04-setup/install-access.py"
printf '%s  %s\n' '496998c751ff41cd9cbc4fab9c68d638e88d02b6234185f0137ad11948b2aa40' \
  "$HOME/.known-enough/fix04-setup/install-access.py" | sha256sum --check --status
python3 -B "$HOME/.known-enough/fix04-setup/install-access.py" --apply
```

Expected result: `FIX04_OPERATOR_POLICY_READBACK_PASS`. Send only that sanitized JSON result back to B. It reports `effectiveBAccess: NOT_EXECUTED`; readback alone does not finish FIX04.

The repair targets only `KnownEnoughGithubPartitionMigration` and its dedicated `KnownEnoughGithubPartitionMigrationBoundary`. It adds key-only DynamoDB Scan (`PK`/`SK`, `SPECIFIC_ATTRIBUTES`) on `KnownEnoughPartitions`, AdminGetUser/ListUsers on `us-east-1_V9OMjd0zx`, and GetFunction on the exact existing primary API for its pinned private source package. No user, password, email, membership, model, worker or AWS resource is changed. Existing scope and IAM-write denial are preserved. Full prior policy versions are saved privately before changes; if all five slots are occupied, one saved non-default version is removed before the new version is created. A shared boundary or unrecognized source/policy change stops before repair. Unknown write acknowledgment is journaled and never automatically retried.

## One-time tool setup in the same private CloudShell

This installs a frozen public source copy and checksum-pinned Node `24.21.0`/npm `11.19.0` in the caller's durable home. It does not install a cloud worker or execute an AWS operation, AI call or email request. Repeating the same setup verifies existing source rather than reinstalling it.

```bash
set -euo pipefail
umask 077
mkdir -p "$HOME/.known-enough/fix04-setup"
curl --fail --silent --show-error --proto '=https' --tlsv1.2 \
  'https://raw.githubusercontent.com/Known-Enough/known-enough/df3e651cf96e09f4e2452e4398e60c1fa0b9140b/scripts/fix04/bootstrap.py' \
  -o "$HOME/.known-enough/fix04-setup/bootstrap.py"
printf '%s  %s\n' '0f68cd163f854efd4daab2d698ac4f8ed13444dfe406a6d143494e1ea32715f0' \
  "$HOME/.known-enough/fix04-setup/bootstrap.py" | sha256sum --check --status
python3 -B "$HOME/.known-enough/fix04-setup/bootstrap.py" \
  --source-sha df3e651cf96e09f4e2452e4398e60c1fa0b9140b \
  --archive-sha256 4061a2f32258a2443df11923b157ccbc2c5c6a86580def597c8f8516efea827f
```

Expected result: `FIX04_TOOL_SOURCE_VERIFIED`, or `FIX04_TOOL_ALREADY_MATCHED` on a verified repeat. Linux x86_64 and arm64 are supported. Source checksum is independently frozen at `df3e651cf96e09f4e2452e4398e60c1fa0b9140b`; cached or edited source is rejected. The exact setup downloaded Node/npm/dependencies and verified all frozen source files in a private local Linux test; a second invocation returned ALREADY_MATCHED with zero AWS/provider requests. This proves installation, not AWS access or a real approval.

## The two routine commands

List all observed pending application requests:

```bash
"$HOME/.known-enough/access-users/access-users" list --pending
```

Approve only the exact username you selected from that private list:

```bash
"$HOME/.known-enough/access-users/access-users" approve --username "EXACT_USERNAME"
```

For example, replace `EXACT_USERNAME` with the exact selected value `chosen-user-01`. Do not select by display name. For two explicitly selected users, use:

```bash
"$HOME/.known-enough/access-users/access-users" approve \
  --username "FIRST_EXACT_USERNAME" --username "SECOND_EXACT_USERNAME"
```

Listing performs no transaction or data mutation. It discovers only account STATE keys through a bounded key-only native catalog, then reads canonical accounts and EMAIL ownership through the active native source/journal fences; it does not scan raw private payloads or use the retired aggregate. Pagination must complete. Limits are 100 metadata pages and 10,000 account keys; limit/cursor/identity failures produce an error, never a truncated successful list.

Approval resolves the exact provider username to its immutable subject, checks current verified email/enablement and native email ownership, rereads native state, and conditionally changes only PENDING to APPROVED. It preserves the profile and all unrelated fields and confirms fresh readback. It creates no group membership or participant consent. APPROVED is an explicit zero-mutation ALREADY_APPROVED result; REJECTED/DISABLED, unknown/ambiguous mappings, unverified email and stale versions are rejected. Multiple targets have individual outcomes and are not atomic as a batch. Unexpected operational failures retain confirmed earlier outcomes and skip remaining targets.

Expected list result is `PENDING_LIST_COMPLETE`, with a private `pending` array; empty array means zero observed pending requests. Expected approval result is `APPROVALS_COMPLETE`, with per-user APPROVED or ALREADY_APPROVED. `APPROVALS_PARTIAL` reports rejected/failed/skipped selections and returns nonzero. Do not infer rollback of earlier successes.

Private audit files are under `$HOME/.known-enough/access-users/private/`, mode 0600 beneath a mode-0700 directory. They contain UTC, source/API hash, operation and bounded outcome counts, without account identifiers. A cached verified API ZIP is private; temporary extracted configuration is removed after each command. Never upload that folder. The primary native API is pinned to hash `83d794ac6cd4fe204f30a320c4e34537b683b76da3aedb6a106f9077dff6f663`; deployment drift fails closed and requires a checked source update.

## If a command fails

AccessDeniedException means the current AWS identity lacks the printed operation; use the repaired installed role or A's own administrator session. A configuration readback must be followed by effective access proof. Do not repeat the same test before the installed permissions change. WRONG_ACCOUNT means select the existing project account, without borrowing credentials. IDENTITY_MISMATCH/MISSING_IDENTITY means reconcile the trusted provider/native mapping; do not fabricate an account or approve by display name. UNVERIFIED_EMAIL/INACTIVE_PROVIDER/NOT_PENDING require resolving that account state, not forcing approval. STALE_ACCOUNT/UNCONFIRMED_APPROVAL require fresh private inspection before another selection; no write is automatically repeated. Source/cache/hash or shared-boundary errors require B's checked package update; do not disable the guard or overwrite other work. A failed admin repair reports confirmed IAM writes and unknown acknowledgments in its private backup's execution journal; send only sanitized status/errors to B.

## Completed proof and future B use

Own-A proof38611720048 passed with the current operator/source pindf3e651, including exact selected-email private configuration readback. B must pull current main and verify its own effective access on future use; do not duplicate a passing signup proof merely to repeat this installation. The existing `fix04-proof.yml` workflow remains available for required regression verification. It completes a read-only global preflight before creating two fresh owned pending fixtures, executes these actual list/approve CLI commands privately, approves one fixture, leaves the other pending, verifies zero automatic memberships and idempotence, then disables/deletes owned accounts and mailboxes. Public reports contain only counts/statuses. Own-A list/selected approval/live signup/conflict proof and cleanup passed; FIX04 is DONE under the explicit takeover. B execution remains unclaimed.

[Ticket](ticket.md) · [Evidence](../../../../review-artifacts/FIX04/access-commands.md)

## Email conflicts and missed signup intake

Ordinary emails support one account per verified email. The privately selected testing email is exempt: new usernames create separate PENDING accounts. No new username takes over an existing account; ordinary already-linked emails cannot enter the pending queue as a second identity. Verification now completes and the signed-in app explains how to use the original account or a different email. Confirmed users missing an eligible app record recover automatically into PENDING through a trusted server lookup; rejected/disabled or email-conflicting identities are not automatically approved or reset.

An empty pending list is a valid result when only already-linked usernames were created. Do not fabricate state or retry an old verification code to force registration. Source9144 tools pinned the prior API68 and stop after this server update: run the current setup block once, then the same list/approve commands.
