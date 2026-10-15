import sys
sys.path.pop(0)
import copy,hashlib,io,json,os,runpy,subprocess,tempfile,unittest,uuid
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch
SOURCE='6b6aa79070689caf17568fb59ee5dc3d677effe4'
class Tests(unittest.TestCase):
 def execute(self,phase='SUCCEEDED',lost=False,foreign=False,active=False,absent=False,rebound=False):
  f={'runId':'owned-run','subject':'owned','groupId':'garden','draftRequestKey':'nonce','deleted':True,'mailboxRemoved':True}
  state={'sourceSha':SOURCE,'runId':'owned-run','fixtures':[f,{**f,'subject':'member','groupId':None}]}
  draft='draft-'+hashlib.sha256(json.dumps(['garden','owned','nonce'],separators=(',',':')).encode()).hexdigest()[:40]
  jobid=str(uuid.UUID(bytes=hashlib.sha256(json.dumps([SOURCE,'garden',draft],separators=(',',':')).encode()).digest()[:16],version=4));pk='MODELJOB#'+jobid
  def row(value):return {'revision':{'N':'1'},'payload':{'S':json.dumps(value)}}
  records={'TOTAL':row({'reservedTokens':18432,'reservedCostMicros':10000}),'OPERATIONS#MODEL_JOBS':row({'sourceSha':SOURCE,'active':[jobid] if active else [],'slots':[]}),pk:row({'phase':phase,'reason':None if phase=='SUCCEEDED' else 'PROVIDER_UNCONFIRMED','attempts':1,'usage':{'inputTokens':12,'outputTokens':3},'reference':{'kind':'ARCHITECT','sourceSha':SOURCE,'subject':'owned','decisionId':'garden','requestKey':'nonce'}})}
  if absent:del records[pk]
  if rebound:records['OPERATIONS#MODEL_JOBS']=row({'sourceSha':'c'*40,'active':[jobid] if active else [],'slots':[]})
  prior=copy.deepcopy(records['TOTAL']);writes=[]
  def aws(args,**kwargs):
   service,operation=args[1:3];value={}
   if operation=='get-caller-identity':value={'Account':'foreign' if foreign else '092954139775','Arn':'arn:aws:sts::092954139775:assumed-role/KnownEnoughGithubModelJobOperations/owned'}
   elif operation=='get-item':value={'Item':records.get(json.loads(args[args.index('--key')+1])['PK']['S'])}
   elif operation=='transact-write-items':
    tx=json.loads(args[args.index('--transact-items')+1]);writes.append(tx);del records[pk]
    if lost:return subprocess.CompletedProcess(args,1,'','An error occurred (RequestTimeout)')
   else:raise AssertionError('Unexpected operation')
   return subprocess.CompletedProcess(args,0,json.dumps(value),'')
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);(root/'partition-cutover-private').mkdir();(root/'partition-cutover-private/owned-fixtures-private.json').write_text(json.dumps(state))
   with patch.dict(os.environ,{'RUNNER_TEMP':folder}),patch('subprocess.run',aws),redirect_stdout(io.StringIO()):
    try:runpy.run_path(str(Path(__file__).with_name('original-usage.py')),run_name='__main__')
    except SystemExit:pass
   report=json.loads((root/'fix01-original-usage-report.json').read_text())
  self.assertEqual(records['TOTAL'],prior)
  return report,writes
 def test_known_completed_cleanup_preserves_totals_and_lost_ack_never_replays(self):
  for lost in [False,True]:
   report,writes=self.execute(lost=lost);self.assertEqual(report['result'],'ORIGINAL_TERMINAL_JOB_CLEANUP_PASS');self.assertEqual(len(writes),1);self.assertEqual(report['totalWrites'],0)
   self.assertEqual(len(writes[0]),2);self.assertIn('ConditionCheck',writes[0][1])
 def test_unknown_active_or_foreign_original_is_never_deleted(self):
  for kwargs in [{'phase':'DEAD'},{'active':True},{'foreign':True}]:
   report,writes=self.execute(**kwargs);self.assertEqual(report['result'],'BLOCKED');self.assertEqual(writes,[])
 def test_absent_original_is_read_only_after_a_later_source_rebind_but_existing_or_active_old_jobs_remain_protected(self):
  report,writes=self.execute(absent=True,rebound=True);self.assertEqual(report['result'],'ORIGINAL_TERMINAL_JOB_CLEANUP_PASS');self.assertEqual(writes,[])
  for kwargs in [{'rebound':True},{'absent':True,'rebound':True,'active':True}]:
   report,writes=self.execute(**kwargs);self.assertEqual(report['result'],'BLOCKED');self.assertEqual(writes,[])
if __name__=='__main__':unittest.main()
