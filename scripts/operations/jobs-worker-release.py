"""Publish only verified coordinated code to the installed disabled worker; never enables it."""
import base64
import hashlib
import json
import os
import re
import subprocess
import time
from pathlib import Path

ACCOUNT = '092954139775'
FUNCTION = 'known-enough-stage-model-jobs'
OLD_HASH = 'c46b2a7673297281a730105f3a352b2d98da18e2625472572f1e38d2e404fd3e'  # verified 2af publication; tests only


def validate_candidate(report, source, package):
    worker = report['worker']
    sha = worker['sha256']
    if (not re.fullmatch('[a-f0-9]{40}', source) or worker['sourceSha'] != source or report['sourceSha'] != source
            or not re.fullmatch('[a-f0-9]{64}', sha) or worker['workerKey'] != sha + '/model-worker.zip'
            or hashlib.sha256(package).hexdigest() != sha or worker.get('artifactStorage') != 'VERIFIED'):
        raise RuntimeError('WORKER_CANDIDATE_INVALID')
    return sha


def validate_installed(config, rule, new_hash, prior_hash=OLD_HASH, *, before_pause=False):
    if not re.fullmatch(r'[a-f0-9]{64}', prior_hash):
        raise RuntimeError('WORKER_BASELINE_REQUIRED')
    code = base64.b64decode(config.get('CodeSha256', ''), validate=True).hex()
    if (config.get('FunctionName') != FUNCTION or config.get('Role') != f'arn:aws:iam::{ACCOUNT}:role/KnownEnoughModelJobRuntime'
            or config.get('Runtime') != 'nodejs24.x' or config.get('Handler') != 'worker.handler'
            or config.get('Timeout') != 180 or config.get('MemorySize') != 512
            or config.get('Environment', {}).get('Variables', {}) != {} or config.get('State') != 'Active'
            or config.get('LastUpdateStatus') != 'Successful' or not config.get('RevisionId')
            or code not in [prior_hash, new_hash] or rule.get('Name') != 'KnownEnoughModelJobs'
            or rule.get('Arn') != f'arn:aws:events:us-east-1:{ACCOUNT}:rule/KnownEnoughModelJobs'
            or rule.get('State') not in (['DISABLED', 'ENABLED'] if before_pause else ['DISABLED'])
            or rule.get('ScheduleExpression') != 'rate(1 minute)'):
        raise RuntimeError('WORKER_INSTALLED_GUARD_FAILED')
    return code


def main():
    root = Path(os.environ['RUNNER_TEMP'])
    report = {'result': 'WORKER_PUBLICATION_NOT_EXECUTED', 'providerCalls': 0, 'activation': 'NOT_EXECUTED', 'codeWriteRequested': False}
    operation = 'candidate'
    def aws(*args):
        result = subprocess.run(['aws', *args, '--region', 'us-east-1', '--output', 'json', '--no-cli-pager'], capture_output=True, timeout=30)
        if result.returncode:
            code = re.search(rb'\(([A-Za-z0-9]+)\)', result.stderr)
            raise RuntimeError(code.group(1).decode() if code else 'AWS_CLI_FAILED')
        return json.loads(result.stdout)
    try:
        source = os.environ['GITHUB_SHA']
        prepared = json.loads((root/'partition-prepare-report.json').read_text())
        worker = prepared['worker']
        package = root/'coordinated-worker-release-private.zip'
        operation = 'identity'
        identity = aws('sts', 'get-caller-identity')
        if identity.get('Account') != ACCOUNT or not identity.get('Arn', '').startswith(f'arn:aws:sts::{ACCOUNT}:assumed-role/KnownEnoughGithubModelJobRelease/'):
            raise RuntimeError('WORKER_RELEASE_ROLE_INVALID')
        operation = 's3:GetObject'
        aws('s3api', 'get-object', '--bucket', f'known-enough-qa-artifacts-{ACCOUNT}', '--key', worker['workerKey'], str(package))
        sha = validate_candidate(prepared, source, package.read_bytes())
        operation = 'installed-guard'
        config = aws('lambda', 'get-function-configuration', '--function-name', FUNCTION)
        rule = aws('events', 'describe-rule', '--name', 'KnownEnoughModelJobs')
        expected_prior = os.environ.get('PREVIOUS_WORKER_HASH', '')
        report['priorInstalledWorkerSha256'] = base64.b64decode(config.get('CodeSha256', ''), validate=True).hex()
        report['expectedPriorWorkerSha256'] = expected_prior if re.fullmatch(r'[a-f0-9]{64}', expected_prior) else 'NOT_SUPPLIED'
        # The queue has already passed the disabled/empty prepublication guard.
        # Pause only this verified worker's existing schedule before replacing code.
        validate_installed(config, rule, sha, expected_prior, before_pause=True)
        if rule['State'] == 'ENABLED':
            operation = 'events:DisableRule'
            report['schedulePauseRequested'] = True
            aws('events', 'disable-rule', '--name', 'KnownEnoughModelJobs')
            rule = aws('events', 'describe-rule', '--name', 'KnownEnoughModelJobs')
            config = aws('lambda', 'get-function-configuration', '--function-name', FUNCTION)
        prior_hash = validate_installed(config, rule, sha, expected_prior)
        if prior_hash != sha:
            report['codeWriteRequested'] = True
            operation = 'lambda:UpdateFunctionCode'
            try:
                aws('lambda', 'update-function-code', '--function-name', FUNCTION, '--s3-bucket', f'known-enough-qa-artifacts-{ACCOUNT}',
                    '--s3-key', worker['workerKey'], '--revision-id', config['RevisionId'])
            except RuntimeError as error:
                report['writeError'] = str(error)
                # Unknown acknowledgment is reconciled by reads, never a repeated update.
            operation = 'code-readback'
            for attempt in range(12):
                config = aws('lambda', 'get-function-configuration', '--function-name', FUNCTION)
                if config.get('LastUpdateStatus') == 'Successful':
                    break
                time.sleep(2)
        rule = aws('events', 'describe-rule', '--name', 'KnownEnoughModelJobs')
        if validate_installed(config, rule, sha) != sha:
            raise RuntimeError('WORKER_CODE_WRITE_UNCONFIRMED')
        report.update(result='WORKER_CODE_DISABLED_READBACK_PASS', workerSha256=sha,
                      installedWorkerSha256=base64.b64decode(config['CodeSha256'], validate=True).hex(),
                      sourceSha=source, schedule='DISABLED')
    except (RuntimeError, ValueError, KeyError, OSError, subprocess.TimeoutExpired) as error:
        report.update(result='WORKER_PUBLICATION_BLOCKED', operation=operation, code=str(error) if isinstance(error, RuntimeError) else type(error).__name__)
    (root/'partition-worker-publish-report.json').write_text(json.dumps(report)+'\n')
    print(json.dumps(report))
    return 0 if report['result'] == 'WORKER_CODE_DISABLED_READBACK_PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
