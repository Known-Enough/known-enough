#!/usr/bin/env bash
# Reconcile only the saved enable-signup step, retaining original source/artifacts/grant.
set -euo pipefail
umask 077
repair_commit="${1:?Exact verified ASSESS09 repair commit required}"
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
if state.get('schemaVersion') != 2 or state.get('account') != '092954139775' or state.get('pending') not in (None, 'enable-signup') or state.get('rollback'):
    sys.exit('PRIMARY_MUTATION_RECONCILIATION_REQUIRED')
# Never mutate or move any existing approved settings, journal or rollback bytes.
if not (expected.parent / 'primary-rollback.zip').is_file() or not (expected.parent / 'package.json').is_file():
    sys.exit('EXISTING_PRIMARY_BACKUP_REQUIRED')
for file in ['api.zip', 'broker.zip', 'package.json', 'primary-rollback.zip']:
    if (expected.parent / file).is_symlink():
        sys.exit('PRIVATE_STATE_SYMLINK_REJECTED')
print(path)
PY
)
repair="$HOME/known-enough-assess09-$repair_commit"
python3 - "$repair" <<'PY'
import os, sys
from pathlib import Path
path = Path(sys.argv[1])
if path.is_symlink() or path.parent.is_symlink():
    sys.exit('PRIVATE_STATE_SYMLINK_REJECTED')
path.mkdir(mode=0o700, exist_ok=True)
os.chmod(path, 0o700)
for name in ['setup.sh', 'primary.mjs', 'aws.mjs', 'tool-home']:
    if (path / name).is_symlink():
        sys.exit('PRIVATE_STATE_SYMLINK_REJECTED')
PY
curl --fail --silent --show-error "https://raw.githubusercontent.com/Known-Enough/known-enough/$source_commit/scripts/live-qa/setup.sh" -o "$repair/setup.sh"
curl --fail --silent --show-error "https://raw.githubusercontent.com/Known-Enough/known-enough/$repair_commit/scripts/live-qa/primary.mjs" -o "$repair/primary.mjs"
curl --fail --silent --show-error "https://raw.githubusercontent.com/Known-Enough/known-enough/$repair_commit/scripts/live-qa/aws.mjs" -o "$repair/aws.mjs"
# Disposable dry-run output has a separate HOME; original package/journal stay untouched.
mkdir -p "$repair/tool-home"
HOME="$repair/tool-home" bash "$repair/setup.sh" "$source_commit" dry-run "$config"
export PATH="/tmp/known-enough-live-qa-$source_commit/node/bin:$PATH"
cd "/tmp/known-enough-live-qa-$source_commit/source"
node --input-type=module - "$config" "$repair" "$source_commit" "$repair_commit" <<'JS'
import { readFileSync, writeFileSync, existsSync, lstatSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const [configPath, repair, pin, repairPin] = process.argv.slice(2);
const sha = value => createHash('sha256').update(value).digest('hex');
const directory = `${process.env.HOME}/known-enough-live-qa-state/${pin}/package`;
const scripts = `${process.cwd()}/scripts/live-qa`;
try {
  const raw = JSON.parse(readFileSync(configPath, 'utf8'));
  const { validateConfig } = await import(`${scripts}/config.mjs`);
  validateConfig(raw);
  const manifest = JSON.parse(readFileSync(directory + '/package.json', 'utf8'));
  const expected = {
    api: '6a0cd3eb5b35b1c993917962b9f5f3eb415a6eb75f9b25f98141c1ee36708b4a',
    broker: 'b5f93d79414e582107ea16d6fd351c19d22419f47ebe772482f98630d2426a49',
  };
  if (manifest.sourceCommit !== pin || Object.entries(expected).some(([name, hash]) =>
    manifest.artifacts[name]?.sha256 !== hash || sha(readFileSync(`${directory}/${name}.zip`)) !== hash))
    throw new Error('PRIMARY_PACKAGE_BYTES_CHANGED');
  // Original deployment artifacts and configuration are copied once, never replaced.
  const backup = directory + '/assess09-original';
  if (existsSync(backup) && lstatSync(backup).isSymbolicLink()) throw new Error('PRIVATE_STATE_SYMLINK_REJECTED');
  mkdirSync(backup, { recursive: true, mode: 0o700 });
  for (const name of ['api.zip', 'broker.zip', 'package.json', 'primary-rollback.zip']) {
    const destination = `${backup}/${name}`;
    if (existsSync(destination)) {
      if (lstatSync(destination).isSymbolicLink()) throw new Error('PRIVATE_STATE_SYMLINK_REJECTED');
      // The manifest can include repair provenance on subsequent resumed attempts.
      if (name !== 'package.json' && sha(readFileSync(destination)) !== sha(readFileSync(`${directory}/${name}`)))
        throw new Error('PRIMARY_REPAIR_BACKUP_CONFLICT');
    } else writeFileSync(destination, readFileSync(`${directory}/${name}`), { flag: 'wx', mode: 0o600 });
  }
  const configurationBackup = backup + '/config.json';
  if (existsSync(configurationBackup)) {
    if (lstatSync(configurationBackup).isSymbolicLink() || sha(readFileSync(configurationBackup)) !== sha(readFileSync(configPath)))
      throw new Error('PRIMARY_REPAIR_BACKUP_CONFLICT');
  } else writeFileSync(configurationBackup, readFileSync(configPath), { flag: 'wx', mode: 0o600 });
  // Untracked operational overlays leave tracked source clean and the build cwd intact.
  function overlay(name, text) {
    const file = `${scripts}/${name}`;
    if (existsSync(file) && lstatSync(file).isSymbolicLink()) throw new Error('PRIVATE_STATE_SYMLINK_REJECTED');
    writeFileSync(file, text, { mode: 0o600 });
  }
  const primary = readFileSync(repair + '/primary.mjs', 'utf8');
  const oldImport = "from './aws.mjs'";
  if (primary.split(oldImport).length !== 2) throw new Error('REPAIR_MODULE_SHAPE_CHANGED');
  overlay('aws-assess09.mjs', readFileSync(repair + '/aws.mjs', 'utf8'));
  overlay('primary-assess09.mjs', primary.replace(oldImport, "from './aws-assess09.mjs'"));
  const installer = readFileSync(`${scripts}/install.mjs`, 'utf8');
  const primaryImport = "from './primary.mjs'";
  if (installer.split(primaryImport).length !== 2) throw new Error('REPAIR_MODULE_SHAPE_CHANGED');
  overlay('install-assess09.mjs', installer.replace(primaryImport, "from './primary-assess09.mjs'"));
  const { aws, assertIdentity } = await import(pathToFileURL(`${scripts}/aws-assess09.mjs`));
  const { reconcilePendingSignup } = await import(pathToFileURL(`${scripts}/primary-assess09.mjs`));
  const { install } = await import(pathToFileURL(`${scripts}/install-assess09.mjs`));
  const prepared = await install('dry-run', raw, `/tmp/known-enough-live-qa-${pin}/assess09-prepared`, aws);
  if (Object.entries(expected).some(([name, hash]) => prepared.artifacts[name]?.sha256 !== hash))
    throw new Error('PRIMARY_PACKAGE_BYTES_CHANGED');
  assertIdentity(aws('sts', 'get-caller-identity'), raw);
  console.log(JSON.stringify(await reconcilePendingSignup(raw, manifest, directory, aws)));
  writeFileSync(directory + '/assess09-repair.json', JSON.stringify({ repairCommit: repairPin, sourceCommit: pin,
    primaryModuleSha256: sha(primary), awsModuleSha256: sha(readFileSync(repair + '/aws.mjs')), artifacts: expected }) + '\n', { mode: 0o600 });
  const { publicTarget } = await import(`${scripts}/config.mjs`);
  const result = await install('resume', raw, directory, aws);
  console.log(JSON.stringify(result));
  console.log('LIVE_QA_INSTALLED_TARGET=' + JSON.stringify(publicTarget(JSON.parse(readFileSync(directory + '/installed-target.json', 'utf8')))));
} catch (error) {
  const code = /^(?:[A-Z0-9_]+|AWS_OPERATION_FAILED:[a-z0-9-]+:[a-z0-9-]+)$/.test(error.message) ? error.message : 'SETUP_OPERATION_FAILED';
  console.error(JSON.stringify({ status: 'BLOCKED', code }));
  process.exitCode = 1;
}
JS
