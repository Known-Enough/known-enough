#!/usr/bin/env bash
# Rebuild disposable tools; keep approved settings and recovery/rollback state in HOME.
set -euo pipefail
umask 077
commit="${1:?Exact verified recovery commit required}"
[[ "$commit" =~ ^[a-f0-9]{40}$ ]] || exit 2
config=$(python3 - "$commit" <<'PY'
import json, subprocess, sys
from pathlib import Path
from datetime import datetime, timezone

commit = sys.argv[1]
previous = {
    '348afae8270eb739a89ab974c85a89e1526f06d9',
    'fb42d675756bd6c67ff77f7a1a980ae965705a76',
    '46160692e77d114a09283ddb271dda8b984add3e',
    'e0cd5ddd3ede595eea88aef3481c23bf01363a8a',
    '18d5ea433cfc55dec71d19b3e2878974dfc6a531',
    '5d6d5e169c166c900564623b49704a1eed59db42', commit
}
candidates = []
for path in Path.home().glob('known-enough-free-qa.*/config.json'):
    try:
        settings = json.loads(path.read_text())
        if settings.get('authorization', {}).get('approved') is True and settings['authorization']['expiresAt'] == '2026-10-09T03:16:41.171626Z':
            candidates.append((path, settings))
    except (ValueError, KeyError):
        continue
if len(candidates) != 1:
    sys.exit('ONE_SAVED_APPROVED_CONFIGURATION_REQUIRED')
path, settings = candidates[0]
if settings.get('sourceCommit') not in previous or settings.get('mailboxProvider') != 'mailtm' or settings.get('primaryRollout') is not True:
    sys.exit('SAVED_CONFIGURATION_SCOPE_MISMATCH')
if datetime.fromisoformat(settings['authorization']['expiresAt'].replace('Z', '+00:00')) <= datetime.now(timezone.utc):
    sys.exit('ORIGINAL_AUTHORIZATION_EXPIRED')
function = json.loads(subprocess.check_output([
    'aws', 'lambda', 'get-function-configuration',
    '--function-name', 'known-enough-stage-api', '--region', 'us-east-1',
    '--output', 'json', '--no-cli-pager'
], text=True))
if function.get('LastUpdateStatus') != 'Successful' or function.get('Environment', {}).get('Variables', {}).get('KE14_MODEL_MODE') != 'DISABLED' or function['Environment']['Variables'].get('KE14_PAID_CALLS_APPROVED') != 'false':
    sys.exit('PRIMARY_MODEL_OFF_CHECK_REQUIRED')
# Update the source/revision only; never recreate or extend approval or limits.
settings['sourceCommit'] = commit
settings['primaryExpectedRevision'] = function['RevisionId']
path.write_text(json.dumps(settings, indent=2) + '\n')
path.chmod(0o600)
print(path)
PY
)
setup="$HOME/known-enough-live-qa-resume-setup.sh"
curl --fail --silent --show-error \
  "https://raw.githubusercontent.com/Known-Enough/known-enough/$commit/scripts/live-qa/setup.sh" -o "$setup"
printf '%s\n' 'Resuming saved setup. Temporary tools will be rebuilt if needed; test limits and expiry stay unchanged.'
bash "$setup" "$commit" resume "$config"
