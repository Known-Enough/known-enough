import { describe, expect, test, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
// @ts-expect-error Node-only authorization boundary exercised without live services.
import { reserveExtra, githubRun } from '../../scripts/live-qa/extra-runs.mjs';
// @ts-expect-error Executable cumulative grant semantics are compared against the administrator helper.
import { cumulativeLimits } from '../../scripts/live-qa/cumulative.mjs';
const now=Date.parse('2026-10-03T03:00:00Z');
const auth={approved:true,maxRunsPerDay:4,expiresAt:'2026-10-09T03:16:41.171626Z'};
const approval={schemaVersion:1,day:'2026-10-03',actor:'Battosai1806',additionalRuns:2,usedRuns:0,baseRuns:4,authorizationVersion:3,authorizationExpiresAt:auth.expiresAt,expiresAt:'2026-10-04T00:00:00Z'};
const run={id:123,run_attempt:1,actor:{login:'Battosai1806'},triggering_actor:{login:'Battosai1806'},repository:{id:1377587215},head_repository:{id:1377587215},head_branch:'main',event:'workflow_run',status:'in_progress',path:'.github/workflows/live-qa-release-and-check.yml',head_sha:'a'.repeat(40)};
describe('two additional B runs, never a recurring daily increase',()=>{
 test('two starts consume the dated allowance without changing the original grant',()=>{
  const first=reserveExtra(approval,auth,3,4,'gh-123-1',run,now);expect(first.usedRuns).toBe(1);
  const second=reserveExtra(first,auth,3,5,'gh-123-1',run,now);expect(second.usedRuns).toBe(2);
  expect(()=>reserveExtra(second,auth,3,6,'gh-123-1',run,now)).toThrow('EXTRA_RUN_ALLOWANCE_BLOCKED');expect(approval.usedRuns).toBe(0);expect(auth.maxRunsPerDay).toBe(4);
 });
 test('the separately authorized third start consumes once and cannot be repeated',()=>{
  const bApproval={...approval,additionalRuns:3,usedRuns:2};
  const third=reserveExtra(bApproval,auth,3,6,'gh-123-1',run,now);expect(third.usedRuns).toBe(3);
  expect(()=>reserveExtra(third,auth,3,7,'gh-123-1',run,now)).toThrow('EXTRA_RUN_ALLOWANCE_BLOCKED');
  for(const usedRuns of [0,1,3])expect(()=>reserveExtra({...bApproval,usedRuns},auth,3,6,'gh-123-1',run,now)).toThrow('EXTRA_RUN_ALLOWANCE_BLOCKED');
  expect(auth.maxRunsPerDay).toBe(4);expect(bApproval.usedRuns).toBe(2);
 });
 test('wrong day, expired/malformed approval, changed grant and inconsistent usage fail closed',()=>{
  for(const a of [null,{...approval,additionalRuns:3},{...approval,usedRuns:-1},{...approval,usedRuns:2},{...approval,usedRuns:0.5},{...approval,actor:'someone-else'},{...approval,expiresAt:auth.expiresAt},{...approval,unknown:'PRIVATE'}])
   expect(()=>reserveExtra(a,auth,3,4,'gh-123-1',run,now)).toThrow('EXTRA_RUN_ALLOWANCE_BLOCKED');
  for(const time of [Date.parse('2026-10-02T23:59:59Z'),Date.parse(approval.expiresAt)])expect(()=>reserveExtra(approval,auth,3,4,'gh-123-1',run,time)).toThrow();
  expect(()=>reserveExtra(approval,auth,4,4,'gh-123-1',run,now)).toThrow();expect(()=>reserveExtra(approval,auth,3,5,'gh-123-1',run,now)).toThrow();
 });
 test('caller-supplied actor cannot replace fixed GitHub repository/workflow/run/attempt evidence',()=>{
  for(const r of [{...run,actor:{login:'martelaxe'}},{...run,triggering_actor:{login:'martelaxe'}},{...run,id:124},{...run,run_attempt:2},{...run,repository:{id:1}},{...run,head_repository:{id:1}},{...run,head_branch:'other'},{...run,path:'other.yml'},{...run,event:'pull_request'},{...run,status:'completed'}])
   expect(()=>reserveExtra(approval,auth,3,4,'gh-123-1',r,now)).toThrow('EXTRA_RUN_ACTOR_UNVERIFIED');
 });
 test('the one-time transfer accepts A only when the saved approval and both GitHub actors name A',()=>{
  const aApproval={...approval,actor:'martelaxe'};
  const aRun={...run,actor:{login:'martelaxe'},triggering_actor:{login:'martelaxe'}};
  expect(reserveExtra(aApproval,auth,3,4,'gh-123-1',aRun,now).usedRuns).toBe(1);
  for(const r of [{...aRun,actor:{login:'Battosai1806'}},{...aRun,triggering_actor:{login:'Battosai1806'}}])
   expect(()=>reserveExtra(aApproval,auth,3,4,'gh-123-1',r,now)).toThrow('EXTRA_RUN_ACTOR_UNVERIFIED');
  expect(()=>reserveExtra({...approval,actor:'someone-else'},auth,3,4,'gh-123-1',run,now)).toThrow('EXTRA_RUN_ALLOWANCE_BLOCKED');
 });
 test('GitHub lookup uses the fixed HTTPS repository, bounded deadline, no redirect or private errors',async()=>{
  const fetcher=vi.fn(async(url:string,options:Record<string,unknown>)=>{expect(url).toContain('https://api.github.com/');expect(options.signal).toBeDefined();return {ok:true,json:async()=>run};});expect(await githubRun('gh-123-1',fetcher)).toEqual(run);
  expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.github.com/repos/Known-Enough/known-enough/actions/runs/123');
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({redirect:'error'});
  await expect(githubRun('PRIVATE_TOKEN',fetcher)).rejects.toThrow('EXTRA_RUN_ACTOR_UNVERIFIED');expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(githubRun('gh-123-1',async()=>{throw new Error('PRIVATE_PROVIDER_PAYLOAD');})).rejects.toThrow('EXTRA_RUN_ACTOR_UNVERIFIED');
 });
 test('the exception increment is in the same broker transaction as ordinary usage, lease and cumulative reservation',()=>{
  const source=readFileSync('scripts/live-qa/broker.mjs','utf8');
  expect(source).toContain('if (next.runs > a.value.maxRunsPerDay)');expect(source).toContain('reserveTotal(total.value, a.value, { runs: 1 })');
  expect(source).toContain("put('LEASE', prior, current), put(day, period, next), put('TOTAL', total, reservedTotal), ...extraReservation");
 });
 test('administrator helper preserves usage, guards all four versions, retries idempotently and rejects drift',()=>{
  const result=spawnSync('python3',['-B','-c',String.raw`
import copy, datetime, importlib.util, json, os, tempfile
from pathlib import Path
spec=importlib.util.spec_from_file_location('extra','scripts/live-qa/approve-two-extra-runs.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
now=datetime.datetime(2026,10,3,3,tzinfo=datetime.timezone.utc)
a={'approved':True,'retentionReviewed':True,'invocationLoggingDisabled':True,'expiresAt':m.EXPIRY,'maxRunsPerDay':4,'maxRunsTotal':28,'maxTokensTotal':7000000,'maxCostMicrosTotal':7000000,'maxSignupMessagesTotal':56,'maxAttemptsPerRun':200,'maxTokensPerRun':250000,'maxCostMicrosPerRun':250000,'maxSignupMessagesPerRun':2,'maxSignupMessagesPerDay':8}
values={'AUTH':a,'LEASE':{'status':'CLEAN','PRIVATE':'DO_NOT_PRINT'},'DAY#'+m.DAY:{'runs':4,'messages':4},'TOTAL':{'runs':4,'reservedTokens':100,'reservedCostMicros':100,'messages':4}}
base={k:{**m.key(k),'payload':{'S':json.dumps(v)},'version':{'N':'3'}} for k,v in values.items()}
with tempfile.TemporaryDirectory() as folder:
 home=Path(folder);state=copy.deepcopy(base);writes=[]
 def fake(service,op,**p):
  if op=='get-caller-identity':return {'Account':m.ACCOUNT}
  if op=='describe-table':return {'Table':{'TableArn':'arn:aws:dynamodb:us-east-1:'+m.ACCOUNT+':table/'+m.TABLE,'TableStatus':'ACTIVE'}}
  if op=='get-item':
   assert p['consistent_read'] is True and p['table_name']==m.TABLE
   return {'Item':state[p['key']['PK']['S']]} if p['key']['PK']['S'] in state else {}
  if op=='transact-write-items':
   tx=json.loads(Path(p['cli_input_json'].removeprefix('file://')).read_text())['TransactItems'];assert len(tx)==5
   for name,t in zip(['AUTH','LEASE','DAY#'+m.DAY,'TOTAL'],tx[:4]):
    assert t['ConditionCheck']['Key']==m.key(name) and t['ConditionCheck']['ExpressionAttributeValues'][':v']==state[name]['version']
   put=tx[-1]['Put'];assert put['ConditionExpression']=='attribute_not_exists(PK)' and put['Item']['PK']['S']==m.EXTRA_KEY
   writes.append(tx);state[m.EXTRA_KEY]=put['Item'];return {}
  raise AssertionError('Unexpected operation')
 assert m.install(fake,now,home)['cloudWrites'] is False and not (home/'known-enough-two-extra-runs').exists()
 assert m.install(fake,now,home,True,clock=lambda:now)['remaining']==2 and len(writes)==1
 assert all(state[k]==v for k,v in base.items())
 assert (home/'known-enough-two-extra-runs'/m.DAY/'original-private.json').stat().st_mode&0o777==0o600
 state[m.EXTRA_KEY]['payload']['S']=json.dumps({**json.loads(state[m.EXTRA_KEY]['payload']['S']),'usedRuns':1})
 assert m.install(fake,now,home,True,clock=lambda:now)['remaining']==1 and len(writes)==1
 for change,reason in [('lease','CLEANUP_REQUIRED_FIRST'),('daily','DAILY_USAGE_CHANGED'),('total','CUMULATIVE_BUDGET_INSUFFICIENT'),('grant','ORIGINAL_APPROVAL_CHANGED'),('extra','EXTRA_ALLOWANCE_DRIFT')]:
  state=copy.deepcopy(base)
  name,field,value={'lease':('LEASE','status','ACTIVE'),'daily':('DAY#'+m.DAY,'runs',5),'total':('TOTAL','runs',28),'grant':('AUTH','maxRunsPerDay',6)}.get(change,('','',None))
  if change=='extra':state[m.EXTRA_KEY]={**m.key(m.EXTRA_KEY),'payload':{'S':'{}'},'version':{'N':'1'}}
  else:
   v=json.loads(state[name]['payload']['S']);v[field]=value;state[name]['payload']['S']=json.dumps(v)
  try:m.install(fake,now,home,True,clock=lambda:now);raise AssertionError('unexpected allowance')
  except ValueError as e:assert str(e)==reason
 assert len(writes)==1
 for case in ['legacy','stricter']:
  state=copy.deepcopy(base);original=json.loads(state['AUTH']['payload']['S'])
  if case=='legacy':
   for field in m.TOTAL_CEILINGS:del original[field]
  else:original.update(maxRunsTotal=20,maxTokensTotal=600000,maxCostMicrosTotal=600000,maxSignupMessagesTotal=8)
  state['AUTH']['payload']['S']=json.dumps(original);before=copy.deepcopy(state)
  assert m.install(fake,now,home/case,True,clock=lambda:now)['remaining']==2
  assert all(state[k]==v for k,v in before.items())
 assert len(writes)==3
`],{encoding:'utf8'});expect(result.status,result.stderr).toBe(0);expect(result.stdout).not.toMatch(/PRIVATE|DO_NOT_PRINT/);
 });
 test('administrator third-run helper assigns exactly one guarded use to B and is idempotent',()=>{
  const result=spawnSync('python3',['-B','-c',String.raw`
import copy,datetime,importlib.util,json,tempfile
from pathlib import Path
spec=importlib.util.spec_from_file_location('third','scripts/live-qa/approve-third-extra-run.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
now=datetime.datetime(2026,10,3,20,tzinfo=datetime.timezone.utc)
a={'approved':True,'retentionReviewed':True,'invocationLoggingDisabled':True,'expiresAt':m.AUTH_EXPIRY,'maxRunsPerDay':4,'maxRunsTotal':28,'maxTokensTotal':7000000,'maxCostMicrosTotal':7000000,'maxSignupMessagesTotal':56,'maxAttemptsPerRun':200,'maxTokensPerRun':250000,'maxCostMicrosPerRun':250000,'maxSignupMessagesPerRun':2,'maxSignupMessagesPerDay':8}
values={'AUTH':a,'LEASE':{'status':'CLEAN','PRIVATE':'DO_NOT_PRINT'},'DAY#'+m.DAY:{'runs':6,'messages':5},'TOTAL':{'runs':6,'reservedTokens':100,'reservedCostMicros':100,'messages':5},m.EXTRA_KEY:{'schemaVersion':1,'day':m.DAY,'actor':'martelaxe','additionalRuns':2,'usedRuns':2,'baseRuns':4,'authorizationVersion':4,'authorizationExpiresAt':m.AUTH_EXPIRY,'expiresAt':m.EXTRA_EXPIRY}}
state={k:{**m.key(k),'payload':{'S':json.dumps(v)},'version':{'N':'4'}} for k,v in values.items()};before=copy.deepcopy(state);writes=[]
def fake(service,op,**p):
 if op=='get-caller-identity':return {'Account':m.ACCOUNT}
 if op=='describe-table':return {'Table':{'TableArn':'arn:aws:dynamodb:us-east-1:'+m.ACCOUNT+':table/'+m.TABLE,'TableStatus':'ACTIVE'}}
 if op=='get-item':return {'Item':copy.deepcopy(state[p['key']['PK']['S']])}
 if op=='transact-write-items':
  tx=json.loads(Path(p['cli_input_json'].removeprefix('file://')).read_text())['TransactItems'];assert len(tx)==5
  for name,t in zip(['AUTH','LEASE','DAY#'+m.DAY,'TOTAL'],tx[:4]):assert t['ConditionCheck']['Key']==m.key(name) and t['ConditionCheck']['ExpressionAttributeValues'][':v']==state[name]['version']
  put=tx[-1]['Put'];assert put['Item']['PK']['S']==m.EXTRA_KEY and put['ConditionExpression']=='#v=:v' and put['Item']['version']['N']=='5'
  assert json.loads(put['Item']['payload']['S'])['additionalRuns']==3 and json.loads(put['Item']['payload']['S'])['usedRuns']==2
  writes.append(tx);state[m.EXTRA_KEY]=put['Item'];return {}
 raise AssertionError('unexpected AWS operation')
with tempfile.TemporaryDirectory() as d:
 home=Path(d)
 assert m.install(fake,now,home)['status']=='THIRD_RUN_PREPARED_FOR_B' and not writes and not (home/'known-enough-third-extra-run').exists()
 applied=m.install(fake,now,home,True,clock=lambda:now)
 assert applied=={'status':'THIRD_RUN_APPROVED_FOR_B','remaining':1,'expiresAt':m.EXTRA_EXPIRY,'cloudWrites':True} and len(writes)==1
 assert json.loads(state[m.EXTRA_KEY]['payload']['S'])['actor']=='Battosai1806'
 assert all(state[k]==before[k] for k in ['AUTH','LEASE','DAY#'+m.DAY,'TOTAL'])
 snapshot=home/'known-enough-third-extra-run'/m.DAY/'before-private.json';assert snapshot.stat().st_mode&0o777==0o600
 again=m.install(fake,now,home,True,clock=lambda:now);assert again['status']=='THIRD_RUN_ALREADY_APPROVED_FOR_B' and again['remaining']==1 and len(writes)==1
 v=json.loads(state[m.EXTRA_KEY]['payload']['S']);v['usedRuns']=3;state[m.EXTRA_KEY]['payload']['S']=json.dumps(v)
 state['DAY#'+m.DAY]['payload']['S']=json.dumps({'runs':7,'messages':6})
 assert m.install(fake,now,home,True,clock=lambda:now)['remaining']==0 and len(writes)==1

state=copy.deepcopy(before);total=json.loads(state['TOTAL']['payload']['S']);total['reservedTokens']=m.TOTAL_CEILINGS['maxTokensTotal']-1;state['TOTAL']['payload']['S']=json.dumps(total)
try:m.install(fake,now,tempfile.gettempdir(),True,clock=lambda:now);raise AssertionError('budget overflow accepted')
except ValueError as e:assert str(e)=='CUMULATIVE_BUDGET_INSUFFICIENT'
assert len(writes)==1
print(json.dumps({'prepared':True,'oneUseOnly':True,'idempotent':True,'priorRecordsUnchanged':True}))
`],{encoding:'utf8'});
  expect(result.status,result.stderr).toBe(0);expect(result.stdout).toContain('"oneUseOnly": true');expect(result.stdout).not.toMatch(/PRIVATE|DO_NOT_PRINT/);
 });
 test('administrator helper exposes only a safe AWS error code and fixed control key',()=>{
  const result=spawnSync('python3',['-B','-c',String.raw`
import importlib.util,subprocess
from types import SimpleNamespace
s=importlib.util.spec_from_file_location('third','scripts/live-qa/approve-third-extra-run.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
original=m.subprocess.run
m.subprocess.run=lambda *a,**k:SimpleNamespace(returncode=1,stderr='aws: [ERROR]: An error occurred (AccessDeniedException) when calling the GetItem operation: PRIVATE_ARN_AND_DETAILS')
try:
 try:m.read(lambda *a,**k:m.aws('dynamodb','get-item',table_name=m.TABLE,key=m.key('AUTH')),'AUTH');raise AssertionError('expected safe AWS failure')
 except ValueError as e:assert str(e)=='AWS_OPERATION_FAILED:dynamodb:get-item:AccessDeniedException:KEY=AUTH' and 'PRIVATE' not in str(e)
finally:m.subprocess.run=original
print('safe AWS error classification passed')
`],{encoding:'utf8'});
  expect(result.status,result.stderr).toBe(0);expect(result.stdout).toContain('safe AWS error classification passed');expect(result.stdout).not.toMatch(/PRIVATE|ARN/);
 });
 test('administrator legacy/stricter totals match executable cumulative caps and reject partial or enlarged totals',()=>{
  const base={approved:true,expiresAt:auth.expiresAt,maxRunsPerDay:4,maxAttemptsPerRun:200,maxTokensPerRun:250000,maxCostMicrosPerRun:250000,attemptCostMicros:1,maxSignupMessagesPerRun:2,maxSignupMessagesPerDay:8,retentionReviewed:true,invocationLoggingDisabled:true};
  const cases=[base,{...base,maxTokensPerRun:1000,maxCostMicrosPerRun:2000,maxSignupMessagesPerDay:4},{...base,maxRunsTotal:20,maxTokensTotal:600000,maxCostMicrosTotal:600000,maxSignupMessagesTotal:8}];
  const output=spawnSync('python3',['-B','-c',String.raw`
import importlib.util,json,sys
s=importlib.util.spec_from_file_location('extra','scripts/live-qa/approve-two-extra-runs.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
cases=json.load(sys.stdin)
for changed in [{'maxRunsTotal':28},{'maxRunsTotal':True,'maxTokensTotal':7000000,'maxCostMicrosTotal':7000000,'maxSignupMessagesTotal':56},{'maxRunsTotal':28,'maxTokensTotal':8000000,'maxCostMicrosTotal':7000000,'maxSignupMessagesTotal':56},{'maxRunsTotal':0,'maxTokensTotal':7000000,'maxCostMicrosTotal':7000000,'maxSignupMessagesTotal':56}]:
 try:m.cumulative_caps({**cases[0],**changed});raise AssertionError('unsafe caps accepted')
 except ValueError as e:assert str(e)=='CUMULATIVE_CEILINGS_CHANGED'
print(json.dumps([m.cumulative_caps(a) for a in cases]))
`],{input:JSON.stringify(cases),encoding:'utf8'});
  expect(output.status,output.stderr).toBe(0);
  expect(JSON.parse(output.stdout)).toEqual(cases.map(a=>{const limits=cumulativeLimits(a);return {maxRunsTotal:limits.runs,maxTokensTotal:limits.reservedTokens,maxCostMicrosTotal:limits.reservedCostMicros,maxSignupMessagesTotal:limits.messages};}));
 });
});
