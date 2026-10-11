"""Fixed inspector metadata reads; compare installed consent rights without data mutation."""
import json
import os
import re
import subprocess
from pathlib import Path
from urllib.parse import unquote
ACCOUNT = '092954139775'
ROLE = 'KnownEnoughGithubModelJobOperations'
BOUNDARY = f'arn:aws:iam::{ACCOUNT}:policy/{ROLE}Boundary'


def document(value):
    return json.loads(unquote(value)) if isinstance(value, str) else value


def readback(expected, aws):
    report = {'result': 'CONSENT_POLICY_READBACK_BLOCKED', 'mutations': 0, 'signup': 0,
              'providerCalls': 0, 'requests': 0, 'effectiveTransaction': 'NOT_EXECUTED'}
    operation = 'sts:GetCallerIdentity'
    def read(action, *args):
        nonlocal operation
        operation = action
        report['requests'] += 1
        return aws(*args)
    try:
        identity = read(operation, 'sts', 'get-caller-identity')
        if identity.get('Account') != ACCOUNT or not identity.get('Arn', '').startswith(
                f'arn:aws:sts::{ACCOUNT}:assumed-role/KnownEnoughGithubStagingInspector/'):
            raise RuntimeError('OWN_INSPECTOR_IDENTITY_REQUIRED')
        role = read('iam:GetRole', 'iam', 'get-role', '--role-name', ROLE)['Role']
        if role.get('Arn') != f'arn:aws:iam::{ACCOUNT}:role/{ROLE}' or role.get('PermissionsBoundary', {}).get('PermissionsBoundaryArn') != BOUNDARY:
            raise RuntimeError('INSTALLED_ROLE_BOUNDARY_MISMATCH')
        inline = read('iam:GetRolePolicy', 'iam', 'get-role-policy', '--role-name', ROLE,
                      '--policy-name', 'ScopedOperations')
        policy = read('iam:GetPolicy', 'iam', 'get-policy', '--policy-arn', BOUNDARY)['Policy']
        version = policy.get('DefaultVersionId', '')
        if not re.fullmatch(r'v[1-9][0-9]*', version):
            raise RuntimeError('BOUNDARY_VERSION_INVALID')
        boundary = read('iam:GetPolicyVersion', 'iam', 'get-policy-version', '--policy-arn', BOUNDARY,
                        '--version-id', version)['PolicyVersion']
        inline_doc = document(inline['PolicyDocument'])
        boundary_doc = document(boundary['Document'])
        report.update(inlineMatchesCheckedSource=inline_doc == expected['inline'],
                      boundaryMatchesCheckedSource=boundary_doc == expected['boundary'], boundaryVersion=version)
        statements = [s for s in inline_doc['Statement'] if s.get('Sid') == 'JoinedKernelStateAndGuardCAS']
        if len(statements) != 1:
            raise RuntimeError('INSTALLED_ROOM_STATEMENT_INVALID')
        room = statements[0]
        # Report only the fixed expected actions, not arbitrary remote policy/identity strings.
        actions = room['Action'] if isinstance(room['Action'], list) else [room['Action']]
        report['installedRoomActions'] = [a for a in ['dynamodb:PutItem', 'dynamodb:ConditionCheckItem', 'dynamodb:UpdateItem'] if a in actions]
        report['originalGuardOperation'] = 'dynamodb:UpdateItem'
        report['correctedGuardOperation'] = 'dynamodb:PutItem'
        if not report['inlineMatchesCheckedSource'] or not report['boundaryMatchesCheckedSource']:
            raise RuntimeError('INSTALLED_CONSENT_PROFILE_DRIFT')
        report['result'] = 'CONSENT_POLICY_CONFIGURATION_MATCH'
    except (RuntimeError, KeyError, ValueError, TypeError, OSError, subprocess.TimeoutExpired) as error:
        code = str(error) if isinstance(error, RuntimeError) else ('AWS_METADATA_READ_TIMEOUT' if isinstance(error, subprocess.TimeoutExpired) else 'METADATA_RESPONSE_INVALID')
        report.update(operation=operation, code=code if re.fullmatch(r'[A-Z][A-Za-z0-9_]{0,80}', code) else 'METADATA_READ_FAILED')
    return report


def main():
    def aws(*args):
        result = subprocess.run(['aws', *args, '--region', 'us-east-1', '--output', 'json', '--no-cli-pager'],
                                capture_output=True, timeout=30)
        if result.returncode:
            match = re.search(rb'\(([A-Za-z0-9]+)\)', result.stderr)
            raise RuntimeError(match.group(1).decode() if match else 'AWS_METADATA_READ_FAILED')
        return json.loads(result.stdout)
    target = Path(os.environ['RUNNER_TEMP'])
    try:
        report = readback(json.loads((target / 'consent-policy-expected.json').read_text()), aws)
    except (OSError, subprocess.TimeoutExpired):
        report = {'result': 'CONSENT_POLICY_READBACK_BLOCKED', 'code': 'METADATA_READ_UNAVAILABLE', 'mutations': 0}
    report['sourceSha'] = os.environ['GITHUB_SHA']
    (target / 'consent-policy-readback-report.json').write_text(json.dumps(report) + '\n')
    print(json.dumps(report))
    return 0 if report['result'] == 'CONSENT_POLICY_CONFIGURATION_MATCH' else 1


if __name__ == '__main__':
    raise SystemExit(main())
