"""Exact IAM scope, foreign-policy preservation and unknown-write readback."""
import sys
sys.path.pop(0)
import contextlib,io,json,os,pathlib,runpy,tempfile,unittest
from unittest.mock import patch
class RepairChecks(unittest.TestCase):
 def exercise(self,foreign=False,lost=False,wrong=False):
  writes=[];saved={'Version':'2012-10-17','Statement':[]} if foreign else None
  def run(argv,**_):
   nonlocal saved
   service,op=argv[1:3];value={};code=0;stderr=''
   if service=='sts':value={'Account':'000000000000' if wrong else '092954139775'}
   elif op=='get-role':value={'Role':{'RoleName':'KnownEnoughStageApiRole'}}
   elif op=='get-role-policy':
    if saved is None:code=1;stderr='An error occurred (NoSuchEntity)'
    else:value={'PolicyDocument':saved}
   elif op=='put-role-policy':
    self.assertEqual(argv[argv.index('--role-name')+1],'KnownEnoughStageApiRole');self.assertEqual(argv[argv.index('--policy-name')+1],'FIX01PublicDraftNovaLite')
    saved=json.loads(argv[argv.index('--policy-document')+1]);writes.append(saved)
    if lost:code=1;stderr='An error occurred (RequestTimeout)'
   else:raise AssertionError(op)
   return type('Response',(),{'returncode':code,'stderr':stderr,'stdout':json.dumps(value)})()
  with tempfile.TemporaryDirectory() as folder,patch('pathlib.Path.home',return_value=pathlib.Path(folder)),patch.object(sys,'argv',['installer','--apply']),patch('subprocess.run',run),contextlib.redirect_stdout(io.StringIO()) as output:
   try:runpy.run_path('scripts/fix01/install-public-draft-access.py',run_name='__main__')
   except SystemExit:pass
   result=json.loads(output.getvalue())
  return result,writes
 def test_exact_model_permission_and_lost_ack_one_write(self):
  result,writes=self.exercise(lost=True);self.assertEqual(result['result'],'POLICY_READBACK_MATCH');self.assertEqual(len(writes),1)
  self.assertEqual(writes[0]['Statement'],[{'Sid':'FIX01PublicOnlyNovaLite','Effect':'Allow','Action':'bedrock:InvokeModel','Resource':'arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-lite-v1:0'}])
 def test_foreign_policy_and_target_never_write(self):
  for options in [{'foreign':True},{'wrong':True}]:
   result,writes=self.exercise(**options);self.assertEqual(result['result'],'BLOCKED');self.assertEqual(writes,[])
if __name__=='__main__':unittest.main()
