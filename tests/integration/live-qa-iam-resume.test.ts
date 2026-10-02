import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';

test.each(['ready', 'pending', 'expired'])('same-pin IAM recovery preflight: %s', mode => {
  const folder = mkdtempSync(tmpdir() + '/iam-resume-preflight-');
  const block = readFileSync('scripts/live-qa/resume-iam-policy-fix.sh', 'utf8').split("<<'PY'\n")[1];
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
original = {'sourceCommit':pin, 'mailboxProvider':'mailtm', 'primaryRollout':True, 'authorization':{'approved':True, 'expiresAt':'2026-10-09T03:16:41.171626Z', 'maxRunsPerDay':4}}
config.write_text(json.dumps(original))
journal = root / 'known-enough-live-qa-state' / pin / 'package/primary-private-journal.json'
journal.parent.mkdir(parents=True)
state = {'schemaVersion':2, 'account':'092954139775', 'pending':'create-policy' if mode == 'pending' else None}
journal.write_text(json.dumps(state))
helper = sys.argv[2]; sys.argv = ['resume',pin]
try:
    exec(helper)
except SystemExit as error:
    assert str(error) == ('ORIGINAL_AUTHORIZATION_EXPIRED' if mode == 'expired' else 'PRIMARY_MUTATION_RECONCILIATION_REQUIRED')
else:
    assert mode == 'ready'
assert json.loads(config.read_text()) == original
assert json.loads(journal.read_text()) == state
`, folder, helper, mode], { encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
