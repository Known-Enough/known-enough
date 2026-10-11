# Restore the operations API first

The automatic QA chain replaced the native operations API with its legacy package. The deployed hash is recorded in [recovery evidence](../../../../review-artifacts/OPS03/a-primary-recovery.json). The corrected publication guard preserves operations packages and rejects that mismatch. Local full1,546application/two skips/hosted1/browser64 and four Python recovery tests pass. Actual restoration still needs authenticated own AWS access: WSL setup/SSO sessions expired. This is authentication, not a new approval requirement.

Open AWS CloudShell in account092954139775 and paste this block. It identifies and verifies the original private owner ZIP from successful source1ebfdcd, checks the current observed wrong code and unchanged private configuration, and restores code with a fresh revision guard. It keeps the original signing key and model-disable settings; no participant data operation occurs. Saved diagnostics and archives stay privately under HOME/.known-enough/ops03-primary-recovery.

```bash
(
  set -euo pipefail
  umask 077
  repair=97b56a8b336dbd2b3541ec7e1e871e8b05812d4b
  file="$HOME/known-enough-restore-primary.py"
  curl --fail --silent --show-error \
    "https://raw.githubusercontent.com/Known-Enough/known-enough/$repair/scripts/operations/restore-operations-primary.py" \
    -o "$file"
  printf '%s  %s\n' ed5e72abd5baa50fccc832c42c3e14134e1a733e979eff9ee3ef5bde7c1b156b "$file" | sha256sum --check --status
  python3 -B "$file" --apply
)
```

Return only the final JSON result. OPERATIONS_PRIMARY_RESTORED or OPERATIONS_PRIMARY_ALREADY_RESTORED is the code-recovery checkpoint, not whole OPS03 completion. BLOCKED identifies the failed guard; private last-error-private.txt remains available locally for a sanitized diagnosis. Do not regenerate the private signing key or force another code upload.

After verified restoration, continue source-matching authenticated enqueue/frontend binding, [disabled dedicated worker installation](cloudshell-runtime-install.md), safe control/source transition and actual owned provider/restart/duplicate/usage/cleanup qualification. Existing automatic QA38162912629 reports4pass/1fail/2blocked,8model attempts/1signup message and cleanupPASS; it does not qualify OPS03. Its pending failure and final reporting-source mismatch remain explicit.
