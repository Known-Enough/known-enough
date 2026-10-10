# Fixed partition inspection access: one additive policy

The earlier [GitHub readback](https://github.com/Known-Enough/known-enough/actions/runs/38019839052) verified the exact signed KnownEnoughGithubStagingInspector role/account and then failed DynamoDB DescribeTable on KnownEnoughPartitions. The table is now installed according to A's checked CloudShell receipt; the app's participant role is also configured. Neither setup changes this separate inspector role. Do not repeat the unchanged denial before a policy repair.

[The exact policy](inspector-partitions-policy.json) copies the existing preparedInspectionDelta in partition-create-evidence.json: only DescribeTable/DescribeContinuousBackups/DescribeTimeToLive on the fixed partitions table and DescribeStacks/GetTemplate/ListStackResources on the fixed partitions stack. Canonical SHA256 **aaf403ab18488dbe76347c56d997b9a4bb3400134addfc4ae3f780a645cbf0a1**;547characters excluding final newline. No item/data/model/email/IAM permission or general resource access. The CloudFormation wildcard selects only this named stack's generated ID; it is not all stacks.

This one command uses existing checked f763284 helper tools and a separate persistent private HOME state. It verifies account, exact role ARN/path/identity and fixed GitHub main-only OIDC trust; captures original complete inline policies privately, requires no managed attachments or boundary, checks quota, validates the candidate with AWS, then repeats the baseline before one PutRolePolicy. Full trust and original policies never print. Lists with pagination or over five original inline policies stop before mutation to preserve the helper's32request bound. Unknown target/baseline/policy drift fails; no new trust or original-policy update. The tool records flushed write intent first; empty or uncertain acknowledgments use readback only, and restarting never repeats an intent-recorded write. IAM has no atomic conditional-create guard; fresh checks plus shared single-writer ownership are not cloud CAS. No automatic policy/resource deletion or state reset.

Only the named KnownEnoughPartitionsMetadata policy is added to KnownEnoughGithubStagingInspector. Existing installed source/template/private state and app flags remain. Existing matching policy yields reads only. Actual effective access is PENDING_GITHUB_READBACK until the own-A exact-source manual partition inspection succeeds. Standing user authority already covers the write; the user uses their own CloudShell session because this local worker has no demonstrated IAM write credentials. This requires no credentials handed to B.

```bash
(
set -euo pipefail
umask 077
cd "$HOME/.known-enough/ops00-partition-tools-f7632841284907411a0e9adb0de15f447c2eec00"
command python3 -B - <<'PY_INSPECTOR'
import importlib.util, json, re
from pathlib import Path
spec=importlib.util.spec_from_file_location('ops_common','scripts/operations/cloudshell-create.py')
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.verify_checkout('f7632841284907411a0e9adb0de15f447c2eec00')
state=m.State(Path.home()/'.known-enough/ops00-inspector-partitions-20261010',Path.home())
a=m.Aws(state); action=None; findings=[]; finding_codes=[]; write_outcome=None
role_name='KnownEnoughGithubStagingInspector'; policy_name='KnownEnoughPartitionsMetadata'
role_arn='arn:aws:iam::092954139775:role/'+role_name
policy={'Version':'2012-10-17','Statement':[
    {'Sid':'ReadFixedRetainedPartitionMetadata','Effect':'Allow',
     'Action':['dynamodb:DescribeTable','dynamodb:DescribeContinuousBackups','dynamodb:DescribeTimeToLive'],
     'Resource':'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughPartitions'},
    {'Sid':'ReadFixedRetainedPartitionStack','Effect':'Allow',
     'Action':['cloudformation:DescribeStacks','cloudformation:GetTemplate','cloudformation:ListStackResources'],
     'Resource':'arn:aws:cloudformation:us-east-1:092954139775:stack/KnownEnoughPartitionsStorage/*'}]}
policy_sha='aaf403ab18488dbe76347c56d997b9a4bb3400134addfc4ae3f780a645cbf0a1'
trust_sha='7dbfc8c615545903e4d479215adb9785d11c439193d20f2a90bd599b8d95942b'
def call(service,operation,*args,**kwargs):
    global action
    action=service+':'+operation
    return a.call([service,operation,*args],**kwargs)
def snapshot():
    role=call('iam','get-role','--role-name',role_name).get('Role',{})
    m.require(role.get('Arn')==role_arn and role.get('RoleName')==role_name
              and isinstance(role.get('RoleId'),str) and bool(role['RoleId'])
              and role.get('Path')=='/' and 'PermissionsBoundary' not in role,'ROLE_CHANGED')
    trust=m.document(role.get('AssumeRolePolicyDocument'))
    m.require(m.inventory.digest(m.encoded(trust))==trust_sha,'ROLE_TRUST_CHANGED')
    listed=call('iam','list-role-policies','--role-name',role_name)
    names=listed.get('PolicyNames')
    m.require(listed.get('IsTruncated') is False and isinstance(names,list) and len(names)<=6
              and all(isinstance(n,str) and re.fullmatch(r'[A-Za-z0-9+=,.@_-]{1,128}',n) for n in names)
              and len(set(names))==len(names),'INLINE_LIST_REJECTED')
    originals=sorted(n for n in names if n!=policy_name)
    m.require(len(originals)<=5,'REQUEST_SCOPE_LIMIT')
    managed=call('iam','list-attached-role-policies','--role-name',role_name)
    m.require(managed.get('IsTruncated') is False and managed.get('AttachedPolicies')==[],'MANAGED_BASELINE_REVIEW_REQUIRED')
    docs={}
    for name in originals:
        item=call('iam','get-role-policy','--role-name',role_name,'--policy-name',name)
        m.require(item.get('RoleName')==role_name and item.get('PolicyName')==name,'POLICY_BASELINE_REJECTED')
        docs[name]=m.document(item.get('PolicyDocument'))
        m.require(isinstance(docs[name],dict),'POLICY_BASELINE_REJECTED')
    stable={k:role[k] for k in ['RoleId','Arn','RoleName','Path']}
    stable['AssumeRolePolicyDocument']=trust
    return {'role':stable,'inlinePolicies':docs,'managedPolicies':[]}, policy_name in names
def read_candidate():
    item=call('iam','get-role-policy','--role-name',role_name,'--policy-name',policy_name,missing='NoSuchEntity')
    m.require(item is not None,'WRITE_NOT_VERIFIED')
    m.require(item.get('RoleName')==role_name and item.get('PolicyName')==policy_name
              and m.same(m.document(item.get('PolicyDocument')),policy),'METADATA_POLICY_CHANGED')
try:
    body=m.encoded(policy)
    m.require(m.inventory.digest(body)==policy_sha,'POLICY_CHANGED')
    state.save_bytes('metadata-policy.json',body)
    m.require(call('sts','get-caller-identity').get('Account')==m.ACCOUNT,'ACCOUNT_REJECTED')
    observed,present=snapshot()
    baseline=state.load('role-baseline.json')
    m.require(baseline is None or m.same(baseline,observed),'ROLE_BASELINE_CHANGED')
    baseline=observed
    state.save('role-baseline.json',baseline)
    size=len(body)-1+sum(len(m.encoded(p))-1 for p in baseline['inlinePolicies'].values())
    m.require(size<=10240,'INLINE_SIZE_LIMIT')
    baseline_sha=m.inventory.digest(m.encoded(baseline))
    intent={'roleName':role_name,'policyName':policy_name,'policySha':policy_sha,'baselineSha':baseline_sha}
    saved=state.load('put.intent.json')
    m.require(saved is None or m.same(saved,intent),'INTENT_CHANGED')
    if present:
        read_candidate()
    else:
        m.require(saved is None,'WRITE_NOT_VERIFIED')
        validation=call('accessanalyzer','validate-policy','--policy-type','IDENTITY_POLICY',
                        '--policy-document','file://'+str(state.folder/'metadata-policy.json'),'--max-results','100')
        state.save('validation-'+a.folder.name+'.json',validation)
        m.require(validation.get('nextToken') in (None,''),'VALIDATION_PAGINATED')
        findings=validation.get('findings')
        m.require(isinstance(findings,list),'VALIDATION_RESPONSE_REJECTED')
        m.require(all(isinstance(f,dict) and f.get('findingType') in {'ERROR','WARNING','SECURITY_WARNING','SUGGESTION'}
                      and isinstance(f.get('issueCode'),str) and re.fullmatch(r'[A-Z0-9_]{1,128}',f['issueCode'])
                      for f in findings),'VALIDATION_RESPONSE_REJECTED')
        finding_codes=[f['issueCode'] for f in findings]
        m.require(findings==[],'POLICY_REVIEW_REQUIRED')
        fresh,new_present=snapshot()
        m.require(not new_present and m.same(fresh,baseline),'ROLE_BASELINE_CHANGED')
        state.save('put.intent.json',intent)
        try:
            call('iam','put-role-policy','--role-name',role_name,'--policy-name',policy_name,
                 '--policy-document','file://'+str(state.folder/'metadata-policy.json'),mutation=True)
            write_outcome='JSON_ACK'
        except m.Rejected as error:
            # Empty or uncertain write acknowledgment is always reconciled by
            # reads. A saved intent never permits a second write on restart.
            write_outcome=str(error)
        fresh,new_present=snapshot()
        m.require(m.same(fresh,baseline),'ROLE_BASELINE_CHANGED')
        m.require(new_present,'WRITE_NOT_VERIFIED')
        read_candidate()
    state.save('readback.json',intent)
    print(json.dumps({'result':'INSPECTOR_PARTITIONS_POLICY_READBACK_PASS','role':role_name,'policy':policy_name,
                      'policySha':policy_sha,'baselineSha':baseline_sha,'originalInlinePolicyCount':len(baseline['inlinePolicies']),
                      'totalInlineCharactersAfter':size,'requests':a.calls,'mutations':a.mutations,
                      'alreadyPresent':present,'activation':'DISABLED','effectivePermissions':'PENDING_GITHUB_READBACK'}))
except m.Rejected as error:
    print(json.dumps({'result':'BLOCKED','action':action,'classification':str(error),
                      'requests':a.calls,'mutations':a.mutations,'writeOutcome':write_outcome,
                      'findingCodes':finding_codes}))
    raise SystemExit(1)
except (ValueError,KeyError,TypeError,AttributeError,OSError):
    print(json.dumps({'result':'BLOCKED','action':action,'classification':'LOCAL_OR_RESPONSE_REJECTED',
                      'requests':a.calls,'mutations':a.mutations}))
    raise SystemExit(1)
finally:
    state.close()
PY_INSPECTOR
) 1>&2
```

After successful CloudShell readback, A dispatches operations-partition-readback.yml once using its current frozen main source_sha and own GitHub account. Verify terminal result and the allowlisted matching artifact: CONFIGURATION_MATCH and zero mutations are metadata inspection only, not participant workload/migration/activation proof.

References: [DynamoDB read resource scopes](https://docs.aws.amazon.com/service-authorization/latest/reference/list_dynamodb.html), [CloudFormation metadata](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DescribeStacks.html), [IAM additive named policy semantics](https://docs.aws.amazon.com/IAM/latest/APIReference/API_PutRolePolicy.html).

## Checked preparation

[Evidence](inspector-partitions-evidence.json):32 isolated simulated executions PASS: successful JSON/empty/uncertain acknowledgments and repeat readback; uncertain unapplied write, changed intent, post-write identity drift and temporarily missing candidate never cause resend; correct prewrite role/policy drift, concurrent new candidate, wrong trust/account/role/boundary/managed/paginated/oversized policy lists/quota/new warnings/malformed or paginated validation stop without writes. Five-original-policy bound stays within32requests. Exact prepared-delta equality, Bash and embedded Python syntax PASS. Public summaries exclude private test role IDs and old policy names/documents. Application/operations executable source/workflows/installed templates stay byte-identical to own-A verifiedf5d1eaf source; no full application rerun for this artifact-only preparation. Actual AWS validation/attachment and effective GitHub readback remain pending.
