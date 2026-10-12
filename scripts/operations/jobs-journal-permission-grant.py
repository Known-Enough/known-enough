"""A's bounded CloudShell repair. No credential environment stripping, data writes or worker installation."""
import copy
import hashlib
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote

ACCOUNT = '092954139775'
ROLE = 'KnownEnoughGithubModelJobOperations'
BOUNDARY = f'arn:aws:iam::{ACCOUNT}:policy/{ROLE}Boundary'
INLINE_HASH = 'bb677303895511749355ba0ec29535f4c1f54c1c782517cf015dc628c18c1185'
BOUNDARY_HASH = '55984f7e57f7bf285e9d72b3dedb36bc9102f564ee71b786c3e47ff69dc3fb2b'
GRANT = {'Sid': 'OwnTerminalModelJournalCleanup', 'Effect': 'Allow', 'Action': ['dynamodb:DeleteItem'],
         'Resource': f'arn:aws:dynamodb:us-east-1:{ACCOUNT}:table/KnownEnoughOperationsJournal',
         'Condition': {'ForAllValues:StringLike': {'dynamodb:LeadingKeys': ['MODELJOB#*']},
                       'Null': {'dynamodb:LeadingKeys': 'false'},
                       'StringEqualsIfExists': {'dynamodb:ReturnValues': 'NONE'},
                       'ForAnyValue:StringEquals': {'dynamodb:EnclosingOperation': ['TransactWriteItems']}}}


def document(value):
    return json.loads(unquote(value)) if isinstance(value, str) else value


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def candidate(value, baseline_hash):
    result = copy.deepcopy(value)
    matches = [s for s in result['Statement'] if s.get('Sid') == GRANT['Sid']]
    if len(matches) > 1 or (matches and matches[0] != GRANT):
        raise RuntimeError('OPS03_GRANT_SID_CONFLICT')
    base = {**result, 'Statement': [s for s in result['Statement'] if s.get('Sid') != GRANT['Sid']]}
    if digest(base) != baseline_hash:
        raise RuntimeError('OPS03_BASE_POLICY_DRIFT')
    if matches:
        return result
    index = next((i for i, s in enumerate(result['Statement'])
                  if s.get('Effect') == 'Deny' and 'iam:*' in s.get('Action', [])), None)
    if index is None:
        raise RuntimeError('OPS03_EXISTING_PRIVILEGE_DENY_MISSING')
    result['Statement'].insert(index, copy.deepcopy(GRANT))
    return result


def apply(aws, folder):
    report = {'result': 'OPS03_TERMINAL_POLICY_READBACK_UNVERIFIED', 'role': ROLE,
              'iamWriteRequests': 0, 'dataWrites': 0, 'providerCalls': 0,
              'effectiveBAccess': 'NOT_EXECUTED', 'backup': str(folder)}
    identity = aws('sts', 'get-caller-identity')
    if identity.get('Account') != ACCOUNT:
        raise RuntimeError('OPS03_ACCOUNT_MISMATCH')
    role = aws('iam', 'get-role', '--role-name', ROLE)['Role']
    if (role.get('Arn') != f'arn:aws:iam::{ACCOUNT}:role/{ROLE}'
            or role.get('PermissionsBoundary', {}).get('PermissionsBoundaryArn') != BOUNDARY):
        raise RuntimeError('OPS03_ROLE_BOUNDARY_MISMATCH')
    def read_inline():
        return document(aws('iam', 'get-role-policy', '--role-name', ROLE,
                            '--policy-name', 'ScopedOperations')['PolicyDocument'])
    def read_boundary():
        policy = aws('iam', 'get-policy', '--policy-arn', BOUNDARY)['Policy']
        version = policy['DefaultVersionId']
        if not re.fullmatch('v[1-9][0-9]*', version):
            raise RuntimeError('OPS03_BOUNDARY_VERSION_INVALID')
        return document(aws('iam', 'get-policy-version', '--policy-arn', BOUNDARY,
                            '--version-id', version)['PolicyVersion']['Document'])
    before_inline, before_boundary = read_inline(), read_boundary()
    wanted_inline, wanted_boundary = candidate(before_inline, INLINE_HASH), candidate(before_boundary, BOUNDARY_HASH)
    for name, value in [('role-before', role), ('inline-before', before_inline), ('boundary-before', before_boundary),
                        ('inline-candidate', wanted_inline), ('boundary-candidate', wanted_boundary)]:
        path = folder/(name+'.json')
        path.write_text(json.dumps(value, indent=2)+'\n')
        path.chmod(0o600)
    if before_boundary != wanted_boundary:
        if read_boundary() != before_boundary:
            raise RuntimeError('OPS03_BOUNDARY_CHANGED_BEFORE_WRITE')
        report['iamWriteRequests'] += 1
        error = None
        try:
            aws('iam', 'create-policy-version', '--policy-arn', BOUNDARY,
                '--policy-document', 'file://'+str(folder/'boundary-candidate.json'), '--set-as-default')
        except RuntimeError as failure:
            error = failure
        if read_boundary() != wanted_boundary:
            raise error or RuntimeError('OPS03_BOUNDARY_WRITE_UNVERIFIED')
    if before_inline != wanted_inline:
        if read_inline() != before_inline:
            raise RuntimeError('OPS03_INLINE_CHANGED_BEFORE_WRITE')
        report['iamWriteRequests'] += 1
        error = None
        try:
            aws('iam', 'put-role-policy', '--role-name', ROLE, '--policy-name', 'ScopedOperations',
                '--policy-document', 'file://'+str(folder/'inline-candidate.json'))
        except RuntimeError as failure:
            error = failure
        if read_inline() != wanted_inline:
            raise error or RuntimeError('OPS03_INLINE_WRITE_UNVERIFIED')
    if read_inline() != wanted_inline or read_boundary() != wanted_boundary:
        raise RuntimeError('OPS03_FINAL_POLICY_READBACK_UNVERIFIED')
    report.update(result='OPS03_TERMINAL_POLICY_READBACK_PASS', utc=datetime.now(timezone.utc).isoformat(),
                  inlineHash=digest(wanted_inline), boundaryHash=digest(wanted_boundary))
    return report


if __name__ == '__main__':
    folder = Path.home()/'.known-enough'/('ops03-journal-access-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    folder.mkdir(parents=True, mode=0o700)
    audit = {'iamWriteRequests': 0}
    def aws(*args):
        if args[:2] in [('iam', 'create-policy-version'), ('iam', 'put-role-policy')]:
            audit['iamWriteRequests'] += 1
        # Preserve CloudShell's installed credential provider, including AWS_CONTAINER_CREDENTIALS_*.
        result = subprocess.run(['aws', *args, '--region', 'us-east-1', '--output', 'json', '--no-cli-pager'],
                                capture_output=True, text=True, timeout=30)
        if result.returncode:
            code = re.search(r'\(([A-Za-z0-9]+)\)', result.stderr)
            error = RuntimeError(code.group(1) if code else 'AWS_REQUEST_FAILED')
            error.operation = args[0] + ':' + ''.join(part.capitalize() for part in args[1].split('-'))
            raise error
        return json.loads(result.stdout) if result.stdout.strip() else {}
    try:
        report = apply(aws, folder)
    except Exception as error:
        code = str(error) if isinstance(error, RuntimeError) else 'OPS03_SETUP_RESPONSE_UNVERIFIED'
        report = {'result': 'OPS03_TERMINAL_POLICY_READBACK_UNVERIFIED',
                  'code': code if re.fullmatch('[A-Za-z0-9_]{1,100}', code) else 'AWS_REQUEST_FAILED',
                  'backup': str(folder), 'iamWriteRequests': audit['iamWriteRequests'],
                  'operation': getattr(error, 'operation', 'LOCAL_GUARD'),
                  'dataWrites': 0, 'providerCalls': 0, 'effectiveBAccess': 'NOT_EXECUTED'}
    (folder/'result.json').write_text(json.dumps(report)+'\n')
    print(json.dumps(report))
    if report['result'] != 'OPS03_TERMINAL_POLICY_READBACK_PASS':
        raise SystemExit(1)
