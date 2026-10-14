"""Only three JWT recovery routes on the verified current primary package."""
import argparse,base64,datetime,json,os,pathlib,re,subprocess
p=argparse.ArgumentParser();p.add_argument('--api-sha256',required=True);p.add_argument('--apply',action='store_true');args=p.parse_args()
A='092954139775';API='u94iyvt6p9';F='known-enough-stage-api'
KEYS=['GET /groups/{groupId}/members/{memberId}/profile','OPTIONS /groups/{groupId}/members/{memberId}/profile']
report={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':os.environ['EXPECTED_SOURCE'],'configurationWrites':0,'dataWrites':0,'providerCalls':0,'checks':{}}
def call(service,op,*argv):
 r=subprocess.run(['aws',service,op,*argv,'--region','us-east-1','--output','json','--no-cli-pager'],capture_output=True,text=True,timeout=25)
 if r.returncode:
  match=re.search(r'An error occurred \((\w+)\)',r.stderr);raise ValueError(service+':'+op+'/'+(match.group(1) if match else 'AWS_CALL_UNAVAILABLE'))
 return json.loads(r.stdout or '{}')
try:
 if not re.fullmatch('[a-f0-9]{64}',args.api_sha256):raise ValueError('INVALID_EXPECTED_API_HASH')
 identity=call('sts','get-caller-identity')
 if identity['Account']!=A or not identity['Arn'].startswith('arn:aws:sts::'+A+':assumed-role/KnownEnoughGithubApplicationConfig/'):raise ValueError('OWN_TARGET_ROLE_MISMATCH')
 config=call('lambda','get-function-configuration','--function-name',F)
 if base64.b64decode(config['CodeSha256']).hex()!=args.api_sha256:raise ValueError('API_SOURCE_HASH_MISMATCH')
 routes=call('apigatewayv2','get-routes','--api-id',API)['Items'];base=[r for r in routes if r['RouteKey']=='GET /groups/{groupId}']
 if len(base)!=1 or base[0].get('AuthorizationType')!='JWT' or not base[0].get('Target','').startswith('integrations/'):raise ValueError('GROUP_ROUTE_BINDING_MISMATCH')
 base=base[0];authorizer=call('apigatewayv2','get-authorizer','--api-id',API,'--authorizer-id',base['AuthorizerId'])
 if authorizer.get('JwtConfiguration')!={'Audience':['3accf7paalvon2m8ue8okfi853','481ru24906sv26f30i569gq8g0'],'Issuer':'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_V9OMjd0zx'}:raise ValueError('JWT_CONFIGURATION_MISMATCH')
 integration=call('apigatewayv2','get-integration','--api-id',API,'--integration-id',base['Target'].split('/')[1])
 if integration.get('PayloadFormatVersion')!='2.0' or integration.get('IntegrationUri')!='arn:aws:lambda:us-east-1:'+A+':function:'+F:raise ValueError('RUNTIME_INTEGRATION_MISMATCH')
 def missing(values):
  result=[]
  for key in KEYS:
   present=[r for r in values if r['RouteKey']==key]
   if present and (len(present)!=1 or any(present[0].get(field)!=({'AuthorizationType':'NONE','Target':base['Target']} if key.startswith('OPTIONS ') else base).get(field) for field in ['AuthorizationType','AuthorizerId','Target'])):raise ValueError('FOREIGN_ROUTE_BINDING_STOP')
   if not present:result.append(key)
  return result
 absent=missing(routes);report['checks']['missingRoutes']=absent
 if args.apply and absent:
  folder=pathlib.Path(os.environ['RUNNER_TEMP'])/'fix02-routes-private';folder.mkdir(mode=0o700,exist_ok=False)
  for name,value in [('routes.json',routes),('lambda.json',config)]:
   path=folder/name;path.write_text(json.dumps(value));path.chmod(0o600)
   call('s3api','put-object','--bucket','known-enough-qa-artifacts-092954139775','--key','application-config/fix02-'+os.environ['GITHUB_RUN_ID']+'/'+name,'--body',str(path),'--server-side-encryption','AES256')
  for key in absent:
   try:call('apigatewayv2','create-route','--api-id',API,'--route-key',key,'--target',base['Target'],'--authorization-type','NONE' if key.startswith('OPTIONS ') else 'JWT',*([] if key.startswith('OPTIONS ') else ['--authorizer-id',base['AuthorizerId']]));report['configurationWrites']+=1
   except ValueError:
    current=call('apigatewayv2','get-routes','--api-id',API)['Items']
    if key in missing(current):raise
  routes=call('apigatewayv2','get-routes','--api-id',API)['Items']
  if base64.b64decode(call('lambda','get-function-configuration','--function-name',F)['CodeSha256']).hex()!=args.api_sha256:raise ValueError('API_SOURCE_CHANGED_STOP')
 report['checks']['routesMatched']=len(KEYS)-len(missing(routes));report['result']='MEMBER_PROFILE_ROUTES_READBACK_PASS' if not missing(routes) else 'MEMBER_PROFILE_ROUTES_PREVIEW'
except Exception as error:report['result']='BLOCKED';report['error']=str(error) if isinstance(error,ValueError) else 'SETUP_UNAVAILABLE'
path=pathlib.Path(os.environ['RUNNER_TEMP'])/'fix02-routes-report.json';path.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))

if report['result']=='BLOCKED':raise SystemExit(1)
