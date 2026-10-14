import sys
sys.path.pop(0) # Avoid the adjacent diagnostic inspect.py shadowing the standard library.
import copy,importlib.util,json,unittest,uuid,hashlib
from pathlib import Path
spec=importlib.util.spec_from_file_location('recovery',Path(__file__).with_name('queue-recovery.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
SOURCE='a'*40;API='b'*64;NOW=400000

def fixture():
 jobs={};slots=[]
 for index in range(3):
  subject='private-subject-'+str(index);draft='draft-'+hashlib.sha256(json.dumps(['garden',subject,'nonce'],separators=(',',':')).encode()).hexdigest()[:40];id=str(uuid.UUID(bytes=hashlib.sha256(json.dumps([SOURCE,'garden',draft],separators=(',',':')).encode()).digest()[:16],version=4))
  ref={'jobId':id,'kind':'ARCHITECT','subject':subject,'decisionId':'garden','reasoningJobId':draft,'sourceSha':SOURCE,'requestKey':'nonce','expiresAt':300000,'authorityHash':'c'*64}
  job={'schemaVersion':1,'revision':1,'reference':ref,'phase':'DEAD' if index<2 else 'READY','reason':'PROVIDER_UNCONFIRMED' if index<2 else None,'lease':None,'attempts':1 if index<2 else 0,'failures':0,'availableAt':index*20000,'reservedTokens':18432 if index<2 else 0,'reservedCostMicros':10000 if index<2 else 0,'usage':None,'recoveryProofHash':None}
  jobs[id]=m.envelope('MODELJOB#'+id,job)
  if index<2:slots.append({'jobId':id,'token':str(uuid.uuid4()),'until':10000+index*20000})
 control=m.envelope('OPERATIONS#MODEL_JOBS',{'schemaVersion':1,'revision':5,'sourceSha':SOURCE,'enabled':True,'active':list(jobs),'slots':slots})
 def budget(pk,value):return {**m.key(pk),'version':{'N':'7'},'payload':{'S':json.dumps(value,separators=(',',':'))}}
 total=budget('TOTAL',{'runs':65,'messages':60,'reservedTokens':500+2*18432,'reservedCostMicros':1000+2*10000});auth=budget('AUTH',{'mode':'standing','approved':True,'invocationLoggingDisabled':True,'retentionReviewed':True})
 baseline={'completedAt':'1970-01-01T00:00:00Z','totals':{'runs':65,'messages':60,'reservedTokens':500,'reservedCostMicros':1000}}
 events=[{'completedAt':9000+index*20000,'eventId':str(uuid.uuid4()),'requestId':str(uuid.uuid4()),'role':'fixed-api-role','model':m.MODEL,'errorCode':None} for index in range(2)]
 return control,jobs,total,auth,events,baseline

def prepare(f):return m.prepare_intent(*f[:5],SOURCE,API,NOW,f[5])
class RecoveryTests(unittest.TestCase):
 def test_completed_ledger_retires_uncertainty_and_expired_pre_call_with_no_refund_or_draft_write(self):
  f=fixture();intent=prepare(f);self.assertEqual((intent['uncertainRetired'],intent['expiredRetired']),(2,1));self.assertEqual(intent['total'],f[2]);self.assertFalse(json.loads(intent['control']['next']['payload']['S'])['enabled'])
  for row in intent['jobs']:
   prior=json.loads(row['prior']['payload']['S']);after=json.loads(row['next']['payload']['S']);self.assertEqual(after['reference'],prior['reference']);self.assertEqual(after['reservedTokens'],prior['reservedTokens']);self.assertIsNone(after['usage']);self.assertEqual(after['phase'],'DEAD')
 def test_elapsed_time_missing_and_duplicate_receipts_never_authorize_recovery(self):
  for change in [[],fixture()[4][:1],fixture()[4]+fixture()[4][:1]]:
   f=list(fixture());f[4]=change
   with self.assertRaisesRegex(ValueError,'PROVIDER_COMPLETION_LEDGER_INCOMPLETE'):prepare(f)
  f=list(fixture());f[4][1]['requestId']=f[4][0]['requestId']
  with self.assertRaisesRegex(ValueError,'PROVIDER_COMPLETION_LEDGER_INCOMPLETE'):prepare(f)
 def test_foreign_identity_source_and_private_or_nonexpired_jobs_are_preserved(self):
  for change in [{'kind':'NEGOTIATION'},{'sourceSha':'d'*40},{'subject':'foreign'},{'expiresAt':NOW+1}]:
   f=list(fixture());id=next(iter(f[1]));job=json.loads(f[1][id]['payload']['S']);job['reference'].update(change);f[1][id]=m.envelope('MODELJOB#'+id,job)
   with self.assertRaises(ValueError):prepare(f)
 def test_incomplete_or_foreign_ledger_is_rejected_even_with_expired_leases(self):
  f=list(fixture());total=json.loads(f[2]['payload']['S']);total['reservedTokens']+=1;f[2]['payload']['S']=json.dumps(total,separators=(',',':'))
  with self.assertRaisesRegex(ValueError,'ATTEMPT_LEDGER_NOT_EXACT'):prepare(f)
 def test_only_fixed_account_role_model_synchronous_cloudtrail_completion_is_admitted(self):
  raw={'recipientAccountId':m.ACCOUNT,'awsRegion':m.REGION,'eventSource':'bedrock.amazonaws.com','eventName':'Converse','eventType':'AwsApiCall','managementEvent':True,'userIdentity':{'arn':f'arn:aws:sts::{m.ACCOUNT}:assumed-role/KnownEnoughStageApiRole/{m.API}','sessionContext':{'sessionIssuer':{'arn':f'arn:aws:iam::{m.ACCOUNT}:role/KnownEnoughStageApiRole'}}},'requestParameters':{'modelId':m.MODEL,'PRIVATE_INPUT':'not exported'},'requestID':str(uuid.uuid4()),'eventID':str(uuid.uuid4()),'eventTime':'1970-01-01T00:00:09Z'}
  event=m.completed_event(raw);self.assertNotIn('PRIVATE',json.dumps(event))
  for key,value in [('recipientAccountId','foreign'),('eventName','ConverseStream'),('eventType','AwsServiceEvent'),('awsRegion','foreign')]:
   changed=copy.deepcopy(raw);changed[key]=value;self.assertIsNone(m.completed_event(changed))
 def test_one_cas_readback_after_lost_ack_preserves_total_and_never_reissues(self):
  intent=prepare(fixture());items={r['prior']['PK']['S']:copy.deepcopy(r['prior']) for r in [intent['control'],*intent['jobs']]};items['TOTAL']=intent['total'];items['AUTH']=intent['authority'];writes=[]
  def call(service,operation,*args):
   if operation=='get-item':return {'Item':copy.deepcopy(items[json.loads(args[args.index('--key')+1])['PK']['S']])}
   self.assertEqual(operation,'transact-write-items');tx=json.loads(args[args.index('--transact-items')+1]);writes.append(tx)
   for item in tx:
    if 'Put' in item:items[item['Put']['Item']['PK']['S']]=item['Put']['Item']
   raise RuntimeError('lost ACK')
  result=m.apply_intent(call,intent,{'intentSha256':m.digest(intent),'backupReadback':'MATCH'});self.assertEqual(result['result'],'PUBLIC_QUEUE_RECOVERY_PASS');self.assertEqual(len(writes),1);self.assertEqual(result['totalWrites'],0)
  self.assertTrue(all(item.get('Put',{}).get('TableName',m.TABLE)==m.TABLE for item in writes[0]))
 def test_backup_missing_and_prewrite_drift_make_zero_mutations(self):
  intent=prepare(fixture())
  with self.assertRaisesRegex(ValueError,'PRIVATE_BACKUP_REQUIRED'):m.apply_intent(lambda *args:None,intent,{})
  with self.assertRaisesRegex(ValueError,'QUEUE_CHANGED_BEFORE_WRITE'):m.apply_intent(lambda *args:{'Item':{}},intent,{'intentSha256':m.digest(intent),'backupReadback':'MATCH'})
if __name__=='__main__':unittest.main()
