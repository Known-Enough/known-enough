"""Own administrator applies only named inline log read; never edits a boundary."""
import datetime,json,os,pathlib,re,subprocess,sys
ACCOUNT='092954139775';ROLE='KnownEnoughGithubStagingInspector';NAME='FIX01PrimaryApiLogRead'
POLICY={'Version':'2012-10-17','Statement':[{'Sid':'FIX01ReadOnlyPrimaryApiRequestWindow','Effect':'Allow','Action':'logs:FilterLogEvents','Resource':'arn:aws:logs:us-east-1:092954139775:log-group:/aws/lambda/known-enough-stage-api:*'}]}
report={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'role':ROLE,'policy':NAME,'iamWrites':0,'dataWrites':0,'effectiveB':'NOT_EXECUTED'}
def aws(service,operation,*args,absent=False):
 p=subprocess.run(['aws',service,operation,*args,'--output','json','--no-cli-pager'],capture_output=True,text=True,timeout=20)
 if p.returncode:
  match=re.search(r'An error occurred \((\w+)\)',p.stderr);code=match.group(1) if match else 'AWS_CALL_UNAVAILABLE'
  if absent and code=='NoSuchEntity':return None
  raise ValueError(service+':'+operation+'/'+code)
 return json.loads(p.stdout or '{}')
try:
 identity=aws('sts','get-caller-identity')
 if identity.get('Account')!=ACCOUNT:raise ValueError('TARGET_IDENTITY_MISMATCH')
 role=aws('iam','get-role','--role-name',ROLE)['Role'];prior=aws('iam','get-role-policy','--role-name',ROLE,'--policy-name',NAME,absent=True)
 report['boundary']=role.get('PermissionsBoundary',{}).get('PermissionsBoundaryArn','NONE')
 if prior and prior.get('PolicyDocument')!=POLICY:raise ValueError('FOREIGN_NAMED_POLICY_STOP')
 if '--apply' in sys.argv and not prior:
  folder=pathlib.Path.home()/'.known-enough'/('fix01-api-log-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'));folder.mkdir(mode=0o700,parents=True,exist_ok=False)
  for name,value in [('role-private.json',role),('prior-policy-private.json',prior)]:
   path=folder/name;path.write_text(json.dumps(value));path.chmod(0o600)
  report['backup']=str(folder)
  try:aws('iam','put-role-policy','--role-name',ROLE,'--policy-name',NAME,'--policy-document',json.dumps(POLICY));report['iamWrites']=1
  except ValueError as error:report['writeError']=str(error) # Resolve the single write through readback, never reissue it.
  prior=aws('iam','get-role-policy','--role-name',ROLE,'--policy-name',NAME,absent=True)
 report['result']='POLICY_READBACK_MATCH' if prior and prior.get('PolicyDocument')==POLICY else 'PREVIEW_READY' if '--apply' not in sys.argv else 'POLICY_NOT_VERIFIED'
except Exception as error:report['result']='BLOCKED';report['error']=str(error) if isinstance(error,ValueError) else 'SETUP_UNAVAILABLE'
print(json.dumps(report))
