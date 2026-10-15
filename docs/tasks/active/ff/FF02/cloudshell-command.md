**Already applied by the user — 2026-10-15T17:43:10Z.** The named permission installation succeeded. Keep this block as historical setup evidence; do not rerun it for later API deployments. Its old API hash will intentionally reject a newer package. [User receipt](../../../../review-artifacts/FF/processing-stamp-user-receipt.json).

# Complete FF02 private-interpretation access

The native owner route is now published in coordinated source `3da3ded80337cd9693bb213d48180c42f495ad6b`. A's actual read-only run [38762492720](https://github.com/Known-Enough/known-enough/actions/runs/38762492720) confirms the named `FIX01VerifiedSyntheticProcessingStamp` policy is absent. Use your own administrator CloudShell in account `092954139775` to add only that transactional timestamp permission. No new human approval is requested; the missing AWS capability cannot be installed by the deployed GitHub roles.

The script verifies the exact current API hash and role, backs up prior metadata privately, refuses a conflicting policy or a role boundary, installs the one named grant and reads it back. It changes no accounts, group memberships, model permissions, usage or schedules, and calls no AI or tests. Do not rerun an older full installer.

```bash
(
  set -euo pipefail
  umask 077
  KE_FF02_HELPER=$(mktemp /tmp/known-enough-private-access.XXXXXX)
  curl --fail --silent --show-error \
    "https://raw.githubusercontent.com/Known-Enough/known-enough/3da3ded80337cd9693bb213d48180c42f495ad6b/scripts/cloudshell-commands/06-private-interpretation-access.py" \
    -o "$KE_FF02_HELPER"
  printf '%s  %s\n' \
    b3088e26b93399e0682d26f90f29a559bd05539f1535344a86f416beaad63f5b \
    "$KE_FF02_HELPER" | sha256sum --check --status
  python3 -B "$KE_FF02_HELPER" \
    --api-sha256 c1ec4a079d137f1e39c24066a42df03a9b4f7746ae33297456747f2e8397e0ec
)
```

Return only the final JSON. Expected: `FIX01_PROCESSING_STAMP_POLICY_READBACK_PASS`. A later API deployment can change the expected hash; stop on mismatch rather than bypassing the guard.

Then refresh your decision. Every required person must confirm the current shared frame from their own account. For private interpretation, also confirm your own frame, enter fictional test conditions and explicitly tick synthetic processing consent. Review the AI's suggested conditions before choosing any confirmation. No participant's consent or conditions are confirmed automatically. Use only fictional non-sensitive information in this preview. Actual functional acceptance is the user's manual check, not the permission receipt.
