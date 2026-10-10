# Participant access: fixed existing Lambda role, separate additive policy

A supplied exact primary Lambda runtime binding and IAM summary: KnownEnoughStageApiRole, no boundary, two inline policies, new KnownEnoughPartitionParticipant absent, zero managed attachments, both lists complete. Own CloudShell credentials remain private. The next change is only the existing reviewed participant profile, not a union with migration/archive/erasure/job/operator profiles. [Exact policy](participant-policy.json) is the unchanged partition proposal participant document with11statements/four exact DynamoDB table ARNs; canonical SHA256 **4bad8979fc3c43db6411c9b491c844ec65e26808e5ecf7ded74be88abeff99eb**. No IAM/S3/Bedrock/grant/delete/scan authority is added. Existing source/control/copied-journal, leading-key, transaction and return-value conditions are retained. IAM access never replaces server identity/participant consent.

## First: read-only baseline and AWS policy validation

This block uses the already downloaded checked f763284 tools/proposal and a new private HOME directory. No new clone or dependency installation. It verifies account, actual Lambda role, Lambda-only role trust, original complete two-policy/no-boundary/no-managed baseline; reads the two policy documents privately; checks the aggregate10,240character IAM inline-role limit and calls IAM Access Analyzer policy validation. It records only private baseline/candidate/plan/validation under HOME and returns allowlisted counts/hashes/finding codes. No AWS mutation or application activation. Zero findings yields PARTICIPANT_PREVIEW_READY; findings are technical review work, not a new human authorization request. Saved role IDs/trust/policies/environment and credentials are never uploaded.

```bash
(
set -euo pipefail
umask 077
cd "$HOME/.known-enough/ops00-partition-tools-f7632841284907411a0e9adb0de15f447c2eec00"
command python3 -B - <<'PY_PREVIEW'
import importlib.util, json, re
from pathlib import Path
spec=importlib.util.spec_from_file_location('ops_common', 'scripts/operations/cloudshell-create.py')
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.verify_checkout('f7632841284907411a0e9adb0de15f447c2eec00')
state=m.State(Path.home()/'.known-enough/ops00-participant-access-20261010', Path.home())
a=m.Aws(state); action=None
role_name='KnownEnoughStageApiRole'; policy_name='KnownEnoughPartitionParticipant'
role_arn='arn:aws:iam::092954139775:role/'+role_name
source='f7632841284907411a0e9adb0de15f447c2eec00'
def read(service, operation, *args):
    global action
    action=service+':'+operation
    return a.call([service, operation, *args])
try:
    m.require(read('sts','get-caller-identity').get('Account')==m.ACCOUNT, 'ACCOUNT_REJECTED')
    cfg=read('lambda','get-function-configuration','--function-name','known-enough-stage-api')
    m.require(cfg.get('Role')==role_arn, 'RUNTIME_ROLE_CHANGED')
    role=read('iam','get-role','--role-name',role_name).get('Role',{})
    m.require(role.get('Arn')==role_arn and role.get('RoleName')==role_name
              and isinstance(role.get('RoleId'),str) and 'PermissionsBoundary' not in role, 'ROLE_CHANGED')
    trust=m.document(role.get('AssumeRolePolicyDocument'))
    statements=trust.get('Statement') if isinstance(trust,dict) else None
    m.require(isinstance(statements,list) and len(statements)==1
              and statements[0].get('Effect')=='Allow'
              and statements[0].get('Action') in ('sts:AssumeRole',['sts:AssumeRole'])
              and statements[0].get('Principal') in ({'Service':'lambda.amazonaws.com'},{'Service':['lambda.amazonaws.com']}), 'ROLE_TRUST_REVIEW_REQUIRED')
    inline=read('iam','list-role-policies','--role-name',role_name)
    names=inline.get('PolicyNames')
    m.require(inline.get('IsTruncated') is False and isinstance(names,list)
              and len(names)==2 and all(isinstance(n,str) and re.fullmatch(r'[A-Za-z0-9+=,.@_-]{1,128}',n) for n in names)
              and len(set(names))==2 and policy_name not in names, 'INLINE_BASELINE_CHANGED')
    managed=read('iam','list-attached-role-policies','--role-name',role_name)
    m.require(managed.get('IsTruncated') is False and managed.get('AttachedPolicies')==[], 'MANAGED_BASELINE_CHANGED')
    policies={}
    for name in sorted(names):
        value=read('iam','get-role-policy','--role-name',role_name,'--policy-name',name)
        m.require(value.get('RoleName')==role_name and value.get('PolicyName')==name, 'POLICY_BASELINE_REJECTED')
        policies[name]=m.document(value.get('PolicyDocument'))
        m.require(isinstance(policies[name],dict), 'POLICY_BASELINE_REJECTED')
    template_bytes=Path('infra/operations/partition-setup.json').read_bytes()
    m.require(m.inventory.digest(template_bytes)=='262afec3e0c6d5306e819a723d3589c86f8499e1f9995ab33956046d9ff705f0','TEMPLATE_CHANGED')
    policy=json.loads(template_bytes)['Metadata']['PermissionProfiles']['participant']
    body=m.encoded(policy)
    m.require(m.inventory.digest(body)=='4bad8979fc3c43db6411c9b491c844ec65e26808e5ecf7ded74be88abeff99eb','POLICY_CHANGED')
    size=len(body)-1+sum(len(m.encoded(p))-1 for p in policies.values())
    m.require(size<=10240,'INLINE_SIZE_LIMIT')
    baseline={'sourceSha':source,'role':{k:role[k] for k in ['RoleId','Arn','RoleName','Path','AssumeRolePolicyDocument']},'inlinePolicies':policies,'managedPolicies':[]}
    state.save('role-baseline.json',baseline)
    state.save_bytes('participant-policy.json',body)
    validation=read('accessanalyzer','validate-policy','--policy-type','IDENTITY_POLICY',
                    '--policy-document','file://'+str(state.folder/'participant-policy.json'),'--max-results','100')
    m.require(validation.get('nextToken') in (None,''), 'VALIDATION_PAGINATED')
    findings=validation.get('findings')
    m.require(isinstance(findings,list), 'VALIDATION_RESPONSE_REJECTED')
    types={'ERROR','SECURITY_WARNING','WARNING','SUGGESTION'}
    m.require(all(isinstance(f,dict) and f.get('findingType') in types and isinstance(f.get('issueCode'),str)
                  and re.fullmatch('[A-Z0-9_]{1,128}',f['issueCode']) for f in findings), 'VALIDATION_RESPONSE_REJECTED')
    state.save('validation.json',validation)
    plan={'sourceSha':source,'roleName':role_name,'policyName':policy_name,'policySha':m.inventory.digest(body),
          'baselineSha':m.inventory.digest(m.encoded(baseline)),'totalInlineCharactersAfter':size}
    state.save('participant-preview.json',plan)
    print(json.dumps({'result':'PARTICIPANT_PREVIEW_READY' if not findings else 'POLICY_REVIEW_REQUIRED',
                      'role':role_name,'policy':policy_name,'policySha':plan['policySha'],
                      'baselineSha':plan['baselineSha'],'statementCount':len(policy['Statement']),
                      'totalInlineCharactersAfter':size,'findings':[{'type':f['findingType'],'code':f['issueCode']} for f in findings],
                      'requests':a.calls,'mutations':a.mutations,'activation':'DISABLED','effectivePermissions':'UNKNOWN'}))
except m.Rejected as error:
    print(json.dumps({'result':'BLOCKED','action':action,'classification':str(error),'requests':a.calls,'mutations':a.mutations}))
    raise SystemExit(1)
finally:
    state.close()
PY_PREVIEW
) 1>&2
```

## Apply/readback contract (prepare after actual validation result)

Standing user setup authority covers one named PutRolePolicy on the verified existing role with this exact document. Before writing, reverify the saved source/policy hashes, same role identity/trust/boundary, exact complete baseline policy documents and managed attachment state; check no existing new policy name. Write a durable intent before one PutRolePolicy; an uncertain response uses GetRolePolicy readback, not a blind retry. Never update/remove either original policy or role trust. If the named policy already matches, read back rather than reapply; mismatch requires repair review. Validate unchanged baseline plus new exact document after the write. IAM PutRolePolicy has no conditional-create/revision parameter: fresh preflight plus project single-writer ownership is the guard, not a claimed atomic CAS. Preserve intent and private original baseline for rollback; remove only this added named policy after verifying its document if rollback is necessary, never reset installed tables or original permissions.

This does not activate PARTITION_V2, migrate existing rows, deploy code or prove Lambda access. Migration/archive profiles and runtime integration still need their own scoped work. Exact validation result and current private baseline are pending; no policy attachment has occurred during preparation.

## Preparation evidence

Policy JSON parses and exactly equals the checked generated participant profile;11unique statement IDs, four fixed ARNs, only scoped DynamoDB actions, required leading-key/Null conditions and transaction enclosure for writes checked offline. Bash and embedded Python syntax PASS. No executable application/helper file changed; previously passed60Python/286native/full1407app+hosted1+browser64 source remains unchanged. Root quota/validation/PutRolePolicy semantics reviewed against primary AWS docs: [inline quota](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_iam-quotas.html), [validation](https://docs.aws.amazon.com/access-analyzer/latest/APIReference/API_ValidatePolicy.html), [PutRolePolicy](https://docs.aws.amazon.com/IAM/latest/APIReference/API_PutRolePolicy.html). AWS's [policy-generator metadata](https://awspolicygen.s3.amazonaws.com/js/policies.js) declares the EnclosingOperation key; effective transaction access still requires real workload proof.

Seven isolated preview scenarios PASS using a memory-only private-state store and fixed fake AWS reader: valid baseline, foreign account, wrong Lambda role, role boundary, existing candidate name, aggregate quota overflow and validation-error finding. All produce0mutations; failing baseline cases store no preview; output excludes synthetic role ID/existing policy names/content. These tests exercise the embedded preview logic, not real IAM capability.
