"""Fixed own-job-role read probe: random absent keys, no writes/provider/fixtures."""
import json
import os
import re
import subprocess
import uuid
from pathlib import Path
ACCOUNT = '092954139775'
TABLE = 'KnownEnoughPartitions'


def probe(aws, nonce):
    if str(uuid.UUID(nonce)) != nonce:
        raise ValueError('PROBE_UUID_INVALID')
    report = {'result': 'GROUP_READ_PROBE_BLOCKED', 'mutations': 0, 'signup': 0, 'providerCalls': 0}
    operation = 'sts:GetCallerIdentity'
    try:
        identity = aws('sts', 'get-caller-identity')
        if identity.get('Account') != ACCOUNT or not identity.get('Arn', '').startswith(
                f'arn:aws:sts::{ACCOUNT}:assumed-role/KnownEnoughGithubModelJobOperations/'):
            raise RuntimeError('OWN_JOB_ROLE_REQUIRED')
        keys = [{'PK': {'S': 'ACCOUNT#' + nonce}, 'SK': {'S': 'STATE'}},
                {'PK': {'S': 'GROUP#' + nonce}, 'SK': {'S': 'STATE'}}]
        operation = 'dynamodb:BatchGetItem'
        try:
            aws('dynamodb', 'batch-get-item', '--request-items', json.dumps({TABLE: {'Keys': keys, 'ConsistentRead': True}}))
            raise RuntimeError('BATCH_GET_DENIAL_NOT_OBSERVED')
        except RuntimeError as error:
            if str(error) != 'AccessDeniedException_dynamodb_BatchGetItem':
                raise
        report['deniedAction'] = 'dynamodb:BatchGetItem'
        report['deniedCode'] = 'AccessDeniedException'
        operation = 'dynamodb:GetItem'
        for key in keys:
            value = aws('dynamodb', 'get-item', '--table-name', TABLE, '--key', json.dumps(key), '--consistent-read')
            if value.get('Item'):
                raise RuntimeError('PROBE_KEY_COLLISION')
        report.update(result='SCOPED_GET_PERMISSION_PASS', scopedGetReads=2, absentProbeKeys=2)
    except (RuntimeError, ValueError, KeyError) as error:
        report.update(operation=operation, code=str(error) if isinstance(error, RuntimeError) else type(error).__name__)
    return report


def main():
    def aws(*args):
        result = subprocess.run(['aws', *args, '--region', 'us-east-1', '--output', 'json', '--no-cli-pager'],
                                capture_output=True, timeout=30)
        if result.returncode:
            match = re.search(rb'\(([A-Za-z0-9]+)\)', result.stderr)
            if match and match.group(1) == b'AccessDeniedException' and re.search(rb'perform:\s*dynamodb:BatchGetItem\b', result.stderr):
                raise RuntimeError('AccessDeniedException_dynamodb_BatchGetItem')
            raise RuntimeError(match.group(1).decode() if match else 'AWS_REQUEST_FAILED')
        return json.loads(result.stdout or b'{}')
    try:
        report = probe(aws, str(uuid.uuid4()))
    except (OSError, subprocess.TimeoutExpired):
        report = {'result': 'GROUP_READ_PROBE_BLOCKED', 'code': 'PROBE_REQUEST_UNAVAILABLE', 'mutations': 0}
    report['sourceSha'] = os.environ['GITHUB_SHA']
    (Path(os.environ['RUNNER_TEMP']) / 'group-read-probe-report.json').write_text(json.dumps(report) + '\n')
    print(json.dumps(report))
    return 0 if report['result'] == 'SCOPED_GET_PERMISSION_PASS' else 1


if __name__ == '__main__': raise SystemExit(main())
