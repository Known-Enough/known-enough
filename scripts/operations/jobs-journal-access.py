"""Read actual policies; an impossible condition probes DeleteItem without deleting data."""
import hashlib
import json
import os
import re
import subprocess
import uuid
from pathlib import Path
from urllib.parse import unquote

ACCOUNT = '092954139775'
ROLE = 'KnownEnoughGithubModelJobOperations'
BOUNDARY = f'arn:aws:iam::{ACCOUNT}:policy/{ROLE}Boundary'
TABLE = 'KnownEnoughOperationsJournal'
TABLE_ARN = f'arn:aws:dynamodb:us-east-1:{ACCOUNT}:table/{TABLE}'


def document(value):
    return json.loads(unquote(value)) if isinstance(value, str) else value


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def impossible_delete():
    return [{'Delete': {'TableName': TABLE, 'Key': {
        'PK': {'S': 'MODELJOB#' + str(uuid.uuid4())}, 'SK': {'S': 'STATE'}},
        'ConditionExpression': 'attribute_exists(PK) AND attribute_not_exists(PK)'}}]


def summary_policies(inline, boundary, expected):
    def declares(policy):
        for statement in policy['Statement']:
            actions = statement.get('Action', [])
            resources = statement.get('Resource', [])
            actions = [actions] if isinstance(actions, str) else actions
            resources = [resources] if isinstance(resources, str) else resources
            keys = statement.get('Condition', {}).get('ForAllValues:StringLike', {}).get('dynamodb:LeadingKeys', [])
            keys = [keys] if isinstance(keys, str) else keys
            if (statement.get('Effect') == 'Allow' and 'dynamodb:DeleteItem' in actions
                    and TABLE_ARN in resources and 'MODELJOB#*' in keys):
                return True
        return False
    return {'inlineMatchesCheckedSource': inline == expected['inline'],
            'boundaryMatchesCheckedSource': boundary == expected['boundary'],
            'inlineHash': digest(inline), 'boundaryHash': digest(boundary),
            'inlineScopedDeleteDeclared': declares(inline),
            'boundaryScopedDeleteDeclared': declares(boundary)}


def execute(aws, phase, expected=None):
    report = {'result': 'JOURNAL_ACCESS_UNVERIFIED', 'phase': phase, 'mutations': 0,
              'providerCalls': 0, 'fixtureRequests': 0}
    operation = 'sts:GetCallerIdentity'
    try:
        identity = aws('sts', 'get-caller-identity')
        expected_role = 'KnownEnoughGithubStagingInspector' if phase == 'metadata' else ROLE
        if (identity.get('Account') != ACCOUNT or not identity.get('Arn', '').startswith(
                f'arn:aws:sts::{ACCOUNT}:assumed-role/{expected_role}/')):
            raise RuntimeError('JOURNAL_ROLE_INVALID')
        if phase == 'metadata':
            operation = 'iam:GetRole'
            role = aws('iam', 'get-role', '--role-name', ROLE)['Role']
            if (role.get('Arn') != f'arn:aws:iam::{ACCOUNT}:role/{ROLE}'
                    or role.get('PermissionsBoundary', {}).get('PermissionsBoundaryArn') != BOUNDARY):
                raise RuntimeError('JOURNAL_BOUNDARY_INVALID')
            operation = 'iam:GetRolePolicy'
            inline = document(aws('iam', 'get-role-policy', '--role-name', ROLE,
                                  '--policy-name', 'ScopedOperations')['PolicyDocument'])
            operation = 'iam:GetPolicy'
            version = aws('iam', 'get-policy', '--policy-arn', BOUNDARY)['Policy']['DefaultVersionId']
            if not re.fullmatch(r'v[1-9][0-9]*', version):
                raise RuntimeError('JOURNAL_POLICY_VERSION_INVALID')
            operation = 'iam:GetPolicyVersion'
            boundary = document(aws('iam', 'get-policy-version', '--policy-arn', BOUNDARY,
                                   '--version-id', version)['PolicyVersion']['Document'])
            report.update(result='JOURNAL_POLICIES_READ', boundaryVersion=version,
                          **summary_policies(inline, boundary, expected))
        elif phase == 'probe':
            operation = 'dynamodb:DeleteItem'
            try:
                aws('dynamodb', 'transact-write-items', '--transact-items', json.dumps(impossible_delete()))
                raise RuntimeError('IMPOSSIBLE_CONDITION_DID_NOT_REJECT')
            except RuntimeError as error:
                if str(error) != 'TransactionCanceledException':
                    raise
                if not getattr(error, 'conditional_only', False):
                    raise RuntimeError('JOURNAL_CONDITION_RESULT_UNVERIFIED')
                report.update(result='JOURNAL_DELETE_ALLOWED_CONDITION_REJECTED',
                              code='TransactionCanceledException', operation=operation)
        else:
            raise RuntimeError('JOURNAL_PHASE_INVALID')
    except (RuntimeError, KeyError, ValueError, TypeError, subprocess.TimeoutExpired) as error:
        code = str(error) if isinstance(error, RuntimeError) else 'JOURNAL_RESPONSE_UNVERIFIED'
        report.update(operation=operation, code=code if re.fullmatch('[A-Za-z0-9_]{1,100}', code) else 'AWS_REQUEST_UNVERIFIED')
        denied = getattr(error, 'denied_action', None)
        if denied in ['dynamodb:DeleteItem', 'dynamodb:TransactWriteItems', 'dynamodb:GetItem']:
            report['deniedAction'] = denied
    return report


if __name__ == '__main__':
    root = Path(os.environ['RUNNER_TEMP'])
    phase = os.environ['JOURNAL_PHASE']
    def aws(*args):
        result = subprocess.run(['aws', *args, '--region', 'us-east-1', '--output', 'json', '--no-cli-pager'],
                                capture_output=True, text=True, timeout=30)
        if result.returncode:
            match = re.search(r'\(([A-Za-z0-9]+)\)', result.stderr)
            error = RuntimeError(match.group(1) if match else 'AWS_REQUEST_FAILED')
            error.conditional_only = bool(re.search(r'\[ConditionalCheckFailed\]', result.stderr))
            denied = re.search(r'(?:perform:?\s*|allows\s+)(dynamodb:(?:DeleteItem|TransactWriteItems|GetItem))\b', result.stderr)
            error.denied_action = denied.group(1) if denied else None
            raise error
        return json.loads(result.stdout) if result.stdout.strip() else {}
    expected = json.loads((root/'journal-policy-expected-private.json').read_text()) if phase == 'metadata' else None
    report = {'sourceSha': os.environ['GITHUB_SHA'], **execute(aws, phase, expected)}
    (root/f'jobs-journal-{phase}-report.json').write_text(json.dumps(report)+'\n')
    if report['result'] == 'JOURNAL_ACCESS_UNVERIFIED':
        raise SystemExit(1)
