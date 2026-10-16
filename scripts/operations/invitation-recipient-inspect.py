"""Read one hashed username's provider/account/directory consistency; export no identity values."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

ACCOUNT = '092954139775'
POOL = 'us-east-1_V9OMjd0zx'
report = {'source': os.environ['EXPECTED_SOURCE'], 'observedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'awsWrites': 0, 'providerCalls': 0, 'providerIdentityReads': 0, 'checks': {}}


def aws(service, action, *args):
    result = subprocess.run(['aws', service, action, *args, '--region', 'us-east-1', '--output', 'json',
                             '--no-cli-pager', '--no-paginate'], capture_output=True, text=True, timeout=25,
                            env={**os.environ, 'AWS_MAX_ATTEMPTS': '1'})
    if result.returncode:
        code = re.search(r'An error occurred \(([A-Za-z0-9]+)\)', result.stderr or '')
        raise RuntimeError(service + ':' + action + '/' + (code.group(1) if code else 'AWS_READ_UNAVAILABLE'))
    return json.loads(result.stdout or '{}')


def row(pk, sk):
    value = aws('dynamodb', 'get-item', '--table-name', 'KnownEnoughPartitions', '--consistent-read',
                '--key', json.dumps({'PK': {'S': pk}, 'SK': {'S': sk}})).get('Item')
    return json.loads(value['payload']['S']) if value else None


try:
    hashed = os.environ.get('RECIPIENT_USERNAME_SHA256', '')
    if not re.fullmatch('[a-f0-9]{64}', hashed):
        raise RuntimeError('INVALID_USERNAME_HASH')
    identity = aws('sts', 'get-caller-identity')
    if identity.get('Account') != ACCOUNT or not identity.get('Arn', '').startswith(
            f'arn:aws:sts::{ACCOUNT}:assumed-role/KnownEnoughGithubPartitionMigration/'):
        raise RuntimeError('OWN_ROLE_TARGET_INVALID')
    matches, token = [], None
    for _ in range(8):
        args = ['--user-pool-id', POOL, '--limit', '60']
        if token:
            args += ['--pagination-token', token]
        page = aws('cognito-idp', 'list-users', *args)
        report['providerIdentityReads'] += 1
        matches += [user for user in page.get('Users', []) if isinstance(user.get('Username'), str)
                    and hashlib.sha256(user['Username'].strip().lower().encode()).hexdigest() == hashed]
        token = page.get('PaginationToken')
        if not token:
            break
    if token or len(matches) > 1:
        raise RuntimeError('PROVIDER_LOOKUP_INCOMPLETE_OR_AMBIGUOUS')
    report['checks']['providerAccountPresent'] = bool(matches)
    if matches:
        user = aws('cognito-idp', 'admin-get-user', '--user-pool-id', POOL, '--username', matches[0]['Username'])
        report['providerIdentityReads'] += 1
        attrs = {item['Name']: item['Value'] for item in user.get('UserAttributes', [])}
        subject = attrs.get('sub', '')
        if not re.fullmatch('[A-Za-z0-9_-]{1,80}', subject):
            raise RuntimeError('PROVIDER_IDENTITY_INVALID')
        report['checks'].update(providerConfirmed=user.get('UserStatus') == 'CONFIRMED',
                                providerEnabled=user.get('Enabled') is True, emailVerified=attrs.get('email_verified') == 'true')
        account = row('ACCOUNT#' + subject, 'STATE')
        report['checks']['appAccountPresent'] = account is not None
        if account:
            value = account['value']
            if account.get('kind') != 'ACCOUNT' or value.get('subject') != subject:
                raise RuntimeError('APP_IDENTITY_MISMATCH')
            status = value.get('status')
            report['checks']['appAccountStatus'] = status if status in {'PENDING', 'APPROVED', 'DISABLED', 'REJECTED'} else 'UNKNOWN'
            saved = value.get('profile', {}).get('loginUsername')
            report['checks']['savedLoginUsernamePresent'] = isinstance(saved, str) and bool(saved)
            report['checks']['savedLoginUsernameMatches'] = isinstance(saved, str) and hashlib.sha256(saved.strip().lower().encode()).hexdigest() == hashed
        try:
            claim = row('USERNAME#' + hashed, 'CLAIM')
            report['checks']['usernameDirectoryPresent'] = claim is not None
            report['checks']['usernameDirectoryMatches'] = bool(claim and account and claim.get('kind') == 'DIRECTORY'
                and claim['value'].get('type') == 'USERNAME' and claim['value'].get('usernameHash') == hashed
                and claim['value'].get('subject') == subject and claim['value'].get('emailHash') == account['value'].get('emailHash'))
        except RuntimeError as error:
            report['checks']['usernameDirectoryRead'] = str(error)
            # The installed operator may lack the newer USERNAME key fence. Its existing
            # key-only catalog can establish absence without exporting any account data.
            if str(error) == 'dynamodb:get-item/AccessDeniedException':
                token, found = None, False
                for _ in range(5):
                    args = ['--table-name', 'KnownEnoughPartitions', '--projection-expression', 'PK,SK',
                            '--select', 'SPECIFIC_ATTRIBUTES', '--filter-expression', 'PK = :pk AND SK = :sk',
                            '--expression-attribute-values', json.dumps({':pk': {'S': 'USERNAME#' + hashed}, ':sk': {'S': 'CLAIM'}}),
                            '--consistent-read', '--limit', '1000']
                    if token:
                        args += ['--exclusive-start-key', json.dumps(token)]
                    page = aws('dynamodb', 'scan', *args)
                    found = found or bool(page.get('Items'))
                    token = page.get('LastEvaluatedKey')
                    if not token:
                        report['checks']['usernameDirectoryPresent'] = found
                        report['checks']['usernameDirectoryCatalogComplete'] = True
                        break
                else:
                    report['checks']['usernameDirectoryCatalogComplete'] = False
    report['result'] = 'INVITATION_RECIPIENT_INSPECTED'
except (RuntimeError, OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
    report.update(result='READBACK_UNAVAILABLE', code=str(error) if isinstance(error, RuntimeError) else type(error).__name__)
finally:
    (Path(os.environ['RUNNER_TEMP']) / 'invitation-recipient-inspect.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))
raise SystemExit(0 if report['result'] == 'INVITATION_RECIPIENT_INSPECTED' else 1)
