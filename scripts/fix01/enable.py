"""Source-bound model control for public drafts. Preserves private retention and schedule."""
import argparse,base64,datetime,json,os,pathlib,re,subprocess
p=argparse.ArgumentParser();p.add_argument('phase',choices=['api','worker','logging','enable','disable']);p.add_argument('--api-sha256');p.add_argument('--worker-sha256');args=p.parse_args()
A='092954139775';SOURCE=os.environ['EXPECTED_SOURCE'];ROOT=pathlib.Path(os.environ['RUNNER_TEMP'])
report={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':SOURCE,'phase':args.phase,'controlWrites':0,'dataWrites':0,'providerCalls':0}
def call(service,op,*argv):
 r=subprocess.run(['aws',service,op,*argv,'--region','us-east-1','--output','json','--no-cli-pager'],capture_output=True,text=True,timeout=20)
 if r.returncode:
  match=re.search(r'An error occurred \((\w+)\)',r.stderr);raise ValueError(service+':'+op+'/'+(match.group(1) if match else 'AWS_CALL_UNAVAILABLE'))
 return json.loads(r.stdout or '{}')
def item(table,pk):return call('dynamodb','get-item','--table-name',table,'--key',json.dumps({'PK':{'S':pk},'SK':{'S':'STATE'}}),'--consistent-read').get('Item')
try:
 role={'api':'KnownEnoughGithubPrimaryRelease','worker':'KnownEnoughGithubModelJobRelease','logging':'KnownEnoughGithubQaRelease','enable':'KnownEnoughGithubModelJobOperations','disable':'KnownEnoughGithubModelJobOperations'}[args.phase]
 identity=call('sts','get-caller-identity')
 if identity['Account']!=A or not identity['Arn'].startswith('arn:aws:sts::'+A+':assumed-role/'+role+'/'):raise ValueError('OWN_ROLE_TARGET_INVALID')
 if args.phase in ['api','worker']:
  expected=args.api_sha256 if args.phase=='api' else args.worker_sha256
  if not expected or not re.fullmatch('[a-f0-9]{64}',expected):raise ValueError('MISSING_INDEPENDENT_CODE_HASH')
  config=call('lambda','get-function-configuration','--function-name','known-enough-stage-api' if args.phase=='api' else 'known-enough-stage-model-jobs')
  if base64.b64decode(config['CodeSha256']).hex()!=expected or config.get('LastUpdateStatus')!='Successful' or config.get('Runtime')!='nodejs24.x':raise ValueError('INSTALLED_CODE_MISMATCH')
  report['codeSha256']=expected
  if args.phase=='worker':
   rule=call('events','describe-rule','--name','KnownEnoughModelJobs')
   if rule.get('State')!='DISABLED':raise ValueError('PRIVATE_WORKER_SCHEDULE_CHANGED_STOP')
   report['schedule']='DISABLED'
 elif args.phase=='logging':
  config=call('bedrock','get-model-invocation-logging-configuration').get('loggingConfig')
  if config and any(config.get(name) is not False for name in ['textDataDeliveryEnabled','imageDataDeliveryEnabled','embeddingDataDeliveryEnabled','videoDataDeliveryEnabled']):raise ValueError('PROVIDER_LOGGING_NOT_DISABLED')
  report['logging']='DISABLED'
 else:
  if args.phase=='enable':
   for phase in ['api','worker','logging']:
    proof=json.loads((ROOT/('fix01-'+phase+'-guard.json')).read_text())
    if proof.get('source')!=SOURCE or proof.get('result')!='GUARD_PASS':raise ValueError('CURRENT_SOURCE_GUARDS_MISSING')
  current=item('KnownEnoughOperationsJournal','OPERATIONS#MODEL_JOBS');auth=item('KnownEnoughQaControl','AUTH');retention=item('KnownEnoughOperationsJournal','OPERATIONS#RETENTION');totals=item('KnownEnoughQaControl','TOTAL')
  if not current or not auth or not totals or not retention:raise ValueError('CURRENT_CONTROLS_MISSING')
  state=json.loads(current['payload']['S']);standing=json.loads(auth['payload']['S']);policy=json.loads(retention['payload']['S'])
  if state.get('sourceSha')!=SOURCE or state.get('active')!=[] or state.get('slots')!=[]:raise ValueError('SOURCE_OR_ACTIVE_JOBS_STOP')
  if policy.get('enabled') is not False:raise ValueError('PRIVATE_RETENTION_GATE_CHANGED_STOP')
  if standing.get('mode')!='standing' or any(standing.get(name) is not True for name in ['approved','retentionReviewed','invocationLoggingDisabled']):raise ValueError('STANDING_AUTHORITY_NOT_VERIFIED')
  desired=args.phase=='enable';report['priorEnabled']=state.get('enabled');report['privateRetention']='DISABLED'
  if state.get('enabled')!=desired:
   new={**state,'revision':state['revision']+1,'enabled':desired}
   transaction=[{'Put':{'TableName':'KnownEnoughOperationsJournal','Item':{**current,'revision':{'N':str(new['revision'])},'payload':{'S':json.dumps(new,separators=(',',':'))}},'ConditionExpression':'#r = :r AND #p = :p','ExpressionAttributeNames':{'#r':'revision','#p':'payload'},'ExpressionAttributeValues':{':r':current['revision'],':p':current['payload']}}}]
   for table,record,attribute in [('KnownEnoughQaControl',auth,'version'),('KnownEnoughOperationsJournal',retention,'revision')]:
    transaction.append({'ConditionCheck':{'TableName':table,'Key':{'PK':record['PK'],'SK':record['SK']},'ConditionExpression':'#v = :v AND #p = :p','ExpressionAttributeNames':{'#v':attribute,'#p':'payload'},'ExpressionAttributeValues':{':v':record[attribute],':p':record['payload']}}})
   try:call('dynamodb','transact-write-items','--transact-items',json.dumps(transaction));report['controlWrites']=1
   except ValueError as error:report['writeError']=str(error)
   observed=item('KnownEnoughOperationsJournal','OPERATIONS#MODEL_JOBS')
   if not observed or json.loads(observed['payload']['S'])!=new:raise ValueError('CONTROL_WRITE_NOT_VERIFIED')
  if item('KnownEnoughQaControl','TOTAL')!=totals:raise ValueError('TOTAL_CHANGED_STOP')
  report['enabled']=desired;report['totals']='UNCHANGED'
 report['result']='GUARD_PASS' if args.phase in ['api','worker','logging'] else 'CONTROL_READBACK_PASS'
except Exception as error:report['result']='BLOCKED';report['error']=str(error) if isinstance(error,ValueError) else 'ENABLE_UNAVAILABLE'
path=ROOT/('fix01-'+args.phase+'-guard.json');path.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
if report['result']=='BLOCKED':raise SystemExit(1)
