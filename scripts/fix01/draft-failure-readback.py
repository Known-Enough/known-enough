"""Read only recent finite draft rejection stages. Never export raw log content."""
import datetime
import json
import os
import re
import subprocess
from pathlib import Path

ACCOUNT = '092954139775'
ROLE = 'KnownEnoughGithubStagingInspector'
output = Path(os.environ['RUNNER_TEMP']) / 'draft-failure-readback.json'
report = {'source': os.environ['EXPECTED_SOURCE'], 'awsWrites': 0, 'providerCalls': 0,
          'requestReferenceCorrelation': 'UNAVAILABLE_NOT_LOGGED', 'failures': []}

def aws(*args):
    result = subprocess.run(['aws', *args, '--region', 'us-east-1', '--output', 'json',
                             '--no-cli-pager'], capture_output=True, text=True, timeout=30)
    if result.returncode:
        match = re.search(r'An error occurred \(([A-Za-z0-9]+)\)', result.stderr)
        raise RuntimeError(match.group(1) if match else 'AWS_READ_UNAVAILABLE')
    return json.loads(result.stdout)

try:
    identity = aws('sts', 'get-caller-identity')
    if identity.get('Account') != ACCOUNT or not identity.get('Arn', '').startswith(
            f'arn:aws:sts::{ACCOUNT}:assumed-role/{ROLE}/'):
        raise RuntimeError('OWN_TARGET_IDENTITY_INVALID')
    stages = set(re.findall(r"'([A-Z_]+)'", Path('packages/application/src/model-runtime.ts')
                           .read_text().split('] as const;', 1)[0]))
    end = int(datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000)
    report['windowStart'] = end - 3600000
    report['windowEnd'] = end
    token = None
    for _ in range(3):
        args = ['logs', 'filter-log-events', '--log-group-name', '/aws/lambda/known-enough-stage-api',
                '--start-time', str(end - 3600000), '--end-time', str(end),
                '--filter-pattern', '"FIX01_PUBLIC_DRAFT_FAILURE"', '--limit', '100', '--no-paginate']
        if token:
            args += ['--next-token', token]
        page = aws(*args)
        for event in page.get('events', []):
            message = event.get('message', '')
            try:
                value = json.loads(message[message.index('{'):].strip())
            except (ValueError, TypeError):
                continue
            if not isinstance(value, dict) or value.get('event') != 'FIX01_PUBLIC_DRAFT_FAILURE':
                continue
            report['failures'].append({'timestamp': event.get('timestamp'),
                'stage': value.get('rejectionStage') if value.get('rejectionStage') in stages else 'UNAVAILABLE',
                'invalidOutput': value.get('reason') == 'INVALID_OUTPUT',
                'providerDispatched': value.get('providerDispatched') is True,
                'providerAcknowledged': value.get('providerAcknowledged') is True})
        next_token = page.get('nextToken')
        if not next_token or next_token == token:
            token = None
            break
        token = next_token
    report['result'] = 'DRAFT_FAILURE_STAGES_READ'
    report['windowComplete'] = token is None
except (RuntimeError, OSError, subprocess.SubprocessError, ValueError) as error:
    report['result'] = 'READBACK_UNAVAILABLE'
    report['code'] = str(error) if isinstance(error, RuntimeError) else type(error).__name__
finally:
    output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))
