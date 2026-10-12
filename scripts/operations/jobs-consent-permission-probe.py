"""Two fixed, contradictory-condition transactions: no writes can commit."""
import json
import os
import re
import subprocess
import uuid
from pathlib import Path
ACCOUNT = '092954139775'
TABLE = f'arn:aws:dynamodb:us-east-1:{ACCOUNT}:table/KnownEnoughStage'
CONTRADICTION = 'attribute_exists(#pk) AND attribute_not_exists(#pk)'


def transaction(probe, corrected):
    if str(uuid.UUID(probe)) != probe:
        raise ValueError('PROBE_UUID_INVALID')
    key = {'PK': {'S': 'ROOM#' + probe}, 'SK': {'S': 'GUARD'}}
    guard = {'TableName': TABLE, 'ConditionExpression': CONTRADICTION, 'ExpressionAttributeNames': {'#pk': 'PK'}}
    if corrected:
        guard['Item'] = {**key, 'version': {'N': '1'}}
    else:
        guard.update(Key=key, UpdateExpression='SET #version = :next',
                     ExpressionAttributeNames={'#pk': 'PK', '#version': 'version'},
                     ExpressionAttributeValues={':next': {'N': '1'}})
    return [{'Put': {'TableName': TABLE, 'Item': {'PK': key['PK'], 'SK': {'S': 'STATE'}},
                     'ConditionExpression': CONTRADICTION, 'ExpressionAttributeNames': {'#pk': 'PK'}}},
            {'Put' if corrected else 'Update': guard}]


def outcome(stderr):
    # Never publish arbitrary AWS text, account/session identifiers or item values.
    code = re.search(r'\(([A-Za-z0-9]+)\)', stderr)
    action = re.search(r'perform:\s*(dynamodb:UpdateItem)\b', stderr)
    return {'code': code.group(1) if code and code.group(1) in ['AccessDeniedException', 'TransactionCanceledException', 'ValidationException'] else 'AWS_PROBE_FAILED',
            'deniedAction': action.group(1) if action else None,
            'conditionalFailures': stderr.count('ConditionalCheckFailed')}


def main():
    report = {'result': 'CONSENT_PERMISSION_PROBE_BLOCKED', 'mutations': 0, 'signup': 0, 'providerCalls': 0,
              'fullConsent': 'NOT_EXECUTED', 'sourceSha': os.environ['GITHUB_SHA']}
    operation = 'sts:GetCallerIdentity'
    try:
        identity = subprocess.run(['aws', 'sts', 'get-caller-identity', '--output', 'json', '--no-cli-pager'],
                                  capture_output=True, timeout=30, check=True)
        owner = json.loads(identity.stdout)
        if owner.get('Account') != ACCOUNT or not owner.get('Arn', '').startswith(
                f'arn:aws:sts::{ACCOUNT}:assumed-role/KnownEnoughGithubModelJobOperations/'):
            raise RuntimeError('OWN_JOB_ROLE_REQUIRED')
        probe = str(uuid.uuid4())
        results = []
        for corrected in [False, True]:
            operation = 'dynamodb:TransactWriteItems'
            result = subprocess.run(['aws', 'dynamodb', 'transact-write-items', '--transact-items',
                                     json.dumps(transaction(probe, corrected)), '--region', 'us-east-1', '--no-cli-pager'],
                                    capture_output=True, timeout=30)
            if result.returncode == 0:
                raise RuntimeError('IMPOSSIBLE_TRANSACTION_ACCEPTED')
            results.append(outcome(result.stderr.decode('utf-8', errors='replace')))
        report.update(original=results[0], corrected=results[1], transactionRequests=2)
        if results[0]['code'] != 'AccessDeniedException' or results[0]['deniedAction'] != 'dynamodb:UpdateItem':
            raise RuntimeError('ORIGINAL_DENIED_OPERATION_NOT_PROVEN')
        if results[1]['code'] != 'TransactionCanceledException' or results[1]['conditionalFailures'] != 2:
            raise RuntimeError('CORRECTED_PERMISSION_NOT_PROVEN')
        report['result'] = 'CONSENT_GUARD_EFFECTIVE_PERMISSION_PASS'
    except (RuntimeError, ValueError, OSError, subprocess.SubprocessError) as error:
        code = str(error) if isinstance(error, RuntimeError) else 'PROBE_REQUEST_FAILED'
        report.update(operation=operation, code=code if re.fullmatch('[A-Z_]{1,80}', code) else 'PROBE_REQUEST_FAILED')
    (Path(os.environ['RUNNER_TEMP']) / 'consent-permission-probe-report.json').write_text(json.dumps(report) + '\n')
    print(json.dumps(report))
    return 0 if report['result'] == 'CONSENT_GUARD_EFFECTIVE_PERMISSION_PASS' else 1


if __name__ == '__main__': raise SystemExit(main())
