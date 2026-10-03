# ASSESS09 — verified same-source Cognito and Lambda repair/resume

2026-10-02: local repair is verified and published at **a164eaa0f128db05a337bd3b5d8789ceb3e63906**. This includes complete recorded-update revision proof, retaining A's binary-file/unapplied-upload repair and B's Cognito fix. A runs the command below in the same AWS CloudShell HOME that holds the original approved configuration and backup. This supersedes the old generic/new-pin and IAM-only resume commands for the interrupted Cognito and Lambda upload steps. B made no AWS calls and does not claim managed success.

## One resume command

```bash
(
set -euo pipefail
umask 077
repair=a164eaa0f128db05a337bd3b5d8789ceb3e63906
helper=$(mktemp "$HOME/known-enough-cognito-resume.XXXXXX")
curl --fail --silent --show-error "https://raw.githubusercontent.com/Known-Enough/known-enough/$repair/scripts/live-qa/resume-cognito-fix.sh" -o "$helper"
bash "$helper" "$repair"
)
```

Keep the existing approved config and all state in place. Do not run the old IAM-only helper first, clear pending manually, replace a backup, or switch the deployment source to this repair pin. The original source remains **30fa91ad914c1dc1732680784ee368e2f30c9e92**; the helper applies only reviewed operational overlays. It retains the fixed IAM missing-error adapter, Node 24.21.0/npm 11.19.0 PATH and original build cwd.

The helper rebuilds disposable tools/output without touching original progress, verifies both original ZIP hashes, and preserves original config/manifest/artifacts/rollback under the private package directory's `assess09-original/`. It checks read-only Lambda/client/table/routes/policy and pool evidence. Only a proven pending `enable-signup` can become `poolDone`; immutable original journal bytes are retained as `primary-before-assess09.json`. For pending `update-code`, exact original Lambda revision/code/environment/handler/role and successful active status, Cognito/table/routes/policy plus candidate/rollback bytes must prove the upload never applied. The helper retains `primary-before-lambda-upload-repair.json`, then clears only that proven unapplied intent before retrying. Already-uploaded or foreign revisions, other pending actions and unknown differences remain blocked. For an acknowledged upload (`codeDone=true`, no pending intent), a different revision can be adopted only after exact complete intended Lambda configuration/code size/hash/backup and Cognito/table/routes/policy proof, followed by a second identical read. Unknown settings and runtime versions stay exact; only observational revision/timestamps/state messages are omitted. Before settings change, all original settings remain exact; after recorded settings completion only the intended handler/environment differ (its derived ConfigSha256 is verified through complete settings). Immutable `primary-before-recorded-revision-<content hash>.json` retains the old checkpoint. Both code and configuration update readbacks use this guarded proof, so completed steps are skipped. The original expiry **2026-10-09T03:16:41.171626Z**, limits and accumulated counters remain unchanged.

Expected output, in order:

1. Offline tools return `PREPARED`, `cloudWrites:false`, with the original hashes.
2. For the latest acknowledged-upload revision failure, `PRIMARY_CODE_RECONCILIATION_NOT_REQUIRED`, then `PRIMARY_RECORDED_REVISION_RECONCILED`, `cloudWrites:false`, followed by `PRIMARY_RECONCILIATION_NOT_REQUIRED` show completed upload/signup are retained. A previously synchronized guard returns `PRIMARY_RECORDED_REVISION_NOT_REQUIRED`. For the earlier pre-upload failure, `PRIMARY_CODE_UPLOAD_NOT_APPLIED_RECONCILED`, `cloudWrites:false` confirms read-only proof and checkpoint repair, followed by `PRIMARY_RECONCILIATION_NOT_REQUIRED` for completed signup. Earlier signup interruptions can return `PRIMARY_SIGNUP_RECONCILED`; completed steps return their not-required status.
3. Authorized original setup resumes and ends with `SETUP_READBACK_PASS`, source `30fa91ad914c1dc1732680784ee368e2f30c9e92`, `cloudQualification:PENDING_LIVE04`.
4. `LIVE_QA_INSTALLED_TARGET=` prints only the allowlisted target needed for GitHub configuration.

If it prints `BLOCKED`, stop and retain every saved file. For `PRIMARY_POOL_RECONCILIATION_MISMATCH` or `PRIMARY_RECORDED_CONFIG_MISMATCH`, the helper also prints only differing top-level field names, never values. That small status/field list is enough for the next repair; do not share config, raw Cognito responses, journals, ZIPs, tokens or secrets. No unchecked mutation is adopted.

## Verification and remaining checks

The old JSON hash rejects identical settings when a previously absent AutoVerifiedAttributes field is appended in a different object order. Tests reproduce this specific defect, nested key/client scope reordering, propagation, rollback, preservation and genuine drift rejection. Known set order and empty optional attribute/scope lists normalize; scalar defaults and unknown configuration differences remain exact. B did not have the private failed response, so any additional live difference is checked rather than assumed harmless.

Current focused primary/CLI/helper checks **82/82**; pinned full `npm run check` exit 0: **673 application tests**, two optional skips, **hosted 1/1**, **browser 56/56**, references/planning/lint/types/boundaries/build. An isolated original-source build verified operational overlay imports and unchanged package hashes. Regression tests prove private file byte equality/permissions/cleanup, native Linux large-argument launch, preserved journal/backup, exactly one retry and rejection of applied uploads or genuine drift. Published helper/primary/adapter bytes were downloaded from the exact repair URL and compared with the immutable Git blobs; Bash syntax passed. The original 554956-byte ZIP embedded in JSON exceeds Linux's per-argument limit before AWS starts. The repaired command uses a private binary file and a fresh revision guard only after full recorded-state proof. Additional regressions cover acknowledged code/settings updates, complete configuration/unknown-field drift, immutable backups, no repeated writes and concurrency rejection. Actual readback confirms the upload succeeded; its different revision cause is not established. Local launch failures are reported separately; AWS denials remain blocked. These are local checks, not actual cloud qualification.

Original API ZIP: `6a0cd3eb5b35b1c993917962b9f5f3eb415a6eb75f9b25f98141c1ee36708b4a`; broker ZIP: `b5f93d79414e582107ea16d6fd351c19d22419f47ebe772482f98630d2426a49`.

A's actual reconciliation/readback, real Cognito delivery to Mail.tm/cleanup, B workload manual qualification and matching automatic complete PASS remain [ASSESS07](tasks/active/live-testing/ASSESS07/ticket.md). NP00 remains A's excluded work. See [ASSESS09 evidence](tasks/historical/completed/assessments/ASSESS09/ticket.md) and the [remaining installation/qualification instructions](live-qa-final-handoff.md) after successful readback.
