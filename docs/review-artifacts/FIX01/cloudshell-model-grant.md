# FIX01 exact administrator grant

**Latest manual completion path:** [combined current CloudShell setup](../../../scripts/cloudshell-commands/05-enable-decision-drafting.py) grants the same exact model permission and enables public drafting on the currently published source4fc702b/API83d794ac/workerf15b5164. It invokes no model or tests. The single-grant block below remains historical/separate setup and does not enable drafting by itself.

Run this once in A’s own AWS CloudShell in account `092954139775`, using A’s existing IAM administrator access. No B credentials or role expansion is needed. The installed API role’s five policies were read in [38521238916](https://github.com/Known-Enough/known-enough/actions/runs/38521238916): none grants the existing Nova Lite model. B’s own repair [38521528053](https://github.com/Known-Enough/known-enough/actions/runs/38521528053) failed `iam:get-role/AccessDenied` before any write.

The block checks the account, preserves any different named policy, saves a private backup, grants only one model operation and reads it back. It changes no worker, boundary, data, queue control or usage counter. It retains CloudShell’s credential provider.

```bash
python3 - <<'PY'
"""Own administrator applies only named inline log read; never edits a boundary."""
import datetime,json,os,pathlib,re,subprocess,sys
os.environ['AWS_MAX_ATTEMPTS']='1'
sys.argv.append('--apply')
ACCOUNT='092954139775';ROLE='KnownEnoughStageApiRole';NAME='FIX01PublicDraftNovaLite'
POLICY={'Version':'2012-10-17','Statement':[{'Sid':'FIX01PublicOnlyNovaLite','Effect':'Allow','Action':'bedrock:InvokeModel','Resource':'arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-lite-v1:0'}]}
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
  folder=pathlib.Path.home()/'.known-enough'/('fix01-public-draft-access-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'));folder.mkdir(mode=0o700,parents=True,exist_ok=False)
  for name,value in [('role-private.json',role),('prior-policy-private.json',prior)]:
   path=folder/name;path.write_text(json.dumps(value));path.chmod(0o600)
  report['backup']=str(folder)
  try:aws('iam','put-role-policy','--role-name',ROLE,'--policy-name',NAME,'--policy-document',json.dumps(POLICY));report['iamWrites']=1
  except ValueError as error:report['writeError']=str(error) # Resolve the single write through readback, never reissue it.
  prior=aws('iam','get-role-policy','--role-name',ROLE,'--policy-name',NAME,absent=True)
 report['result']='POLICY_READBACK_MATCH' if prior and prior.get('PolicyDocument')==POLICY else 'PREVIEW_READY' if '--apply' not in sys.argv else 'POLICY_NOT_VERIFIED'
except Exception as error:report['result']='BLOCKED';report['error']=str(error) if isinstance(error,ValueError) else 'SETUP_UNAVAILABLE'
print(json.dumps(report))

if report['result'] in ['BLOCKED','POLICY_NOT_VERIFIED']:raise SystemExit(1)
PY
```

Return the sanitized JSON result. Required result is `POLICY_READBACK_MATCH`; `effectiveB: NOT_EXECUTED` is expected because this block does not call a model. B then verifies the installed permission and exact published code/logging/private gate, enables public drafting under standing authority and runs fresh normal owned primary draft → review → create → reload plus unauthorized access, usage and cleanup checks. FIX01 remains incomplete until that live evidence passes.
