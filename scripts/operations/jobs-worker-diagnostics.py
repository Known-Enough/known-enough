"""Read a bounded fixed worker window; emit only finite stages, counters and durations."""
import base64
import json
import os
import re
import subprocess
import time
from pathlib import Path

COUNTS = {'discovered', 'attempted', 'applied', 'skipped', 'retry', 'dead', 'failed', 'deferred'}
STAGES = {'OUTPUT_SHAPE', 'CANDIDATE_SCHEMA', 'CATALOG_MISMATCH', 'KERNEL_STALE', 'KERNEL_INVALID', 'KERNEL_CLARIFICATION', 'QUESTION_TARGETS', 'QUESTION_SHAPE', 'QUESTION_ADJUSTMENT', 'QUESTION_COMMIT', 'QUESTION_COUNT'}
FAILURE_STAGES = {'RELOAD_INPUT', 'RESERVE', 'PRE_DISPATCH', 'CALL', 'RELOAD_RESULT', 'PREPARE', 'COMMIT_RESULT'}
FAILURE_CODES = {'INVALID', 'CONFLICT', 'CAPACITY', 'STALE', 'DISABLED', 'BUDGET', 'RETRYABLE', 'INVALID_OUTPUT', 'PROVIDER_REJECTED', 'TYPE_ERROR', 'SCHEMA', 'UNCLASSIFIED'}


def finite_events(events):
    output = []
    for event in events:
        message = event.get('message', '')
        if not isinstance(message, str):
            continue
        duration = re.search(r'^REPORT RequestId: [a-f0-9-]{36}\s+Duration: ([0-9.]+) ms', message)
        if duration:
            output.append({'event': 'duration', 'timestamp': event.get('timestamp'), 'durationMs': float(duration[1])})
        if '{' not in message:
            continue
        try:
            value = json.loads(message[message.find('{'):].strip())
            if isinstance(value, dict) and set(value) == {'event', 'stage'} and value.get('event') == 'model-job-output-invalid' and value.get('stage') in STAGES:
                output.append({'timestamp': event.get('timestamp'), **value})
            if isinstance(value, dict) and set(value) == COUNTS | {'event'} and value.get('event') == 'model-job-run' and all(type(value[k]) is int and 0 <= value[k] <= 64 for k in COUNTS):
                output.append({'timestamp': event.get('timestamp'), **value})
            if isinstance(value, dict) and set(value) == {'event', 'stage', 'code', 'providerResponded'} and value.get('event') == 'model-job-failure' and value.get('stage') in FAILURE_STAGES and value.get('code') in FAILURE_CODES and type(value.get('providerResponded')) is bool:
                output.append({'timestamp': event.get('timestamp'), **value})
        except (ValueError, TypeError):
            pass
    return output


def main():
    report = {'result': 'WORKER_DIAGNOSTIC_UNVERIFIED', 'mutations': 0, 'providerCalls': 0}
    def aws(*args):
        r = subprocess.run(['aws', *args, '--region', 'us-east-1', '--output', 'json', '--no-cli-pager'], capture_output=True, timeout=30)
        if r.returncode:
            match = re.search(rb'\(([A-Za-z0-9]+)\)', r.stderr)
            raise RuntimeError(match[1].decode() if match else 'AWS_CLI_FAILED')
        return json.loads(r.stdout)
    try:
        start = int(os.environ['DIAGNOSTIC_START_MS']); end = min(int(time.time()*1000), start + 600000)
        sha = os.environ['EXPECTED_WORKER_SHA256']
        if not re.fullmatch('[a-f0-9]{64}', sha) or not 0 < end-start <= 600000 or end-start < 1000:
            raise RuntimeError('DIAGNOSTIC_WINDOW_INVALID')
        identity = aws('sts', 'get-caller-identity')
        if identity.get('Account') != '092954139775' or not identity.get('Arn', '').startswith('arn:aws:sts::092954139775:assumed-role/KnownEnoughGithubModelJobRelease/'):
            raise RuntimeError('DIAGNOSTIC_IDENTITY_INVALID')
        config = aws('lambda', 'get-function-configuration', '--function-name', 'known-enough-stage-model-jobs')
        if config.get('CodeSha256') != base64.b64encode(bytes.fromhex(sha)).decode() or config.get('LastUpdateStatus') != 'Successful':
            raise RuntimeError('DIAGNOSTIC_WORKER_CHANGED')
        logs = aws('logs', 'filter-log-events', '--log-group-name', '/aws/lambda/known-enough-stage-model-jobs', '--start-time', str(start), '--end-time', str(end), '--limit', '100', '--no-paginate')
        report.update(result='FINITE_WORKER_DIAGNOSTIC_READ', workerSha256=sha, startMs=start, endMs=end, events=finite_events(logs.get('events', [])), truncated=bool(logs.get('nextToken')))
    except (RuntimeError, ValueError, OSError, subprocess.TimeoutExpired) as error:
        report['code'] = str(error) if isinstance(error, RuntimeError) else type(error).__name__
    (Path(os.environ['RUNNER_TEMP'])/'jobs-worker-diagnostic.json').write_text(json.dumps(report)+'\n')
    return 0 if report['result'] == 'FINITE_WORKER_DIAGNOSTIC_READ' else 1


if __name__ == '__main__':
    raise SystemExit(main())
