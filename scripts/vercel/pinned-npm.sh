#!/usr/bin/env bash
# Vercel can upgrade its default patch version; retain this repository's exact toolchain.
set -euo pipefail
case "$*" in 'ci'|'run build') ;; *) printf '%s\n' 'Use ci or run build.' >&2; exit 2 ;; esac
case "$(uname -s):$(uname -m)" in
  Linux:x86_64) platform=linux-x64 ;;
  Linux:aarch64) platform=linux-arm64 ;;
  *) printf '%s\n' 'Unsupported Vercel build platform.' >&2; exit 2 ;;
esac
node_version=24.21.0
npm_version=11.19.0
tool_root="${TMPDIR:-/tmp}/known-enough-vercel-toolchain"
runtime="$tool_root/node-v$node_version-$platform"
if [[ ! -x "$runtime/bin/node" ]]; then
  mkdir -p "$tool_root"
  stage=$(mktemp -d "$tool_root/download.XXXXXX")
  trap 'rm -rf -- "$stage"' EXIT
  archive="node-v$node_version-$platform.tar.xz"
  curl --fail --silent --show-error --connect-timeout 20 --max-time 120 \
    "https://nodejs.org/dist/v$node_version/SHASUMS256.txt" -o "$stage/SHASUMS256.txt"
  expected=$(awk -v archive="$archive" '$2 == archive {print $1}' "$stage/SHASUMS256.txt")
  [[ "$expected" =~ ^[a-f0-9]{64}$ ]]
  curl --fail --silent --show-error --connect-timeout 20 --max-time 120 \
    "https://nodejs.org/dist/v$node_version/$archive" -o "$stage/$archive"
  printf '%s  %s\n' "$expected" "$stage/$archive" | sha256sum --check --status
  tar -xJf "$stage/$archive" -C "$stage"
  mv "$stage/node-v$node_version-$platform" "$runtime"
fi
export PATH="$runtime/bin:$PATH"
[[ "$(node --version)" == "v$node_version" && "$(npm --version)" == "$npm_version" ]]
exec npm "$@"
