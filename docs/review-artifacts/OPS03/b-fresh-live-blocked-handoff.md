# OPS03 fresh live checkpoint and bounded unblock

UTC: 2026-10-12T09:07:56.564300+00:00. B / Battosai1806. Checked source/package-upload source: cb6bc9e557070eb2e49e31bd50a824f19dcbd2fd. Installed application/worker package remains 2af293eea1cc0d0a0b8af43899d1b99d56bb0bd3; worker SHA256 c46b2a7673297281a730105f3a352b2d98da18e2625472572f1e38d2e404fd3e. No worker reinstallation, new worker/chat/automation or old DEBT01 action.

Fresh scheduled model [38217508750](https://github.com/Known-Enough/known-enough/actions/runs/38217508750), native two-worker race/new terminal instance [38218539176](https://github.com/Known-Enough/known-enough/actions/runs/38218539176), and unconfirmed private-input revision [38220365631](https://github.com/Known-Enough/known-enough/actions/runs/38220365631) passed. Actual source/consent/private readiness, proposal publication, duplicate enqueue, one paid race winner, terminal skip, exact cumulative charges and normal new-fixture cleanup are evidenced. Four actual provider calls total 8,644 tokens, with all failed-call reservations preserved. Fifteen confirmed new users and mailboxes were removed. The final second mailbox creation request was explicitly rejected HTTP429; no creation acknowledgement or Cognito signup exists for that intent, and absence is not separately verified.

The admission harness's initial role mismatch was corrected. Its disabled never-dispatched job was safely drained in [38223171603](https://github.com/Known-Enough/known-enough/actions/runs/38223171603), with no provider port/call or charge change. The changed admission retry stopped earlier at Mail.tm ACCOUNT_CREATE / MAILTM_REQUEST_FAILED / HTTP429 in [38223463457](https://github.com/Known-Enough/known-enough/actions/runs/38223463457); one created user/mailbox cleaned up. The client already waits2.1seconds before every sequential request. [Mail.tm](https://docs.mail.tm/) documents8QPS perIP, but this specific limiter/shared-egress cause and Retry-After are UNKNOWN. Do not repeat unchanged creation/test, guess a reset time, change egress to evade the limit, or use another person's mailbox credentials. Mail.tm must allow ordinary paced creation, or a project-owned permitted alternative must be configured before remaining fresh fixtures.

Actual journal permission [38223272731](https://github.com/Known-Enough/known-enough/actions/runs/38223272731) returned dynamodb:DeleteItem / AccessDeniedException from an impossible-condition transaction, zero mutations. Both installed operator inline policy and boundary match the pre-repair checked source and omit this action. B's installed project roles explicitly deny IAM writes. This is missing installed administrative capability, separate from the fixed harness code and Mail.tm dependency.

## A's one CloudShell block when its terminal is available

Use A's own AWS administrator session in account092954139775. Paste the block below. It retrieves only a checksum-pinned checked script from the project's private SSE artifact storage; no GitHub login or credential sharing is needed.

```bash
(
  set -eu
  umask 077
  OPS03_GRANT_DIR="$(mktemp -d)"
  aws s3api get-object \
    --bucket known-enough-qa-artifacts-092954139775 \
    --key ops01-owned/ops03-journal-grant-0b97136bb478a9c8becbaadb52046735a5e585672e8d886e8de63068774e0902/grant.py \
    "$OPS03_GRANT_DIR/grant.py" \
    --region us-east-1 --no-cli-pager >/dev/null
  printf '%s  %s\n' '0b97136bb478a9c8becbaadb52046735a5e585672e8d886e8de63068774e0902' "$OPS03_GRANT_DIR/grant.py" | sha256sum --check --status
  python3 "$OPS03_GRANT_DIR/grant.py"
)
```

Expected result: OPS03_TERMINAL_POLICY_READBACK_PASS, iamWriteRequests2 on first apply (0 if already exact), dataWrites0, providerCalls0, effectiveBAccessNOT_EXECUTED. Return the complete sanitized JSON to B. Keep the printed private backup folder. If a source-drift, denied write or limit error appears, return that exact JSON rather than retrying unchanged.

Only KnownEnoughGithubModelJobOperations / ScopedOperations and KnownEnoughGithubModelJobOperationsBoundary change. The added permission is DeleteItem only on KnownEnoughOperationsJournal MODELJOB#* keys inside TransactWriteItems, with present leading keys and no returned values. Existing actions, resources, source/trust/privilege denies and all other roles remain; the scheduled worker is explicitly excluded. Backups and readbacks precede acceptance; a lost acknowledgement is read without repeating its write. CloudShell AWS_CONTAINER_CREDENTIALS_* is preserved. No data deletion, cumulative TOTAL change, model call, activation, API/worker installation or primary flag change occurs in this block.

The source repair passed6Python and17Node focused checks; pinned full check passed1562application/two optional skips/hosted1/browser65/reference7/planning15/lint/types/build/boundaries455. Script upload [38227395634](https://github.com/Known-Enough/known-enough/actions/runs/38227395634) passed one artifact CREATE and hash readback, zero IAM/model calls. Source is [the checked repair](../../../scripts/operations/jobs-journal-permission-grant.py); checksum0b97136bb478a9c8becbaadb52046735a5e585672e8d886e8de63068774e0902.

## B's continuation

After A returns the repair result, verify fresh own-role metadata and the impossible-condition effective DeleteItem probe. A configuration readback is not B effective access or terminal cleanup PASS. Verify control/TOTAL/source again; current [38227399490](https://github.com/Known-Enough/known-enough/actions/runs/38227399490) readback is DISABLED/active0/slots0, AUTHstanding, synthetic policyDISABLED, migrationACTIVE and TOTALruns65/reservedTokens17501524/reservedCostMicros17467796/messages60,5reads/0writes/provider. sourceMatchesfalse is intentional: helpercb6 differs from installed runtime2af. Actual provider logging is NOT_READ by this final five-key check; prior exact publication/native readbacks proved DISABLED.

Whole OPS03 remains NOT DONE. Remaining live evidence: admission/retention/source/frame-semantic/erasure guards; separate-process restart/lease/incarnation/output races; genuine provider timeout/quiescence/usage and quarantined recovery through a trusted verifier (default callback remains disabled, operator booleans are insufficient); actual terminal journal retention/cleanup, legacy in-progress adoption and deployment/recovery rollback. Prepared tests and local regressions do not turn these gaps into PASS. Resume one bounded claim after dependencies change, keep one writer and new-fixture normal cleanup, and retain all cumulative reservations. Old mailbox cleanup remains deferred DEBT01 and is not an OPS03 gate. MVP01 is queued; no successor implementation or claim starts in this checkpoint.
