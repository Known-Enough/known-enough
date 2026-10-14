"""Bounded installed worker readback. Never writes, invokes, or emits environment/log bytes."""
import base64
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path

ACCOUNT = '092954139775'
REGION = 'us-east-1'
FUNCTION = 'known-enough-stage-model-jobs'
RULE = 'KnownEnoughModelJobs'
EXPECTED_SHA = 'a123823764f35df6abdc09a288d1c26962ed76f94b6956c7e77bf89ef6cc2214'


def validate(config, rule, package):
    checks = {
        'codeHash': config.get('CodeSha256') == base64.b64encode(bytes.fromhex(EXPECTED_SHA)).decode(),
        'artifactHash': hashlib.sha256(package).hexdigest() == EXPECTED_SHA,
        'function': config.get('FunctionName') == FUNCTION,
        'runtime': config.get('Runtime') == 'nodejs24.x',
        'handler': config.get('Handler') == 'worker.handler',
        'role': config.get('Role') == f'arn:aws:iam::{ACCOUNT}:role/KnownEnoughModelJobRuntime',
        'timeout': config.get('Timeout') == 180,
        'memory': config.get('MemorySize') == 512,
        'state': config.get('State') == 'Active' and config.get('LastUpdateStatus') == 'Successful',
        'environment': config.get('Environment', {}).get('Variables', {}) == {},
        'rule': rule.get('Name') == RULE and rule.get('Arn') == f'arn:aws:events:{REGION}:{ACCOUNT}:rule/{RULE}',
        'schedule': rule.get('ScheduleExpression') == 'rate(1 minute)' and rule.get('State') == 'DISABLED',
    }
    return {'result': 'INSTALLED_WORKER_READBACK_PASS' if all(checks.values()) else 'INSTALLED_WORKER_MISMATCH',
            'checks': checks, 'workerSha256': EXPECTED_SHA,
            'installedCodeSha256': base64.b64decode(config.get('CodeSha256', '')).hex() if re.fullmatch(r'[A-Za-z0-9+/]{43}=', config.get('CodeSha256', '')) else 'UNKNOWN',
            'artifactSha256': hashlib.sha256(package).hexdigest(), 'packageSource': '9a27a99f20b1462183e8843ca9960bd53feed57b',
            'mutations': 0, 'providerCalls': 0, 'effectiveRuntimePermissions': 'NOT_EXECUTED',
            'reservedConcurrency': 'NOT_READ', 'targetBinding': 'NOT_READ'}


def main():
    report_path = Path(os.environ['RUNNER_TEMP']) / 'jobs-runtime-readback.json'
    operation = 'identity'
    def aws(*args):
        result = subprocess.run(['aws', *args, '--region', REGION, '--output', 'json', '--no-cli-pager'],
                                capture_output=True, timeout=30, check=False)
        if result.returncode:
            match = re.search(rb'\(([A-Za-z0-9]+)\)', result.stderr)
            raise RuntimeError(match.group(1).decode() if match else 'AWS_CLI_FAILED')
        return json.loads(result.stdout)
    try:
        identity = aws('sts', 'get-caller-identity')
        if identity.get('Account') != ACCOUNT or not identity.get('Arn', '').startswith(f'arn:aws:sts::{ACCOUNT}:assumed-role/KnownEnoughGithubModelJobRelease/'):
            raise RuntimeError('WORKER_ROLE_INVALID')
        operation = 'lambda:GetFunctionConfiguration'
        config = aws('lambda', 'get-function-configuration', '--function-name', FUNCTION)
        operation = 'events:DescribeRule'
        rule = aws('events', 'describe-rule', '--name', RULE)
        operation = 's3:GetObject'
        package = Path(os.environ['RUNNER_TEMP']) / 'installed-worker-private.zip'
        aws('s3api', 'get-object', '--bucket', f'known-enough-qa-artifacts-{ACCOUNT}', '--key', EXPECTED_SHA + '/model-worker.zip', str(package))
        report = validate(config, rule, package.read_bytes())
    except (RuntimeError, subprocess.TimeoutExpired, ValueError, OSError) as error:
        code = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        report = {'result': 'INSTALLED_WORKER_READBACK_BLOCKED', 'operation': operation, 'code': code,
                  'mutations': 0, 'providerCalls': 0}
    report['sourceSha'] = os.environ['GITHUB_SHA']
    report_path.write_text(json.dumps(report) + '\n')
    print(json.dumps(report))
    return 0 if report['result'] == 'INSTALLED_WORKER_READBACK_PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
