#!/usr/bin/env bash
# Resume the existing 30fa91a journal with the reviewed missing-IAM-error adapter.
set -euo pipefail
umask 077
repair_commit="${1:?Exact verified adapter commit required}"
[[ "$repair_commit" =~ ^[a-f0-9]{40}$ ]] || exit 2
source_commit=30fa91ad914c1dc1732680784ee368e2f30c9e92
config=$(python3 - "$source_commit" <<'PY'
import json, sys
from pathlib import Path
from datetime import datetime, timezone
pin = sys.argv[1]
matches = []
for path in Path.home().glob('known-enough-free-qa.*/config.json'):
    if path.is_symlink() or path.parent.is_symlink():
        sys.exit('PRIVATE_CONFIGURATION_SYMLINK_REJECTED')
    settings = json.loads(path.read_text())
    approval = settings.get('authorization', {})
    if settings.get('sourceCommit') == pin and approval.get('approved') is True and approval.get('expiresAt') == '2026-10-09T03:16:41.171626Z':
        matches.append((path, settings))
if len(matches) != 1:
    sys.exit('ONE_SAVED_APPROVED_CONFIGURATION_REQUIRED')
path, settings = matches[0]
if settings.get('mailboxProvider') != 'mailtm' or settings.get('primaryRollout') is not True:
    sys.exit('SAVED_CONFIGURATION_SCOPE_MISMATCH')
if datetime.fromisoformat(settings['authorization']['expiresAt'].replace('Z', '+00:00')) <= datetime.now(timezone.utc):
    sys.exit('ORIGINAL_AUTHORIZATION_EXPIRED')
root = Path.home() / 'known-enough-live-qa-state'
journals = list(root.glob('*/package/primary-private-journal.json'))
expected = root / pin / 'package/primary-private-journal.json'
if journals != [expected]:
    sys.exit('EXISTING_PRIMARY_RECOVERY_PIN_REQUIRED')
if any(p.is_symlink() for p in [root, expected, expected.parent, expected.parent.parent]):
    sys.exit('PRIVATE_STATE_SYMLINK_REJECTED')
state = json.loads(expected.read_text())
if state.get('schemaVersion') != 2 or state.get('account') != '092954139775' or state.get('pending') or state.get('rollback'):
    sys.exit('PRIMARY_MUTATION_RECONCILIATION_REQUIRED')
print(path)
PY
)
adapter="$HOME/known-enough-aws-error-fix-$repair_commit.mjs"
setup="$HOME/known-enough-iam-fix-tools.sh"
curl --fail --silent --show-error "https://raw.githubusercontent.com/Known-Enough/known-enough/$repair_commit/scripts/live-qa/aws.mjs" -o "$adapter"
curl --fail --silent --show-error "https://raw.githubusercontent.com/Known-Enough/known-enough/$source_commit/scripts/live-qa/setup.sh" -o "$setup"
# Rebuild disposable tools if CloudShell restarted; keep the original source and state.
bash "$setup" "$source_commit" dry-run "$config"
"/tmp/known-enough-live-qa-$source_commit/node/bin/node" --input-type=module - "$config" "$adapter" "$source_commit" <<'JS'
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const [configPath, adapterPath, pin] = process.argv.slice(2);
const { aws } = await import(pathToFileURL(adapterPath));
const { install } = await import(`/tmp/known-enough-live-qa-${pin}/source/scripts/live-qa/install.mjs`);
const { publicTarget } = await import(`/tmp/known-enough-live-qa-${pin}/source/scripts/live-qa/config.mjs`);
const directory = `${process.env.HOME}/known-enough-live-qa-state/${pin}/package`;
try {
  const result = await install('resume', JSON.parse(readFileSync(configPath, 'utf8')), directory, aws);
  console.log(JSON.stringify(result));
  console.log('LIVE_QA_INSTALLED_TARGET=' + JSON.stringify(publicTarget(JSON.parse(readFileSync(directory + '/installed-target.json', 'utf8')))));
} catch (error) {
  const code = /^(?:[A-Z0-9_]+|AWS_OPERATION_FAILED:[a-z0-9-]+:[a-z0-9-]+)$/.test(error.message) ? error.message : 'SETUP_OPERATION_FAILED';
  console.error(JSON.stringify({status: 'BLOCKED', code}));
  process.exitCode = 1;
}
JS
