# Complete FIX01 queue recovery in your own administrator CloudShell

The checked software repair is pushed. B's actual [read38640022558](https://github.com/Known-Enough/known-enough/actions/runs/38640022558) was denied `cloudtrail:lookup-events/AccessDeniedException` under `KnownEnoughGithubStagingInspector`, before any recovery write or model invocation. Standing authorization does not install that AWS permission. Use your own existing same-account (`092954139775`) AWS administrator session; no credentials are shared and no IAM permission is changed by this command. This is a required AWS recovery action, not another product test.

Run the complete block below in CloudShell. It downloads only two checksum-pinned public files, preserves the existing CloudShell credential provider, reads fixed API/CloudTrail evidence and the exact public queue, verifies a private encrypted S3 backup, then performs one conditional journal transaction. It retires only expired public requests whose provider completion is covered, preserves original references and all usage reservations, leaves participants/drafts untouched, and leaves model control DISABLED/empty for B's guarded publication. Missing/ambiguous evidence or state drift stops the command. No model, signup, email, group membership, account approval or IAM operation is performed.

```bash
python3 - <<'PYCODE'
import datetime,hashlib,os,pathlib,subprocess,urllib.request
source = '7e432dceb493d43916f32846bcbaeb16a5f6f004'
files = {'queue-recovery.py': '05cdf9aed926042d577afe7f08aee082931870a9546a099ba01f3a9d03149b02', 'queue-baseline.json': 'bd20fd4b6ee76901191172a4f8b080645176aec8e2df1e9e2b685f9837ab54ab'}
folder = pathlib.Path.home()/'.known-enough'/('fix01-queue-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
folder.mkdir(mode=0o700,parents=True,exist_ok=False)
for name,expected in files.items():
    url = 'https://raw.githubusercontent.com/Known-Enough/known-enough/'+source+'/scripts/fix01/'+name
    with urllib.request.urlopen(url,timeout=30) as response:
        data = response.read()
    if hashlib.sha256(data).hexdigest()!=expected:
        raise SystemExit('CHECKED_SOURCE_HASH_MISMATCH')
    path = folder/name
    path.write_bytes(data)
    path.chmod(0o600)
environment = dict(os.environ)
environment.update(EXPECTED_SOURCE=source, PREVIOUS_JOB_SOURCE='4fc702b3018a7e2933486ee4289efd3d7fe2971a', API_SHA256='83d794ac6cd4fe204f30a320c4e34537b683b76da3aedb6a106f9077dff6f663', FIX01_QUEUE_DIRECTORY=str(folder))
for phase in ['events','prepare','backup','apply']:
    result = subprocess.run(['python3','-B',str(folder/'queue-recovery.py'),phase,'--admin'],env=environment)
    if result.returncode:
        raise SystemExit(result.returncode)
PYCODE
```

Return only the printed final JSON result (`PUBLIC_QUEUE_RECOVERY_PASS` or the exact `BLOCKED` code). Do not paste private files. On success B verifies the actual disabled/empty control, publishes the already checked API/worker/frontend source, enables public drafting and tests a fresh owned decision plus another group member's visibility. Your existing draft remains saved; wait for B's ready-for-retest update before submitting it again.
