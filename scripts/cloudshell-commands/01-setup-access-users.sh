#!/usr/bin/env bash
# Run with bash, rather than sourcing into your interactive CloudShell.
# Installs/refreshes the operator tool locally; makes no AWS resource changes.
set -euo pipefail
umask 077

mkdir -p "$HOME/.known-enough/fix04-setup"
curl --fail --silent --show-error --proto '=https' --tlsv1.2 \
  'https://raw.githubusercontent.com/Known-Enough/known-enough/61f781d96a7dad7e182bf5dd9ae6bdea7d65b4e6/scripts/fix04/bootstrap.py' \
  -o "$HOME/.known-enough/fix04-setup/bootstrap.py"
printf '%s  %s\n' \
  '0f68cd163f854efd4daab2d698ac4f8ed13444dfe406a6d143494e1ea32715f0' \
  "$HOME/.known-enough/fix04-setup/bootstrap.py" | sha256sum --check --status
python3 -B "$HOME/.known-enough/fix04-setup/bootstrap.py" \
  --source-sha 61f781d96a7dad7e182bf5dd9ae6bdea7d65b4e6 \
  --archive-sha256 c4a193f44a6e6797cba4125485905b99c727e564c53551687b18a0ab39c9de87
