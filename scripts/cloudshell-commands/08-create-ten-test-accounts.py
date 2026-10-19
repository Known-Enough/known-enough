#!/usr/bin/env python3
"""Create ten dedicated Cognito logins; app admission remains a separate action."""
import datetime
import fcntl
import hashlib
import hmac
import io
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
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
    global state, stage
    os.umask(0o077)
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    if root.is_symlink() or state_file.is_symlink():
        raise RuntimeError('PRIVATE_DIRECTORY_REQUIRED')
    root.chmod(0o700)
    with (root / 'create.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if aws('sts', 'get-caller-identity', {}).get('Account') != ACCOUNT:
            raise RuntimeError('WRONG_AWS_ACCOUNT')
        if state_file.exists():
            existing = json.loads(state_file.read_text())
            ready = sum(user.get('status') == 'LOGIN_CREATED' for user in existing['users'])
            print(json.dumps({'result': 'SAVED_BATCH_EXISTS', 'loginsCreated': ready,
                              'credentialsFile': str(state_file), 'newAccountsCreated': 0,
                              'next': 'Use the saved batch; partial work must be reviewed, not recreated.'}))
            return

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
        # Refuse redirects rather than forwarding a private signed package URL.
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                return None
        with urllib.request.build_opener(NoRedirect).open(location, timeout=30) as response:
            package = response.read(50 * 1024 * 1024 + 1)
        import base64
        if (len(package) > 50 * 1024 * 1024
                or base64.b64encode(hashlib.sha256(package).digest()).decode() != config['CodeSha256']):
            raise RuntimeError('PACKAGE_HASH_MISMATCH')
        with zipfile.ZipFile(io.BytesIO(package)) as archive:
            if archive.getinfo('configuration-private.json').file_size > 1024 * 1024:
                raise RuntimeError('CONFIGURATION_LIMIT')
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

        prefix = 'ke-test-' + secrets.token_hex(3)
        state = {'account': ACCOUNT, 'pool': POOL, 'email': EMAIL,
                 'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                 'appAccess': 'NOT_APPROVED', 'users': [
                     {'username': f'{prefix}-{index:02d}',
                      'password': 'Ke1!' + secrets.token_urlsafe(15), 'status': 'PLANNED'}
                     for index in range(1, 11)]}
        save()
        for user in state['users']:
            stage = 'CREATE_LOGIN'
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
        print(json.dumps({'result': 'TEN_TEST_LOGINS_CREATED', 'count': 10,
                          'credentialsFile': str(state_file), 'emailSent': False,
                          'appAccess': 'NOT_APPROVED',
                          'next': 'Sign in once per user, then approve these exact usernames with the account tool.'}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        safe = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        print(json.dumps({'result': 'ACCOUNT_CREATION_STOPPED', 'stage': stage, 'code': safe,
                          'credentialsFile': str(state_file),
                          'loginsCreated': sum(u['status'] == 'LOGIN_CREATED' for u in (state or {}).get('users', [])),
                          'automaticRetry': False}))
        raise SystemExit(1)
