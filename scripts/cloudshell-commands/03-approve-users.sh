#!/usr/bin/env bash
# Approves only exact usernames supplied as arguments; never all pending users.
set -euo pipefail
if [ "$#" -eq 0 ]; then
  printf '%s\n' 'Usage: bash 03-approve-users.sh "EXACT_USERNAME" ["ANOTHER_USERNAME" ...]' >&2
  exit 1
fi
tool="$HOME/.known-enough/access-users/access-users"
if [ ! -x "$tool" ]; then
  printf '%s\n' 'Run 01-setup-access-users.sh first.' >&2
  exit 1
fi
selected=()
for username in "$@"; do
  selected+=(--username "$username")
done
exec "$tool" approve "${selected[@]}"
