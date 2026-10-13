"""Install one durable GitHub configuration role. No application changes; inspect by default."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
ACCOUNT = '092954139775'
ROLE = 'KnownEnoughGithubApplicationConfig'
POLICY = 'ExactApplicationConfig'
BOUNDARY = f'arn:aws:iam::{ACCOUNT}:policy/{ROLE}Boundary'


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def require(value, code):
    if not value:
        raise RuntimeError(code)


def aws(service, action, data=None):
    result = subprocess.run(['aws', service, action, '--region', 'us-east-1', '--output', 'json', '--no-cli-pager',
                             '--cli-connect-timeout', '5', '--cli-read-timeout', '20',
                             *(['--cli-input-json', json.dumps(data)] if data is not None else [])],
                            capture_output=True, text=True, timeout=30,
                            env={**os.environ, 'AWS_MAX_ATTEMPTS': '1'})
    if result.returncode:
        code = re.search(r'An error occurred \(([A-Za-z0-9]+)\)', result.stderr)
        label = code.group(1) if code else 'NO_CREDENTIALS' if 'unable to locate credentials' in result.stderr.lower() else 'CLI_FAILED'
        raise RuntimeError(service + ':' + action + ':' + label)
    return json.loads(result.stdout or '{}')


def optional(action, data):
    try:
        return aws('iam', action, data)
    except RuntimeError as error:
        if str(error) != 'iam:' + action + ':NoSuchEntity':
            raise
        return None


def owned(tags, policy):
    values = {tag['Key']: tag['Value'] for tag in tags}
    require(values.get('KnownEnoughComponent') == 'application-config' and values.get('PolicySha256') == digest(policy), 'EXISTING_RESOURCE_NOT_OWNED')


def inspect(policy, trust):
    boundary = optional('get-policy', {'PolicyArn': BOUNDARY})
    if boundary:
        owned(boundary['Policy'].get('Tags', []), policy)
        document = aws('iam', 'get-policy-version', {'PolicyArn': BOUNDARY, 'VersionId': boundary['Policy']['DefaultVersionId']})['PolicyVersion']['Document']
        require(document == policy, 'BOUNDARY_CHANGED')
    role = optional('get-role', {'RoleName': ROLE})
    inline = None
    if role:
        current = role['Role']
        owned(current.get('Tags', []), policy)
        require(current.get('Arn') == f'arn:aws:iam::{ACCOUNT}:role/{ROLE}' and current.get('Path') == '/' and
                current.get('MaxSessionDuration') == 3600 and current.get('AssumeRolePolicyDocument') == trust and
                current.get('PermissionsBoundary', {}).get('PermissionsBoundaryArn') == BOUNDARY, 'ROLE_CONFIGURATION_CHANGED')
        require(boundary is not None, 'BOUNDARY_MISSING')
        attached = aws('iam', 'list-attached-role-policies', {'RoleName': ROLE})
        names = aws('iam', 'list-role-policies', {'RoleName': ROLE})
        require(not attached.get('IsTruncated') and not names.get('IsTruncated'), 'POLICY_PAGE_INCOMPLETE')
        require(not attached.get('AttachedPolicies') and names.get('PolicyNames', []) in [[], [POLICY]], 'FOREIGN_ROLE_POLICY')
        if names.get('PolicyNames'):
            inline = aws('iam', 'get-role-policy', {'RoleName': ROLE, 'PolicyName': POLICY})['PolicyDocument']
            require(inline == policy, 'INLINE_POLICY_CHANGED')
    return boundary, role, inline


def install(source, apply):
    require(re.fullmatch(r'[a-f0-9]{40}', source) is not None, 'SOURCE_INVALID')
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    remote = subprocess.check_output(['git', 'remote', 'get-url', 'origin'], cwd=ROOT, text=True).strip()
    require(head == source and remote in ['https://github.com/Known-Enough/known-enough.git', 'https://github.com/Known-Enough/known-enough'], 'CHECKOUT_CHANGED')
    require(not subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True).strip(), 'CHECKOUT_DIRTY')
    policy = json.loads((ROOT / 'infra/zz/github-application-config-policy.json').read_text())
    trust = json.loads((ROOT / 'infra/zz/github-application-config-trust.json').read_text())
    identity = aws('sts', 'get-caller-identity')
    require(identity.get('Account') == ACCOUNT, 'WRONG_AWS_ACCOUNT')
    require(not identity.get('Arn', '').startswith(f'arn:aws:sts::{ACCOUNT}:assumed-role/{ROLE}/'), 'ADMINISTRATOR_SETUP_REQUIRED')
    boundary, role, inline = inspect(policy, trust)
    report = {'result': 'APPLICATION_CONFIG_INSTALL_REVIEW_READY', 'source': source, 'policySha256': digest(policy),
              'role': ROLE, 'configurationWrites': 0, 'applicationChanges': 0, 'githubExecution': 'NOT_EXECUTED'}
    if not apply:
        return report
    os.umask(0o077)
    folder = Path.home() / '.known-enough' / ('application-config-install-' + source)
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    saved = folder / 'before-private.json'
    if not saved.exists():
        saved.write_text(json.dumps({'boundary': boundary, 'role': role, 'inline': inline}))
        saved.chmod(0o600)
    tags = [{'Key': 'KnownEnoughComponent', 'Value': 'application-config'}, {'Key': 'PolicySha256', 'Value': digest(policy)}]
    if not boundary:
        report['configurationWrites'] += 1
        aws('iam', 'create-policy', {'PolicyName': ROLE + 'Boundary', 'PolicyDocument': json.dumps(policy), 'Tags': tags})
    if not role:
        report['configurationWrites'] += 1
        aws('iam', 'create-role', {'RoleName': ROLE, 'MaxSessionDuration': 3600, 'PermissionsBoundary': BOUNDARY,
                                  'AssumeRolePolicyDocument': json.dumps(trust), 'Tags': tags,
                                  'Description': 'Known Enough existing application configuration from GitHub main'})
    if inline is None:
        report['configurationWrites'] += 1
        aws('iam', 'put-role-policy', {'RoleName': ROLE, 'PolicyName': POLICY, 'PolicyDocument': json.dumps(policy)})
    _, _, installed = inspect(policy, trust)
    require(installed == policy, 'INSTALL_READBACK_FAILED')
    report['result'] = 'APPLICATION_CONFIG_ROLE_READBACK_PASS'
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        print(json.dumps(install(args.source, args.apply)))
    except (RuntimeError, OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        print(json.dumps({'result': 'APPLICATION_CONFIG_INSTALL_BLOCKED', 'code': str(error) if isinstance(error, RuntimeError) else type(error).__name__,
                          'applicationChanges': 0, 'recovery': 'SAME_PINNED_COMMAND; do not replace existing resources'}))
        raise SystemExit(1)
