#!/usr/bin/env python3
"""One-shot operator capability probes; no account identifiers or raw errors in reports."""
import datetime,json,os,re,subprocess,uuid
ACCOUNT='092954139775'
REGION='us-east-1'
def invoke(service,operation,args):
    result=subprocess.run(['aws',service,operation,*args,'--region',REGION,'--endpoint-url',f'https://{service}.{REGION}.amazonaws.com','--output','json','--no-cli-pager','--no-paginate'],capture_output=True,text=True,timeout=20,env={**os.environ,'AWS_MAX_ATTEMPTS':'1'})
    if result.returncode:
        match=re.search(r'\(([^)]+)\) when calling',result.stderr)
        code=match.group(1) if match and match.group(1) in ['AccessDenied','AccessDeniedException','UserNotFoundException','UnrecognizedClientException','ExpiredTokenException'] else 'AWS_OPERATION_UNAVAILABLE'
        return None,code
    return json.loads(result.stdout),None
report={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':os.environ.get('EXPECTED_SOURCE'),'result':'NOT_EXECUTED','writes':0,'emailRequests':0,'checks':[]}
try:
    identity,error=invoke('sts','get-caller-identity',[])
    if error or identity.get('Account')!=ACCOUNT or not identity.get('Arn','').startswith(f'arn:aws:sts::{ACCOUNT}:assumed-role/KnownEnoughGithubPartitionMigration/'):
        raise ValueError('OWN_OPERATOR_IDENTITY_REQUIRED')
    absent=str(uuid.uuid4())
    operations=[('dynamodb','scan',['--table-name','KnownEnoughPartitions','--projection-expression','PK,SK','--select','SPECIFIC_ATTRIBUTES','--filter-expression','PK = :key AND SK = :state','--expression-attribute-values',json.dumps({':key':{'S':'ACCOUNT#'+absent},':state':{'S':'STATE'}}),'--limit','1']),('cognito-idp','admin-get-user',['--user-pool-id','us-east-1_V9OMjd0zx','--username','keqa-fix04-probe-'+absent]),('cognito-idp','list-users',['--user-pool-id','us-east-1_V9OMjd0zx','--filter',f'sub = "{absent}"','--limit','1'])]
    for service,operation,args in operations:
        data,error=invoke(service,operation,args)
        status='ALLOWED' if error is None or (operation=='admin-get-user' and error=='UserNotFoundException') else 'MISSING_ACCESS' if error in ['AccessDenied','AccessDeniedException'] else 'UNAVAILABLE'
        report['checks'].append({'operation':service+':'+operation,'result':status,'code':error,'dataWrites':0})
    report['result']='OPERATOR_CAPABILITIES_PASS' if all(item['result']=='ALLOWED' for item in report['checks']) else 'OPERATOR_CAPABILITIES_INCOMPLETE'
except (ValueError,subprocess.TimeoutExpired,OSError,json.JSONDecodeError):
    report['result']='OPERATOR_CAPABILITIES_UNAVAILABLE'
path=os.path.join(os.environ.get('RUNNER_TEMP','.'),'fix04-access-report.json')
with open(path,'w') as out:json.dump(report,out,indent=2)
print(json.dumps(report))
