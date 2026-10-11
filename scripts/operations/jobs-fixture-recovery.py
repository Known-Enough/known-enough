"""Locate only the known B run's private fixture checkpoint; no signup/model/credential output."""
import datetime
import json
import os
import re
import subprocess
from pathlib import Path
ACCOUNT='092954139775';SOURCE='246a1d8552810e46efdc635ba956ed459bbd9ad2'
START=datetime.datetime.fromisoformat('2026-10-11T23:26:45+00:00');END=datetime.datetime.fromisoformat('2026-10-11T23:28:16+00:00')

def candidate(key,last_modified):
    return bool(re.fullmatch(r'ops01-owned/[a-f0-9-]{36}/state-private\.json',key)) and START<=datetime.datetime.fromisoformat(last_modified.replace('Z','+00:00'))<=END

def main():
    report={'result':'FIXTURE_RECOVERY_NOT_EXECUTED','signup':0,'providerCalls':0,'mutations':0}
    operation='identity'
    def aws(*args):
        p=subprocess.run(['aws',*args,'--region','us-east-1','--output','json','--no-cli-pager'],capture_output=True,timeout=30)
        if p.returncode:
            code=re.search(rb'\(([A-Za-z0-9]+)\)',p.stderr)
            raise RuntimeError(code.group(1).decode() if code else 'AWS_CLI_FAILED')
        return json.loads(p.stdout)
    try:
        identity=aws('sts','get-caller-identity')
        if identity.get('Account')!=ACCOUNT or not identity.get('Arn','').startswith(f'arn:aws:sts::{ACCOUNT}:assumed-role/KnownEnoughGithubQaRelease/'):
            raise RuntimeError('FIXTURE_RECOVERY_ROLE_INVALID')
        operation='s3:ListBucket'
        rows=aws('s3api','list-objects-v2','--bucket',f'known-enough-qa-artifacts-{ACCOUNT}','--prefix','ops01-owned/','--max-keys','1000','--no-paginate')
        if rows.get('IsTruncated'):raise RuntimeError('FIXTURE_METADATA_BUDGET_EXCEEDED')
        selected=[row for row in rows.get('Contents',[]) if candidate(row['Key'],row['LastModified'])]
        report['candidateCount']=len(selected)
        if len(selected)!=1:raise RuntimeError('FIXTURE_OWN_WINDOW_NOT_UNIQUE')
        operation='s3:GetObject'
        target=Path(os.environ['RUNNER_TEMP'])/'owned-fixture-recovery-private.json'
        aws('s3api','get-object','--bucket',f'known-enough-qa-artifacts-{ACCOUNT}','--key',selected[0]['Key'],str(target))
        state=json.loads(target.read_text())
        if state.get('sourceSha')!=SOURCE or selected[0]['Key']!='ops01-owned/'+state.get('runId','')+'/state-private.json' or len(state.get('fixtures',[]))!=2:
            raise RuntimeError('FIXTURE_OWN_SOURCE_INVALID')
        report.update(result='OWNED_PRIVATE_CHECKPOINT_LOCATED',originalSource=SOURCE,privateRecoveryKey=selected[0]['Key'],
                      knownDeletedUsers=sum(f.get('deleted') is True for f in state['fixtures']),
                      knownRemovedMailboxes=sum(f.get('mailboxRemoved') is True for f in state['fixtures']),
                      unconfirmedMailboxIntents=sum(not f.get('mailboxRemoved') for f in state['fixtures']))
    except (RuntimeError,ValueError,KeyError,OSError,subprocess.TimeoutExpired) as error:
        report.update(result='FIXTURE_RECOVERY_BLOCKED',operation=operation,code=str(error) if isinstance(error,RuntimeError) else type(error).__name__)
    report['sourceSha']=os.environ['GITHUB_SHA']
    (Path(os.environ['RUNNER_TEMP'])/'owned-fixture-recovery-report.json').write_text(json.dumps(report)+'\n')
    print(json.dumps(report));return 0 if report['result']=='OWNED_PRIVATE_CHECKPOINT_LOCATED' else 1

if __name__=='__main__':raise SystemExit(main())
