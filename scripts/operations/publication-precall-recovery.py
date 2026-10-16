"""Close one expired, never-called request for publication. No provider or draft writes."""
import copy
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
TABLE = 'KnownEnoughOperationsJournal'
BUDGET = 'KnownEnoughQaControl'
SOURCE = os.environ['RUNTIME_SOURCE']
ROOT = Path(os.environ['RUNNER_TEMP'])
PHASE = sys.argv[1]
PRIVATE = ROOT / 'publication-precall-private.json'
REPORT = {'phase': PHASE, 'providerCalls': 0, 'draftWrites': 0, 'totalWrites': 0, 'writesRequested': 0}


def stop(code):
    raise ValueError(code)


def aws(service, operation, *args):
    result = subprocess.run(['aws', service, operation, *args, '--region', 'us-east-1',
                             '--output', 'json', '--no-cli-pager'], capture_output=True,
                            text=True, timeout=30, env={**os.environ, 'AWS_MAX_ATTEMPTS': '1'})
    if result.returncode:
        match = re.search(r'An error occurred \(([A-Za-z0-9]+)\)', result.stderr)
        stop(service + ':' + operation + '/' + (match.group(1) if match else 'UNAVAILABLE'))
    return json.loads(result.stdout or '{}')


def key(pk):
    return {'PK': {'S': pk}, 'SK': {'S': 'STATE'}}


def read(table, pk):
    return aws('dynamodb', 'get-item', '--table-name', table, '--key', json.dumps(key(pk)),
               '--consistent-read').get('Item')


def decode(row, pk, field='revision'):
    if not row or set(row) != {'PK', 'SK', field, 'payload'} or row['PK'] != {'S': pk} or row['SK'] != {'S': 'STATE'}:
        stop('RECORD_INVALID')
    value = json.loads(row['payload']['S'])
    if not re.fullmatch(r'[1-9][0-9]*', row[field].get('N', '')) or json.dumps(value, separators=(',', ':')) != row['payload']['S']:
        stop('RECORD_ENCODING_INVALID')
    if field == 'revision' and value.get('revision') != int(row[field]['N']):
        stop('RECORD_REVISION_INVALID')
    return value


def checked(state):
    control = decode(state['control'], 'OPERATIONS#MODEL_JOBS')
    if set(control) != {'schemaVersion', 'revision', 'enabled', 'sourceSha', 'active', 'slots'} or control['schemaVersion'] != 1 or control['enabled'] is not True or control['sourceSha'] != SOURCE or len(control['active']) != 1 or control['slots'] != []:
        stop('EXACT_SINGLE_SLOT_FREE_CONTROL_REQUIRED')
    job_id = control['active'][0]
    if str(uuid.UUID(job_id)) != job_id:
        stop('JOB_ID_INVALID')
    job = decode(state['job'], 'MODELJOB#' + job_id)
    REPORT['observedJob'] = {name: job.get(name) for name in ['phase', 'attempts', 'reservedTokens', 'reservedCostMicros']}
    ref = job['reference']
    REPORT['observedJob']['expired'] = isinstance(ref.get('expiresAt'), int) and ref['expiresAt'] <= int(datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000)
    if job.get('schemaVersion') != 1 or ref.get('jobId') != job_id or ref.get('sourceSha') != SOURCE or ref.get('kind') not in ['ARCHITECT', 'OWNER', 'NEGOTIATION'] or not REPORT['observedJob']['expired']:
        stop('EXPIRED_CURRENT_REQUEST_REQUIRED')
    if job.get('phase') != 'READY' or job.get('attempts') != 0 or job.get('failures') != 0 or job.get('reservedTokens') != 0 or job.get('reservedCostMicros') != 0 or job.get('lease') is not None or job.get('usage') is not None or job.get('reason') is not None or job.get('recoveryProofHash') is not None:
        stop('CALLED_LEASED_OR_UNCERTAIN_JOB_PRESERVED')
    authority = decode(state['authority'], 'AUTH', 'version')
    if authority.get('mode') != 'standing' or authority.get('approved') is not True:
        stop('STANDING_AUTHORITY_REQUIRED')
    decode(state['totals'], 'TOTAL', 'version')
    return control, job, job_id


def main():
    if not re.fullmatch(r'[a-f0-9]{40}', SOURCE):
        stop('RUNTIME_SOURCE_REQUIRED')
    role = 'KnownEnoughGithubQaRelease' if PHASE == 'backup' else 'KnownEnoughGithubModelJobOperations'
    identity = aws('sts', 'get-caller-identity')
    if identity.get('Account') != ACCOUNT or not identity.get('Arn', '').startswith(f'arn:aws:sts::{ACCOUNT}:assumed-role/{role}/'):
        stop('OWN_ROLE_REQUIRED')
    if PHASE == 'prepare':
        control_row = read(TABLE, 'OPERATIONS#MODEL_JOBS')
        control = decode(control_row, 'OPERATIONS#MODEL_JOBS')
        if len(control.get('active', [])) != 1:
            stop('EXACT_ONE_JOB_REQUIRED')
        state = {'source': SOURCE, 'control': control_row,
                 'job': read(TABLE, 'MODELJOB#' + control['active'][0]),
                 'authority': read(BUDGET, 'AUTH'), 'totals': read(BUDGET, 'TOTAL')}
        checked(state)
        PRIVATE.write_text(json.dumps(state));PRIVATE.chmod(0o600)
        REPORT['result'] = 'PRECALL_RECOVERY_PREPARED'
        return
    state = json.loads(PRIVATE.read_text())
    if state.get('source') != SOURCE:
        stop('PRIVATE_SOURCE_CHANGED')
    control, job, job_id = checked(state)
    if PHASE == 'backup':
        backup_key = 'ops01-owned/' + str(uuid.uuid4()) + '/publication-precall-private.json'
        REPORT['writesRequested'] = 1
        try:
            aws('s3api', 'put-object', '--bucket', 'known-enough-qa-artifacts-' + ACCOUNT,
                '--key', backup_key, '--body', str(PRIVATE), '--server-side-encryption', 'AES256', '--if-none-match', '*')
        except ValueError:
            pass
        saved = ROOT / 'publication-precall-backup-private.json'
        aws('s3api', 'get-object', '--bucket', 'known-enough-qa-artifacts-' + ACCOUNT, '--key', backup_key, str(saved))
        if saved.read_bytes() != PRIVATE.read_bytes():
            stop('PRIVATE_BACKUP_NOT_VERIFIED')
        (ROOT / 'publication-precall-backup-receipt.json').write_text(json.dumps({'sha256': hashlib.sha256(PRIVATE.read_bytes()).hexdigest(), 'privateKey': backup_key}))
        REPORT['result'] = 'PRIVATE_BACKUP_READBACK_PASS'
        return
    if PHASE != 'apply':
        stop('PHASE_INVALID')
    receipt = json.loads((ROOT / 'publication-precall-backup-receipt.json').read_text())
    if receipt.get('sha256') != hashlib.sha256(PRIVATE.read_bytes()).hexdigest():
        stop('PRIVATE_BACKUP_REQUIRED')
    next_control = copy.deepcopy(control);next_control.update(revision=control['revision']+1, enabled=False, active=[])
    next_job = copy.deepcopy(job);next_job.update(revision=job['revision']+1, phase='DEAD', reason='EXPIRED')
    def updated(row, value):
        result = copy.deepcopy(row);result['revision']={'N':str(value['revision'])};result['payload']={'S':json.dumps(value,separators=(',',':'))};return result
    next_control_row, next_job_row = updated(state['control'], next_control), updated(state['job'], next_job)
    def guard(row, field):
        return {'ConditionExpression':'#v = :v AND #p = :p','ExpressionAttributeNames':{'#v':field,'#p':'payload'},'ExpressionAttributeValues':{':v':row[field],':p':row['payload']}}
    transaction = [{'Put': {'TableName': TABLE, 'Item': next_control_row, **guard(state['control'],'revision')}},
                   {'Put': {'TableName': TABLE, 'Item': next_job_row, **guard(state['job'],'revision')}},
                   {'ConditionCheck': {'TableName': BUDGET, 'Key': key('AUTH'), **guard(state['authority'],'version')}},
                   {'ConditionCheck': {'TableName': BUDGET, 'Key': key('TOTAL'), **guard(state['totals'],'version')}}]
    REPORT['writesRequested'] = 1
    try:
        aws('dynamodb','transact-write-items','--client-request-token',str(uuid.uuid4()),'--transact-items',json.dumps(transaction))
    except ValueError:
        pass
    if read(TABLE,'OPERATIONS#MODEL_JOBS') != next_control_row or read(TABLE,'MODELJOB#'+job_id) != next_job_row or read(BUDGET,'TOTAL') != state['totals']:
        stop('RECOVERY_READBACK_UNCONFIRMED')
    REPORT.update(result='EXPIRED_UNCALLED_REQUEST_RETIRED', control='DISABLED_EMPTY', totalValues='UNCHANGED')


try:
    os.umask(0o077)
    main()
except Exception as error:
    REPORT['result']='BLOCKED'
    REPORT['code']=str(error) if isinstance(error, ValueError) and re.fullmatch(r'[A-Za-z0-9_:./-]{1,140}',str(error)) else 'RECOVERY_UNAVAILABLE'
(ROOT / ('publication-precall-'+PHASE+'-report.json')).write_text(json.dumps(REPORT)+'\n')
print(json.dumps(REPORT))
if REPORT['result']=='BLOCKED':
    raise SystemExit(1)
