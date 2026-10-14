#!/usr/bin/env python3
"""Own-administrator, exact-role additive reader repair. No credentials/providers stripped."""
import argparse,datetime,hashlib,json,os,pathlib,re,subprocess,uuid
ACCOUNT='092954139775';ROLE='KnownEnoughGithubPartitionMigration';BOUNDARY=f'arn:aws:iam::{ACCOUNT}:policy/{ROLE}Boundary';POLICY='FIX04PrivateOperatorReads'
INLINE_HASH='e7da3f549630b8c8a451d9ce0b8d944a80e8b1bcae2b1acf5f96687b942c7c8c';BOUNDARY_HASH='a2aea02b08607cb5a3bcb60f73210c259b07d0b4145a0fc876a1e84c7c1655c6'
READS={'Version':'2012-10-17','Statement':[
 {'Sid':'FIX04KeyOnlyAccountCatalog','Effect':'Allow','Action':['dynamodb:Scan'],'Resource':f'arn:aws:dynamodb:us-east-1:{ACCOUNT}:table/KnownEnoughPartitions','Condition':{'StringEquals':{'dynamodb:Select':'SPECIFIC_ATTRIBUTES'},'ForAllValues:StringEquals':{'dynamodb:Attributes':['PK','SK']},'Null':{'dynamodb:Attributes':'false'}}},
 {'Sid':'FIX04TrustedProviderIdentity','Effect':'Allow','Action':['cognito-idp:AdminGetUser','cognito-idp:ListUsers'],'Resource':f'arn:aws:cognito-idp:us-east-1:{ACCOUNT}:userpool/us-east-1_V9OMjd0zx'},
 {'Sid':'FIX04PinnedSourceRead','Effect':'Allow','Action':['lambda:GetFunction'],'Resource':f'arn:aws:lambda:us-east-1:{ACCOUNT}:function:known-enough-stage-api'}]}
class RepairError(Exception):pass
def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def desired_boundary(current):
    original=json.loads(json.dumps(current));found=[];kept=[]
    for statement in original.get('Statement',[]):
        if statement.get('Sid','').startswith('FIX04'):found.append(statement)
        else:kept.append(statement)
    original['Statement']=kept
    if digest(original)!=BOUNDARY_HASH:raise RepairError('BOUNDARY_SOURCE_CHANGED')
    if found and found!=READS['Statement']:raise RepairError('FIX04_BOUNDARY_STATEMENTS_CHANGED')
    return {**original,'Statement':kept+json.loads(json.dumps(READS['Statement']))}
def checked_scope(current):
    original=json.loads(json.dumps(current));found=[item for item in original['Statement'] if item.get('Sid','').startswith('FIX04')];original['Statement']=[item for item in original['Statement'] if not item.get('Sid','').startswith('FIX04')]
    if digest(original)!=INLINE_HASH or (found and found!=READS['Statement']):raise RepairError('ROLE_SOURCE_CHANGED')
    return bool(found)
def aws(service,operation,*args):
    result=subprocess.run(['aws',service,operation,*args,'--region','us-east-1','--output','json','--no-cli-pager'],capture_output=True,text=True,timeout=30,env={**os.environ,'AWS_MAX_ATTEMPTS':'1'})
    if result.returncode:
        match=re.search(r'An error occurred \((\w+)\)',result.stderr);code=match.group(1) if match and match.group(1) in ['AccessDenied','AccessDeniedException','NoSuchEntity','LimitExceeded','ConcurrentModification'] else 'AWS_OPERATION_UNAVAILABLE'
        raise RepairError(service+':'+operation+'/'+code)
    return json.loads(result.stdout or '{}')
def save(root,name,value):
    path=root/name
    with path.open('x') as out:json.dump(value,out,indent=2)
    os.chmod(path,0o600)
def repair(invoke=aws,apply=False,backup=None):
    writes=0;execution=[]
    def mutate(operation,*args):
        nonlocal writes
        item={'operation':'iam:'+operation,'result':'ACK_UNKNOWN'};execution.append(item)
        def checkpoint():
            if backup:
                path=backup/'execution.json';temporary=backup/'execution-next.json';temporary.write_text(json.dumps({'iamWritesConfirmed':writes,'attempts':execution},indent=2));os.chmod(temporary,0o600);temporary.replace(path)
        checkpoint();result=invoke('iam',operation,*args);writes+=1;item['result']='CONFIRMED';checkpoint();return result
    identity=invoke('sts','get-caller-identity')
    if identity.get('Account')!=ACCOUNT:raise RepairError('WRONG_ACCOUNT')
    role=invoke('iam','get-role','--role-name',ROLE)['Role']
    if role.get('Arn')!=f'arn:aws:iam::{ACCOUNT}:role/{ROLE}' or role.get('PermissionsBoundary',{}).get('PermissionsBoundaryArn')!=BOUNDARY:raise RepairError('ROLE_BOUNDARY_TARGET_CHANGED')
    original_inline=invoke('iam','get-role-policy','--role-name',ROLE,'--policy-name','ScopedOperations')['PolicyDocument']
    scope_has_reads=checked_scope(original_inline)
    boundary_policy=invoke('iam','get-policy','--policy-arn',BOUNDARY)['Policy'];version_id=boundary_policy['DefaultVersionId']
    current=invoke('iam','get-policy-version','--policy-arn',BOUNDARY,'--version-id',version_id)['PolicyVersion']['Document'];desired=desired_boundary(current)
    entities=invoke('iam','list-entities-for-policy','--policy-arn',BOUNDARY,'--policy-usage-filter','PermissionsBoundary')
    if entities.get('IsTruncated') or entities.get('PolicyUsers') or entities.get('PolicyGroups') or {item['RoleName'] for item in entities.get('PolicyRoles',[])}!={ROLE}:raise RepairError('BOUNDARY_NOT_EXCLUSIVELY_USED')
    existing=None
    try:existing=invoke('iam','get-role-policy','--role-name',ROLE,'--policy-name',POLICY)['PolicyDocument']
    except RepairError as error:
        if str(error)!='iam:get-role-policy/NoSuchEntity':raise
    if existing is not None and existing!=READS:raise RepairError('NAMED_POLICY_CHANGED')
    versions=invoke('iam','list-policy-versions','--policy-arn',BOUNDARY)['Versions']
    if not 1<=len(versions)<=5 or len([item for item in versions if item.get('IsDefaultVersion')])!=1 or next((item['VersionId'] for item in versions if item.get('IsDefaultVersion')),None)!=version_id:raise RepairError('POLICY_VERSION_INVENTORY_INVALID')
    if backup:
        save(backup,'role.json',role);save(backup,'scoped-operations.json',original_inline);save(backup,'named-inline-before.json',existing);save(backup,'boundary-desired.json',desired)
        for version in versions:
            document=invoke('iam','get-policy-version','--policy-arn',BOUNDARY,'--version-id',version['VersionId'])['PolicyVersion']['Document'];save(backup,'boundary-'+version['VersionId']+'.json',document)
    if not apply:return {'result':'FIX04_OPERATOR_ACCESS_PREVIEW','iamWrites':0,'boundaryChange':current!=desired,'inlineChange':existing!=READS and not scope_has_reads,'dataWrites':0,'emailRequests':0}
    # Recheck original role/boundary binding and default version immediately before writing.
    again=invoke('iam','get-role','--role-name',ROLE)['Role']
    if again.get('PermissionsBoundary',{}).get('PermissionsBoundaryArn')!=BOUNDARY or invoke('iam','get-policy','--policy-arn',BOUNDARY)['Policy']['DefaultVersionId']!=version_id:raise RepairError('CONCURRENT_ROLE_CHANGE')
    if current!=desired:
        if len(versions)==5:
            old=sorted([item for item in versions if not item.get('IsDefaultVersion')],key=lambda item:item.get('CreateDate',''))[0]
            if not backup:raise RepairError('PRIVATE_BACKUP_REQUIRED_FOR_VERSION_SLOT')
            mutate('delete-policy-version','--policy-arn',BOUNDARY,'--version-id',old['VersionId'])
        mutate('create-policy-version','--policy-arn',BOUNDARY,'--policy-document',json.dumps(desired),'--set-as-default')
    if existing!=READS and not scope_has_reads:
        mutate('put-role-policy','--role-name',ROLE,'--policy-name',POLICY,'--policy-document',json.dumps(READS))
    final_role=invoke('iam','get-role','--role-name',ROLE)['Role']
    final_policy=invoke('iam','get-policy','--policy-arn',BOUNDARY)['Policy']
    final_boundary=invoke('iam','get-policy-version','--policy-arn',BOUNDARY,'--version-id',final_policy['DefaultVersionId'])['PolicyVersion']['Document']
    final_inline=invoke('iam','get-role-policy','--role-name',ROLE,'--policy-name',POLICY)['PolicyDocument'] if existing is not None or not scope_has_reads else None
    preserved=invoke('iam','get-role-policy','--role-name',ROLE,'--policy-name','ScopedOperations')['PolicyDocument']
    if final_role.get('PermissionsBoundary',{}).get('PermissionsBoundaryArn')!=BOUNDARY or final_boundary!=desired or (final_inline!=READS and not scope_has_reads) or digest(preserved)!=digest(original_inline):raise RepairError('ACCESS_READBACK_MISMATCH')
    return {'result':'FIX04_OPERATOR_POLICY_READBACK_PASS','iamWrites':writes,'role':ROLE,'policy':POLICY if final_inline else 'ScopedOperations','boundary':BOUNDARY,'boundarySha256':digest(desired),'originalScopePreserved':True,'effectiveBAccess':'NOT_EXECUTED','dataWrites':0,'emailRequests':0}
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    timestamp=datetime.datetime.now(datetime.timezone.utc);backup=pathlib.Path.home()/'.known-enough'/('fix04-grant-'+timestamp.strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex[:8]);backup.mkdir(parents=True,mode=0o700);os.chmod(backup,0o700)
    try:report=repair(apply=args.apply,backup=backup)
    except RepairError as error:report={'result':'FIX04_OPERATOR_ACCESS_BLOCKED','error':str(error),'effectiveBAccess':'NOT_EXECUTED','dataWrites':0,'emailRequests':0,'iamWritesConfirmed':0,'attempts':[]}
    except Exception:report={'result':'FIX04_OPERATOR_ACCESS_BLOCKED','error':'ADMIN_COMMAND_UNAVAILABLE','effectiveBAccess':'NOT_EXECUTED','dataWrites':0,'emailRequests':0,'iamWritesConfirmed':0,'attempts':[]}
    if (backup/'execution.json').exists():report['execution']=json.loads((backup/'execution.json').read_text())
    report.update({'utc':timestamp.isoformat(),'backup':str(backup)});print(json.dumps(report));return 0 if report['result'] in ['FIX04_OPERATOR_POLICY_READBACK_PASS','FIX04_OPERATOR_ACCESS_PREVIEW'] else 1
if __name__=='__main__':raise SystemExit(main())
