# FIX01 native archive operator setup

The decision repair is published and the user confirms it completes and A can see it. No further product test is requested. Cleanup-only [38667776396](https://github.com/Known-Enough/known-enough/actions/runs/38667776396) independently reports that the native `OPERATIONS#ARCHIVE / STATE` policy is absent. All five original synthetic group rows pass structural checks; native archive preparation rejects the missing policy with `ARCHIVE_INVALID`. The original completed job, both synthetic users and both mailboxes are already cleaned.

Run the complete block below manually in your own administrator CloudShell for account `092954139775`, and return only its printed JSON. The existing GroupArchive workload can read this policy but its declared write scope covers group records, not this operator configuration key. This is an operational setup step, not another product test or a new authorization request.

This installs the existing strict native archive policy for B's verified GitHub actor `143764700`. That policy permits B to use the existing project archive service; the policy itself is not restricted to one group. The subsequent checked cleanup workflow separately restricts execution to the original two owned synthetic fixtures. No IAM permission, AWS account access, group membership or participant approval changes. The command verifies the published API hash, privately saves the prior policy state, stops on an existing different policy, and performs at most one conditional configuration write. It never deletes group data, calls a model, changes usage totals or handles participant credentials. An uncertain write is read back once, never replayed.

```bash
python3 - <<'PYCODE'
import base64, datetime, json, os, pathlib, re, subprocess

ACCOUNT = '092954139775'
API_HASH = '046174a6ce41a952ccc35ca1db87ed6d67d5145bc109dbfe8297a5fff2b3a232'
KEY = {'PK': {'S': 'OPERATIONS#ARCHIVE'}, 'SK': {'S': 'STATE'}}
POLICY = {'schemaVersion': 1, 'revision': 1, 'kind': 'ARCHIVE_POLICY',
          'enabled': True, 'actors': [143764700]}
WANTED = {**KEY, 'revision': {'N': '1'},
          'payload': {'S': json.dumps(POLICY, separators=(',', ':'))}}

def aws(*args):
    run = subprocess.run(['aws', *args, '--region', 'us-east-1',
                          '--output', 'json', '--no-cli-pager'],
                         capture_output=True, timeout=30)
    if run.returncode:
        match = re.search(rb'\(([A-Za-z0-9]+)\)', run.stderr)
        raise RuntimeError(match.group(1).decode() if match else 'AWS_CLI_FAILED')
    return json.loads(run.stdout.strip() or b'{}')

def read_policy():
    return aws('dynamodb', 'get-item', '--table-name', 'KnownEnoughPartitions',
               '--key', json.dumps(KEY), '--consistent-read').get('Item')

def main():
    os.umask(0o077)
    identity = aws('sts', 'get-caller-identity')
    if identity.get('Account') != ACCOUNT:
        raise RuntimeError('ACCOUNT_MISMATCH')
    runtime = aws('lambda', 'get-function-configuration', '--function-name',
                  'known-enough-stage-api', '--query',
                  '{hash:CodeSha256,state:State,update:LastUpdateStatus}')
    if (base64.b64decode(runtime.get('hash', ''), validate=True).hex() != API_HASH
            or runtime.get('state') != 'Active'
            or runtime.get('update') != 'Successful'):
        raise RuntimeError('PUBLISHED_API_MISMATCH')
    prior = read_policy()
    if prior is not None and prior != WANTED:
        raise RuntimeError('EXISTING_POLICY_DRIFT')
    folder = pathlib.Path.home() / '.known-enough' / (
        'fix01-archive-control-' + datetime.datetime.now(datetime.timezone.utc)
        .strftime('%Y%m%dT%H%M%S%fZ'))
    folder.mkdir(mode=0o700, parents=True, exist_ok=False)
    (folder / 'prior-policy-private.json').write_text(json.dumps({'Item': prior}))
    writes = 0
    uncertain = False
    if prior is None:
        writes = 1
        try:
            aws('dynamodb', 'put-item', '--table-name', 'KnownEnoughPartitions',
                '--item', json.dumps(WANTED), '--condition-expression',
                'attribute_not_exists(PK) AND attribute_not_exists(SK)')
        except (RuntimeError, subprocess.TimeoutExpired):
            uncertain = True
    if read_policy() != WANTED:
        raise RuntimeError('POLICY_WRITE_NOT_CONFIRMED_NO_RETRY')
    print(json.dumps({'result': 'FIX01_ARCHIVE_CONTROL_READBACK_PASS',
                      'configurationWriteRequests': writes,
                      'writeAcknowledgmentUncertain': uncertain,
                      'iamWrites': 0, 'groupWrites': 0, 'accountWrites': 0,
                      'totalWrites': 0, 'providerCalls': 0,
                      'utc': datetime.datetime.now(datetime.timezone.utc).isoformat()}))

try:
    main()
except Exception as error:
    code = str(error) if isinstance(error, RuntimeError) else type(error).__name__
    if not re.fullmatch(r'[A-Za-z0-9_]{1,100}', code):
        code = 'LOCAL_VALIDATION_FAILED'
    print(json.dumps({'result': 'FIX01_ARCHIVE_CONTROL_BLOCKED', 'code': code}))
    raise SystemExit(1)
PYCODE
```

After a successful receipt, B reruns only the original-fixture cleanup and records its actual native archive result. Installation alone is not cleanup completion or whole-task DONE. The private backup stays in CloudShell under `~/.known-enough/`.
