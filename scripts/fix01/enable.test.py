"""Exercise real control script with bounded AWS response stubs, including lost ACK."""
import sys
sys.path.pop(0)  # Avoid local inspect.py shadowing the standard library.
import contextlib,io,json,os,pathlib,runpy,tempfile,unittest
from unittest.mock import patch
SOURCE='a'*40
class EnableChecks(unittest.TestCase):
 def exercise(self,alter=None,lost=False):
  state={'schemaVersion':1,'revision':3,'enabled':False,'sourceSha':SOURCE,'active':[],'slots':[]}
  standing={'mode':'standing','approved':True,'retentionReviewed':True,'invocationLoggingDisabled':True}
  policy={'revision':2,'enabled':False}
  def row(pk,value,field='revision'):
   return {'PK':{'S':pk},'SK':{'S':'STATE'},field:{'N':str(value.get(field,2))},'payload':{'S':json.dumps(value)}}
  records={'OPERATIONS#MODEL_JOBS':row('OPERATIONS#MODEL_JOBS',state),'AUTH':row('AUTH',standing,'version'),'OPERATIONS#RETENTION':row('OPERATIONS#RETENTION',policy),'TOTAL':row('TOTAL',{'runs':65,'reservedTokens':100,'reservedCostMicros':200,'messages':60},'version')}
  if alter:alter(records)
  writes=[]
  def run(argv,**_):
   service,operation=argv[1:3];value={};code=0;stderr=''
   if service=='sts':value={'Account':'092954139775','Arn':'arn:aws:sts::092954139775:assumed-role/KnownEnoughGithubModelJobOperations/test'}
   elif operation=='get-item':value={'Item':records[json.loads(argv[argv.index('--key')+1])['PK']['S']]}
   elif operation=='transact-write-items':
    transaction=json.loads(argv[argv.index('--transact-items')+1]);writes.append(transaction);records['OPERATIONS#MODEL_JOBS']=transaction[0]['Put']['Item']
    if lost:code=1;stderr='An error occurred (RequestTimeout)'
   else:raise AssertionError(operation)
   return type('Response',(),{'returncode':code,'stderr':stderr,'stdout':json.dumps(value)})()
  with tempfile.TemporaryDirectory() as folder:
   for phase in ['api','worker','logging']:pathlib.Path(folder,'fix01-'+phase+'-guard.json').write_text(json.dumps({'source':SOURCE,'result':'GUARD_PASS'}))
   with patch.dict(os.environ,{'EXPECTED_SOURCE':SOURCE,'RUNNER_TEMP':folder}),patch.object(sys,'argv',['enable.py','enable']),patch('subprocess.run',run),contextlib.redirect_stdout(io.StringIO()):
    try:runpy.run_path('scripts/fix01/enable.py',run_name='__main__')
    except SystemExit:pass
   result=json.loads(pathlib.Path(folder,'fix01-enable-guard.json').read_text())
  return result,writes,records
 def test_lost_ack_readback_changes_only_enable_preserves_usage_and_private_gate(self):
  result,writes,records=self.exercise(lost=True);self.assertEqual(result['result'],'CONTROL_READBACK_PASS');self.assertEqual(len(writes),1)
  self.assertEqual([item.get('ConditionCheck',{}).get('Key',{}).get('PK',{}).get('S') for item in writes[0][1:]],['AUTH','OPERATIONS#RETENTION'])
  self.assertFalse(json.loads(records['OPERATIONS#RETENTION']['payload']['S'])['enabled']);self.assertEqual(result['totals'],'UNCHANGED')
 def test_source_and_pending_jobs_stop_without_write(self):
  for field,value in [('sourceSha','b'*40),('active',['unknown']),('slots',['unknown'])]:
   def change(records):
    row=records['OPERATIONS#MODEL_JOBS'];state=json.loads(row['payload']['S']);state[field]=value;row['payload']['S']=json.dumps(state)
   result,writes,_=self.exercise(change);self.assertEqual(result['result'],'BLOCKED');self.assertEqual(writes,[])
 def test_retention_enabled_stops_without_write(self):
  def change(records):records['OPERATIONS#RETENTION']['payload']['S']=json.dumps({'enabled':True})
  result,writes,_=self.exercise(change);self.assertEqual(result['error'],'PRIVATE_RETENTION_GATE_CHANGED_STOP');self.assertEqual(writes,[])
if __name__=='__main__':unittest.main()
