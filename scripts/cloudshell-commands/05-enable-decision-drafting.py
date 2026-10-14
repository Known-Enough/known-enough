#!/usr/bin/env python3
"""Own-admin public drafting setup only: exact model grant and guarded control activation.

No model invocation, application test, signup, private-retention or schedule change.
"""
import base64
import datetime
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ACCOUNT = '092954139775'
SOURCE = '4fc702b3018a7e2933486ee4289efd3d7fe2971a'
API_HASH = '83d794ac6cd4fe204f30a320c4e34537b683b76da3aedb6a106f9077dff6f663'
WORKER_HASH = 'f15b5164be54248e2514f0a354bc07fcabcc03695ec9bf81ab93d16448ea7bf5'
ROLE = 'KnownEnoughStageApiRole'
NAME = 'FIX01PublicDraftNovaLite'
POLICY = {'Version': '2012-10-17', 'Statement': [{
    'Sid': 'FIX01PublicOnlyNovaLite', 'Effect': 'Allow', 'Action': 'bedrock:InvokeModel',
    'Resource': 'arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-lite-v1:0'}]}
report = {'source': SOURCE, 'iamWritesConfirmed': 0, 'controlWritesConfirmed': 0,
          'accountChanges': 0, 'modelCalls': 0, 'emailRequests': 0,
          'manualDecisionCreation': 'NOT_EXECUTED'}


def require(condition, code):
    if not condition:
        raise ValueError(code)


def aws(service, operation, *args, absent=False):
    result = subprocess.run(['aws', service, operation, *args, '--region', 'us-east-1',
                             '--output', 'json', '--no-cli-pager'],
                            capture_output=True, text=True, timeout=30)
    if result.returncode:
        match = re.search(r'An error occurred \(([A-Za-z0-9]+)\)', result.stderr)
        code = match.group(1) if match else 'AWS_CALL_UNAVAILABLE'
        if absent and code == 'NoSuchEntity':
            return None
        raise ValueError(service + ':' + operation + '/' + code)
    return json.loads(result.stdout or '{}')


def item(table, pk):
    return aws('dynamodb', 'get-item', '--table-name', table, '--consistent-read',
               '--key', json.dumps({'PK': {'S': pk}, 'SK': {'S': 'STATE'}})).get('Item')


def main():
    os.umask(0o077)
    os.environ['AWS_MAX_ATTEMPTS'] = '1'
    require(sys.argv[1:] == ['--apply'], 'APPLY_ARGUMENT_REQUIRED')
    require(aws('sts', 'get-caller-identity').get('Account') == ACCOUNT, 'WRONG_AWS_ACCOUNT')
    for name, digest, handler, role in [
            ('known-enough-stage-api', API_HASH, 'api.handler', ROLE),
            ('known-enough-stage-model-jobs', WORKER_HASH, 'worker.handler', 'KnownEnoughModelJobRuntime')]:
        config = aws('lambda', 'get-function-configuration', '--function-name', name)
        require(config.get('FunctionArn') == f'arn:aws:lambda:us-east-1:{ACCOUNT}:function:{name}'
                and config.get('Role') == f'arn:aws:iam::{ACCOUNT}:role/{role}'
                and config.get('Handler') == handler and config.get('Runtime') == 'nodejs24.x'
                and config.get('CodeSha256') == base64.b64encode(bytes.fromhex(digest)).decode()
                and config.get('State') == 'Active' and config.get('LastUpdateStatus') == 'Successful',
                'INSTALLED_RUNTIME_CHANGED')
        if name == 'known-enough-stage-api':
            variables = config.get('Environment', {}).get('Variables', {})
            require(variables.get('KE14_MODEL_MODE') == 'DISABLED'
                    and variables.get('KE14_PAID_CALLS_APPROVED') == 'false', 'LEGACY_MODEL_FLAGS_CHANGED')
    rule = aws('events', 'describe-rule', '--name', 'KnownEnoughModelJobs')
    require(rule.get('Arn') == f'arn:aws:events:us-east-1:{ACCOUNT}:rule/KnownEnoughModelJobs'
            and rule.get('State') == 'DISABLED', 'PRIVATE_WORKER_SCHEDULE_CHANGED')
    logging = aws('bedrock', 'get-model-invocation-logging-configuration').get('loggingConfig')
    require(not logging or all(logging.get(name) is False for name in [
        'textDataDeliveryEnabled', 'imageDataDeliveryEnabled', 'embeddingDataDeliveryEnabled',
        'videoDataDeliveryEnabled']), 'PROVIDER_LOGGING_NOT_DISABLED')

    current = item('KnownEnoughOperationsJournal', 'OPERATIONS#MODEL_JOBS')
    auth = item('KnownEnoughQaControl', 'AUTH')
    retention = item('KnownEnoughOperationsJournal', 'OPERATIONS#RETENTION')
    totals = item('KnownEnoughQaControl', 'TOTAL')
    require(all([current, auth, retention, totals]), 'CURRENT_CONTROLS_MISSING')
    state = json.loads(current['payload']['S'])
    standing = json.loads(auth['payload']['S'])
    private = json.loads(retention['payload']['S'])
    require(state.get('sourceSha') == SOURCE and state.get('active') == [] and state.get('slots') == [],
            'SOURCE_OR_ACTIVE_JOBS_CHANGED')
    revision = state.get('revision')
    require(type(revision) is int and 0 < revision < 9007199254740991
            and current.get('revision', {}).get('N') == str(revision)
            and type(state.get('enabled')) is bool, 'CONTROL_REVISION_INVALID')
    require(private.get('enabled') is False, 'PRIVATE_RETENTION_CHANGED')
    require(standing.get('mode') == 'standing' and all(standing.get(name) is True for name in [
        'approved', 'retentionReviewed', 'invocationLoggingDisabled']), 'STANDING_AUTHORITY_CHANGED')
    role = aws('iam', 'get-role', '--role-name', ROLE)['Role']
    require(role.get('Arn') == f'arn:aws:iam::{ACCOUNT}:role/{ROLE}'
            and not role.get('PermissionsBoundary'), 'RUNTIME_ROLE_CHANGED')
    prior = aws('iam', 'get-role-policy', '--role-name', ROLE, '--policy-name', NAME, absent=True)
    require(not prior or prior.get('PolicyDocument') == POLICY, 'FOREIGN_NAMED_POLICY_STOP')

    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    folder = Path.home() / '.known-enough' / ('fix01-decision-setup-' + stamp)
    folder.mkdir(parents=True, mode=0o700)
    (folder / 'before-private.json').write_text(json.dumps({
        'role': role, 'policy': prior, 'control': current, 'auth': auth, 'retention': retention, 'totals': totals}))
    report['backup'] = str(folder)

    if not prior:
        try:
            aws('iam', 'put-role-policy', '--role-name', ROLE, '--policy-name', NAME,
                '--policy-document', json.dumps(POLICY))
        except ValueError as error:
            report['policyWriteAcknowledgement'] = str(error)
        observed = aws('iam', 'get-role-policy', '--role-name', ROLE, '--policy-name', NAME, absent=True)
        require(observed and observed.get('PolicyDocument') == POLICY, 'MODEL_POLICY_NOT_VERIFIED')
        report['iamWritesConfirmed'] = 1
    report['modelPolicy'] = 'MATCH'

    if not state['enabled']:
        new = {**state, 'revision': revision + 1, 'enabled': True}
        transaction = [{'Put': {'TableName': 'KnownEnoughOperationsJournal',
            'Item': {**current, 'revision': {'N': str(new['revision'])},
                     'payload': {'S': json.dumps(new, separators=(',', ':'))}},
            'ConditionExpression': '#r = :r AND #p = :p',
            'ExpressionAttributeNames': {'#r': 'revision', '#p': 'payload'},
            'ExpressionAttributeValues': {':r': current['revision'], ':p': current['payload']}}}]
        for table, record, attribute in [('KnownEnoughQaControl', auth, 'version'),
                                         ('KnownEnoughOperationsJournal', retention, 'revision')]:
            transaction.append({'ConditionCheck': {'TableName': table,
                'Key': {'PK': record['PK'], 'SK': record['SK']},
                'ConditionExpression': '#v = :v AND #p = :p',
                'ExpressionAttributeNames': {'#v': attribute, '#p': 'payload'},
                'ExpressionAttributeValues': {':v': record[attribute], ':p': record['payload']}}})
        try:
            aws('dynamodb', 'transact-write-items', '--transact-items', json.dumps(transaction))
        except ValueError as error:
            report['controlWriteAcknowledgement'] = str(error)
        observed = item('KnownEnoughOperationsJournal', 'OPERATIONS#MODEL_JOBS')
        require(observed and json.loads(observed['payload']['S']) == new, 'CONTROL_WRITE_NOT_VERIFIED')
        report['controlWritesConfirmed'] = 1
    else:
        require(item('KnownEnoughOperationsJournal', 'OPERATIONS#MODEL_JOBS') == current, 'CONTROL_CHANGED')
    require(item('KnownEnoughQaControl', 'TOTAL') == totals, 'TOTAL_CHANGED')
    require(item('KnownEnoughOperationsJournal', 'OPERATIONS#RETENTION') == retention, 'RETENTION_CHANGED')
    require(aws('events', 'describe-rule', '--name', 'KnownEnoughModelJobs').get('State') == 'DISABLED',
            'PRIVATE_WORKER_SCHEDULE_CHANGED')
    report.update(result='DECISION_DRAFTING_SETUP_READBACK_PASS', publicDrafting='ENABLED',
                  privateWorkerSchedule='DISABLED', privateRetention='UNCHANGED_DISABLED', totals='UNCHANGED')
    (folder / 'outcome.json').write_text(json.dumps(report))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        report['result'] = 'BLOCKED'
        report['error'] = str(error) if isinstance(error, ValueError) else type(error).__name__
    print(json.dumps(report))
    if report.get('result') != 'DECISION_DRAFTING_SETUP_READBACK_PASS':
        sys.exit(1)
