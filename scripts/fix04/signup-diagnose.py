"""Bounded read-only signup diagnosis; exports counts/categories, never identities or log messages."""
import base64
import datetime
import hashlib
import hmac
import io
import json
import os
import pathlib
import re
import subprocess
import sys
import urllib.parse
import urllib.request
import zipfile

os.umask(0o077)

ACCOUNT = '092954139775'
POOL = 'us-east-1_V9OMjd0zx'
FUNCTION = 'known-enough-stage-api'
ROOT = pathlib.Path(os.environ['RUNNER_TEMP'])
REPORT = ROOT / 'fix04-signup-diagnosis.json'
report = json.loads(REPORT.read_text()) if REPORT.exists() else {
    'source': os.environ['EXPECTED_SOURCE'], 'writes': 0, 'messagesExported': 0,
    'observedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'checks': {}}


def aws(*args):
    result = subprocess.run(['aws', *args, '--region', 'us-east-1', '--output', 'json',
                             '--no-cli-pager', '--no-paginate'], capture_output=True, text=True,
                            timeout=30, env={**os.environ, 'AWS_MAX_ATTEMPTS': '1'})
    if result.returncode:
        code = re.search(r'An error occurred \((\w+)\)', result.stderr)
        raise RuntimeError(args[0] + ':' + args[1] + '/' + (code.group(1) if code else 'AWS_READ_FAILED'))
    return json.loads(result.stdout or '{}')


def row(pk, sk):
    result = aws('dynamodb', 'get-item', '--table-name', 'KnownEnoughPartitions', '--consistent-read',
                 '--key', json.dumps({'PK': {'S': pk}, 'SK': {'S': sk}}))
    item = result.get('Item')
    return json.loads(item['payload']['S']) if item else None


try:
    if aws('sts', 'get-caller-identity').get('Account') != ACCOUNT:
        raise RuntimeError('WRONG_ACCOUNT')
    phase = sys.argv[1]
    if phase == 'package':
        result = aws('lambda', 'get-function', '--function-name', FUNCTION)
        config = result['Configuration']
        if config['Handler'] != 'api.handler' or config['FunctionArn'] != f'arn:aws:lambda:us-east-1:{ACCOUNT}:function:{FUNCTION}':
            raise RuntimeError('NATIVE_PACKAGE_MISMATCH')
        url = urllib.parse.urlparse(result['Code']['Location'])
        if url.scheme != 'https' or not url.hostname.endswith('.amazonaws.com'):
            raise RuntimeError('DOWNLOAD_TARGET_INVALID')
        with urllib.request.urlopen(result['Code']['Location'], timeout=30) as response:
            data = response.read(50 * 1024 * 1024 + 1)
        if len(data) > 50 * 1024 * 1024 or base64.b64encode(hashlib.sha256(data).digest()).decode() != config['CodeSha256']:
            raise RuntimeError('NATIVE_PACKAGE_HASH_MISMATCH')
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            settings = archive.read('configuration-private.json')
        private = ROOT / 'fix04-signup-configuration-private.json'
        private.write_bytes(settings)
        private.chmod(0o600)
        report['checks']['apiHash'] = hashlib.sha256(data).hexdigest()
    elif phase == 'identity':
        settings = json.loads((ROOT / 'fix04-signup-configuration-private.json').read_text())
        if settings['account'] != ACCOUNT or settings['userPoolId'] != POOL or len(settings['emailKey']) < 32:
            raise RuntimeError('PRIVATE_CONFIGURATION_MISMATCH')
        users, token = [], None
        floor = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=1)
        for _ in range(20):
            args = ['cognito-idp', 'list-users', '--user-pool-id', POOL, '--limit', '60']
            if token:
                args += ['--pagination-token', token]
            page = aws(*args)
            users += [user for user in page['Users'] if datetime.datetime.fromisoformat(user['UserCreateDate'].replace('Z', '+00:00')) >= floor]
            token = page.get('PaginationToken')
            if not token:
                break
        else:
            raise RuntimeError('PROVIDER_PAGE_LIMIT')
        counts = {'recentConfirmedVerified': 0, 'missingNativeAccount': 0,
                  'missingWithOtherEmailOwner': 0, 'missingWithSameEmailOwner': 0,
                  'missingWithoutEmailClaim': 0, 'existingEmailOwnerStatus': {}}
        for user in users:
            attrs = {item['Name']: item['Value'] for item in user['Attributes']}
            if user.get('UserStatus') != 'CONFIRMED' or attrs.get('email_verified') != 'true':
                continue
            subject = attrs['sub']
            if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', subject):
                raise RuntimeError('IDENTITY_INVALID')
            counts['recentConfirmedVerified'] += 1
            if row('ACCOUNT#' + subject, 'STATE'):
                continue
            counts['missingNativeAccount'] += 1
            digest = hmac.new(settings['emailKey'].encode(), attrs['email'].strip().lower().encode(), hashlib.sha256).hexdigest()
            claim = row('EMAIL#' + digest, 'CLAIM')
            if not claim:
                counts['missingWithoutEmailClaim'] += 1
            elif claim['value']['subject'] == subject:
                counts['missingWithSameEmailOwner'] += 1
            else:
                counts['missingWithOtherEmailOwner'] += 1
                owner = row('ACCOUNT#' + claim['value']['subject'], 'STATE')
                status = owner['value']['status'] if owner else 'ABSENT'
                status = status if status in ['PENDING', 'APPROVED', 'REJECTED', 'DISABLED', 'ABSENT'] else 'UNKNOWN'
                counts['existingEmailOwnerStatus'][status] = counts['existingEmailOwnerStatus'].get(status, 0) + 1
        report['checks']['intake'] = counts
    elif phase == 'logs':
        start = int(datetime.datetime.fromisoformat('2026-10-14T16:25:00+00:00').timestamp() * 1000)
        end = int(datetime.datetime.fromisoformat('2026-10-14T16:35:00+00:00').timestamp() * 1000)
        logs = aws('logs', 'filter-log-events', '--log-group-name', '/aws/lambda/' + FUNCTION,
                   '--start-time', str(start), '--end-time', str(end), '--limit', '200')
        markers = ['SIGNUP_INTAKE_UNAVAILABLE', 'SIGNUP_EVENT_INVALID', 'AccessDeniedException',
                   'Task timed out', 'Runtime.ImportModuleError', 'PARTITION_IDENTITY_CONFLICT', 'FORBIDDEN']
        report['checks']['logs'] = {'eventCount': len(logs.get('events', [])),
            'truncated': bool(logs.get('nextToken')),
            'markers': [marker for marker in markers if any(marker in item.get('message', '') for item in logs.get('events', []))]}
    else:
        raise RuntimeError('PHASE_INVALID')
    report['result'] = 'SIGNUP_DIAGNOSIS_READ_PASS'
except Exception as error:
    report['result'] = 'BLOCKED'
    report['error'] = str(error) if isinstance(error, RuntimeError) else type(error).__name__
finally:
    REPORT.write_text(json.dumps(report, indent=2))
    print(json.dumps(report))
if report['result'] == 'BLOCKED':
    raise SystemExit(1)
