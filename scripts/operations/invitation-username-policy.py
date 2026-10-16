"""Add the username directory key to the existing participant policy only."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

ACCOUNT = '092954139775'
ROLE = 'KnownEnoughStageApiRole'
POLICY = 'KnownEnoughPartitionParticipant'
TABLE = f'arn:aws:dynamodb:us-east-1:{ACCOUNT}:table/KnownEnoughPartitions'
EXPECTED_PRIOR_SHA = 'a5c483ca534d34c864543dcebe47cb27657090143a9968932c7a1a645bc70abd'
EXPECTED_KEYS = ['ACCOUNT#*', 'GROUP#*', 'EMAIL#*', 'INVITATION#*', 'DECISION#*', 'MEMBER#*']


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


def run(executor=subprocess.run, root=None):
    root = Path(root or os.environ['RUNNER_TEMP'])
    report = {'result': 'BLOCKED', 'role': ROLE, 'policy': POLICY, 'iamWrites': 0, 'writeRequested': False,
              'dataWrites': 0, 'providerCalls': 0}

    def aws(service, action, *args, mutation=False):
        result = executor(['aws', service, action, *args, '--region', 'us-east-1', '--output', 'json', '--no-cli-pager'],
                          capture_output=True, text=True, timeout=20)
        if result.returncode:
            import re
            match = re.search(r'An error occurred \(([A-Za-z0-9]+)\)', result.stderr or '')
            code = match.group(1) if match else 'AWS_REQUEST_FAILED'
            raise ValueError(('iam:' + action + '/' + code) if not mutation else 'IAM_WRITE_UNCONFIRMED')
        return json.loads(result.stdout or '{}')

    try:
        report['operation'] = 'sts:GetCallerIdentity'
        identity = aws('sts', 'get-caller-identity')
        if identity.get('Account') != ACCOUNT or not identity.get('Arn', '').startswith(
                f'arn:aws:sts::{ACCOUNT}:assumed-role/KnownEnoughGithubModelJobOperations/'):
            raise ValueError('OWN_ROLE_TARGET_INVALID')
        report['operation'] = 'iam:GetRole'
        role = aws('iam', 'get-role', '--role-name', ROLE)['Role']
        if role.get('Arn') != f'arn:aws:iam::{ACCOUNT}:role/{ROLE}' or role.get('PermissionsBoundary'):
            raise ValueError('RUNTIME_ROLE_BINDING_CHANGED')
        report['operation'] = 'iam:GetRolePolicy'
        prior = aws('iam', 'get-role-policy', '--role-name', ROLE, '--policy-name', POLICY).get('PolicyDocument')
        if not isinstance(prior, dict) or digest(prior) != EXPECTED_PRIOR_SHA:
            raise ValueError('PARTICIPANT_POLICY_BASELINE_CHANGED')
        updated = candidate(prior)
        report['priorPolicySha256'] = digest(prior)
        report['candidatePolicySha256'] = digest(updated)
        root.mkdir(mode=0o700, parents=True, exist_ok=True)
        backup = root / 'participant-policy-before-private.json'
        fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as stream:
            stream.write(canonical(prior))
        if '--apply' in sys.argv:
            report['writeRequested'] = True
            report['operation'] = 'iam:PutRolePolicy'
            try:
                aws('iam', 'put-role-policy', '--role-name', ROLE, '--policy-name', POLICY,
                    '--policy-document', canonical(updated), mutation=True)
                report['iamWrites'] = 1
            except ValueError as error:
                report['writeAcknowledgment'] = str(error)
            observed = aws('iam', 'get-role-policy', '--role-name', ROLE, '--policy-name', POLICY).get('PolicyDocument')
            if not isinstance(observed, dict) or observed != updated:
                raise ValueError('PARTICIPANT_POLICY_READBACK_MISMATCH')
            report['iamWrites'] = 1
            report.update(result='USERNAME_DIRECTORY_POLICY_READBACK_PASS', read=True, transactionalWrite=True)
        else:
            report.update(result='USERNAME_DIRECTORY_POLICY_PREVIEW_PASS', read=True, transactionalWrite=True)
    except Exception as error:
        report['code'] = str(error) if isinstance(error, ValueError) else 'POLICY_REPAIR_UNAVAILABLE'
    report_path = root / 'invitation-username-policy-report.json'
    report_path.write_text(json.dumps(report) + '\n')
    return report


if __name__ == '__main__':
    result = run()
    print(json.dumps(result))
    raise SystemExit(0 if result['result'] == 'USERNAME_DIRECTORY_POLICY_READBACK_PASS' else 1)
