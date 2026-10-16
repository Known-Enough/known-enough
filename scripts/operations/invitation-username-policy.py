"""Add USERNAME#* only to the existing participant policy's scoped partition statements."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import datetime

ACCOUNT = '092954139775'
ROLE = 'KnownEnoughStageApiRole'
POLICY = 'KnownEnoughPartitionParticipant'
TABLE = f'arn:aws:dynamodb:us-east-1:{ACCOUNT}:table/KnownEnoughPartitions'
EXPECTED_PRIOR_SHA = 'a5c483ca534d34c864543dcebe47cb27657090143a9968932c7a1a645bc70abd'
EXPECTED_KEYS = ['ACCOUNT#*', 'GROUP#*', 'EMAIL#*', 'INVITATION#*', 'DECISION#*', 'MEMBER#*']
PHASES = {'prepare', 'apply', 'readback'}


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'))


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def candidate(prior):
    if not isinstance(prior, dict) or prior.get('Version') != '2012-10-17' or not isinstance(prior.get('Statement'), list):
        raise ValueError('PARTICIPANT_POLICY_SHAPE_INVALID')
    out = json.loads(json.dumps(prior))
    rows = [row for row in out['Statement'] if isinstance(row, dict)
            and row.get('Sid') in ('ScopedPartitionRead', 'ScopedPartitionCommit')]
    if len(rows) != 2:
        raise ValueError('PARTICIPANT_POLICY_TARGETS_INVALID')
    expected = {
        'ScopedPartitionRead': ['dynamodb:GetItem', 'dynamodb:BatchGetItem'],
        'ScopedPartitionCommit': ['dynamodb:PutItem', 'dynamodb:ConditionCheckItem'],
    }
    for row in rows:
        sid = row['Sid']
        if (row.get('Effect') != 'Allow' or row.get('Resource') != TABLE or row.get('Action') != expected[sid]
                or row.get('Condition', {}).get('ForAllValues:StringLike', {}).get('dynamodb:LeadingKeys') != EXPECTED_KEYS):
            raise ValueError('PARTICIPANT_POLICY_TARGET_DRIFT')
        if sid == 'ScopedPartitionCommit' and row.get('Condition', {}).get('ForAnyValue:StringEquals', {}).get('dynamodb:EnclosingOperation') != ['TransactWriteItems']:
            raise ValueError('PARTICIPANT_POLICY_TRANSACTION_FENCE_INVALID')
        row['Condition']['ForAllValues:StringLike']['dynamodb:LeadingKeys'].append('USERNAME#*')
    return out


def run(executor=subprocess.run, root=None, phase=None):
    root = Path(root or os.environ['RUNNER_TEMP'])
    phase = phase or os.environ.get('INVITATION_POLICY_PHASE', 'prepare')
    report = {'result': 'BLOCKED', 'phase': phase, 'role': ROLE, 'policy': POLICY, 'iamWrites': 0,
              'writeRequested': False, 'dataWrites': 0, 'providerCalls': 0}
    if phase not in PHASES:
        report['code'] = 'POLICY_REPAIR_PHASE_INVALID'
        return report

    def aws(service, action, *args, mutation=False):
        result = executor(['aws', service, action, *args, '--region', 'us-east-1', '--output', 'json', '--no-cli-pager'],
                          capture_output=True, text=True, timeout=20)
        if result.returncode:
            match = re.search(r'An error occurred \(([A-Za-z0-9]+)\)', result.stderr or '')
            code = match.group(1) if match else 'AWS_REQUEST_FAILED'
            raise ValueError(('iam:' + action + '/' + code) if not mutation else 'iam:put-role-policy/' + code)
        return json.loads(result.stdout or '{}')

    try:
        expected_role = 'KnownEnoughGithubModelJobOperations' if phase == 'apply' else 'KnownEnoughGithubStagingInspector'
        report['operation'] = 'sts:GetCallerIdentity'
        identity = aws('sts', 'get-caller-identity')
        if identity.get('Account') != ACCOUNT or not identity.get('Arn', '').startswith(
                f'arn:aws:sts::{ACCOUNT}:assumed-role/{expected_role}/'):
            raise ValueError('OWN_ROLE_TARGET_INVALID')
        root.mkdir(mode=0o700, parents=True, exist_ok=True)
        prior_path = root / 'participant-policy-before-private.json'
        candidate_path = root / 'participant-policy-candidate-private.json'

        if phase == 'prepare':
            report['operation'] = 'iam:GetRole'
            role = aws('iam', 'get-role', '--role-name', ROLE)['Role']
            if role.get('Arn') != f'arn:aws:iam::{ACCOUNT}:role/{ROLE}' or role.get('PermissionsBoundary'):
                raise ValueError('RUNTIME_ROLE_BINDING_CHANGED')
            report['operation'] = 'iam:GetRolePolicy'
            prior = aws('iam', 'get-role-policy', '--role-name', ROLE, '--policy-name', POLICY).get('PolicyDocument')
            if not isinstance(prior, dict) or digest(prior) != EXPECTED_PRIOR_SHA:
                raise ValueError('PARTICIPANT_POLICY_BASELINE_CHANGED')
            updated = candidate(prior)
            for path, value in ((prior_path, prior), (candidate_path, updated)):
                fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, 'w') as stream:
                    stream.write(canonical(value))
            report.update(result='USERNAME_DIRECTORY_POLICY_PREPARED', priorPolicySha256=digest(prior),
                          candidatePolicySha256=digest(updated))
        elif phase == 'apply':
            prior = json.loads(prior_path.read_text())
            updated = json.loads(candidate_path.read_text())
            if digest(prior) != EXPECTED_PRIOR_SHA or candidate(prior) != updated:
                raise ValueError('PARTICIPANT_POLICY_PRIVATE_PLAN_INVALID')
            report['writeRequested'] = True
            report['operation'] = 'iam:PutRolePolicy'
            aws('iam', 'put-role-policy', '--role-name', ROLE, '--policy-name', POLICY,
                '--policy-document', canonical(updated), mutation=True)
            report.update(iamWrites=1, result='USERNAME_DIRECTORY_POLICY_WRITE_REQUESTED',
                          candidatePolicySha256=digest(updated))
        else:
            updated = json.loads(candidate_path.read_text())
            report['operation'] = 'iam:GetRolePolicy'
            observed = aws('iam', 'get-role-policy', '--role-name', ROLE, '--policy-name', POLICY).get('PolicyDocument')
            if not isinstance(observed, dict) or observed != updated:
                raise ValueError('PARTICIPANT_POLICY_READBACK_MISMATCH')
            report.update(result='USERNAME_DIRECTORY_POLICY_READBACK_PASS', read=True, transactionalWrite=True,
                          candidatePolicySha256=digest(updated))
    except Exception as error:
        report['code'] = str(error) if isinstance(error, ValueError) else 'POLICY_REPAIR_UNAVAILABLE'
    return report


def cloudshell(executor=subprocess.run):
    """Use the operator's existing same-account CloudShell identity for this one exact policy update."""
    report = {'result': 'BLOCKED', 'role': ROLE, 'policy': POLICY, 'iamWrites': 0,
              'writeRequested': False, 'dataWrites': 0, 'providerCalls': 0}

    def aws(action, *args, mutation=False):
        result = executor(['aws', 'iam' if action != 'get-caller-identity' else 'sts', action, *args,
                           '--region', 'us-east-1', '--output', 'json', '--no-cli-pager'],
                          capture_output=True, text=True, timeout=25)
        if result.returncode:
            match = re.search(r'An error occurred \(([A-Za-z0-9]+)\)', result.stderr or '')
            code = match.group(1) if match else 'AWS_REQUEST_FAILED'
            raise ValueError(('iam:' + action + '/' + code) if not mutation else 'iam:put-role-policy/' + code)
        return json.loads(result.stdout or '{}')

    try:
        report['operation'] = 'sts:GetCallerIdentity'
        identity = aws('get-caller-identity')
        if identity.get('Account') != ACCOUNT:
            raise ValueError('TARGET_ACCOUNT_MISMATCH')
        report['operation'] = 'iam:GetRole'
        role = aws('get-role', '--role-name', ROLE)['Role']
        if role.get('Arn') != f'arn:aws:iam::{ACCOUNT}:role/{ROLE}' or role.get('PermissionsBoundary'):
            raise ValueError('RUNTIME_ROLE_BINDING_CHANGED')
        report['operation'] = 'iam:GetRolePolicy'
        prior = aws('get-role-policy', '--role-name', ROLE, '--policy-name', POLICY).get('PolicyDocument')
        if not isinstance(prior, dict) or digest(prior) != EXPECTED_PRIOR_SHA:
            raise ValueError('PARTICIPANT_POLICY_BASELINE_CHANGED')
        updated = candidate(prior)
        folder = Path.home() / '.known-enough' / ('invitation-username-policy-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
        folder.mkdir(mode=0o700, parents=True, exist_ok=False)
        prior_path = folder / 'participant-policy-before-private.json'
        candidate_path = folder / 'participant-policy-candidate-private.json'
        for path, value in ((prior_path, prior), (candidate_path, updated)):
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'w') as stream:
                stream.write(canonical(value))
        report['candidatePolicySha256'] = digest(updated)
        report['writeRequested'] = True
        report['operation'] = 'iam:PutRolePolicy'
        try:
            aws('put-role-policy', '--role-name', ROLE, '--policy-name', POLICY,
                '--policy-document', 'file://' + str(candidate_path), mutation=True)
            report['iamWrites'] = 1
        except ValueError as error:
            report['writeAcknowledgment'] = str(error)
        report['operation'] = 'iam:GetRolePolicyReadback'
        observed = aws('get-role-policy', '--role-name', ROLE, '--policy-name', POLICY).get('PolicyDocument')
        if not isinstance(observed, dict) or observed != updated:
            raise ValueError('PARTICIPANT_POLICY_READBACK_MISMATCH')
        report.update(result='USERNAME_DIRECTORY_POLICY_READBACK_PASS', iamWrites=1, read=True, transactionalWrite=True)
    except Exception as error:
        report['code'] = str(error) if isinstance(error, ValueError) else 'POLICY_REPAIR_UNAVAILABLE'
    return report


if __name__ == '__main__':
    is_cloudshell = '--cloudshell' in sys.argv
    result = cloudshell() if is_cloudshell else run()
    report_path = (Path.home() / '.known-enough' / 'invitation-username-policy-result.json') if is_cloudshell else (
        Path(os.environ['RUNNER_TEMP']) / ('invitation-username-policy-' + result['phase'] + '.json'))
    report_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    report_path.write_text(json.dumps(result) + '\n')
    print(json.dumps(result))
    expected = {'prepare': 'USERNAME_DIRECTORY_POLICY_PREPARED', 'apply': 'USERNAME_DIRECTORY_POLICY_WRITE_REQUESTED',
                'readback': 'USERNAME_DIRECTORY_POLICY_READBACK_PASS'}
    success = result['result'] == 'USERNAME_DIRECTORY_POLICY_READBACK_PASS' if is_cloudshell else (
        result['result'] == expected.get(result['phase']))
    raise SystemExit(0 if success else 1)
