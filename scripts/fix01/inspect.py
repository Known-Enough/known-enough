"""Fixed-target, read-only FIX01 diagnosis. Never exports logs, config or tokens."""
import datetime, hashlib, json, os, re, subprocess, pathlib
ACCOUNT='092954139775'; REGION='us-east-1'; FUNCTION='known-enough-stage-api'; API='u94iyvt6p9'
report={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':os.environ['EXPECTED_SOURCE'],'writes':0,'providerCalls':0,'checks':{},'denials':[]}
def call(service,operation,*args):
 p=subprocess.run(['aws',service,operation,*args,'--region',REGION,'--output','json','--no-cli-pager'],capture_output=True,text=True,timeout=25)
 if p.returncode:
  match=re.search(r'An error occurred \((\w+)\)',p.stderr)
  report['denials'].append({'operation':service+':'+operation,'code':match.group(1) if match else 'AWS_CALL_UNAVAILABLE','role':report.get('role'),'resource':FUNCTION if service in ['lambda','logs'] else API})
  return None
 return json.loads(p.stdout)
try:
 identity=call('sts','get-caller-identity')
 if not identity or identity['Account']!=ACCOUNT or not identity['Arn'].startswith('arn:aws:sts::'+ACCOUNT+':assumed-role/KnownEnoughGithubStagingInspector/'):raise ValueError('OWN_TARGET_IDENTITY_INVALID')
 report['role']='KnownEnoughGithubStagingInspector'
 config=call('lambda','get-function-configuration','--function-name',FUNCTION)
 if config:report['checks']['api']={key:config.get(key) for key in ['CodeSha256','RevisionId','Runtime','Handler','LastModified','LastUpdateStatus']};report['checks']['api']['environmentHash']=hashlib.sha256(json.dumps(config.get('Environment',{}),sort_keys=True).encode()).hexdigest()
 routes=call('apigatewayv2','get-routes','--api-id',API)
 if routes:report['checks']['routes']=[{key:r.get(key) for key in ['RouteKey','AuthorizationType','AuthorizerId','Target']} for r in routes.get('Items',[])]
 authorizers=call('apigatewayv2','get-authorizers','--api-id',API)
 if authorizers:report['checks']['jwt']=[{key:r.get(key) for key in ['AuthorizerId','AuthorizerType','JwtConfiguration','IdentitySource']} for r in authorizers.get('Items',[])]
 now=int(datetime.datetime.now(datetime.timezone.utc).timestamp()*1000)
 logs=call('logs','filter-log-events','--log-group-name','/aws/lambda/'+FUNCTION,'--start-time',str(now-300000),'--end-time',str(now),'--limit','10','--no-paginate')
 if logs is not None:report['checks']['apiLogs']={'result':'READ_PASS','windowSeconds':300,'eventCount':len(logs.get('events',[])),'messagesExported':0}
 report['result']='METADATA_READBACK' if config and routes else 'METADATA_INCOMPLETE'
except Exception as error:report['result']='BLOCKED';report['error']=str(error) if str(error)=='OWN_TARGET_IDENTITY_INVALID' else 'INSPECTION_UNAVAILABLE'
finally:
 path=pathlib.Path(os.environ['RUNNER_TEMP'])/'fix01-inspect.json';path.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
