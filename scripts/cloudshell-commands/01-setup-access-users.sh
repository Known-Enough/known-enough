#!/usr/bin/env bash
# Run with bash, rather than sourcing into your interactive CloudShell.
# Installs/refreshes the operator tool locally; makes no AWS resource changes.
set -euo pipefail
umask 077

mkdir -p "$HOME/.known-enough/fix04-setup"
curl --fail --silent --show-error --proto '=https' --tlsv1.2 \
  'https://raw.githubusercontent.com/Known-Enough/known-enough/df3e651cf96e09f4e2452e4398e60c1fa0b9140b/scripts/fix04/bootstrap.py' \
  -o "$HOME/.known-enough/fix04-setup/bootstrap.py"
printf '%s  %s\n' \
  '0f68cd163f854efd4daab2d698ac4f8ed13444dfe406a6d143494e1ea32715f0' \
  "$HOME/.known-enough/fix04-setup/bootstrap.py" | sha256sum --check --status
python3 -B "$HOME/.known-enough/fix04-setup/bootstrap.py" \
  --source-sha df3e651cf96e09f4e2452e4398e60c1fa0b9140b \
  --archive-sha256 4061a2f32258a2443df11923b157ccbc2c5c6a86580def597c8f8516efea827f
