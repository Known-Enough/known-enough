"""Delete only the acknowledged completed job of the recovered owned FIX01 fixture."""
import hashlib,json,os,re,subprocess,uuid
from pathlib import Path
ROOT=Path(os.environ['RUNNER_TEMP']);SOURCE='6b6aa79070689caf17568fb59ee5dc3d677effe4'
report={'result':'NOT_EXECUTED','originalSource':SOURCE,'providerCalls':0,'journalDeletes':0,'totalWrites':0}
def aws(*args):
    p=subprocess.run(['aws',*args,'--region','us-east-1','--output','json','--no-cli-pager'],capture_output=True,text=True,timeout=20)
    if p.returncode:
        m=re.search(r'\(([A-Za-z0-9]+)\)',p.stderr);raise RuntimeError(m.group(1) if m else 'AWS_REQUEST_UNVERIFIED')
    return json.loads(p.stdout or '{}')
def key(pk):return {'PK':{'S':pk},'SK':{'S':'STATE'}}
def get(table,pk):return aws('dynamodb','get-item','--table-name',table,'--key',json.dumps(key(pk)),'--consistent-read').get('Item')
try:
    identity=aws('sts','get-caller-identity')
    if identity.get('Account')!='092954139775' or not identity.get('Arn','').startswith('arn:aws:sts::092954139775:assumed-role/KnownEnoughGithubModelJobOperations/'):
        raise RuntimeError('OWN_ROLE_TARGET_INVALID')
    state=json.loads((ROOT/'partition-cutover-private/owned-fixtures-private.json').read_text())
    if state.get('sourceSha')!=SOURCE or len(state.get('fixtures',[]))!=2 or any(f.get('deleted') is not True or f.get('mailboxRemoved') is not True or f.get('runId')!=state.get('runId') for f in state['fixtures']):raise RuntimeError('ORIGINAL_FIXTURE_INVALID')
    fixtures=[f for f in state['fixtures'] if f.get('groupId') and f.get('draftRequestKey')]
    if len(fixtures)!=1:raise RuntimeError('ORIGINAL_REQUEST_NOT_UNIQUE')
    f=fixtures[0];draft='draft-'+hashlib.sha256(json.dumps([f['groupId'],f['subject'],f['draftRequestKey']],separators=(',',':')).encode()).hexdigest()[:40]
    jobid=str(uuid.UUID(bytes=hashlib.sha256(json.dumps([SOURCE,f['groupId'],draft],separators=(',',':')).encode()).digest()[:16],version=4));pk='MODELJOB#'+jobid
    total=get('KnownEnoughQaControl','TOTAL');control=get('KnownEnoughOperationsJournal','OPERATIONS#MODEL_JOBS');job=get('KnownEnoughOperationsJournal',pk)
    c=json.loads(control['payload']['S'])
    if c['sourceSha']!=SOURCE or jobid in c['active'] or any(s['jobId']==jobid for s in c['slots']):raise RuntimeError('ORIGINAL_JOB_NOT_QUIESCENT')
    if job:
        j=json.loads(job['payload']['S']);r=j['reference']
        if j['phase']!='SUCCEEDED' or j['reason'] is not None or j['attempts']!=1 or not isinstance(j['usage'],dict) or r['kind']!='ARCHITECT' or r['sourceSha']!=SOURCE or r['subject']!=f['subject'] or r['decisionId']!=f['groupId'] or r['requestKey']!=f['draftRequestKey']:raise RuntimeError('ORIGINAL_JOB_OUTCOME_INVALID')
        report['acknowledgedUsage']=j['usage']
        def condition(record):return {'ConditionExpression':'#r = :r AND #p = :p','ExpressionAttributeNames':{'#r':'revision','#p':'payload'},'ExpressionAttributeValues':{':r':record['revision'],':p':record['payload']}}
        transaction=[{'Delete':{'TableName':'KnownEnoughOperationsJournal','Key':key(pk),**condition(job)}},{'ConditionCheck':{'TableName':'KnownEnoughOperationsJournal','Key':key('OPERATIONS#MODEL_JOBS'),**condition(control)}}]
        try:aws('dynamodb','transact-write-items','--transact-items',json.dumps(transaction));report['journalDeletes']=1
        except RuntimeError as error:report['writeError']=str(error)
        if get('KnownEnoughOperationsJournal',pk):raise RuntimeError('ORIGINAL_JOB_DELETE_NOT_VERIFIED')
    if get('KnownEnoughQaControl','TOTAL')!=total:raise RuntimeError('TOTAL_CHANGED_STOP')
    report['result']='ORIGINAL_TERMINAL_JOB_CLEANUP_PASS'
except Exception as error:
    code=str(error) if isinstance(error,RuntimeError) else 'ORIGINAL_CLEANUP_UNVERIFIED'
    report.update(result='BLOCKED',code=code if re.fullmatch('[A-Za-z0-9_]{1,100}',code) else 'AWS_REQUEST_UNVERIFIED')
(ROOT/'fix01-original-usage-report.json').write_text(json.dumps(report)+'\n');print(json.dumps(report))
if report['result']=='BLOCKED':raise SystemExit(1)
