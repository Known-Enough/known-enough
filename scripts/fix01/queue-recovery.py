"""FIX01 public queue recovery: verified AWS completion receipts, private backup, one CAS; no model call or refund."""
import base64,copy,datetime,hashlib,json,os,pathlib,re,subprocess,sys,time,uuid
ACCOUNT='092954139775';REGION='us-east-1';TABLE='KnownEnoughOperationsJournal';BUDGET='KnownEnoughQaControl';MODEL='amazon.nova-lite-v1:0'
API='known-enough-stage-api';BUCKET='known-enough-qa-artifacts-092954139775'
ROLES={'events':'KnownEnoughGithubStagingInspector','prepare':'KnownEnoughGithubModelJobOperations','backup':'KnownEnoughGithubQaRelease','apply':'KnownEnoughGithubModelJobOperations'}
def fail(code):raise ValueError(code)
def digest(value):return hashlib.sha256(json.dumps(value,separators=(',',':'),sort_keys=True).encode()).hexdigest()
def key(pk):return {'PK':{'S':pk},'SK':{'S':'STATE'}}
def instant(value):return int(datetime.datetime.fromisoformat(value.replace('Z','+00:00')).timestamp()*1000)
def envelope(pk,value):return {**key(pk),'revision':{'N':str(value['revision'])},'payload':{'S':json.dumps(value,separators=(',',':'))}}
def payload(row,pk,field='revision'):
 if not row or set(row)!={'PK','SK','payload',field} or row['PK']!={'S':pk} or row['SK']!={'S':'STATE'} or not re.fullmatch('[1-9][0-9]*',row[field].get('N','')):fail('INVALID_RECORD')
 value=json.loads(row['payload']['S'])
 if json.dumps(value,separators=(',',':'))!=row['payload']['S'] or field=='revision' and value.get('revision')!=int(row[field]['N']):fail('INVALID_RECORD')
 return value

def completed_event(raw):
 issuer=raw.get('userIdentity',{}).get('sessionContext',{}).get('sessionIssuer',{})
 if raw.get('recipientAccountId')!=ACCOUNT or raw.get('awsRegion')!=REGION or raw.get('eventSource')!='bedrock.amazonaws.com' or raw.get('eventName')!='Converse' or raw.get('eventType')!='AwsApiCall' or raw.get('managementEvent') is not True or issuer.get('arn')!=f'arn:aws:iam::{ACCOUNT}:role/KnownEnoughStageApiRole' or raw.get('userIdentity',{}).get('arn')!=f'arn:aws:sts::{ACCOUNT}:assumed-role/KnownEnoughStageApiRole/{API}' or raw.get('requestParameters',{}).get('modelId')!=MODEL:return None
 for name in ['requestID','eventID']:
  if not isinstance(raw.get(name),str) or not re.fullmatch('[A-Za-z0-9_-]{1,100}',raw[name]):fail('INVALID_PROVIDER_RECEIPT')
 event={'completedAt':instant(raw['eventTime']),'eventId':raw['eventID'],'requestId':raw['requestID'],'role':issuer['arn'],'model':MODEL,'errorCode':raw.get('errorCode')}
 if event['errorCode'] is not None and not re.fullmatch('[A-Za-z0-9_.]{1,100}',event['errorCode']):fail('INVALID_PROVIDER_RECEIPT')
 return event

def completion_proof(total,baseline,events,now):
 # Complete, authenticated AWS receipts must cover the entire reserved-attempt ledger.
 # There is no guessed per-job timestamp correlation, elapsed-time proof, refund or reissue.
 tokens=total['reservedTokens']-baseline['totals']['reservedTokens'];cost=total['reservedCostMicros']-baseline['totals']['reservedCostMicros']
 if tokens<=0 or tokens%18432 or cost<=0 or cost%10000 or tokens//18432!=cost//10000 or tokens//18432>256 or any(total[name]!=baseline['totals'][name] for name in ['runs','messages']):fail('ATTEMPT_LEDGER_NOT_EXACT')
 start=instant(baseline['completedAt']);qualified=[event for event in events if start<=event['completedAt']<=now]
 if len(qualified)!=tokens//18432 or len({event['eventId'] for event in qualified})!=len(qualified) or len({event['requestId'] for event in qualified})!=len(qualified):fail('PROVIDER_COMPLETION_LEDGER_INCOMPLETE')
 return {'baseline':baseline,'completedRequests':qualified,'reservedAttempts':tokens//18432,'totals':total}

def prepare_intent(control_row,jobs,total,auth,events,source,api_hash,now,baseline):
 control=payload(control_row,'OPERATIONS#MODEL_JOBS');values=payload(total,'TOTAL','version');authority=payload(auth,'AUTH','version')
 if authority.get('mode')!='standing' or authority.get('approved') is not True or authority.get('invocationLoggingDisabled') is not True or authority.get('retentionReviewed') is not True:fail('STANDING_AUTHORITY_REQUIRED')
 if control.get('sourceSha')!=source or control.get('enabled') is not True or len(control['active'])!=len(jobs) or not 1<=len(jobs)<=64 or len(set(control['active']))!=len(jobs):fail('QUEUE_SOURCE_OR_SCOPE_CHANGED')
 if control.get('schemaVersion')!=1 or len(control['slots'])>2 or len({slot['jobId'] for slot in control['slots']})!=len(control['slots']):fail('INVALID_QUEUE_CONTROL')
 slots={slot['jobId']:slot for slot in control['slots']};coverage=completion_proof(values,baseline,events,now);replacements=[];uncertain=0;expired=0
 for job_id in control['active']:
  row=jobs.get(job_id);job=payload(row,'MODELJOB#'+job_id);ref=job['reference']
  if str(uuid.UUID(job_id))!=job_id or ref.get('jobId')!=job_id or ref.get('sourceSha')!=source or ref.get('kind')!='ARCHITECT' or ref.get('expiresAt',now+1)>now:fail('ONLY_EXPIRED_PUBLIC_JOBS_ALLOWED')
  expected='draft-'+hashlib.sha256(json.dumps([ref['decisionId'],ref['subject'],ref['requestKey']],separators=(',',':')).encode()).hexdigest()[:40]
  job_digest=hashlib.sha256(json.dumps([source,ref['decisionId'],expected],separators=(',',':')).encode()).digest()[:16]
  if expected!=ref['reasoningJobId'] or str(uuid.UUID(bytes=job_digest,version=4))!=job_id:fail('JOB_IDENTITY_MISMATCH')
  changed=copy.deepcopy(job);changed['revision']+=1
  if job['phase']=='DEAD' and job['reason']=='PROVIDER_UNCONFIRMED':
   if job['attempts']!=1 or job['usage'] is not None or job['lease'] is not None or slots.get(job_id,{}).get('until',now+1)>now:fail('UNCERTAIN_JOB_NOT_EXPECTED')
   changed['reason']='STALE';changed['recoveryProofHash']=digest({'job':job,'awsCompletedAttemptLedger':coverage,'apiSha256':api_hash});uncertain+=1
  elif job['phase'] in ['READY','LEASED'] and job['attempts']==0 and job['reservedTokens']==0 and job['reservedCostMicros']==0 and job['usage'] is None:
   if job['lease'] and job['lease']['until']>now:fail('LIVE_PRECALL_LEASE_PRESERVED')
   changed.update(phase='DEAD',reason='EXPIRED',lease=None);expired+=1
  else:fail('OTHER_JOB_PRESERVED')
  replacements.append({'prior':row,'next':envelope('MODELJOB#'+job_id,changed)})
 if set(slots)-set(control['active']):fail('FOREIGN_SLOT_PRESERVED')
 changed=copy.deepcopy(control);changed.update(revision=control['revision']+1,enabled=False,active=[],slots=[])
 return {'purpose':'FIX01_PUBLIC_QUEUE_RECOVERY','source':source,'apiSha256':api_hash,'control':{'prior':control_row,'next':envelope('OPERATIONS#MODEL_JOBS',changed)},'jobs':replacements,'total':total,'authority':auth,'completedEvents':events,'uncertainRetired':uncertain,'expiredRetired':expired,'totals':values}

def condition(row,field='revision'):
 return {'ConditionExpression':'#v = :v AND #p = :p','ExpressionAttributeNames':{'#v':field,'#p':'payload'},'ExpressionAttributeValues':{':v':row[field],':p':row['payload']}}

def apply_intent(call,intent,receipt):
 if receipt.get('intentSha256')!=digest(intent) or receipt.get('backupReadback')!='MATCH' or intent.get('purpose')!='FIX01_PUBLIC_QUEUE_RECOVERY':fail('PRIVATE_BACKUP_REQUIRED')
 get=lambda table,pk:call('dynamodb','get-item','--table-name',table,'--key',json.dumps(key(pk)),'--consistent-read').get('Item')
 rows=[intent['control'],*intent['jobs']]
 for row in rows:
  if get(TABLE,row['prior']['PK']['S'])!=row['prior']:fail('QUEUE_CHANGED_BEFORE_WRITE')
 if get(BUDGET,'TOTAL')!=intent['total'] or get(BUDGET,'AUTH')!=intent['authority']:fail('AUTHORITY_OR_USAGE_CHANGED')
 transaction=[{'Put':{'TableName':TABLE,'Item':row['next'],**condition(row['prior'])}} for row in rows]
 transaction.append({'ConditionCheck':{'TableName':BUDGET,'Key':key('AUTH'),**condition(intent['authority'],'version')}})
 try:call('dynamodb','transact-write-items','--client-request-token',str(uuid.uuid4()),'--transact-items',json.dumps(transaction))
 except Exception:pass # Read exact disposition once; never repeat an ambiguous transaction.
 if any(get(TABLE,row['next']['PK']['S'])!=row['next'] for row in rows):fail('QUEUE_RECOVERY_NOT_CONFIRMED')
 if get(BUDGET,'TOTAL')!=intent['total']:fail('USAGE_CHANGED_DURING_RECOVERY')
 return {'result':'PUBLIC_QUEUE_RECOVERY_PASS','uncertainRetired':intent['uncertainRetired'],'expiredRetired':intent['expiredRetired'],'active':0,'slots':0,'state':'DISABLED','totalsUnchanged':True,'totalWrites':0,'providerCalls':0,'transactionWrites':1,'draftWrites':0}

def main(phase):
 baseline=json.loads((pathlib.Path(__file__).with_name('queue-baseline.json')).read_text());source=os.environ['EXPECTED_SOURCE'];old=os.environ['PREVIOUS_JOB_SOURCE'];api_hash=os.environ['API_SHA256'];root=pathlib.Path(os.environ.get('FIX01_QUEUE_DIRECTORY') or os.environ['RUNNER_TEMP']);private=root/'fix01-queue-private';private.mkdir(mode=0o700,exist_ok=True)
 if not re.fullmatch('[a-f0-9]{40}',source) or not re.fullmatch('[a-f0-9]{40}',old) or not re.fullmatch('[a-f0-9]{64}',api_hash):fail('SOURCE_REQUIRED')
 def call(service,operation,*args):
  result=subprocess.run(['aws',service,operation,*args,'--region',REGION,'--output','json','--no-cli-pager'],capture_output=True,text=True,timeout=30)
  if result.returncode:
   code=re.search(r'An error occurred \(([A-Za-z0-9]+)\)',result.stderr);fail(service+':'+operation+'/'+(code.group(1) if code else 'AWS_CALL_UNAVAILABLE'))
  return json.loads(result.stdout or '{}')
 identity=call('sts','get-caller-identity');admin='--admin' in sys.argv
 if identity.get('Account')!=ACCOUNT or not admin and not identity.get('Arn','').startswith(f'arn:aws:sts::{ACCOUNT}:assumed-role/{ROLES[phase]}/'):fail('OWN_ROLE_TARGET_INVALID')
 def save(name,value):
  path=private/name;path.write_text(json.dumps(value,separators=(',',':')));path.chmod(0o600)
 if phase=='events':
  config=call('lambda','get-function-configuration','--function-name',API)
  if base64.b64decode(config['CodeSha256']).hex()!=api_hash or config.get('LastUpdateStatus')!='Successful' or config.get('Role')!=f'arn:aws:iam::{ACCOUNT}:role/KnownEnoughStageApiRole':fail('LIVE_API_CHANGED')
  variables=config.get('Environment',{}).get('Variables',{})
  if variables.get('KE14_MODEL_MODE')!='DISABLED' or variables.get('KE14_PAID_CALLS_APPROVED')!='false':fail('LEGACY_MODELS_NOT_DISABLED')
  now=datetime.datetime.now(datetime.timezone.utc);start=baseline['completedAt'];end=now.isoformat();events=[];cursor=None
  for _ in range(20):
   args=['--lookup-attributes','AttributeKey=EventName,AttributeValue=Converse','--start-time',start,'--end-time',end,'--max-results','50','--no-paginate']
   if cursor:args+=['--next-token',cursor]
   page=call('cloudtrail','lookup-events',*args)
   for row in page.get('Events',[]):
    event=completed_event(json.loads(row['CloudTrailEvent']))
    if event:events.append(event)
   cursor=page.get('NextToken')
   if not cursor:break
   time.sleep(.6)
  if cursor:fail('PROVIDER_EVENTS_TRUNCATED')
  save('events.json',{'source':source,'apiSha256':api_hash,'events':events});return {'result':'PROVIDER_COMPLETION_READ_PASS','events':len(events),'writes':0,'providerCalls':0}
 if phase=='prepare':
  evidence=json.loads((private/'events.json').read_text())
  if evidence['source']!=source or evidence['apiSha256']!=api_hash:fail('PROVIDER_EVIDENCE_SOURCE_MISMATCH')
  get=lambda table,pk:call('dynamodb','get-item','--table-name',table,'--key',json.dumps(key(pk)),'--consistent-read').get('Item')
  control=get(TABLE,'OPERATIONS#MODEL_JOBS');state=payload(control,'OPERATIONS#MODEL_JOBS');jobs={id:get(TABLE,'MODELJOB#'+id) for id in state['active']}
  intent=prepare_intent(control,jobs,get(BUDGET,'TOTAL'),get(BUDGET,'AUTH'),evidence['events'],old,api_hash,int(datetime.datetime.now(datetime.timezone.utc).timestamp()*1000),baseline);intent['checkedSource']=source;save('intent.json',intent)
  return {'result':'QUEUE_RECOVERY_PREVIEW_READY','uncertainRetired':intent['uncertainRetired'],'expiredRetired':intent['expiredRetired'],'writes':0,'providerCalls':0}
 intent=json.loads((private/'intent.json').read_text())
 if intent.get('checkedSource')!=source or intent['source']!=old or intent['apiSha256']!=api_hash:fail('INTENT_SOURCE_MISMATCH')
 if phase=='backup':
  backup_key='ops01-owned/'+str(uuid.uuid4())+'/fix01-queue-recovery-private.json';data=private/'intent.json'
  try:call('s3api','put-object','--bucket',BUCKET,'--key',backup_key,'--body',str(data),'--server-side-encryption','AES256','--if-none-match','*')
  except Exception:pass
  saved=private/'backup-readback.json';call('s3api','get-object','--bucket',BUCKET,'--key',backup_key,str(saved))
  if digest(json.loads(saved.read_text()))!=digest(intent):fail('PRIVATE_BACKUP_NOT_VERIFIED')
  save('backup-receipt.json',{'intentSha256':digest(intent),'backupReadback':'MATCH','key':backup_key});return {'result':'QUEUE_PRIVATE_BACKUP_PASS','writes':1,'providerCalls':0}
 if phase=='apply':return apply_intent(call,intent,json.loads((private/'backup-receipt.json').read_text()))
 fail('INVALID_PHASE')
if __name__=='__main__':
 phase=sys.argv[1];root=pathlib.Path(os.environ.get('FIX01_QUEUE_DIRECTORY') or os.environ['RUNNER_TEMP'])
 try:report=main(phase)
 except Exception as error:
  code=str(error) if isinstance(error,ValueError) and re.fullmatch('[A-Za-z0-9_:./-]{1,140}',str(error)) else 'QUEUE_RECOVERY_UNAVAILABLE';report={'result':'BLOCKED','code':code,'providerCalls':0,'draftWrites':0,'totalWrites':0}
 report['source']=os.environ['EXPECTED_SOURCE'];(root/('fix01-queue-'+phase+'-report.json')).write_text(json.dumps(report)+'\n');print(json.dumps(report))
 if report['result']=='BLOCKED':raise SystemExit(1)
