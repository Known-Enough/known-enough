import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';

test.each(['pending-signup', 'pending-code', 'ready', 'other-pending', 'expired', 'wrong-pin', 'missing-backup', 'symlink'])('Cognito repair preflight preserves original state: %s', mode => {
  const folder = mkdtempSync(tmpdir() + '/cognito-resume-preflight-');
  const block = readFileSync('scripts/live-qa/resume-cognito-fix.sh', 'utf8').split("<<'PY'\n")[1];
  if (!block) throw new Error('Missing preflight block');
  const helper = block.split('\nPY\n)')[0];
  if (!helper) throw new Error('Missing preflight helper');
  try {
    const result = spawnSync('python3', ['-c', `
import json, sys, datetime as dates
from pathlib import Path
root = Path(sys.argv[1]); mode = sys.argv[3]
Path.home = classmethod(lambda cls: root)
class Clock(dates.datetime):
    @classmethod
    def now(cls, tz=None): return cls(2026, 10, 10 if mode == 'expired' else 2, tzinfo=tz)
dates.datetime = Clock
pin = '30fa91ad914c1dc1732680784ee368e2f30c9e92'
config = root / 'known-enough-free-qa.test/config.json'
config.parent.mkdir()
original = {'sourceCommit':pin, 'mailboxProvider':'mailtm', 'primaryRollout':True, 'authorization':{'approved':True, 'expiresAt':'2026-10-09T03:16:41.171626Z', 'maxRunsPerDay':4, 'maxRunsTotal':28}}
config.write_text(json.dumps(original)); config_bytes = config.read_bytes()
journal = root / 'known-enough-live-qa-state' / ('a'*40 if mode == 'wrong-pin' else pin) / 'package/primary-private-journal.json'
journal.parent.mkdir(parents=True)
state = {'schemaVersion':2, 'account':'092954139775', 'pending':'enable-signup' if mode == 'pending-signup' else 'update-code' if mode == 'pending-code' else 'update-config' if mode == 'other-pending' else None}
journal.write_text(json.dumps(state)); journal_bytes = journal.read_bytes()
for file in ['api.zip','broker.zip','package.json','primary-rollback.zip']:
    (journal.parent / file).write_text('preserved-'+file)
if mode == 'missing-backup': (journal.parent / 'primary-rollback.zip').unlink()
if mode == 'symlink':
    (journal.parent / 'api.zip').unlink(); (journal.parent / 'api.zip').symlink_to(config)
saved = {str(p):p.read_bytes() for p in root.rglob('*') if p.is_file()}
helper = sys.argv[2]; sys.argv = ['resume',pin]
try:
    exec(helper, {'__name__':'__main__'})
except SystemExit as error:
    expected = {'expired':'ORIGINAL_AUTHORIZATION_EXPIRED', 'other-pending':'PRIMARY_MUTATION_RECONCILIATION_REQUIRED', 'wrong-pin':'EXISTING_PRIMARY_RECOVERY_PIN_REQUIRED', 'missing-backup':'EXISTING_PRIMARY_BACKUP_REQUIRED', 'symlink':'PRIVATE_STATE_SYMLINK_REJECTED'}
    assert str(error) == expected[mode], str(error)
else:
    assert mode in ('ready','pending-signup','pending-code')
assert config.read_bytes() == config_bytes and journal.read_bytes() == journal_bytes
assert {str(p):p.read_bytes() for p in root.rglob('*') if p.is_file()} == saved
`, folder, helper, mode], { encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('Cognito helper launches child commands with original source cwd and pinned Node/npm', () => {
  const folder = mkdtempSync(tmpdir() + '/cognito-runtime-path-');
  try {
    const shell = readFileSync('scripts/live-qa/resume-cognito-fix.sh', 'utf8');
    const section = shell.split('HOME="$repair/tool-home" bash "$repair/setup.sh" "$source_commit" dry-run "$config"\n')[1];
    if (!section) throw new Error('Missing isolated dry-run');
    const launch = section.split("<<'JS'")[0];
    if (!launch) throw new Error('Missing Node launch');
    for (const name of ['runtime/bin', 'base/bin', 'source']) mkdirSync(folder + '/' + name, { recursive: true });
    writeFileSync(folder + '/base/bin/npm', '#!/bin/sh\necho wrong\n', { mode: 0o700 });
    writeFileSync(folder + '/runtime/bin/npm', '#!/bin/sh\necho 11.19.0\n', { mode: 0o700 });
    writeFileSync(folder + '/runtime/bin/node', '#!/bin/sh\ntest "$(npm --version)" = "11.19.0" && test "$PWD" = "$EXPECTED_SOURCE"\n', { mode: 0o700 });
    const result = spawnSync('/bin/bash', ['-c', launch.replaceAll('/tmp/known-enough-live-qa-$source_commit/node/bin', folder + '/runtime/bin').replaceAll('/tmp/known-enough-live-qa-$source_commit/source', folder + '/source')], {
      encoding: 'utf8', env: { PATH: folder + '/base/bin:/usr/bin:/bin', config: 'unused', repair: 'unused', repair_commit: 'verified', source_commit: 'original', EXPECTED_SOURCE: folder + '/source' },
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
