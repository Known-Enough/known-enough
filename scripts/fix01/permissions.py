"""Read installed API role policies; no simulation, secrets, model calls or writes."""
import datetime,fnmatch,json,os,pathlib,re,subprocess
ACCOUNT='092954139775';ROLE='KnownEnoughStageApiRole';RESOURCE='arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-lite-v1:0'
report={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':os.environ['EXPECTED_SOURCE'],'role':ROLE,'writes':0,'providerCalls':0,'denials':[],'documents':[]}
def call(service,operation,*args):
 response=subprocess.run(['aws',service,operation,*args,'--region','us-east-1','--output','json','--no-cli-pager'],capture_output=True,text=True,timeout=20)
 if response.returncode:
  match=re.search(r'An error occurred \((\w+)\)',response.stderr);report['denials'].append({'operation':service+':'+operation,'code':match.group(1) if match else 'AWS_CALL_UNAVAILABLE'});return None
 return json.loads(response.stdout or '{}')
def document(name,value):
 statuses=[]
 for statement in value.get('Statement',[]):
  actions=statement.get('Action',[]);resources=statement.get('Resource',[])
  if isinstance(actions,str):actions=[actions]
  if isinstance(resources,str):resources=[resources]
  if any(fnmatch.fnmatchcase('bedrock:InvokeModel',action) for action in actions) and any(fnmatch.fnmatchcase(RESOURCE,resource) for resource in resources):statuses.append({'effect':statement.get('Effect'),'conditional':bool(statement.get('Condition'))})
 report['documents'].append({'policy':name,'novaLiteInvoke':statuses})
try:
 identity=call('sts','get-caller-identity')
 if not identity or identity['Account']!=ACCOUNT or not identity['Arn'].startswith('arn:aws:sts::'+ACCOUNT+':assumed-role/KnownEnoughGithubStagingInspector/'):raise ValueError('OWN_ROLE_TARGET_INVALID')
 role=call('iam','get-role','--role-name',ROLE);inline=call('iam','list-role-policies','--role-name',ROLE);attached=call('iam','list-attached-role-policies','--role-name',ROLE)
 if not role or inline is None or attached is None:raise ValueError('API_POLICY_INVENTORY_INCOMPLETE')
 report['boundaryPresent']=bool(role['Role'].get('PermissionsBoundary'))
 if len(inline['PolicyNames'])>20 or len(attached['AttachedPolicies'])>10:raise ValueError('POLICY_READ_BOUND_EXCEEDED')
 for name in inline['PolicyNames']:
  value=call('iam','get-role-policy','--role-name',ROLE,'--policy-name',name)
  if value:document(name,value['PolicyDocument'])
 for policy in attached['AttachedPolicies']:
  value=call('iam','get-policy','--policy-arn',policy['PolicyArn'])
  if value:
   version=call('iam','get-policy-version','--policy-arn',policy['PolicyArn'],'--version-id',value['Policy']['DefaultVersionId'])
   if version:document(policy['PolicyName'],version['PolicyVersion']['Document'])
 report['result']='POLICY_READBACK_PASS' if not report['denials'] else 'POLICY_READBACK_INCOMPLETE'
 report['effectiveAccess']='NOT_EXECUTED'
except Exception as error:report['result']='BLOCKED';report['error']=str(error) if isinstance(error,ValueError) else 'POLICY_READ_UNAVAILABLE'
pathlib.Path(os.environ['RUNNER_TEMP'],'fix01-permissions-report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
