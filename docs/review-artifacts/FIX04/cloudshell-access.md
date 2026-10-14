# FIX04 — A’s exact access repair

Run from A’s own existing administrator CloudShell in account `092954139775`, then return only the sanitized result. B needs both the inline read grant and dedicated boundary amendment; the old boundary also omitted these reads. No cloud worker reinstall, model call or real-account approval is part of this action.

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

Expected `FIX04_OPERATOR_POLICY_READBACK_PASS`; effective B access remains NOT_EXECUTED until verified. [Complete command guide](../../tasks/active/fix/FIX04/commands.md) describes scope, private backups, errors and the subsequent proof.
