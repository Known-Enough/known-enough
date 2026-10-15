"""Source-bound synthetic pilot activation. No participant stamps, model call or usage mutation."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import uuid

ACCOUNT = '092954139775'
KEY = {'PK': {'S': 'OPERATIONS#RETENTION'}, 'SK': {'S': 'STATE'}}
TABLE = 'KnownEnoughOperationsJournal'


def candidate(prior):
    if not isinstance(prior, dict) or set(prior) != {'PK', 'SK', 'revision', 'payload'} or prior.get('PK') != KEY['PK'] or prior.get('SK') != KEY['SK']:
        raise ValueError('RETENTION_WIRE_INVALID')
    policy = json.loads(prior['payload']['S'])
    fields = {'schemaVersion', 'kind', 'revision', 'enabled', 'dataClass', 'rawConversationMs', 'structuredMs',
              'replayMs', 'journalMs', 'backupMs', 'providerMs', 'realPersonPolicy'}
    if (set(policy) != fields or type(policy['schemaVersion']) is not int or policy['schemaVersion'] != 1 or policy['kind'] != 'RETENTION_POLICY'
            or policy['dataClass'] != 'SYNTHETIC' or policy['realPersonPolicy'] != 'UNAPPROVED'
            or type(policy['rawConversationMs']) is not int or policy['rawConversationMs'] != 0 or type(policy['enabled']) is not bool
            or type(policy['revision']) is not int or not 1 <= policy['revision'] < 9007199254740990
            or prior['revision'] != {'N': str(policy['revision'])}
            or json.dumps(policy, separators=(',', ':')) != prior['payload']['S']):
        raise ValueError('RETENTION_POLICY_DRIFT')
    for field in ['structuredMs', 'replayMs', 'journalMs', 'backupMs', 'providerMs']:
        value = policy[field]
        if value is None and field in ['backupMs', 'providerMs']:
            continue
        if type(value) is not int or not 1 <= value <= 366 * 86400000:
            raise ValueError('RETENTION_PERIOD_DRIFT')
    desired = {**policy, 'enabled': True, 'revision': policy['revision'] + (not policy['enabled'])}
    return {**KEY, 'revision': {'N': str(desired['revision'])},
            'payload': {'S': json.dumps(desired, separators=(',', ':'))}}


def main():
    phase = sys.argv[1]
    if phase not in ['prepare', 'backup', 'apply']:
        raise ValueError('PHASE_INVALID')
    source = os.environ['EXPECTED_SOURCE']
    if not re.fullmatch(r'[a-f0-9]{40}', source):
        raise ValueError('SOURCE_INVALID')
    root = Path(os.environ['RUNNER_TEMP'])
    os.umask(0o077)
    private = root / 'fix01-retention-prior-private.json'
    receipt = root / 'fix01-retention-backup-private.json'
    role = 'KnownEnoughGithubQaRelease' if phase == 'backup' else 'KnownEnoughGithubRetentionPolicy'
    report = {'source': source, 'phase': phase, 'policyWrites': 0, 'backupWrites': 0,
              'accountWrites': 0, 'stampWrites': 0, 'totalWrites': 0, 'providerCalls': 0}

    def aws(*args):
        run = subprocess.run(['aws', *args, '--region', 'us-east-1', '--output', 'json', '--no-cli-pager'],
                             capture_output=True, timeout=30)
        if run.returncode:
            match = re.search(rb'\(([A-Za-z0-9]+)\)', run.stderr)
            raise ValueError(match.group(1).decode() if match else 'AWS_CALL_UNAVAILABLE')
        return json.loads(run.stdout.strip() or b'{}')

    def read():
        return aws('dynamodb', 'get-item', '--table-name', TABLE, '--key', json.dumps(KEY), '--consistent-read').get('Item')

    try:
        identity = aws('sts', 'get-caller-identity')
        if identity.get('Account') != ACCOUNT or not identity.get('Arn', '').startswith('arn:aws:sts::' + ACCOUNT + ':assumed-role/' + role + '/'):
            raise ValueError('OWN_ROLE_TARGET_INVALID')
        if phase == 'prepare':
            for guard in ['api', 'worker', 'logging', 'enable']:
                value = json.loads((root / ('fix01-' + guard + '-guard.json')).read_text())
                expected = 'CONTROL_READBACK_PASS' if guard == 'enable' else 'GUARD_PASS'
                if value.get('source') != source or value.get('result') != expected or guard == 'enable' and value.get('enabled') is not True:
                    raise ValueError('CURRENT_RUNTIME_GUARDS_REQUIRED')
            prior = read()
            value = {'source': source, 'key': 'ops01-owned/' + str(uuid.uuid4()) + '/retention-private.json',
                     'prior': prior, 'desired': candidate(prior)}
            private.write_text(json.dumps(value, separators=(',', ':')))
            private.chmod(0o600)
        else:
            value = json.loads(private.read_text())
            if value['source'] != source or value['desired'] != candidate(value['prior']) or not re.fullmatch(r'ops01-owned/[a-f0-9-]{36}/retention-private\.json', value['key']):
                raise ValueError('PRIVATE_PLAN_DRIFT')
            digest = hashlib.sha256(private.read_bytes()).hexdigest()
            if phase == 'backup':
                # One immutable upload; readback also resolves a lost upload acknowledgement.
                try:
                    aws('s3api', 'put-object', '--bucket', 'known-enough-qa-artifacts-' + ACCOUNT, '--key', value['key'],
                        '--body', str(private), '--if-none-match', '*', '--server-side-encryption', 'AES256')
                    report['backupWrites'] = 1
                except (ValueError, subprocess.TimeoutExpired):
                    report['backupWriteAcknowledgmentUncertain'] = True
                observed = root / 'fix01-retention-backup-read-private.json'
                metadata = aws('s3api', 'get-object', '--bucket', 'known-enough-qa-artifacts-' + ACCOUNT,
                               '--key', value['key'], str(observed))
                report['backupChecks'] = {'versioned': bool(metadata.get('VersionId') and metadata['VersionId'] != 'null'),
                                         'encrypted': metadata.get('ServerSideEncryption') == 'AES256',
                                         'contentMatches': hashlib.sha256(observed.read_bytes()).hexdigest() == digest,
                                         'etagPresent': isinstance(metadata.get('ETag'), str) and bool(metadata['ETag'])}
                if not all(report['backupChecks'][field] for field in ['encrypted', 'contentMatches', 'etagPresent']):
                    raise ValueError('PRIVATE_BACKUP_NOT_VERIFIED')
                # QA artifact storage supports conditional-create backups without requiring bucket versioning.
                # The unique key, encrypted exact-byte readback and digest remain mandatory.
                receipt.write_text(json.dumps({'source': source, 'digest': digest, 'key': value['key'],
                                               'version': metadata.get('VersionId'), 'etag': metadata['ETag']}))
            else:
                backup = json.loads(receipt.read_text())
                if backup.get('source') != source or backup.get('digest') != digest or backup.get('key') != value['key'] or not isinstance(backup.get('etag'), str) or not backup['etag']:
                    raise ValueError('PRIVATE_BACKUP_REQUIRED')
                current = read()
                if current != value['prior'] and current != value['desired']:
                    raise ValueError('CURRENT_POLICY_DRIFT')
                if current != value['desired']:
                    entry = {'Put': {'TableName': TABLE, 'Item': value['desired'], 'ConditionExpression': '#r=:r AND #p=:p',
                                     'ExpressionAttributeNames': {'#r': 'revision', '#p': 'payload'},
                                     'ExpressionAttributeValues': {':r': current['revision'], ':p': current['payload']}}}
                    try:
                        aws('dynamodb', 'transact-write-items', '--transact-items', json.dumps([entry]))
                        report['policyWrites'] = 1
                    except (ValueError, subprocess.TimeoutExpired):
                        report['policyWriteAcknowledgmentUncertain'] = True
                if read() != value['desired']:
                    raise ValueError('POLICY_WRITE_NOT_CONFIRMED_NO_RETRY')
        report.update(result='SYNTHETIC_PROCESSING_' + phase.upper() + '_PASS',
                      rawConversationMs=0, realPersonPolicy='UNAPPROVED', participantConsent='REQUIRED_IN_APP')
    except Exception as error:
        report.update(result='BLOCKED', code=str(error) if isinstance(error, ValueError) and re.fullmatch(r'[A-Za-z0-9_]{1,100}', str(error)) else type(error).__name__)
    report['utc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    (root / ('fix01-retention-' + phase + '-guard.json')).write_text(json.dumps(report) + '\n')
    print(json.dumps(report))
    return 0 if report['result'] != 'BLOCKED' else 1


if __name__ == '__main__':
    raise SystemExit(main())
