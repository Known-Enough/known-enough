# CloudShell commands — account access

These are the current routine account commands for AWS account `092954139775`. The selected-email exception is already published; no new cloud installation or permission repair is needed for it.

Open your existing AWS CloudShell. Before listing a new account, sign in to [Known Enough](https://main.d143q5ravxp5av.amplifyapp.com/) with that username and refresh. This creates its pending app-access request automatically when eligible. Each username still needs separate approval.

## 1. Set up or refresh the account tool

If you have this repository checked out in CloudShell:

```bash
bash scripts/cloudshell-commands/01-setup-access-users.sh
```

Otherwise, copy the contents of [01-setup-access-users.sh](01-setup-access-users.sh) into CloudShell inside parentheses, or use the complete copy/paste block in the [operator guide](../../docs/tasks/active/fix/FIX04/commands.md#one-time-tool-setup-in-the-same-private-cloudshell).

This downloads the exact checked tool and its pinned local runtime. It does not run application tests, create users, send email or change AWS resources. Expected output: `FIX04_TOOL_SOURCE_VERIFIED` or `FIX04_TOOL_ALREADY_MATCHED`.

## 2. List pending accounts

```bash
"$HOME/.known-enough/access-users/access-users" list --pending
```

Repository shortcut: `bash scripts/cloudshell-commands/02-list-pending-users.sh`.

Use the exact `username` shown in the private result. An empty `pending` array means there are no pending app records at that observation; creating a Cognito login alone may need a first app sign-in/refresh to recover missing intake.

## 3. Approve one selected account

Replace `EXACT_USERNAME` with the username you choose from the list:

```bash
"$HOME/.known-enough/access-users/access-users" approve --username "EXACT_USERNAME"
```

Repository shortcut: `bash scripts/cloudshell-commands/03-approve-users.sh "EXACT_USERNAME"`.

## 4. Approve several selected accounts

```bash
"$HOME/.known-enough/access-users/access-users" approve \
  --username "FIRST_EXACT_USERNAME" \
  --username "SECOND_EXACT_USERNAME"
```

Repository shortcut: `bash scripts/cloudshell-commands/03-approve-users.sh "FIRST_EXACT_USERNAME" "SECOND_EXACT_USERNAME"`.

Approval grants app access to those usernames only. It creates no groups or group memberships. After approval, the user refreshes the app. Already approved accounts return `ALREADY_APPROVED` without another change.

## Existing setup and troubleshooting

[Full operator guide](../../docs/tasks/active/fix/FIX04/commands.md) includes exact existing administrator setup, error meanings and private audit locations. That older permission repair is already applied; it is a historical/recovery command, not a routine setup step. [Selected-email behavior](../../docs/tasks/active/fix/FIX04/shared-test-email.md) explains separate accounts and approval.

This folder contains current account-management commands. Existing operations installers and their state-specific recovery instructions stay in their original task folders; do not rerun those installations to manage users.

## If CloudShell reports “no space left on device”

The update did not finish, so the old wrapper can also report `CHECKED_NATIVE_API_REQUIRED`. Run [04-recover-disk-space.py](04-recover-disk-space.py) with Python, then repeat the normal list command. The helper removes npm download cache, reproducible account-tool dependencies and obsolete public source downloads only. It uses `/tmp` for the new npm download cache, preserves private AWS snapshots/journals/audits and rollback ZIPs, backs up changed or truncated public source files before repairing them from the checksum-pinned archive, and updates the tool. It never invokes AWS or runs application tests.

```bash
python3 -B scripts/cloudshell-commands/04-recover-disk-space.py
```

Expected last result: `LOCAL_SPACE_RECOVERY_COMPLETE`; then run step2 above. This recovery helper has been prepared and manually reviewed, not executed or tested in A's chat at the user's direction. Actual CloudShell recovery awaits the user's result.
