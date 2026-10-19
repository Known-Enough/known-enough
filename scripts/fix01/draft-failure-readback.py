"""Read bounded, sanitized draft diagnostics. Never export raw log messages or model values."""
import datetime
import json
import os
import re
import subprocess
from pathlib import Path

ACCOUNT = '092954139775'
ROLE = 'KnownEnoughGithubStagingInspector'
UUID = re.compile(r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')
EVENTS = {'FIX01_PUBLIC_DRAFT_FAILURE', 'FIX01_PUBLIC_DRAFT_DIAGNOSTIC', 'PUBLIC_DRAFT_HTTP_RESULT', 'PRIVATE_ANSWERS_HTTP_RESULT',
          'known-enough.group-request', 'known-enough.group-result', 'known-enough.group-failure',
          'known-enough.account-failure', 'known-enough.account-lookup-repair-deferred', 'known-enough.storage-read'}
GROUP_OPERATIONS = {'group.create', 'group.list', 'group.open', 'group.accept', 'group.invite', 'group.manage', 'group.draft', 'group.delete', 'account.read', 'account.status', 'account.register'}
TYPES = {'string', 'number', 'boolean', 'object', 'array', 'null', 'missing', 'integer', 'int', 'unknown'}
CODES = {'invalid_type', 'invalid_value', 'invalid_union', 'unrecognized_keys', 'too_small', 'too_big', 'invalid_format', 'not_multiple_of', 'custom'}
PHASES = {'REQUEST_STARTED', 'MODEL_VALIDATION_FAILURE', 'PROVIDER_DISPATCHED', 'PROVIDER_COMPLETED',
          'REQUEST_FINISHED', 'REQUEST_REJECTED', 'SUCCEEDED', 'READY', 'LEASED', 'CALLING', 'DEAD', 'MISSING'}
REASONS = {'INVALID_OUTPUT', 'PROVIDER_UNCONFIRMED', 'CANCELLED', 'DISABLED', 'EXPIRED', 'STALE', 'BUDGET',
           'RETRY_LIMIT', 'AI_UNAVAILABLE', 'AI_AT_CAPACITY', 'REQUEST_UNKNOWN', 'REQUEST_PENDING',
           'PROVIDER_FAILED', 'INVALID_MODEL_OUTPUT', 'RUNTIME_UNAVAILABLE', 'FAILED', 'SUCCEEDED'}
STOP_REASONS = {'tool_use', 'max_tokens', 'end_turn', 'stop_sequence', 'content_filtered', 'guardrail_intervened', 'OTHER'}
HTTP_CODES = {'FORBIDDEN', 'NOT_FOUND', 'INVALID_COMMAND', 'STALE_CONTEXT', 'NEEDS_CLARIFICATION', 'RETRYABLE_SERVER_ERROR', 'CAPACITY_EXCEEDED', 'UNAUTHENTICATED'}
output = Path(os.environ['RUNNER_TEMP']) / 'draft-failure-readback.json'
report = {'source': os.environ['EXPECTED_SOURCE'], 'awsWrites': 0, 'providerCalls': 0, 'events': [], 'failures': []}

def aws(*args):
    result = subprocess.run(['aws', *args, '--region', 'us-east-1', '--output', 'json',
                             '--no-cli-pager'], capture_output=True, text=True, timeout=30)
    if result.returncode:
        match = re.search(r'An error occurred \(([A-Za-z0-9]+)\)', result.stderr)
        raise RuntimeError(match.group(1) if match else 'AWS_READ_UNAVAILABLE')
    return json.loads(result.stdout)

def bounded_number(value, maximum=1000000):
    return value if type(value) is int and 0 <= value <= maximum else None

def details(value):
    result = []
    for item in value[:12] if isinstance(value, list) else []:
        if not isinstance(item, dict):
            continue
        path = [part if isinstance(part, str) and part in fields or bounded_number(part, 65536) is not None
                else '_unrecognized' for part in item.get('path', [])[:12]] if isinstance(item.get('path'), list) else []
        detail = {'path': path, 'code': item.get('code') if item.get('code') in CODES else 'custom',
                  'received': item.get('received') if item.get('received') in TYPES else 'unknown'}
        if item.get('expected') in TYPES:
            detail['expected'] = item['expected']
        if isinstance(item.get('unexpectedFields'), list):
            detail['unexpectedFields'] = [part if isinstance(part, str) and part in fields else '_unrecognized'
                                          for part in item['unexpectedFields'][:12]]
            detail['unrecognizedFieldCount'] = bounded_number(item.get('unrecognizedFieldCount'), 65536)
        result.append(detail)
    return result

try:
    request_id = os.environ.get('DIAGNOSTIC_REQUEST_ID', '')
    if request_id and not UUID.fullmatch(request_id):
        raise RuntimeError('INVALID_REQUEST_REFERENCE')
    lookback = int(os.environ.get('LOOKBACK_MINUTES', '60'))
    if not 1 <= lookback <= 120:
        raise RuntimeError('INVALID_LOG_WINDOW')
    identity = aws('sts', 'get-caller-identity')
    if identity.get('Account') != ACCOUNT or not identity.get('Arn', '').startswith(
            f'arn:aws:sts::{ACCOUNT}:assumed-role/{ROLE}/'):
        raise RuntimeError('OWN_TARGET_IDENTITY_INVALID')
    source = Path('packages/application/src/model-runtime.ts').read_text()
    stages = set(re.findall(r"'([A-Z_]+)'", source.split('] as const;', 1)[0]))
    field_source = source.split('const validationFields = new Set((', 1)[1].split(".split(' ')", 1)[0]
    fields = set(''.join(re.findall(r"'([^']*)'", field_source)).split())
    end = int(datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000)
    report.update(windowStart=end - lookback * 60000, windowEnd=end)
    token = None
    seen = set()
    for _ in range(5):
        filter_pattern = '"' + request_id + '"' if request_id else (
            '{ $.event = "FIX01_PUBLIC_DRAFT_FAILURE" || $.event = "known-enough.group-failure" '
            '|| $.event = "known-enough.account-failure" || $.event = "known-enough.account-lookup-repair-deferred" '
            '|| $.event = "known-enough.storage-read" '
            '|| ($.event = "PUBLIC_DRAFT_HTTP_RESULT" && $.result = "FAILED") '
            '|| ($.event = "PRIVATE_ANSWERS_HTTP_RESULT" && $.result = "FAILED") }')
        args = ['logs', 'filter-log-events', '--log-group-name', '/aws/lambda/known-enough-stage-api',
                '--start-time', str(end - lookback * 60000), '--end-time', str(end),
                '--filter-pattern', filter_pattern,
                '--limit', '1000', '--no-paginate']
        if token:
            args += ['--next-token', token]
        page = aws(*args)
        for event in page.get('events', []):
            if event.get('eventId') in seen:
                continue
            seen.add(event.get('eventId'))
            message = event.get('message', '')
            try:
                value = json.loads(message[message.index('{'):].strip())
            except (ValueError, TypeError):
                continue
            if not isinstance(value, dict) or value.get('event') not in EVENTS or request_id and value.get('requestId') != request_id:
                continue
            item = {'timestamp': bounded_number(event.get('timestamp'), 9999999999999), 'event': value['event']}
            if isinstance(value.get('requestId'), str) and UUID.fullmatch(value['requestId']):
                item['requestId'] = value['requestId']
            if isinstance(value.get('sourceSha'), str) and re.fullmatch('[a-f0-9]{40}', value['sourceSha']):
                item['sourceSha'] = value['sourceSha']
            if value.get('phase') in PHASES:
                item['phase'] = value['phase']
            if value.get('reason') in REASONS:
                item['reason'] = value['reason']
            if 'rejectionStage' in value:
                item['stage'] = value['rejectionStage'] if value['rejectionStage'] in stages else 'UNAVAILABLE'
            for name in ['providerDispatched', 'providerAcknowledged']:
                if type(value.get(name)) is bool:
                    item[name] = value[name]
            if bounded_number(value.get('elapsedMs')) is not None:
                item['elapsedMs'] = value['elapsedMs']
            if value.get('stopReason') in STOP_REASONS:
                item['stopReason'] = value['stopReason']
            if isinstance(value.get('usage'), dict):
                item['usage'] = {key: bounded_number(value['usage'].get(key)) for key in ['inputTokens', 'outputTokens']}
            diagnostics = []
            for diagnostic in value.get('diagnostics', [])[:8] if isinstance(value.get('diagnostics'), list) else []:
                if isinstance(diagnostic, dict) and diagnostic.get('stage') in stages:
                    diagnostics.append({'stage': diagnostic['stage'], 'validation': details(diagnostic.get('validation'))})
            if diagnostics:
                item['diagnostics'] = diagnostics
            if value.get('result') in {'SAVED', 'FAILED'}:
                item['result'] = value['result']
            if value['event'] == 'known-enough.storage-read':
                if value.get('command') == 'TransactGetItems' and value.get('stage') == 'ACTIVATION':
                    item.update(command='TransactGetItems', stage='ACTIVATION')
                if type(value.get('attempt')) is int and 1 <= value['attempt'] <= 3:
                    item['attempt'] = value['attempt']
                if value.get('result') in {'RETRYING', 'FAILED', 'RECOVERED'}:
                    item['result'] = value['result']
                if value.get('errorType') in {'TransactionCanceledException', 'TransactionConflictException', 'AccessDeniedException',
                        'ResourceNotFoundException', 'ProvisionedThroughputExceededException', 'ThrottlingException',
                        'RequestLimitExceeded', 'InternalServerError', 'ValidationException', 'AbortError', 'OTHER'}:
                    item['errorType'] = value['errorType']
                if isinstance(value.get('cancellationCodes'), list):
                    allowed = {'None', 'TransactionConflict', 'ConditionalCheckFailed', 'ProvisionedThroughputExceeded',
                               'ThrottlingError', 'ValidationError', 'ItemCollectionSizeLimitExceeded', 'OTHER'}
                    item['cancellationCodes'] = [code if isinstance(code, str) and code in allowed else 'OTHER'
                                                 for code in value['cancellationCodes'][:3]]
                if bounded_number(value.get('cancellationCount'), 100) is not None:
                    item['cancellationCount'] = value['cancellationCount']
            if value.get('draftOperation') in {'GENERATE', 'EDIT', 'CREATE'}:
                item['draftOperation'] = value['draftOperation']
            if value.get('operation') in GROUP_OPERATIONS:
                item['operation'] = value['operation']
            if value.get('sessionCode') in {'SESSION_INVALID', 'SESSION_STORAGE_UNAVAILABLE', 'SESSION_TIMEOUT', 'SESSION_REQUEST_LIMIT', 'SESSION_CAPACITY'}:
                item['sessionCode'] = value['sessionCode']
            if value.get('event') == 'known-enough.account-lookup-repair-deferred' and value.get('code') in {
                    'PARTITION_INVALID', 'PARTITION_CAPACITY', 'PARTITION_CONFLICT', 'PARTITION_STALE',
                    'PARTITION_TIMEOUT', 'PARTITION_REQUEST_LIMIT', 'PARTITION_IDENTITY_CONFLICT',
                    'SESSION_INVALID', 'SESSION_STORAGE_UNAVAILABLE', 'SESSION_TIMEOUT', 'SESSION_REQUEST_LIMIT', 'SESSION_CAPACITY'}:
                item['storageCode'] = value['code']
            if isinstance(value.get('causes'), list):
                item['causes'] = [cause for cause in value['causes'][:5] if cause in {'AccessDeniedException', 'ResourceNotFoundException',
                    'ThrottlingException', 'TransactionCanceledException', 'TransactionConflictException', 'TimeoutError', 'AbortError'}]
            if value.get('outcome') in {'OK'}:
                item['outcome'] = value['outcome']
            if value.get('code') in HTTP_CODES:
                item['code'] = value['code']
            elif value.get('error') in HTTP_CODES:
                item['code'] = value['error']
            if bounded_number(value.get('status'), 599) is not None:
                item['status'] = value['status']
            if bounded_number(value.get('httpStatus'), 599) is not None:
                item['status'] = value['httpStatus']
            report['events'].append(item)
            if len(report['events']) > 200:
                report['events'].pop(0)
                report['eventsTruncated'] = True
            if value['event'] in {'FIX01_PUBLIC_DRAFT_FAILURE', 'known-enough.group-failure'}:
                report['failures'].append(item)
                if len(report['failures']) > 200:
                    report['failures'].pop(0)
        next_token = page.get('nextToken')
        if not next_token or next_token == token:
            token = None
            break
        token = next_token
    report['result'] = 'DRAFT_DIAGNOSTICS_READ'
    report['windowComplete'] = token is None
    report['requestReferenceCorrelation'] = 'EXACT_REFERENCE_MATCH' if request_id and report['events'] else 'NO_MATCH_IN_BOUNDED_WINDOW' if request_id else 'WINDOW_ONLY'
except (RuntimeError, OSError, subprocess.SubprocessError, ValueError, IndexError, TypeError) as error:
    report['result'] = 'READBACK_UNAVAILABLE'
    report['code'] = str(error) if isinstance(error, RuntimeError) else type(error).__name__
finally:
    output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        lines = ['## Decision draft diagnostics', '', '**Read-only:** no AWS writes or AI calls.', '',
                 'Result: ' + report['result'], '', 'Reference matching: ' + report.get('requestReferenceCorrelation', 'UNAVAILABLE'), '',
                 '| UTC | Reference | Phase/result | Validation stage |', '| --- | --- | --- | --- |']
        for item in report['events'][-30:]:
            stamp = datetime.datetime.fromtimestamp(item['timestamp'] / 1000, datetime.timezone.utc).isoformat() if item.get('timestamp') else 'Unknown'
            description = item.get('operation', item.get('phase', item.get('result', 'Unknown')))
            outcome = item.get('outcome', item.get('code', ''))
            if outcome:
                description += ' · ' + outcome
            lines.append('| ' + ' | '.join([stamp, item.get('requestId', 'Not recorded'), description, item.get('stage', '')]) + ' |')
        failures = [item for item in report['events'] if item.get('diagnostics')][-1:]
        for item in failures:
            lines += ['', '### Recorded validation details', '']
            for diagnostic in item['diagnostics']:
                for detail in diagnostic.get('validation', []):
                    path = ''.join('[' + str(part) + ']' if isinstance(part, int) else ('.' if index else '') + part for index, part in enumerate(detail['path'])) or '(root)'
                    text = '- `' + path + '`: **' + detail['code'] + '**; received ' + detail['received']
                    if detail.get('expected'):
                        text += '; expected ' + detail['expected']
                    if detail.get('unexpectedFields'):
                        text += '; unexpected fields: ' + ', '.join(detail['unexpectedFields'])
                    lines.append(text + '.')
        lines += ['', 'Raw prompts, model answers, private inputs, credentials and framework messages are excluded.',
                  'No matching or incomplete historical log is proof of a successful application request.']
        Path(summary).write_text('\n'.join(lines) + '\n')
if report['result'] == 'READBACK_UNAVAILABLE':
    raise SystemExit(1)
