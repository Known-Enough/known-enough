"""Own public job evidence and conditional terminal cleanup. Never resets counters."""
import datetime,hashlib,json,os,pathlib,re,subprocess,sys,uuid
ROOT=pathlib.Path(os.environ['RUNNER_TEMP']);SOURCE=os.environ['EXPECTED_SOURCE'];before='--before' in sys.argv
report={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':SOURCE,'result':'NOT_EXECUTED','providerCalls':'NOT_VERIFIED','journalDeletes':0,'totalWrites':0}
def call(service,operation,*args):
 response=subprocess.run(['aws',service,operation,*args,'--region','us-east-1','--output','json','--no-cli-pager'],capture_output=True,text=True,timeout=20)
 if response.returncode:
  match=re.search(r'An error occurred \((\w+)\)',response.stderr);raise ValueError(service+':'+operation+'/'+(match.group(1) if match else 'AWS_CALL_UNAVAILABLE'))
 return json.loads(response.stdout or '{}')
def key(pk):return {'PK':{'S':pk},'SK':{'S':'STATE'}}
def get(table,pk):return call('dynamodb','get-item','--table-name',table,'--key',json.dumps(key(pk)),'--consistent-read').get('Item')
try:
 identity=call('sts','get-caller-identity')
 if identity['Account']!='092954139775' or not identity['Arn'].startswith('arn:aws:sts::092954139775:assumed-role/KnownEnoughGithubModelJobOperations/'):raise ValueError('OWN_ROLE_TARGET_INVALID')
 total=get('KnownEnoughQaControl','TOTAL');values=json.loads(total['payload']['S']);report['totals']=values
 if before:report['result']='USAGE_BASELINE_READ_PASS';report['providerCalls']=0
 else:
  baseline=json.loads((ROOT/'fix01-usage-before-report.json').read_text())
  if baseline['source']!=SOURCE:raise ValueError('USAGE_SOURCE_MISMATCH')
  fixtures=json.loads((ROOT/'partition-cutover-private/owned-fixtures-private.json').read_text())
  if fixtures['sourceSha']!=SOURCE:raise ValueError('OWN_FIXTURE_SOURCE_MISMATCH')
  fixture=next((row for row in fixtures['fixtures'] if row.get('groupId')),None)
  if not fixture:report['result']='NO_OWN_MODEL_REQUEST';report['providerCalls']=0
  else:
   if not fixture.get('draftRequestKey'):raise ValueError('OWN_REQUEST_NONCE_NOT_OBSERVED')
   owned=[('ARCHITECT',fixture['groupId'],fixture['draftRequestKey'])]
   if fixture.get('ownerRequestKey'):
    if not fixture.get('decisionId') or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',fixture['ownerRequestKey']):raise ValueError('OWN_OWNER_REQUEST_INVALID')
    owned.append(('OWNER',fixture['decisionId'],fixture['ownerRequestKey']))
   report['jobs']=[];report['providerCalls']=0
   for kind,decision_id,request_key in owned:
    draft=('draft-'+hashlib.sha256(json.dumps([fixture['groupId'],fixture['subject'],request_key],separators=(',',':')).encode()).hexdigest()[:40]) if kind=='ARCHITECT' else 'owner-'+hashlib.sha256(json.dumps([fixture['subject'],decision_id,request_key],separators=(',',':')).encode()).hexdigest()[:40]
    digest=hashlib.sha256(json.dumps([SOURCE,decision_id,draft],separators=(',',':')).encode()).digest()[:16];jobid=str(uuid.UUID(bytes=digest,version=4));pk='MODELJOB#'+jobid
    saved=get('KnownEnoughOperationsJournal',pk)
    if not saved:raise ValueError('MODEL_OUTCOME_UNAVAILABLE')
    job=json.loads(saved['payload']['S']);ref=job['reference']
    if ref['kind']!=kind or ref['subject']!=fixture['subject'] or ref['sourceSha']!=SOURCE or ref['decisionId']!=decision_id or ref['requestKey']!=request_key:raise ValueError('OWN_MODEL_REFERENCE_MISMATCH')
    report['providerCalls']+=job['attempts'];report['jobs'].append({'kind':kind,'jobPhase':job['phase'],'reason':job['reason'],'usage':job['usage'],'reservedTokens':job['reservedTokens'],'reservedCostMicros':job['reservedCostMicros']})
    report['usageDelta']={name:values[name]-baseline['totals'][name] for name in ['runs','reservedTokens','reservedCostMicros','messages']}
    if job['phase'] not in ['SUCCEEDED','DEAD'] or job['reason']=='PROVIDER_UNCONFIRMED':raise ValueError('PROVIDER_OUTCOME_UNKNOWN_PRESERVE_JOB')
    control=get('KnownEnoughOperationsJournal','OPERATIONS#MODEL_JOBS');state=json.loads(control['payload']['S'])
    if state['sourceSha']!=SOURCE or jobid in state['active'] or any(slot['jobId']==jobid for slot in state['slots']):raise ValueError('MODEL_NOT_QUIESCENT')
    transaction=[{'Delete':{'TableName':'KnownEnoughOperationsJournal','Key':key(pk),'ConditionExpression':'#r = :r AND #p = :p','ExpressionAttributeNames':{'#r':'revision','#p':'payload'},'ExpressionAttributeValues':{':r':saved['revision'],':p':saved['payload']}}},{'ConditionCheck':{'TableName':'KnownEnoughOperationsJournal','Key':key('OPERATIONS#MODEL_JOBS'),'ConditionExpression':'#r = :r AND #p = :p','ExpressionAttributeNames':{'#r':'revision','#p':'payload'},'ExpressionAttributeValues':{':r':control['revision'],':p':control['payload']}}}]
    try:call('dynamodb','transact-write-items','--transact-items',json.dumps(transaction));report['deleteAcknowledged']=True
    except ValueError as error:report['cleanupError']=str(error)
    if get('KnownEnoughOperationsJournal',pk):raise ValueError('OWN_TERMINAL_JOURNAL_CLEANUP_NOT_VERIFIED')
    report['journalDeletes']+=1
   report['result']='OWN_USAGE_AND_TERMINAL_CLEANUP_PASS'
except Exception as error:report['result']='BLOCKED';report['error']=str(error) if isinstance(error,ValueError) else 'USAGE_CHECK_UNAVAILABLE'
name='fix01-usage-before-report.json' if before else 'fix01-usage-report.json';(ROOT/name).write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
if report['result']=='BLOCKED':raise SystemExit(1)
