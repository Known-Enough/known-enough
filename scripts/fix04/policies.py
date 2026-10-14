"""One bounded installed role/boundary metadata readback; no effective-access inference."""
import datetime,fnmatch,hashlib,json,os,pathlib,re,subprocess
ACCOUNT='092954139775';ROLE='KnownEnoughGithubPartitionMigration';TABLE=f'arn:aws:dynamodb:us-east-1:{ACCOUNT}:table/KnownEnoughPartitions';POOL=f'arn:aws:cognito-idp:us-east-1:{ACCOUNT}:userpool/us-east-1_V9OMjd0zx'
report={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':os.environ['EXPECTED_SOURCE'],'role':ROLE,'writes':0,'documents':[],'denials':[]}
def call(operation,*args):
 result=subprocess.run(['aws','iam',operation,*args,'--region','us-east-1','--output','json','--no-cli-pager'],capture_output=True,text=True,timeout=20)
 if result.returncode:
  match=re.search(r'An error occurred \((\w+)\)',result.stderr);report['denials'].append({'operation':'iam:'+operation,'code':match.group(1) if match and match.group(1) in ['AccessDenied','AccessDeniedException','NoSuchEntity'] else 'AWS_READ_UNAVAILABLE'});return None
 return json.loads(result.stdout or '{}')
def summarize(name,document,boundary=False):
 relevant=[];iam_denied=False
 for statement in document.get('Statement',[]):
  actions=statement.get('Action',[]);resources=statement.get('Resource',[]);actions=[actions] if isinstance(actions,str) else actions;resources=[resources] if isinstance(resources,str) else resources
  if statement.get('Effect')=='Deny' and any(fnmatch.fnmatchcase('iam:PutRolePolicy',action) for action in actions):iam_denied=True
  for action,resource in [('dynamodb:Scan',TABLE),('cognito-idp:AdminGetUser',POOL),('cognito-idp:ListUsers',POOL)]:
   if any(fnmatch.fnmatchcase(action,pattern) for pattern in actions) and any(fnmatch.fnmatchcase(resource,pattern) for pattern in resources):relevant.append({'action':action,'effect':statement.get('Effect'),'conditionKeys':sorted(statement.get('Condition',{}))})
 report['documents'].append({'policy':name,'boundary':boundary,'sha256':hashlib.sha256(json.dumps(document,sort_keys=True,separators=(',',':')).encode()).hexdigest(),'operatorReads':relevant,'iamWriteDenyPresent':iam_denied})
def managed(arn,boundary=False):
 policy=call('get-policy','--policy-arn',arn)
 if policy:
  version=call('get-policy-version','--policy-arn',arn,'--version-id',policy['Policy']['DefaultVersionId'])
  if version:summarize(arn,version['PolicyVersion']['Document'],boundary)
try:
 role=call('get-role','--role-name',ROLE);inline=call('list-role-policies','--role-name',ROLE);attached=call('list-attached-role-policies','--role-name',ROLE)
 if not role or inline is None or attached is None:raise ValueError('ROLE_INVENTORY_INCOMPLETE')
 if role['Role']['Arn']!=f'arn:aws:iam::{ACCOUNT}:role/{ROLE}' or len(inline['PolicyNames'])>20 or len(attached['AttachedPolicies'])>10:raise ValueError('ROLE_SCOPE_INVALID')
 boundary=role['Role'].get('PermissionsBoundary',{}).get('PermissionsBoundaryArn');report['boundaryArn']=boundary
 for name in inline['PolicyNames']:
  value=call('get-role-policy','--role-name',ROLE,'--policy-name',name)
  if value:summarize(name,value['PolicyDocument'])
 for item in attached['AttachedPolicies']:managed(item['PolicyArn'])
 if boundary:managed(boundary,True)
 report['result']='ROLE_POLICY_READBACK_PASS' if not report['denials'] else 'ROLE_POLICY_READBACK_INCOMPLETE'
except Exception:report['result']='ROLE_POLICY_READBACK_INCOMPLETE'
report['effectiveAccess']='NOT_EXECUTED'
pathlib.Path(os.environ['RUNNER_TEMP'],'fix04-policies-report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
