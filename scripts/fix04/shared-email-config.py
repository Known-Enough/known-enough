"""Configure one private exact-email exception; never change account admission or IAM."""
import base64
import hashlib
import hmac
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

ACCOUNT = '092954139775'
FUNCTION = 'known-enough-stage-api'
SETTING = 'KE_SHARED_TEST_EMAIL_HASHES'


def require(value, code):
    if not value:
        raise RuntimeError(code)


def aws(*args):
    result = subprocess.run(['aws', *args, '--region', 'us-east-1', '--output', 'json',
                             '--no-cli-pager'], capture_output=True, text=True, timeout=30)
    if result.returncode:
        match = re.search(r'An error occurred \(([A-Za-z0-9]+)\)', result.stderr)
        raise RuntimeError('AWS_REQUEST_FAILED:' + (match.group(1) if match else 'UNCLASSIFIED'))
    return json.loads(result.stdout or '{}')


def proposed(current, expected_hash, email):
    require(re.fullmatch(r'[a-f0-9]{64}', expected_hash or ''), 'CODE_ANCHOR_REQUIRED')
    require(current.get('CodeSha256') == base64.b64encode(bytes.fromhex(expected_hash)).decode(), 'CODE_CHANGED')
    require(current.get('FunctionArn') == f'arn:aws:lambda:us-east-1:{ACCOUNT}:function:{FUNCTION}'
            and current.get('Handler') == 'api.handler'
            and current.get('Role') == f'arn:aws:iam::{ACCOUNT}:role/KnownEnoughStageApiRole'
            and current.get('State') == 'Active' and current.get('LastUpdateStatus') == 'Successful'
            and current.get('RevisionId'), 'RUNTIME_TARGET_CHANGED')
    require(isinstance(email, str) and 0 < len(email) <= 254
            and re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email), 'PRIVATE_EMAIL_REQUIRED')
    variables = dict(current.get('Environment', {}).get('Variables', {}))
    require(variables.get('COGNITO_USER_POOL_ID') == 'us-east-1_V9OMjd0zx'
            and variables.get('KE14_MODEL_MODE') == 'DISABLED'
            and variables.get('KE14_PAID_CALLS_APPROVED') == 'false', 'CONFIGURATION_CHANGED')
    key = variables.get('NP_GROUP_EMAIL_KEY')
    require(isinstance(key, str) and 32 <= len(key) <= 1024, 'PRIVATE_KEY_REQUIRED')
    existing = json.loads(variables.get(SETTING, '[]'))
    require(isinstance(existing, list) and len(existing) <= 16
            and all(isinstance(value, str) and re.fullmatch(r'[a-f0-9]{64}', value) for value in existing)
            and len(set(existing)) == len(existing), 'PRIVATE_SETTING_INVALID')
    digest = hmac.new(key.encode(), email.strip().lower().encode(), hashlib.sha256).hexdigest()
    # This task configures exactly the one selected address; preserve any existing exception.
    if digest not in existing:
        require(len(existing) < 16, 'PRIVATE_SETTING_CAPACITY')
        existing.append(digest)
    variables[SETTING] = json.dumps(existing, separators=(',', ':'))
    return {'Variables': variables}


def main():
    os.umask(0o077)
    require(os.environ.get('EXPECTED_SOURCE') == os.environ.get('CHECKOUT_SOURCE')
            and re.fullmatch(r'[a-f0-9]{40}', os.environ.get('EXPECTED_SOURCE', '')), 'SOURCE_CHANGED')
    action = sys.argv[1] if len(sys.argv) == 2 else 'configure'
    require(action in ['configure', 'fixture', 'restore'], 'INVALID_ACTION')
    folder = Path(os.environ['RUNNER_TEMP']) / 'shared-email-private'
    email = os.environ.get('PRIVATE_TEST_EMAIL', '')
    if action == 'fixture':
        state = json.loads((Path(os.environ['RUNNER_TEMP']) / 'partition-cutover-private/owned-fixtures-private.json').read_text())
        require(state.get('sourceSha') == os.environ['EXPECTED_SOURCE'] and len(state.get('fixtures', [])) == 2, 'OWN_SOURCE_REQUIRED')
        email = state['fixtures'][0]['mailbox']['address']
        require(re.fullmatch(r'keqa-[a-f0-9]{32}@[a-z0-9.-]+', email), 'OWN_MAILBOX_REQUIRED')
    if action != 'restore':
        require(email, 'PRIVATE_EMAIL_REQUIRED')
    elif not (folder / 'previous-private.json').exists():
        print(json.dumps({'result': 'SHARED_TEST_EMAIL_RESTORE_NOT_REQUIRED', 'cloudWrites': 0}))
        return
    identity = aws('sts', 'get-caller-identity')
    require(identity.get('Account') == ACCOUNT
            and identity.get('Arn', '').startswith(f'arn:aws:sts::{ACCOUNT}:assumed-role/KnownEnoughGithubPrimaryRelease/'), 'IDENTITY_CHANGED')
    current = aws('lambda', 'get-function-configuration', '--function-name', FUNCTION)
    if action == 'restore':
        prior = json.loads((folder / 'previous-private.json').read_text())
        expected = json.loads((folder / 'environment-private.json').read_text())
        require(current.get('CodeSha256') == prior.get('CodeSha256') and current.get('Environment') in [expected, prior.get('Environment')]
                and current.get('Role') == prior.get('Role') and current.get('Handler') == prior.get('Handler')
                and current.get('LastUpdateStatus') == 'Successful', 'RESTORE_TARGET_CHANGED')
        environment = prior['Environment']
    else:
        environment = proposed(current, os.environ.get('EXPECTED_API_SHA256'), email)
    changed = current['Environment'] != environment
    if changed:
        folder.mkdir(mode=0o700, exist_ok=True)
        if action != 'restore':
            (folder / 'previous-private.json').write_text(json.dumps(current))
            path = folder / 'environment-private.json'
        else:
            path = folder / 'restored-environment-private.json'
        path.write_text(json.dumps(environment))
        aws('lambda', 'update-function-configuration', '--function-name', FUNCTION,
            '--revision-id', current['RevisionId'], '--environment', 'file://' + str(path))
    for attempt in range(15):
        fresh = aws('lambda', 'get-function-configuration', '--function-name', FUNCTION)
        if fresh.get('LastUpdateStatus') == 'InProgress':
            time.sleep(2)
            continue
        require(fresh.get('Environment') == environment
                and fresh.get('CodeSha256') == current['CodeSha256']
                and fresh.get('Role') == current['Role'] and fresh.get('Handler') == current['Handler']
                and fresh.get('State') == 'Active' and fresh.get('LastUpdateStatus') == 'Successful', 'CONFIGURATION_READBACK_FAILED')
        print(json.dumps({'result': 'SHARED_TEST_EMAIL_RESTORE_READBACK_PASS' if action == 'restore' else 'SHARED_TEST_EMAIL_CONFIG_READBACK_PASS', 'cloudWrites': int(changed),
                          'source': os.environ['EXPECTED_SOURCE'], 'accountChanges': 0,
                          'emailRequests': 0, 'modelCalls': 0, 'perEmailAccountCap': None}))
        return
    raise RuntimeError('CONFIGURATION_PENDING')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'result': 'BLOCKED', 'code': str(error) if isinstance(error, RuntimeError) else type(error).__name__}))
        sys.exit(1)
