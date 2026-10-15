# FIX01 private interpretation timestamp capability

**Historical command — superseded after API publication.** The block below targets the previous API and will stop on current runtime drift. Use the [current FF02 command](../../tasks/active/ff/FF02/cloudshell-command.md), pinned to deployed APIc1ec4a07. B independently reconfirmed the permission remains absent in [38777589072](https://github.com/Known-Enough/known-enough/actions/runs/38777589072). Preserve the older block as evidence; do not change or bypass its runtime guard.

Current read-only [38690112752](https://github.com/Known-Enough/known-enough/actions/runs/38690112752) confirms public drafting enabled with no active jobs, but synthetic retention disabled. [38690529209](https://github.com/Known-Enough/known-enough/actions/runs/38690529209) confirms the installed API role has no permissions boundary and its Nova Lite permission is already present. The declared lifecycle-owner profile permits reading retention stamps and writing erasure consent; it lacks the transactional retention-stamp write needed for ordinary participants. This is a declared scope gap, not a reported AWS denial of a new request.

The repair adds a private interpretation route with explicit synthetic-test processing consent, current-owner admission, trusted server timestamps, strict output checks, atomic saved output/usage and nonce-only recovery. The existing retention gate remains enforced. This command adds only a named transactional `PutItem` permission on `RETENTION#*` in the fixed operations journal to the API role. Server code constrains the write to the authenticated owner; IAM grants the API service this key prefix for all its participants. It does not grant policy writes, erasure, approvals, memberships or model invocation. Existing policies stay intact. The command stops on target/runtime drift, a newly introduced boundary or a conflicting named policy.

Run the complete block manually in your own administrator CloudShell for account `092954139775`, then return only its printed JSON. This is operational setup, not another product test. The agent has no installed IAM writer; product and runtime checks continue separately. Successful installation alone does not prove the interpretation works.

```bash
python3 - <<'PYCODE'
import base64, datetime, json, os, pathlib, re, subprocess

ACCOUNT = '092954139775'
ROLE = 'KnownEnoughStageApiRole'
NAME = 'FIX01VerifiedSyntheticProcessingStamp'
API_HASH = '046174a6ce41a952ccc35ca1db87ed6d67d5145bc109dbfe8297a5fff2b3a232'
WANTED = {'Version': '2012-10-17', 'Statement': [{
    'Sid': 'VerifiedSyntheticProcessingStamp', 'Effect': 'Allow',
    'Action': ['dynamodb:PutItem'],
    'Resource': 'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughOperationsJournal',
    'Condition': {'ForAllValues:StringLike': {'dynamodb:LeadingKeys': ['RETENTION#*']},
                  'Null': {'dynamodb:LeadingKeys': 'false'},
                  'StringEqualsIfExists': {'dynamodb:ReturnValues': 'NONE'},
                  'ForAnyValue:StringEquals': {'dynamodb:EnclosingOperation': ['TransactWriteItems']}}
}]}

def aws(*args, absent=False):
    run = subprocess.run(['aws', *args, '--region', 'us-east-1', '--output', 'json', '--no-cli-pager'],
                         capture_output=True, timeout=30)
    if run.returncode:
        match = re.search(rb'\(([A-Za-z0-9]+)\)', run.stderr)
        code = match.group(1).decode() if match else 'AWS_CLI_FAILED'
        if absent and code == 'NoSuchEntity':
            return None
        raise RuntimeError(code)
    return json.loads(run.stdout.strip() or b'{}')

def read_policy():
    value = aws('iam', 'get-role-policy', '--role-name', ROLE, '--policy-name', NAME, absent=True)
    return value.get('PolicyDocument') if value else None

def main():
    os.umask(0o077)
    if aws('sts', 'get-caller-identity').get('Account') != ACCOUNT:
        raise RuntimeError('ACCOUNT_MISMATCH')
    runtime = aws('lambda', 'get-function-configuration', '--function-name', 'known-enough-stage-api',
                  '--query', '{hash:CodeSha256,state:State,update:LastUpdateStatus}')
    if (base64.b64decode(runtime.get('hash', ''), validate=True).hex() != API_HASH
            or runtime.get('state') != 'Active' or runtime.get('update') != 'Successful'):
        raise RuntimeError('PUBLISHED_API_MISMATCH')
    role = aws('iam', 'get-role', '--role-name', ROLE)['Role']
    if role.get('Arn') != 'arn:aws:iam::' + ACCOUNT + ':role/' + ROLE or role.get('PermissionsBoundary'):
        raise RuntimeError('ROLE_SCOPE_DRIFT')
    prior = read_policy()
    if prior is not None and prior != WANTED:
        raise RuntimeError('NAMED_POLICY_DRIFT')
    folder = pathlib.Path.home() / '.known-enough' / ('fix01-processing-access-' +
        datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    folder.mkdir(mode=0o700, parents=True, exist_ok=False)
    (folder / 'prior-private.json').write_text(json.dumps({'role': role, 'prior': prior}))
    writes = 0
    uncertain = False
    if prior is None:
        writes = 1
        try:
            aws('iam', 'put-role-policy', '--role-name', ROLE, '--policy-name', NAME,
                '--policy-document', json.dumps(WANTED))
        except (RuntimeError, subprocess.TimeoutExpired):
            uncertain = True
    if read_policy() != WANTED:
        raise RuntimeError('POLICY_WRITE_NOT_CONFIRMED_NO_RETRY')
    print(json.dumps({'result': 'FIX01_PROCESSING_STAMP_POLICY_READBACK_PASS', 'iamWriteRequests': writes,
                      'writeAcknowledgmentUncertain': uncertain, 'dataWrites': 0, 'providerCalls': 0,
                      'effectiveAccess': 'NOT_EXECUTED', 'utc': datetime.datetime.now(datetime.timezone.utc).isoformat()}))

try:
    main()
except Exception as error:
    code = str(error) if isinstance(error, RuntimeError) else type(error).__name__
    print(json.dumps({'result': 'FIX01_PROCESSING_STAMP_POLICY_BLOCKED',
                      'code': code if re.fullmatch(r'[A-Za-z0-9_]{1,100}', code) else 'LOCAL_VALIDATION_FAILED'}))
    raise SystemExit(1)
PYCODE
```

B must independently verify the effective timestamp write and actual saved private interpretation after compatible publication and narrowly enabling the existing synthetic pilot policy. Participants must explicitly identify their input as synthetic test conditions and agree to processing; no real-person policy or participant confirmation is manufactured by this setup.
