# ASSESS09 — verified same-source Cognito repair/resume

2026-10-02: local repair is verified and published at **da3b1bd1cbc6c7eac155dcd03a52e60bdf1c52ef**. A runs the command below in the same AWS CloudShell HOME that holds the original approved configuration and backup. This supersedes the old generic/new-pin and IAM-only resume commands for the interrupted Cognito step. B made no AWS calls and does not claim managed success.

## One resume command

```bash
set -euo pipefail
umask 077
repair=da3b1bd1cbc6c7eac155dcd03a52e60bdf1c52ef
helper=$(mktemp "$HOME/known-enough-cognito-resume.XXXXXX")
curl --fail --silent --show-error "https://raw.githubusercontent.com/Known-Enough/known-enough/$repair/scripts/live-qa/resume-cognito-fix.sh" -o "$helper"
bash "$helper" "$repair"
```

Keep the existing approved config and all state in place. Do not run the old IAM-only helper first, clear pending manually, replace a backup, or switch the deployment source to this repair pin. The original source remains **30fa91ad914c1dc1732680784ee368e2f30c9e92**; the helper applies only reviewed operational overlays. It retains the fixed IAM missing-error adapter, Node 24.21.0/npm 11.19.0 PATH and original build cwd.

The helper rebuilds disposable tools/output without touching original progress, verifies both original ZIP hashes, and preserves original config/manifest/artifacts/rollback under the private package directory's `assess09-original/`. It checks read-only Lambda/client/table/routes/policy and pool evidence. Only a proven pending `enable-signup` can become `poolDone`; immutable original journal bytes are retained as `primary-before-assess09.json`. Other pending actions and unknown configuration differences remain blocked. The original expiry **2026-10-09T03:16:41.171626Z**, limits and accumulated counters remain unchanged.

Expected output, in order:

1. Offline tools return `PREPARED`, `cloudWrites:false`, with the original hashes.
2. `PRIMARY_SIGNUP_RECONCILED`, `cloudWrites:false` confirms the local checkpoint repair; a later successful retry can return `PRIMARY_RECONCILIATION_NOT_REQUIRED` instead.
3. Authorized original setup resumes and ends with `SETUP_READBACK_PASS`, source `30fa91ad914c1dc1732680784ee368e2f30c9e92`, `cloudQualification:PENDING_LIVE04`.
4. `LIVE_QA_INSTALLED_TARGET=` prints only the allowlisted target needed for GitHub configuration.

If it prints `BLOCKED`, stop and retain every saved file. For `PRIMARY_POOL_RECONCILIATION_MISMATCH`, the helper also prints only differing top-level field names, never values. That small status/field list is enough for the next repair; do not share config, raw Cognito responses, journals, ZIPs, tokens or secrets. No unchecked mutation is adopted.

## Verification and remaining checks

The old JSON hash rejects identical settings when a previously absent AutoVerifiedAttributes field is appended in a different object order. Tests reproduce this specific defect, nested key/client scope reordering, propagation, rollback, preservation and genuine drift rejection. Known set order and empty optional attribute/scope lists normalize; scalar defaults and unknown configuration differences remain exact. B did not have the private failed response, so any additional live difference is checked rather than assumed harmless.

Focused checks **56/56**; pinned full `npm run check` exit 0: **639 application tests**, two optional skips, **hosted 1/1**, **browser 56/56**, references/planning/lint/types/boundaries/build. An isolated original-source build verified operational overlay imports, unchanged package hashes and preserved journal/backup at mocked STS denial. Published helper/primary/adapter bytes were downloaded from the exact repair URL and compared with the immutable Git blobs; Bash syntax passed. These are local checks, not actual cloud qualification.

Original API ZIP: `6a0cd3eb5b35b1c993917962b9f5f3eb415a6eb75f9b25f98141c1ee36708b4a`; broker ZIP: `b5f93d79414e582107ea16d6fd351c19d22419f47ebe772482f98630d2426a49`.

A's actual reconciliation/readback, real Cognito delivery to Mail.tm/cleanup, B workload manual qualification and matching automatic complete PASS remain [ASSESS07](tasks/ASSESS07.md). NP00 remains A's excluded work. See [ASSESS09 evidence](tasks/ASSESS09.md) and the [remaining installation/qualification instructions](live-qa-final-handoff.md) after successful readback.
