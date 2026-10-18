"""Verify one empty scheduled tick; optionally activate the existing source-bound worker."""
import base64
import json
import os
import re
import subprocess
import time
from pathlib import Path

ACCOUNT='092954139775';FUNCTION='known-enough-stage-model-jobs';RULE='KnownEnoughModelJobs'
COUNTS=['discovered','attempted','applied','skipped','retry','dead','failed','deferred']


def empty_summary(message):
    try:
        value=json.loads(message)
        return value.get('event')=='model-job-run' and all(type(value.get(k)) is int and value[k]==0 for k in COUNTS) and set(value)==set(COUNTS+['event'])
    except (ValueError,TypeError,AttributeError):
        return False


def main():
    root=Path(os.environ['RUNNER_TEMP']);report={'result':'WORKER_SMOKE_NOT_EXECUTED','ruleEnableRequested':False,'ruleDisabledReadback':False,'paidDispatchReported':0}
    def aws(*args):
        result=subprocess.run(['aws',*args,'--region','us-east-1','--output','json','--no-cli-pager'],capture_output=True,timeout=30)
        if result.returncode:
            code=re.search(rb'\(([A-Za-z0-9]+)\)',result.stderr)
            raise RuntimeError(code.group(1).decode() if code else 'AWS_CLI_FAILED')
        return json.loads(result.stdout) if result.stdout.strip() else {}
    phase=os.environ['SMOKE_PHASE']
    mode=os.environ.get('SCHEDULE_OPERATION','smoke')
    operation=phase
    try:
        if mode not in ['smoke','activate','deactivate']:raise RuntimeError('SCHEDULE_OPERATION_INVALID')
        identity=aws('sts','get-caller-identity')
        role='KnownEnoughGithubModelJobOperations' if phase=='control' else 'KnownEnoughGithubModelJobRelease'
        if identity.get('Account')!=ACCOUNT or not identity.get('Arn','').startswith(f'arn:aws:sts::{ACCOUNT}:assumed-role/{role}/'):
            raise RuntimeError('SMOKE_IDENTITY_INVALID')
        if phase=='control':
            operation='dynamodb:GetItem'
            item=aws('dynamodb','get-item','--table-name','KnownEnoughOperationsJournal','--key',json.dumps({'PK':{'S':'OPERATIONS#MODEL_JOBS'},'SK':{'S':'STATE'}}),'--consistent-read').get('Item',{})
            control=json.loads(item.get('payload',{}).get('S','null'))
            if (not isinstance(control,dict) or control.get('enabled') is not (mode!='smoke') or control.get('active')!=[] or control.get('slots')!=[]
                    or control.get('sourceSha')!=os.environ['PACKAGE_SOURCE'] or item.get('revision',{}).get('N')!=str(control.get('revision'))):
                raise RuntimeError('SMOKE_CONTROL_NOT_DISABLED_EMPTY_MATCHING')
            result='ENABLED_EMPTY_CONTROL_VERIFIED' if mode!='smoke' else 'DISABLED_EMPTY_CONTROL_VERIFIED'
            (root/'worker-smoke-control.json').write_text(json.dumps({'sourceSha':control['sourceSha'],'result':result})+'\n')
            report.update(result=result,packageSource=control['sourceSha'])
        elif phase=='schedule':
            saved=json.loads((root/'worker-smoke-control.json').read_text())
            expected='ENABLED_EMPTY_CONTROL_VERIFIED' if mode!='smoke' else 'DISABLED_EMPTY_CONTROL_VERIFIED'
            if saved.get('sourceSha')!=os.environ['PACKAGE_SOURCE'] or saved.get('result')!=expected:
                raise RuntimeError('SMOKE_CONTROL_RECEIPT_INVALID')
            if mode=='activate':
                logging=json.loads((root/'fix01-logging-guard.json').read_text())
                if logging.get('source')!=os.environ['PACKAGE_SOURCE'] or logging.get('result')!='GUARD_PASS' or logging.get('logging')!='DISABLED':
                    raise RuntimeError('SCHEDULE_LOGGING_GUARD_MISSING')
            config=aws('lambda','get-function-configuration','--function-name',FUNCTION)
            if config.get('CodeSha256')!=base64.b64encode(bytes.fromhex(os.environ['WORKER_SHA'])).decode() or config.get('State')!='Active' or config.get('LastUpdateStatus')!='Successful':
                raise RuntimeError('SMOKE_WORKER_HASH_MISMATCH')
            if mode=='deactivate':
                rule=aws('events','describe-rule','--name',RULE)
                if rule.get('State') not in ['ENABLED','DISABLED'] or rule.get('ScheduleExpression')!='rate(1 minute)':raise RuntimeError('SCHEDULE_RULE_CHANGED')
                if rule['State']=='ENABLED':aws('events','disable-rule','--name',RULE)
                if aws('events','describe-rule','--name',RULE).get('State')!='DISABLED':raise RuntimeError('SCHEDULE_DISABLED_READBACK_FAILED')
                report.update(result='WORKER_SCHEDULE_DEACTIVATION_PASS',schedule='DISABLED',ruleDisabledReadback=True,packageSource=os.environ['PACKAGE_SOURCE'],workerSha256=os.environ['WORKER_SHA'])
            else:
                rule=aws('events','describe-rule','--name',RULE)
                if rule.get('State')!='DISABLED' or rule.get('ScheduleExpression')!='rate(1 minute)':raise RuntimeError('SMOKE_RULE_NOT_DISABLED')
                start=int(time.time()*1000)
                operation='events:EnableRule';report['ruleEnableRequested']=True
                aws('events','enable-rule','--name',RULE)
                operation='logs:FilterLogEvents'
                for attempt in range(15):
                    time.sleep(10)
                    logs=aws('logs','filter-log-events','--log-group-name','/aws/lambda/'+FUNCTION,'--start-time',str(start),'--limit','100')
                    messages=[event.get('message','') for event in logs.get('events',[])]
                    # Lambda prepends request metadata; inspect only complete JSON suffixes, never publish raw messages.
                    bodies=[message[message.find('{'):].strip() for message in messages if '{' in message]
                    if any(empty_summary(body) for body in bodies):
                        report.update(result='EMPTY_WORKER_SCHEDULE_PASS',matchingEmptySummaries=sum(empty_summary(body) for body in bodies));break
                    if any('MODEL_JOB_RUN_UNAVAILABLE' in message for message in messages) or any('"result":"UNAVAILABLE"' in body or '"result": "UNAVAILABLE"' in body for body in bodies):
                        raise RuntimeError('MODEL_JOB_RUN_UNAVAILABLE')
                else:raise RuntimeError('EMPTY_WORKER_EXECUTION_NOT_OBSERVED')
                if mode=='activate':
                    if aws('events','describe-rule','--name',RULE).get('State')!='ENABLED':raise RuntimeError('SCHEDULE_ENABLED_READBACK_FAILED')
                    report.update(result='WORKER_SCHEDULE_ACTIVATION_PASS',schedule='ENABLED',packageSource=os.environ['PACKAGE_SOURCE'],workerSha256=os.environ['WORKER_SHA'])
        else:raise RuntimeError('SMOKE_PHASE_INVALID')
    except (RuntimeError,ValueError,KeyError,OSError,subprocess.TimeoutExpired) as error:
        report.update(result='WORKER_SMOKE_BLOCKED',operation=operation,code=str(error) if isinstance(error,RuntimeError) else type(error).__name__)
    finally:
        if report['ruleEnableRequested'] and report['result']!='WORKER_SCHEDULE_ACTIVATION_PASS':
            try:
                aws('events','disable-rule','--name',RULE)
                report['ruleDisabledReadback']=aws('events','describe-rule','--name',RULE).get('State')=='DISABLED'
                if not report['ruleDisabledReadback']:report['result']='WORKER_SMOKE_CLEANUP_UNVERIFIED'
            except Exception:
                report.update(result='WORKER_SMOKE_CLEANUP_UNVERIFIED',cleanupCode='RULE_DISABLE_UNVERIFIED')
    report['sourceSha']=os.environ['GITHUB_SHA']
    (root/('worker-smoke-'+phase+'-report.json')).write_text(json.dumps(report)+'\n');print(json.dumps(report))
    return 0 if report['result'] in ['DISABLED_EMPTY_CONTROL_VERIFIED','ENABLED_EMPTY_CONTROL_VERIFIED','EMPTY_WORKER_SCHEDULE_PASS','WORKER_SCHEDULE_ACTIVATION_PASS','WORKER_SCHEDULE_DEACTIVATION_PASS'] else 1


if __name__=='__main__':raise SystemExit(main())
