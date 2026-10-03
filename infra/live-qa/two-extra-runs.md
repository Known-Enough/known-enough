# ASSESS07 — prepare B's final live test — 2026-10-03 UTC

**New direction:** reusable [GitHub-only approvals](github-run-approvals.md) are prepared, pending one-time broker activation. This CloudShell procedure preserves the previous guarded one-use handoff. Do not combine both approval paths for the same human authorization.

## Historical CloudShell path: exact CLI bug fixed; allowance not applied

The user assigned B (`Battosai1806`) one final automatic live cycle. Its one-use slot is **not yet installed**. Both previous extra cycles remain spent. The deadline is `2026-10-04T00:00:00Z` (18:00 on October 3 in Mexico City).

The helper constructed `--consistent-read true`; AWS CLI rejected the extra `true` locally with exit252 / `Unknown options: true`, before any AWS request. Earlier error-parser changes missed the malformed command. The boolean-option builder is now fixed and regression-tested through the actual subprocess arguments.

Actual AWS read-only preflight now returns `THIRD_RUN_PREPARED_FOR_B`, `remaining:1`, `cloudWrites:false`, unchanged expiry `2026-10-04T00:00:00Z`. The allowance is not yet installed. Focused12/12 and pinned Node24.21.0/npm11.19.0 full `npm run check` PASS:707 application tests/two optional skips, hosted1/1, E2E58/58, references7/7, planning15/15, lint/types/build/boundaries. Corrected source is `5279d8a4edbb0d01eabd832c5f487cba98d8d9e3`; helper SHA-256 is `576a0b4733ac04ee933543d2f9a631af5283230a42dcb5f33a3d8ccabd16dba9`. No cloud write, deployment, live test, paid AI or email occurred during this repair. The guarded transaction still changes only the one-use exception, preserves `usedRuns=2`, and checks the original authorization, versions, CLEAN state, budget headroom and expiry.

CloudShell startup repair is already complete. Paste this entire block into A's normal CloudShell prompt. It first checks the real AWS records without writing; `--apply` runs only if that check succeeds. The subshell keeps a failed check from closing CloudShell.

```bash
(
  set -euo pipefail
  umask 077
  COMMIT=5279d8a4edbb0d01eabd832c5f487cba98d8d9e3
  SHA256=576a0b4733ac04ee933543d2f9a631af5283230a42dcb5f33a3d8ccabd16dba9
  DIR=$(mktemp -d "$HOME/known-enough-third-run.XXXXXX")
  curl --fail --silent --show-error \
    "https://raw.githubusercontent.com/Known-Enough/known-enough/$COMMIT/scripts/live-qa/approve-third-extra-run.py" \
    -o "$DIR/approve.py"
  printf '%s  %s\n' "$SHA256" "$DIR/approve.py" | sha256sum --check --status
  python3 -B "$DIR/approve.py"
  python3 -B "$DIR/approve.py" --apply
)
```

Expected output: `THIRD_RUN_PREPARED_FOR_B`, then `THIRD_RUN_APPROVED_FOR_B` with `remaining:1`. A repeat after a lost successful response returns `THIRD_RUN_ALREADY_APPROVED_FOR_B` without replenishing a spent run. If a check blocks or the deadline passes, stop and report its code; do not edit AWS records or extend the allowance.

A applies the pinned helper in CloudShell using A's administrator session. After successful `THIRD_RUN_APPROVED_FOR_B` readback, B pulls clean `main`, signs into GitHub as `Battosai1806`, and starts one staging deployment; its matching qualification starts automatically. B needs no AWS credentials or separate test-workflow click. Only one cycle is authorized, with no reset of used runs, caps or expiry. No B execution or full live PASS is claimed.

The separate CloudShell recovery session lost the old `$DIR` variable, explaining the historical `/approve.py` file error. It did not change AWS state. The previous `Unknown` / `UnclassifiedCliError` reports masked this CLI usage error; they did not establish an AWS permission denial.

## Historical A transfer and two completed automatic runs

The existing two-use exception was originally approved for B. When B was unavailable, the user authorized A to continue and the one-time transfer changed only the existing `EXTRA#2026-10-03/STATE` record's actor from `Battosai1806` to `martelaxe`. It preserved the number already used; it did not restore a spent start.

**Applied 2026-10-03:** User supplied CloudShell readback `TWO_EXTRA_RUNS_TRANSFERRED_TO_A`, initially `remaining: 2`, expiring `2026-10-04T00:00:00Z`. Matching automatic qualifications [37145997504](https://github.com/Known-Enough/known-enough/actions/runs/37145997504) and [37147658807](https://github.com/Known-Enough/known-enough/actions/runs/37147658807) both passed fixture startup, consuming the two slots atomically. Both extra cycles are used; no separate post-run administrator readback was performed. Do not rerun the transfer or dispatch another qualification under this allowance. The helper's default is read-only. Before `--apply`, it checked account `092954139775`, the exact active `KnownEnoughQaControl` table, the original grant and its expiry, all existing limits and remaining budget, a `CLEAN` test record, current daily usage, the existing two-run approval, and its unchanged version. It saved a private original snapshot under `$HOME/known-enough-two-extra-runs-transfer/2026-10-03`, then conditionally updated only the exception record. `AUTH`, `DAY`, `TOTAL`, and `LEASE` are condition-checked and left unchanged. Readback confirmed the change.

The exact CloudShell block A used is preserved here. The commit and helper hash are pinned to the checked, published helper:

```bash
set -euo pipefail
umask 077
TRANSFER_COMMIT=e0199859069d7ccd1f80a0ccfadb9a9f5c61c35a
TRANSFER_SHA256=1ac6dbe6e854ab0eb5c2970d9a1cea361d4963ab491e7f0a7e86a41e40d38129
TRANSFER_DIR=$(mktemp -d "$HOME/known-enough-transfer.XXXXXX")
curl --fail --silent --show-error \
  "https://raw.githubusercontent.com/Known-Enough/known-enough/$TRANSFER_COMMIT/scripts/live-qa/transfer-two-extra-runs-to-a.py" \
  -o "$TRANSFER_DIR/transfer.py"
printf '%s  %s\n' "$TRANSFER_SHA256" "$TRANSFER_DIR/transfer.py" | sha256sum --check --status
python3 -B "$TRANSFER_DIR/transfer.py" --apply
```

The successful result must be `TWO_EXTRA_RUNS_TRANSFERRED_TO_A` with a nonzero `remaining` count and the unchanged expiry `2026-10-04T00:00:00Z`. A readback showing `TWO_EXTRA_RUNS_ALREADY_TRANSFERRED` is also safe after a lost response; it does not consume or add starts. A blocked result means stop and report its code; do not edit AWS records by hand or retry a changed helper.

After the successful readback and the user's separate deployment/test approval, A published the checked broker and QA package through deployment [37145958639](https://github.com/Known-Enough/known-enough/actions/runs/37145958639). Its automatic qualification [37145997504](https://github.com/Known-Enough/known-enough/actions/runs/37145997504) matched the source and both actor fields. It used one model attempt and one synthetic signup message, passed cleanup, and failed QA03 draft on a browser transport error. The safe diagnostic correction was published by deployment [37147620296](https://github.com/Known-Enough/known-enough/actions/runs/37147620296); matching qualification [37147658807](https://github.com/Known-Enough/known-enough/actions/runs/37147658807) used the second and final allowance. It also used one model attempt and one synthetic signup message, passed cleanup, and failed QA03 draft with fixed category `HTTP_REQUEST_ABORTED`. Each run passed QA01/02 and blocked QA04–07. Both extra starts are consumed and the exception expires `2026-10-04T00:00:00Z`. The broker accepts an extra start only when the exception and both GitHub run actor fields say `martelaxe`, with verified repository, automatic workflow, branch, run and attempt. The existing four-per-day rule, per-run limits, cumulative ceilings, prior totals, CLEAN cleanup requirement and original seven-day expiry remain in force.

## Historical B allowance installation

The original user grant authorized two extra synthetic qualification runs for B/Battosai1806. This section records the already-applied setup; it is not the current next step.

User approval covered two additional one-time synthetic ASSESS07 runs for B/Battosai1806. This was not a recurring six-per-day setting. Only A applied the administrator helper with A's own AWS session.

`python3 scripts/live-qa/approve-two-extra-runs.py --apply` checks account092954139775, exact existing KnownEnoughQaControl, original approved grant/expiry/cumulative ceilings (including legacy grants without explicit total fields), CLEAN lease, four current-day starts and sufficient daily email/cumulative headroom. It writes only EXTRA#2026-10-03/STATE, with a two-use counter and expiry2026-10-04T00:00:00Z. AUTH, DAY, TOTAL and LEASE remain unchanged and their versions are checked atomically. A private immutable original snapshot is saved in $HOME/known-enough-two-extra-runs/2026-10-03; rerunning never replenishes a consumed allowance. Without --apply the helper is read-only. A successful result is TWO_EXTRA_RUNS_APPROVED or TWO_EXTRA_RUNS_ALREADY_APPROVED, with remaining count. A BLOCKED result is not applied approval.

At the time of the original B approval, B was to pull the commit containing extra-runs.mjs and the broker change, claim ASSESS07 and start an authorized main deployment. Its automatic qualification would publish the updated broker before fixture startup. This is historical; the current one-use B handoff is above. No separate administrator Lambda upload, IAM change, new resource or credential sharing is needed.

When normal daily starts are exhausted, the broker fetches fixed-repository GitHub run metadata and requires the exact in-progress main automatic qualification workflow, matching run/attempt and both actor/triggering_actor Battosai1806. The exception consumes one of its two uses in the same conditional transaction as ordinary DAY/TOTAL/LEASE usage. It never changes the four/day grant, cumulative run/model/token/email ceilings or original2026-10-09T03:16:41.171626Z expiry. Other actors, a third extra run, malformed/drifted approval, wrong day, stale versions and unverified GitHub metadata fail closed. All future UTC days use the original four/day limit.

[Current task and authorization](../../docs/tasks/active/live-testing/ASSESS07/ticket.md) · [Shared queue](../../docs/task-board.md).

The initial helper required the four newer total-cap fields to equal the maximum ceilings and could report CUMULATIVE_CEILINGS_CHANGED for a valid original legacy grant or stricter explicit caps. The corrected helper computes exactly cumulative.mjs's existing fallback when all four are absent and preserves smaller explicit caps. Partial, malformed or above-approved totals still block. It never writes new total fields into AUTH or increases available spending. A failed guard before --apply's transaction makes no AWS write.
