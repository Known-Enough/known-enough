"""One bounded private log read; only fixed output validation stages are public."""
import json
import os
import re
import subprocess
from pathlib import Path

STAGES = {'OUTPUT_SHAPE', 'CANDIDATE_SCHEMA', 'CATALOG_MISMATCH', 'KERNEL_STALE',
          'KERNEL_INVALID', 'KERNEL_CLARIFICATION', 'QUESTION_TARGETS', 'QUESTION_SHAPE',
          'QUESTION_ADJUSTMENT', 'QUESTION_COMMIT', 'QUESTION_COUNT'}


def stages_from_logs(events):
    stages = []
    for event in events:
        message = event.get('message', '')
        if not isinstance(message, str) or '{' not in message:
            continue
        try:
            value = json.loads(message[message.find('{'):].strip())
            if (isinstance(value, dict) and set(value) == {'event', 'stage'}
                    and value['event'] == 'model-job-output-invalid'
                    and isinstance(value['stage'], str) and value['stage'] in STAGES):
                stages.append(value['stage'])
        except (ValueError, TypeError):
            continue
    return stages


if __name__ == '__main__':
    root = Path(os.environ['RUNNER_TEMP'])
    intent = root/'owned-jobs-schedule-intent.json'
    report = {'result': 'NOT_EXECUTED', 'stages': [], 'requests': 0, 'providerCalls': 0}
    if intent.exists():
        saved = json.loads(intent.read_text())
        assert saved['packageSource'] == os.environ['PACKAGE_SOURCE']
        assert saved['workerSha'] == os.environ['WORKER_SHA']
        assert type(saved['startMs']) is int and saved['startMs'] > 0
        report['requests'] = 1
        result = subprocess.run(['aws', 'logs', 'filter-log-events', '--log-group-name',
            '/aws/lambda/known-enough-stage-model-jobs', '--start-time', str(saved['startMs']),
            '--filter-pattern', '"model-job-output-invalid"', '--limit', '100', '--no-paginate',
            '--region', 'us-east-1', '--output', 'json', '--no-cli-pager'],
            capture_output=True, text=True, timeout=30)
        if result.returncode:
            match = re.search(r'\(([A-Za-z0-9]+)\)', result.stderr)
            report.update(result='READ_UNVERIFIED', code=match.group(1) if match else 'AWS_CLI_FAILED')
        else:
            response = json.loads(result.stdout)
            report.update(result='FINITE_STAGES_READ', stages=stages_from_logs(response.get('events', [])),
                          truncated=bool(response.get('nextToken')))
    (root/'owned-jobs-output-diagnostic-report.json').write_text(json.dumps(report)+'\n')
