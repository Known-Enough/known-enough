#!/usr/bin/env python3
"""Create/register/approve ten owned test accounts using native admission code."""
import argparse
import base64
import datetime
import fcntl
import gzip
import hashlib
import hmac
import io
import json
import os
from pathlib import Path
import platform
import re
import secrets
import shutil
import subprocess
import tarfile
import tempfile
import urllib.parse
import urllib.request
import zipfile

ACCOUNT = '092954139775'
REGION = 'us-east-1'
POOL = 'us-east-1_V9OMjd0zx'
EMAIL = 'martelaxe@gmail.com'  # The owner's previously requested shared test email.
API = 'known-enough-stage-api'
root = Path.home() / '.known-enough' / 'test-accounts'
state = None
state_file = root / 'ten-accounts-private.json'
stage = 'PREFLIGHT'
BUNDLE_SHA256 = '45e7392d76bc618b58941b54c143ca4c7b27c0b2bd25e35bfea59a187339ca5c'
NODE_ARCHIVES = {
    'x86_64': ('x64', 'fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6'),
    'aarch64': ('arm64', '6ad1325edbdb5649c379b75a237147a666c95d4f9ae8d340fef2d1575d289ad2')}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def download(url, maximum):
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != 'https' or parsed.username or parsed.password:
        raise RuntimeError('HTTPS_DOWNLOAD_REQUIRED')
    with urllib.request.build_opener(NoRedirect).open(url, timeout=45) as response:
        data = response.read(maximum + 1)
    if len(data) > maximum:
        raise RuntimeError('DOWNLOAD_LIMIT')
    return data


def prepare_tools(source, folder):
    if platform.system() != 'Linux' or platform.machine() not in NODE_ARCHIVES:
        raise RuntimeError('CLOUDSHELL_LINUX_REQUIRED')
    architecture, expected = NODE_ARCHIVES[platform.machine()]
    candidates = [root.parent / 'access-users' / f'node-v24.21.0-linux-{architecture}/bin/node']
    available = shutil.which('node')
    if available:
        candidates.append(Path(available))
    node = None
    for candidate in candidates:
        if candidate.is_file() and subprocess.run(
                [str(candidate), '--version'], capture_output=True, text=True,
                timeout=10).stdout.strip() == 'v24.21.0':
            node = candidate
            break
    if node is None:
        # Only extract the pinned Node executable into /tmp. No npm, full source
        # checkout, or persistent home-directory dependency installation.
        name = f'node-v24.21.0-linux-{architecture}'
        data = download(f'https://nodejs.org/dist/v24.21.0/{name}.tar.xz', 100 * 1024 * 1024)
        if hashlib.sha256(data).hexdigest() != expected:
            raise RuntimeError('NODE_ARCHIVE_HASH_MISMATCH')
        with tarfile.open(fileobj=io.BytesIO(data)) as archive:
            member = archive.getmember(name + '/bin/node')
            if not member.isfile() or member.size > 160 * 1024 * 1024:
                raise RuntimeError('NODE_BINARY_INVALID')
            node = folder / 'node'
            node.write_bytes(archive.extractfile(member).read())
            node.chmod(0o700)
    compressed = download(
        f'https://raw.githubusercontent.com/Known-Enough/known-enough/{source}'
        '/scripts/cloudshell-commands/test-account-admission.mjs.gz', 1024 * 1024)
    if hashlib.sha256(compressed).hexdigest() != BUNDLE_SHA256:
        raise RuntimeError('ADMISSION_BUNDLE_HASH_MISMATCH')
    tool = folder / 'admission.mjs'
    tool.write_bytes(gzip.decompress(compressed))
    return node, tool


def admission(node, tool, folder, mode):
    result = subprocess.run([str(node), str(tool), str(folder), str(state_file), mode],
                            capture_output=True, text=True, timeout=600,
                            env={**os.environ, 'AWS_REGION': REGION, 'AWS_DEFAULT_REGION': REGION,
                                 'AWS_MAX_ATTEMPTS': '1'})
    # The bundled program emits only sanitized results and these owned usernames.
    for line in result.stdout.splitlines():
        value = json.loads(line)
        if not isinstance(value, dict) or not set(value) <= {
                'result', 'username', 'appAccess', 'code', 'operation', 'automaticRetry',
                'count', 'credentialsFile', 'emailSent', 'modelCalls', 'groupsCreated', 'consentGranted'}:
            raise RuntimeError('ADMISSION_OUTPUT_INVALID')
        print(json.dumps(value), flush=True)
    if result.returncode:
        raise RuntimeError('NATIVE_ADMISSION_STOPPED')
    if not result.stdout.strip():
        raise RuntimeError('ADMISSION_RESULT_MISSING')


def aws(service, operation, data):
    # Input over stdin keeps passwords out of process arguments and shell history.
    result = subprocess.run(
        ['aws', service, operation, '--cli-input-json', 'file:///dev/stdin',
         '--region', REGION, '--output', 'json', '--no-cli-pager',
         '--no-paginate', '--cli-connect-timeout', '10', '--cli-read-timeout', '30'],
        input=json.dumps(data), capture_output=True, text=True, timeout=45,
        env={**os.environ, 'AWS_MAX_ATTEMPTS': '1', 'AWS_PAGER': ''})
    if result.returncode:
        match = re.search(r'An error occurred \(([A-Za-z0-9]+)\)', result.stderr)
        code = match.group(1) if match else 'AWS_CLI_FAILED'
        raise RuntimeError(service + ':' + operation + ':' + code)
    return json.loads(result.stdout or '{}')


def save():
    temporary = state_file.with_suffix('.new')
    temporary.write_text(json.dumps(state, indent=2) + '\n')
    temporary.chmod(0o600)
    temporary.replace(state_file)


def main():
    global state, stage, state_file
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--named-fifteen', action='store_true',
                        help='Create test04 through test18 in a separate private batch.')
    args = parser.parse_args()
    if not re.fullmatch('[a-f0-9]{40}', args.source):
        raise RuntimeError('PINNED_SOURCE_REQUIRED')
    names = [f'test{index:02d}' for index in range(4, 19)] if args.named_fifteen else None
    count = 15 if names else 10
    if names:
        state_file = root / 'test04-test18-private.json'
    os.umask(0o077)
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    if root.is_symlink() or state_file.is_symlink():
        raise RuntimeError('PRIVATE_DIRECTORY_REQUIRED')
    root.chmod(0o700)
    with (root / 'create.lock').open('a') as lock, tempfile.TemporaryDirectory(
            prefix='known-enough-account-setup-') as temporary:
        folder = Path(temporary)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if aws('sts', 'get-caller-identity', {}).get('Account') != ACCOUNT:
            raise RuntimeError('WRONG_AWS_ACCOUNT')
        # Reuse only the explicit installed email exception and an existing verified
        # owner mailbox. Do not enable the exception, steal aliases or edit old users.
        function = aws('lambda', 'get-function', {'FunctionName': API})
        config = function['Configuration']
        if (config['FunctionArn'] != f'arn:aws:lambda:{REGION}:{ACCOUNT}:function:{API}'
                or config['Handler'] != 'api.handler'
                or config['Role'] != f'arn:aws:iam::{ACCOUNT}:role/KnownEnoughStageApiRole'):
            raise RuntimeError('UNEXPECTED_API_TARGET')
        location = function['Code']['Location']
        url = urllib.parse.urlparse(location)
        if url.scheme != 'https' or not (url.hostname or '').endswith('.amazonaws.com'):
            raise RuntimeError('UNEXPECTED_PACKAGE_LOCATION')
        package = download(location, 50 * 1024 * 1024)
        if (len(package) > 50 * 1024 * 1024
                or base64.b64encode(hashlib.sha256(package).digest()).decode() != config['CodeSha256']):
            raise RuntimeError('PACKAGE_HASH_MISMATCH')
        with zipfile.ZipFile(io.BytesIO(package)) as archive:
            for name in ['configuration-private.json', 'manifest-private.json', 'release-private.json']:
                if archive.getinfo(name).file_size > 1024 * 1024:
                    raise RuntimeError('CONFIGURATION_LIMIT')
                (folder / name).write_bytes(archive.read(name))
            private = json.loads(archive.read('configuration-private.json'))
        if private.get('userPoolId') != POOL:
            raise RuntimeError('UNEXPECTED_POOL')
        digest = hmac.new(private['emailKey'].encode(), EMAIL.encode(), hashlib.sha256).hexdigest()
        if digest not in private.get('sharedTestEmailHashes', []):
            raise RuntimeError('SHARED_TEST_EMAIL_EXCEPTION_NOT_INSTALLED')
        owners = aws('cognito-idp', 'list-users', {
            'UserPoolId': POOL, 'Filter': 'email = "' + EMAIL + '"', 'Limit': 60})
        if not any(user.get('Enabled') and user.get('UserStatus') == 'CONFIRMED'
                   and {a['Name']: a['Value'] for a in user['Attributes']}.get('email_verified') == 'true'
                   for user in owners.get('Users', [])):
            raise RuntimeError('EXISTING_VERIFIED_OWNER_EMAIL_REQUIRED')

        stage = 'PREPARE_NATIVE_ADMISSION'
        node, tool = prepare_tools(args.source, folder)
        admission(node, tool, folder, 'prepare')
        if state_file.exists():
            state = json.loads(state_file.read_text())
            if (state.get('account') != ACCOUNT or state.get('pool') != POOL
                    or state.get('email') != EMAIL or len(state.get('users', [])) != count
                    or len({u['username'] for u in state['users']}) != count
                    or (names and (state.get('batchKind') != 'NAMED_FIFTEEN'
                                   or [u['username'] for u in state['users']] != names))
                    or any((not names and not re.fullmatch('ke-test-[a-f0-9]{6}-[0-9]{2}', u['username']))
                           or not isinstance(u.get('password'), str) or len(u['password']) < 8
                           for u in state['users'])):
                raise RuntimeError('SAVED_BATCH_INVALID')
            state_file.chmod(0o600)
            print(f'Reusing the saved {count} accounts; no duplicate batch.', flush=True)
        else:
            if names:
                # Check every requested fixed name before the first account write.
                # Never adopt someone else's identity or reset an existing password.
                for username in names:
                    try:
                        aws('cognito-idp', 'admin-get-user', {'UserPoolId': POOL, 'Username': username})
                    except RuntimeError as error:
                        if str(error) == 'cognito-idp:admin-get-user:UserNotFoundException':
                            continue
                        raise
                    raise RuntimeError('REQUESTED_USERNAME_ALREADY_EXISTS:' + username)
            prefix = 'ke-test-' + secrets.token_hex(3)
            state = {'account': ACCOUNT, 'pool': POOL, 'email': EMAIL,
                     'batchKind': 'NAMED_FIFTEEN' if names else 'RANDOM_TEN',
                     'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                     'appAccess': 'NOT_APPROVED', 'users': [
                         {'username': names[index - 1] if names else f'{prefix}-{index:02d}',
                          'password': 'Ke1!' + secrets.token_urlsafe(15), 'status': 'PLANNED'}
                         for index in range(1, count + 1)]}
            save()
        for user in state['users']:
            stage = 'CREATE_LOGIN'
            if user['status'] == 'LOGIN_CREATED':
                observed = aws('cognito-idp', 'admin-get-user', {
                    'UserPoolId': POOL, 'Username': user['username']})
                attrs = {a['Name']: a['Value'] for a in observed['UserAttributes']}
                if (observed['Username'] != user['username'] or not observed.get('Enabled')
                        or observed.get('UserStatus') != 'CONFIRMED' or attrs.get('sub') != user.get('subject')
                        or attrs.get('email') != EMAIL or attrs.get('email_verified') != 'true'):
                    raise RuntimeError('SAVED_LOGIN_IDENTITY_CHANGED')
                continue
            if user['status'] != 'PLANNED':
                raise RuntimeError('PARTIAL_LOGIN_WRITE_NEEDS_REVIEW')
            user['status'] = 'CREATE_REQUESTED'
            save()
            created = aws('cognito-idp', 'admin-create-user', {
                'UserPoolId': POOL, 'Username': user['username'],
                'MessageAction': 'SUPPRESS', 'ForceAliasCreation': False,
                'UserAttributes': [{'Name': 'email', 'Value': EMAIL},
                                   {'Name': 'email_verified', 'Value': 'true'}]})['User']
            if created['Username'] != user['username']:
                raise RuntimeError('CREATED_USERNAME_MISMATCH')
            user['subject'] = next(a['Value'] for a in created['Attributes'] if a['Name'] == 'sub')
            user['status'] = 'PASSWORD_REQUESTED'
            save()
            stage = 'SET_PASSWORD'
            aws('cognito-idp', 'admin-set-user-password', {
                'UserPoolId': POOL, 'Username': user['username'],
                'Password': user['password'], 'Permanent': True})
            observed = aws('cognito-idp', 'admin-get-user', {
                'UserPoolId': POOL, 'Username': user['username']})
            attrs = {a['Name']: a['Value'] for a in observed['UserAttributes']}
            if (not observed.get('Enabled') or observed.get('UserStatus') != 'CONFIRMED'
                    or attrs.get('sub') != user['subject'] or attrs.get('email') != EMAIL
                    or attrs.get('email_verified') != 'true'):
                raise RuntimeError('LOGIN_CONFIGURATION_MISMATCH')
            user['status'] = 'LOGIN_CREATED'
            save()
            print('Created ' + user['username'], flush=True)
        stage = 'REGISTER_AND_APPROVE'
        # Native registration and the existing exact-username operator keep the
        # immutable email claim, profile, version and migration/source guards.
        admission(node, tool, folder, 'approve')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # The native admission process saves its own incremental progress.
        # Never overwrite that file with this process's older in-memory copy.
        safe = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        print(json.dumps({'result': 'ACCOUNT_CREATION_STOPPED', 'stage': stage, 'code': safe,
                          'credentialsFile': str(state_file),
                          'loginsCreated': sum(u['status'] == 'LOGIN_CREATED' for u in (state or {}).get('users', [])),
                          'automaticRetry': False}))
        raise SystemExit(1)
