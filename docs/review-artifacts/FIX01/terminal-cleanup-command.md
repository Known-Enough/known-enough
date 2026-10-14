# FIX01 completed test-job cleanup capability

The real decision flow passed in [38642585751](https://github.com/Known-Enough/known-enough/actions/runs/38642585751): draft/create/reload/second member visibility, one acknowledged model call, and both test accounts/mailboxes removed. Deleting its completed journal record was denied by AWS. The existing checked helper adds only transactional `dynamodb:DeleteItem` on `MODELJOB#*` in the fixed journal table to the existing ModelJobOperations inline policy and boundary. It checks both complete baseline policy hashes, preserves all other permissions/denies, backs up metadata privately, and stops on drift. Six scope/drift/repeat/lost-ack/foreign-account tests pass. It does not delete data, change participants, run a model, or install another worker.

Run this complete block manually in your own administrator CloudShell for account `092954139775`. Return only its final JSON; keep the private backup files private. This is cleanup setup, not another product test.

```bash
python3 - <<'PYCODE'
import datetime,hashlib,pathlib,subprocess,urllib.request
source='6b6aa79070689caf17568fb59ee5dc3d677effe4'
expected='0b97136bb478a9c8becbaadb52046735a5e585672e8d886e8de63068774e0902'
folder=pathlib.Path.home()/'.known-enough'/('fix01-terminal-helper-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
folder.mkdir(mode=0o700,parents=True,exist_ok=False)
url='https://raw.githubusercontent.com/Known-Enough/known-enough/'+source+'/scripts/operations/jobs-journal-permission-grant.py'
with urllib.request.urlopen(url,timeout=30) as response:
    data=response.read()
if hashlib.sha256(data).hexdigest()!=expected:
    raise SystemExit('CHECKED_SOURCE_HASH_MISMATCH')
script=folder/'grant.py'
script.write_bytes(data)
script.chmod(0o600)
raise SystemExit(subprocess.run(['python3','-B',str(script)]).returncode)
PYCODE
```

Expected result: `OPS03_TERMINAL_POLICY_READBACK_PASS`. B still verifies effective scoped deletion before another model trial. The existing private reservation/usage totals are never reset or refunded.
