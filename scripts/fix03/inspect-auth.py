"""Bounded fixed participant-client authentication metadata; no tokens or secrets exported."""
import datetime,json,os,pathlib,re,subprocess
report={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':os.environ['EXPECTED_SOURCE'],'writes':0,'providerCalls':0}
def call(service,operation,*args):
 result=subprocess.run(['aws',service,operation,*args,'--region','us-east-1','--output','json','--no-cli-pager'],capture_output=True,text=True,timeout=20)
 if result.returncode:
  match=re.search(r'An error occurred \((\w+)\)',result.stderr);raise ValueError(service+':'+operation+'/'+(match.group(1) if match else 'AWS_REQUEST_UNAVAILABLE'))
 return json.loads(result.stdout or '{}')
try:
 identity=call('sts','get-caller-identity')
 if identity['Account']!='092954139775' or not identity['Arn'].startswith('arn:aws:sts::092954139775:assumed-role/KnownEnoughGithubStagingInspector/'):raise ValueError('OWN_ROLE_TARGET_INVALID')
 pool=call('cognito-idp','describe-user-pool','--user-pool-id','us-east-1_V9OMjd0zx')['UserPool']
 report.update({'usernameAttributes':pool.get('UsernameAttributes',[]),'aliases':pool.get('AliasAttributes',[]),'mfa':pool.get('MfaConfiguration'),'passwordPolicy':pool.get('Policies',{}).get('PasswordPolicy'),'customChallenges':any(name in pool.get('LambdaConfig',{}) for name in ['DefineAuthChallenge','CreateAuthChallenge','VerifyAuthChallengeResponse'])})
 client=call('cognito-idp','describe-user-pool-client','--user-pool-id','us-east-1_V9OMjd0zx','--client-id','3accf7paalvon2m8ue8okfi853')['UserPoolClient']
 report.update({'clientSecretPresent':bool(client.get('ClientSecret')),'authFlows':client.get('ExplicitAuthFlows',[]),'oauthScopes':client.get('AllowedOAuthScopes',[]),'preventUserExistenceErrors':client.get('PreventUserExistenceErrors'),'tokenRevocation':client.get('EnableTokenRevocation'),'result':'AUTH_CONTRACT_READBACK_PASS'})
except Exception as error:report['result']='INCOMPLETE';report['error']=str(error) if isinstance(error,ValueError) else 'AUTH_METADATA_UNAVAILABLE'
pathlib.Path(os.environ['RUNNER_TEMP'],'fix03-auth-report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
