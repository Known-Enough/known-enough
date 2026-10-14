"""Read the uniquely matching private checkpoint of FIX01 proof38642585751 only."""
import datetime,importlib.util,json,os,shutil
from pathlib import Path
path=Path(__file__).resolve().parents[1]/'operations/jobs-fixture-recovery.py'
spec=importlib.util.spec_from_file_location('original_fixture_recovery',path)
helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
helper.SOURCE='6b6aa79070689caf17568fb59ee5dc3d677effe4'
helper.START=datetime.datetime.fromisoformat('2026-10-14T21:45:00+00:00')
helper.END=datetime.datetime.fromisoformat('2026-10-14T21:47:30+00:00')
if __name__=='__main__':
    result=helper.main()
    if result:raise SystemExit(result)
    root=Path(os.environ['RUNNER_TEMP'])
    state=json.loads((root/'owned-fixture-recovery-private.json').read_text())
    if any(f.get('deleted') is not True or f.get('mailboxRemoved') is not True for f in state['fixtures']):
        raise SystemExit('ORIGINAL_FIXTURE_CLEANUP_INCOMPLETE')
    shutil.copyfile(root/'owned-fixture-recovery-private.json',root/'partition-cutover-private/owned-fixtures-private.json')
    (root/'partition-cutover-private/owned-fixtures-private.json').chmod(0o600)
