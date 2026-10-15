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

## Enable real decision drafting when FIX01 is blocked

[05-enable-decision-drafting.py](05-enable-decision-drafting.py) combines the two remaining configuration changes for the currently published native runtime: grant the API its exact Nova Lite invoke permission and enable public decision drafting. Run from your existing administrator CloudShell in account092954139775.

```bash
python3 -B scripts/cloudshell-commands/05-enable-decision-drafting.py --apply
```

It checks the exact current API/worker hashes and source, keeps the private worker schedule and retention disabled, preserves usage totals, saves a private pre-change backup, refuses a different existing named policy, uses a conditional control update and reads configuration back. It does not call AI, sign up a user or run tests. Expected final result is `DECISION_DRAFTING_SETUP_READBACK_PASS`; actual decision creation still requires your manual check. Prepared for API83d794ac/workerf15b5164/jobsource4fc702b; changed runtime or active jobs stop before setup.

## Private interpretation timestamp permission (FF02)

[06-private-interpretation-access.py](06-private-interpretation-access.py) preserves the reviewed narrow administrator setup from the [FIX01 command](../../docs/review-artifacts/FIX01/owner-processing-access-command.md). It installs only transactional PutItem for RETENTION#* on the operations journal for the API service. It changes no users, model permissions, retention policy, usage or worker schedule and invokes no models/tests. Use the exact installed API hash from the matching publication receipt via `--api-sha256`; default is the earlier checked API046174a6. Current-runtime mismatch or a conflicting named policy stops the helper. Successful permission installation still needs synthetic-policy activation and participant consent; code readiness is not live acceptance.

For the exact currently published API and complete download/checksum block, use [FF02 CloudShell command](../../docs/tasks/active/ff/FF02/cloudshell-command.md). Synthetic policy is enabled with in-app consent required; only the named timestamp permission remains missing in actual readback38762492720. No other installer is needed for this change.
