# Transfer the two remaining live test runs to A — 2026-10-03 UTC

## Newly authorized single additional cycle — guarded helper checked, pending CloudShell apply

At 2026-10-03T20:12:45Z the user authorized exactly one more live cycle after the previous two were consumed. A's read-only check found the original grant still approved, a CLEAN lease, six daily starts, five synthetic messages, and the exception at `additionalRuns=2, usedRuns=2`. The current broker correctly blocks a third use. The helper adds one start to this exact dated exception while preserving `usedRuns=2`, original daily/per-run/cumulative caps, and expiry `2026-10-04T00:00:00Z`. Focused10/10 and pinned full checks pass. Source is synced on `main` at `44788157c25b61bba606a41ee05d15ef5d73c81f`; helper SHA-256 is `75b4a81c319ac40d108bfbf1cfbe79da27d0b9a0cdaea17194db90d573c85c47`. A's AWS profile is read-only; A must use the CloudShell administrator session for the exact guarded update below. It reads current state and headroom before changing anything. `set -e` prevents applying if its read-only preparation is blocked.

```bash
set -euo pipefail
umask 077
COMMIT=44788157c25b61bba606a41ee05d15ef5d73c81f
SHA256=75b4a81c319ac40d108bfbf1cfbe79da27d0b9a0cdaea17194db90d573c85c47
DIR=$(mktemp -d "$HOME/known-enough-third-run.XXXXXX")
curl --fail --silent --show-error \
  "https://raw.githubusercontent.com/Known-Enough/known-enough/$COMMIT/scripts/live-qa/approve-third-extra-run.py" \
  -o "$DIR/approve.py"
printf '%s  %s\n' "$SHA256" "$DIR/approve.py" | sha256sum --check --status
python3 -B "$DIR/approve.py"
python3 -B "$DIR/approve.py" --apply
```

The first result must be `THIRD_RUN_PREPARED` with `cloudWrites:false`; the second must be `THIRD_RUN_APPROVED`, `remaining:1`, and the unchanged expiry. Stop and paste the result if either result differs or is blocked. The helper changes only the existing exception counter, from three approved/two used, preserving the previous two runs. It neither raises the recurring daily limit nor resets any totals. Once the second result is confirmed, one deployment of the synced prompt correction starts the one authorized automatic qualification.

The existing two-use exception was approved for B, but B is unavailable. The user asked A to continue ASSESS07. The one-time transfer changed only the existing `EXTRA#2026-10-03/STATE` record's approved GitHub actor from `Battosai1806` to `martelaxe`. It preserved the number already used, so it transferred only remaining starts; it did not restore a spent start.

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

At the time of the original B approval, B was to pull the commit containing extra-runs.mjs and the broker change, claim ASSESS07 and start an authorized main deployment. Its automatic qualification would publish the updated broker before fixture startup. This is historical; the current A takeover procedure is above. No separate administrator Lambda upload, IAM change, new resource or personal credential sharing is needed.

When normal daily starts are exhausted, the broker fetches fixed-repository GitHub run metadata and requires the exact in-progress main automatic qualification workflow, matching run/attempt and both actor/triggering_actor Battosai1806. The exception consumes one of its two uses in the same conditional transaction as ordinary DAY/TOTAL/LEASE usage. It never changes the four/day grant, cumulative run/model/token/email ceilings or original2026-10-09T03:16:41.171626Z expiry. Other actors, a third extra run, malformed/drifted approval, wrong day, stale versions and unverified GitHub metadata fail closed. All future UTC days use the original four/day limit.

[Current task and authorization](../../docs/tasks/active/live-testing/ASSESS07/ticket.md) · [Shared queue](../../docs/task-board.md).

The initial helper required the four newer total-cap fields to equal the maximum ceilings and could report CUMULATIVE_CEILINGS_CHANGED for a valid original legacy grant or stricter explicit caps. The corrected helper computes exactly cumulative.mjs's existing fallback when all four are absent and preserves smaller explicit caps. Partial, malformed or above-approved totals still block. It never writes new total fields into AUTH or increases available spending. A failed guard before --apply's transaction makes no AWS write.
