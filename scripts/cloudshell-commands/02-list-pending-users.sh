#!/usr/bin/env bash
# Lists pending app accounts; does not approve or create accounts.
set -euo pipefail
tool="$HOME/.known-enough/access-users/access-users"
if [ ! -x "$tool" ]; then
  printf '%s\n' 'Run 01-setup-access-users.sh first.' >&2
  exit 1
fi
exec "$tool" list --pending
