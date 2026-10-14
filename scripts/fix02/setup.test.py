"""Exercise fixed-target route guards and reconciliation without AWS access."""
import sys
sys.path.pop(0)
import base64,contextlib,io,json,os,pathlib,runpy,tempfile,unittest
from unittest.mock import patch
class RouteChecks(unittest.TestCase):
 def exercise(self,foreign=False,lost=False):
  routes=[{'RouteKey':'GET /groups/{groupId}','AuthorizationType':'JWT','AuthorizerId':'vnsmtt','Target':'integrations/odmtgut'}]
  if foreign:routes.append({'RouteKey':'GET /groups/{groupId}/members/{memberId}/profile','AuthorizationType':'NONE','Target':'integrations/foreign'})
  writes=[]
  def run(argv,**_):
   service,op=argv[1:3];value={};code=0;stderr=''
   if service=='sts':value={'Account':'092954139775','Arn':'arn:aws:sts::092954139775:assumed-role/KnownEnoughGithubApplicationConfig/test'}
   elif service=='lambda':value={'CodeSha256':base64.b64encode(bytes.fromhex('a'*64)).decode()}
   elif op=='get-routes':value={'Items':routes.copy()}
   elif op=='get-authorizer':value={'JwtConfiguration':{'Audience':['3accf7paalvon2m8ue8okfi853','481ru24906sv26f30i569gq8g0'],'Issuer':'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_V9OMjd0zx'}}
   elif op=='get-integration':value={'PayloadFormatVersion':'2.0','IntegrationUri':'arn:aws:lambda:us-east-1:092954139775:function:known-enough-stage-api'}
   elif op=='create-route':
    key=argv[argv.index('--route-key')+1];writes.append(key);routes.append({**routes[0],'RouteKey':key} if key.startswith('GET ') else {'RouteKey':key,'AuthorizationType':'NONE','Target':routes[0]['Target']})
    if lost:code=1;stderr='An error occurred (RequestTimeout)'
   elif service!='s3api':raise AssertionError(op)
   return type('Response',(),{'returncode':code,'stderr':stderr,'stdout':json.dumps(value)})()
  with tempfile.TemporaryDirectory() as folder:
   with patch.dict(os.environ,{'EXPECTED_SOURCE':'b'*40,'RUNNER_TEMP':folder,'GITHUB_RUN_ID':'12345'}),patch.object(sys,'argv',['setup.py','--apply','--api-sha256','a'*64]),patch('subprocess.run',run),contextlib.redirect_stdout(io.StringIO()):
    try:runpy.run_path('scripts/fix02/setup.py',run_name='__main__')
    except SystemExit:pass
   report=json.loads(pathlib.Path(folder,'fix02-routes-report.json').read_text())
  return report,writes
 def test_foreign_route_stops_before_write(self):
  report,writes=self.exercise(foreign=True);self.assertEqual(report['error'],'FOREIGN_ROUTE_BINDING_STOP');self.assertEqual(writes,[])
 def test_lost_ack_reconciles_each_route_once(self):
  report,writes=self.exercise(lost=True);self.assertEqual(report['result'],'MEMBER_PROFILE_ROUTES_READBACK_PASS');self.assertEqual(len(writes),2);self.assertEqual(len(set(writes)),2)
if __name__=='__main__':unittest.main()
