#!/usr/bin/env bash
set -euo pipefail
umask 077
commit="${1:?40-character approved package commit required}"
mode="${2:?dry-run/validate/apply/readback/rollback required}"
config="${3:?absolute path to approved configuration required}"
[[ "$commit" =~ ^[a-f0-9]{40}$ && "$config" == /* && -s "$config" ]] || exit 2
case "$mode" in dry-run|validate|apply|readback|rollback) ;; *) exit 2 ;; esac
workspace="/tmp/known-enough-live-qa-$commit"
mkdir -p "$workspace"
if [[ ! -d "$workspace/source/.git" ]]; then
  git clone --quiet https://github.com/Known-Enough/known-enough.git "$workspace/source"
fi
cd "$workspace/source"
git fetch --quiet origin "$commit"
git checkout --quiet --detach "$commit"
[[ "$(git rev-parse HEAD)" == "$commit" ]] || exit 2
runtime="$workspace/node"
if [[ ! -x "$runtime/bin/node" ]]; then
  curl --fail --silent --show-error --output "$workspace/SHASUMS256.txt" https://nodejs.org/dist/v24.21.0/SHASUMS256.txt
  curl --fail --silent --show-error --output "$workspace/node.tar.xz" https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-x64.tar.xz
  expected="$(awk '$2 == "node-v24.21.0-linux-x64.tar.xz" {print $1}' "$workspace/SHASUMS256.txt")"
  [[ "$expected" =~ ^[a-f0-9]{64}$ && "$(sha256sum "$workspace/node.tar.xz" | cut -d' ' -f1)" == "$expected" ]] || exit 2
  mkdir -p "$runtime"
  tar -xJf "$workspace/node.tar.xz" --strip-components=1 -C "$runtime"
fi
export PATH="$runtime/bin:$PATH"
[[ "$(node --version)" == v24.21.0 && "$(npm --version)" == 11.19.0 ]] || exit 2
npm ci --ignore-scripts --silent
npm ci --prefix scripts/live-qa --ignore-scripts --silent
node scripts/live-qa/install.mjs "$mode" "$config" "$workspace/package"
