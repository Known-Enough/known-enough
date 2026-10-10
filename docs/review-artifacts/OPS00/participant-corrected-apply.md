# Corrected participant policy and one additive attachment

A supplied the actual private preview summary: five WARNING findings, all DYNAMODB_WRONG_CONDITION_FOR_ACTION, on GetItem statements0/2/4/6/9. No AWS mutation occurred. Original policy SHA4bad8979fc3c43db6411c9b491c844ec65e26808e5ecf7ded74be88abeff99eb and original baseline SHA cab6a950a1e451156bbb2546cb3b37a05371c52654619aa1f0df5e194a133bba are retained in the prior HOME directory.

The [corrected policy](participant-policy-corrected.json) is a narrowly defined projection of the immutable installed proposal participant profile: remove only StringEqualsIfExists dynamodb:ReturnValues=NONE from all six pure-read statements0/2/4/6/7/9. The additional Query statement7 has the same inapplicable write-return condition even though AWS reported only the five GetItem locations. Every action/resource/statement and meaningful leading-key/Null/transaction/write condition stays identical. No Select substitute is introduced because no projection restriction was previously intended. AWS documents that this inapplicable condition never takes effect and protects nothing in [the validation reference](https://docs.aws.amazon.com/IAM/latest/UserGuide/access-analyzer-reference-policy-checks.html). Corrected canonical SHA256 **0859906345e54c60b2c0f8eb6384a7038263d56b32e109de70500fa4c3328d82**,4143characters excluding final newline; aggregate expected5126characters. The original generated template/source SHA and installed storage remain unchanged; this is not a CloudFormation update.

The block uses the existing checked f763284 tools, validates the saved original preview/findings/baseline and corrected projection, and uses a separate persistent private HOME state. It verifies the actual Lambda role, stable role identity/trust/no boundary, exact original policy documents and complete managed/inline lists. Actual zero-finding AWS validation and another fresh baseline precede a single additive PutRolePolicy. Private flushed intent survives CloudShell restart. An empty/uncertain write acknowledgment uses reads only; subsequent executions never repeat an intent-recorded write. Exact matching existing policy yields readback without mutation. Failure remains finite/sanitized; private role metadata, Lambda environment and AWS diagnostics stay under HOME. AWS IAM provides no atomic conditional-create guard; exclusive local state and shared single-writer ownership plus fresh baseline checks do not claim cloud CAS. Retain original policies and both old/new private states; no automatic rollback/deletion.

Standing project authority already covers this scoped write. Only the named KnownEnoughPartitionParticipant on KnownEnoughStageApiRole is attached; no trust/original policies/app flags/deployment/migration/model/email change. READBACK_PASS confirms matching configuration, not effective workload access or production readiness. Actual AWS execution is pending user CloudShell output; A's worker makes no AWS request.

```bash
(
set -euo pipefail
umask 077
cd "$HOME/.known-enough/ops00-partition-tools-f7632841284907411a0e9adb0de15f447c2eec00"
command python3 -B - <<'PY_APPLY'
import copy, importlib.util, json
from pathlib import Path
spec=importlib.util.spec_from_file_location('ops_common','scripts/operations/cloudshell-create.py')
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.verify_checkout('f7632841284907411a0e9adb0de15f447c2eec00')
old=m.State(Path.home()/'.known-enough/ops00-participant-access-20261010',Path.home())
try:
    baseline=old.load('role-baseline.json')
    plan=old.load('participant-preview.json')
    original=old.load('participant-policy.json')
    previous=old.load('validation.json')
finally:
    old.close()
state=m.State(Path.home()/'.known-enough/ops00-participant-corrected-20261010',Path.home())
a=m.Aws(state); action=None; findings=[]; write_outcome=None
role_name='KnownEnoughStageApiRole'; policy_name='KnownEnoughPartitionParticipant'
role_arn='arn:aws:iam::092954139775:role/'+role_name
old_sha='4bad8979fc3c43db6411c9b491c844ec65e26808e5ecf7ded74be88abeff99eb'
new_sha='0859906345e54c60b2c0f8eb6384a7038263d56b32e109de70500fa4c3328d82'
baseline_sha='cab6a950a1e451156bbb2546cb3b37a05371c52654619aa1f0df5e194a133bba'
def call(service,operation,*args,**kwargs):
    global action
    action=service+':'+operation
    return a.call([service,operation,*args],**kwargs)
def snapshot():
    cfg=call('lambda','get-function-configuration','--function-name','known-enough-stage-api')
    m.require(cfg.get('Role')==role_arn,'RUNTIME_ROLE_CHANGED')
    role=call('iam','get-role','--role-name',role_name).get('Role',{})
    m.require('PermissionsBoundary' not in role and all(k in role for k in baseline['role']),'ROLE_CHANGED')
    m.require(m.same({k:role[k] for k in baseline['role']},baseline['role']),'ROLE_CHANGED')
    listed=call('iam','list-role-policies','--role-name',role_name)
    names=listed.get('PolicyNames'); originals=set(baseline['inlinePolicies'])
    m.require(listed.get('IsTruncated') is False and isinstance(names,list)
              and all(isinstance(n,str) for n in names) and len(set(names))==len(names)
              and set(names) in (originals,originals|{policy_name}),'INLINE_BASELINE_CHANGED')
    managed=call('iam','list-attached-role-policies','--role-name',role_name)
    m.require(managed.get('IsTruncated') is False and managed.get('AttachedPolicies')==[],'MANAGED_BASELINE_CHANGED')
    for name,expected in baseline['inlinePolicies'].items():
        found=call('iam','get-role-policy','--role-name',role_name,'--policy-name',name)
        m.require(found.get('RoleName')==role_name and found.get('PolicyName')==name
                  and m.same(m.document(found.get('PolicyDocument')),expected),'POLICY_BASELINE_CHANGED')
    return policy_name in names
def read_candidate():
    found=call('iam','get-role-policy','--role-name',role_name,'--policy-name',policy_name,missing='NoSuchEntity')
    m.require(found is not None,'WRITE_NOT_VERIFIED')
    m.require(found.get('RoleName')==role_name and found.get('PolicyName')==policy_name
              and m.same(m.document(found.get('PolicyDocument')),policy),'PARTICIPANT_POLICY_CHANGED')
try:
    m.require(all(isinstance(x,dict) for x in (baseline,plan,original,previous)),'SAVED_PREVIEW_REQUIRED')
    m.require(m.inventory.digest(m.encoded(baseline))==baseline_sha
              and plan.get('baselineSha')==baseline_sha and plan.get('policySha')==old_sha
              and plan.get('roleName')==role_name and plan.get('policyName')==policy_name
              and baseline.get('sourceSha')=='f7632841284907411a0e9adb0de15f447c2eec00','SAVED_BASELINE_CHANGED')
    raw=Path('infra/operations/partition-setup.json').read_bytes()
    m.require(m.inventory.digest(raw)=='262afec3e0c6d5306e819a723d3589c86f8499e1f9995ab33956046d9ff705f0','TEMPLATE_CHANGED')
    m.require(m.same(original,json.loads(raw)['Metadata']['PermissionProfiles']['participant'])
              and m.inventory.digest(m.encoded(original))==old_sha,'ORIGINAL_POLICY_CHANGED')
    reported=previous.get('findings',[])
    indices=[]
    for finding in reported:
        m.require(finding.get('issueCode')=='DYNAMODB_WRONG_CONDITION_FOR_ACTION','PRIOR_FINDINGS_CHANGED')
        for loc in finding.get('locations',[]):
            path=loc.get('path',[])
            m.require(len(path)==5 and path[0]=={'value':'Statement'}
                      and path[2:]==[{'value':'Condition'},{'value':'StringEqualsIfExists'},{'value':'dynamodb:ReturnValues'}], 'PRIOR_FINDINGS_CHANGED')
            indices.append(path[1].get('index'))
    m.require(len(reported)==5 and sorted(indices)==[0,2,4,6,9],'PRIOR_FINDINGS_CHANGED')
    policy=copy.deepcopy(original)
    for i in [0,2,4,6,7,9]:
        statement=policy['Statement'][i]
        m.require(set(statement['Action'])<={'dynamodb:GetItem','dynamodb:BatchGetItem','dynamodb:Query'},'READ_PROJECTION_CHANGED')
        m.require(statement['Condition'].pop('StringEqualsIfExists')=={'dynamodb:ReturnValues':'NONE'},'READ_PROJECTION_CHANGED')
    body=m.encoded(policy)
    m.require(m.inventory.digest(body)==new_sha,'CORRECTED_POLICY_CHANGED')
    size=len(body)-1+sum(len(m.encoded(p))-1 for p in baseline['inlinePolicies'].values())
    m.require(size<=10240,'INLINE_SIZE_LIMIT')
    intent={'roleName':role_name,'policyName':policy_name,'policySha':new_sha,'baselineSha':baseline_sha}
    saved_intent=state.load('put.intent.json')
    m.require(saved_intent is None or m.same(saved_intent,intent),'INTENT_CHANGED')
    state.save('role-baseline.json',baseline)
    state.save_bytes('participant-policy.json',body)
    m.require(call('sts','get-caller-identity').get('Account')==m.ACCOUNT,'ACCOUNT_REJECTED')
    present=snapshot()
    if present:
        read_candidate()
    else:
        m.require(saved_intent is None,'WRITE_NOT_VERIFIED')
        validation=call('accessanalyzer','validate-policy','--policy-type','IDENTITY_POLICY',
                        '--policy-document','file://'+str(state.folder/'participant-policy.json'),'--max-results','100')
        state.save('validation-'+a.folder.name+'.json',validation)
        m.require(validation.get('nextToken') in (None,''),'VALIDATION_PAGINATED')
        findings=validation.get('findings')
        m.require(isinstance(findings,list),'VALIDATION_RESPONSE_REJECTED')
        m.require(findings==[],'POLICY_REVIEW_REQUIRED')
        m.require(not snapshot(),'INLINE_BASELINE_CHANGED')
        state.save('put.intent.json',intent)
        try:
            call('iam','put-role-policy','--role-name',role_name,'--policy-name',policy_name,
                 '--policy-document','file://'+str(state.folder/'participant-policy.json'),mutation=True)
            write_outcome='JSON_ACK'
        except m.Rejected as error:
            # Successful PutRolePolicy CLI acknowledgments are empty. Any uncertain
            # response is reconciled with reads; never send a second write.
            write_outcome=str(error)
        m.require(snapshot(),'WRITE_NOT_VERIFIED')
        read_candidate()
    state.save('readback.json',intent)
    print(json.dumps({'result':'PARTICIPANT_POLICY_READBACK_PASS','role':role_name,'policy':policy_name,
                      'policySha':new_sha,'baselineSha':baseline_sha,'totalInlineCharactersAfter':size,
                      'requests':a.calls,'mutations':a.mutations,'alreadyPresent':present,
                      'activation':'DISABLED','effectivePermissions':'UNKNOWN'}))
except m.Rejected as error:
    print(json.dumps({'result':'BLOCKED','action':action,'classification':str(error),
                      'requests':a.calls,'mutations':a.mutations,'writeOutcome':write_outcome,
                      'findingCodes':[f.get('issueCode') for f in findings if isinstance(f,dict)] if isinstance(findings,list) else []}))
    raise SystemExit(1)
finally:
    state.close()
PY_APPLY
) 1>&2
```

## Checked preparation

[Recorded checks](participant-corrected-evidence.json):21 isolated simulated executions passed, including empty/uncertain AWS acknowledgments, repeat readback, exact original-state preservation and no duplicate write after unresolved intent. Exact projection reversal equals the original policy; Bash/embedded Python syntax passed. No application/helper/source/config/installed template changed; the previous pinned full application check remains the unchanged source baseline. Actual AWS validation/attachment is pending, not PASS.
