import { describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';

describe('A-only transfer of the existing two dated QA starts', () => {
  test('moves only the unused count, preserves the original records, and retries without replenishing', () => {
    const result = spawnSync('python3', ['-B', '-c', String.raw`
import copy, datetime, importlib.util, json, os, tempfile
from pathlib import Path
s=importlib.util.spec_from_file_location('transfer','scripts/live-qa/transfer-two-extra-runs-to-a.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
now=datetime.datetime(2026,10,3,17,tzinfo=datetime.timezone.utc)
auth={'approved':True,'retentionReviewed':True,'invocationLoggingDisabled':True,'expiresAt':m.EXPIRY,'maxRunsPerDay':4,'maxRunsTotal':28,'maxTokensTotal':7000000,'maxCostMicrosTotal':7000000,'maxSignupMessagesTotal':56,'maxAttemptsPerRun':200,'maxTokensPerRun':250000,'maxCostMicrosPerRun':250000,'maxSignupMessagesPerRun':2,'maxSignupMessagesPerDay':8}
values={'AUTH':auth,'LEASE':{'status':'CLEAN','private':'DO_NOT_PRINT'},'DAY#'+m.DAY:{'runs':4,'messages':4},'TOTAL':{'runs':4,'reservedTokens':100,'reservedCostMicros':100,'messages':4},m.EXTRA_KEY:{'schemaVersion':1,'day':m.DAY,'actor':m.FROM_ACTOR,'additionalRuns':2,'usedRuns':0,'baseRuns':4,'authorizationVersion':3,'authorizationExpiresAt':m.EXPIRY,'expiresAt':m.EXTRA_EXPIRY}}
base={k:{**m.key(k),'payload':{'S':json.dumps(v)},'version':{'N':'3' if k!=m.EXTRA_KEY else '1'}} for k,v in values.items()}
state=copy.deepcopy(base);writes=[]
def fake(service,op,**p):
 if op=='get-caller-identity':return {'Account':m.ACCOUNT}
 if op=='describe-table':return {'Table':{'TableArn':f'arn:aws:dynamodb:us-east-1:{m.ACCOUNT}:table/{m.TABLE}','TableStatus':'ACTIVE'}}
 if op=='get-item':
  assert p['consistent_read'] is True and p['table_name']==m.TABLE
  return {'Item':state[p['key']['PK']['S']]} if p['key']['PK']['S'] in state else {}
 if op=='transact-write-items':
  tx=json.loads(Path(p['cli_input_json'].removeprefix('file://')).read_text())['TransactItems'];assert len(tx)==5
  for name,check in zip(['AUTH','LEASE','DAY#'+m.DAY,'TOTAL'],tx[:4]):
   assert check['ConditionCheck']['Key']==m.key(name) and check['ConditionCheck']['ExpressionAttributeValues'][':v']==state[name]['version']
  put=tx[-1]['Put'];assert put['ConditionExpression']=='#v=:v' and put['Item']['PK']['S']==m.EXTRA_KEY
  assert put['Item']['version']['N']==str(int(state[m.EXTRA_KEY]['version']['N'])+1)
  assert put['ExpressionAttributeValues'][':v']==state[m.EXTRA_KEY]['version']
  writes.append(tx);state[m.EXTRA_KEY]=put['Item'];return {}
 raise AssertionError('Unexpected operation')
with tempfile.TemporaryDirectory() as folder:
 home=Path(folder)
 assert m.transfer(fake,now,home)['status']=='TWO_EXTRA_RUNS_TRANSFER_PREPARED' and not writes
 assert not (home/'known-enough-two-extra-runs-transfer').exists()
 first=m.transfer(fake,now,home,True,clock=lambda:now)
 assert first=={'status':'TWO_EXTRA_RUNS_TRANSFERRED_TO_A','remaining':2,'expiresAt':m.EXTRA_EXPIRY,'cloudWrites':True} and len(writes)==1
 original=json.loads(state[m.EXTRA_KEY]['payload']['S']);assert original['actor']==m.TO_ACTOR and original['usedRuns']==0
 assert all(state[k]==v for k,v in base.items() if k!=m.EXTRA_KEY)
 snapshot=home/'known-enough-two-extra-runs-transfer'/m.DAY/'original-private.json'
 assert snapshot.stat().st_mode&0o777==0o600 and snapshot.parent.stat().st_mode&0o777==0o700
 assert json.loads(snapshot.read_text())==base
 again=m.transfer(fake,now,home,True,clock=lambda:now)
 assert again['status']=='TWO_EXTRA_RUNS_ALREADY_TRANSFERRED' and again['remaining']==2 and len(writes)==1
 state[m.EXTRA_KEY]={'PK':{'S':m.EXTRA_KEY},'SK':{'S':'STATE'},'payload':{'S':json.dumps({**original,'usedRuns':1})},'version':{'N':'3'}}
 state['LEASE']={**m.key('LEASE'),'payload':{'S':json.dumps({'status':'CLEAN'})},'version':{'N':'4'}}
 state['DAY#'+m.DAY]={**m.key('DAY#'+m.DAY),'payload':{'S':json.dumps({'runs':5,'messages':5})},'version':{'N':'4'}}
 state['TOTAL']={**m.key('TOTAL'),'payload':{'S':json.dumps({'runs':5,'reservedTokens':250100,'reservedCostMicros':250100,'messages':5})},'version':{'N':'4'}}
 after_one=m.transfer(fake,now,home,True,clock=lambda:now)
 assert after_one['status']=='TWO_EXTRA_RUNS_ALREADY_TRANSFERRED' and after_one['remaining']==1 and len(writes)==1
 for key_name in ['AUTH']:
  assert state[key_name]==base[key_name]
 print(json.dumps({'status':first['status'],'retry':again['status'],'remainingAfterOneUse':after_one['remaining']}))
`], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).not.toMatch(/PRIVATE|DO_NOT_PRINT/);
    expect(JSON.parse(result.stdout)).toEqual({
      status: 'TWO_EXTRA_RUNS_TRANSFERRED_TO_A',
      retry: 'TWO_EXTRA_RUNS_ALREADY_TRANSFERRED',
      remainingAfterOneUse: 1
    });
  });

  test('blocks expired, active, changed, malformed, or already exhausted allowances without writes', () => {
    const result = spawnSync('python3', ['-B', '-c', String.raw`
import copy, datetime, importlib.util, json, tempfile
from pathlib import Path
s=importlib.util.spec_from_file_location('transfer','scripts/live-qa/transfer-two-extra-runs-to-a.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
now=datetime.datetime(2026,10,3,17,tzinfo=datetime.timezone.utc)
a={'approved':True,'retentionReviewed':True,'invocationLoggingDisabled':True,'expiresAt':m.EXPIRY,'maxRunsPerDay':4,'maxRunsTotal':28,'maxTokensTotal':7000000,'maxCostMicrosTotal':7000000,'maxSignupMessagesTotal':56,'maxAttemptsPerRun':200,'maxTokensPerRun':250000,'maxCostMicrosPerRun':250000,'maxSignupMessagesPerRun':2,'maxSignupMessagesPerDay':8}
v={'AUTH':a,'LEASE':{'status':'CLEAN'},'DAY#'+m.DAY:{'runs':4,'messages':4},'TOTAL':{'runs':4,'reservedTokens':1,'reservedCostMicros':1,'messages':4},m.EXTRA_KEY:{'schemaVersion':1,'day':m.DAY,'actor':m.FROM_ACTOR,'additionalRuns':2,'usedRuns':0,'baseRuns':4,'authorizationVersion':3,'authorizationExpiresAt':m.EXPIRY,'expiresAt':m.EXTRA_EXPIRY}}
base={k:{**m.key(k),'payload':{'S':json.dumps(x)},'version':{'N':'3' if k!=m.EXTRA_KEY else '1'}} for k,x in v.items()}
def scenario(change,expected):
 state=copy.deepcopy(base);writes=[]
 if change=='lease':state['LEASE']['payload']['S']=json.dumps({'status':'ACTIVE'})
 if change=='auth':state['AUTH']['payload']['S']=json.dumps({**a,'maxRunsPerDay':5})
 if change=='day':state['DAY#'+m.DAY]['payload']['S']=json.dumps({'runs':5,'messages':4})
 if change=='extra':state[m.EXTRA_KEY]['payload']['S']='{}'
 if change=='empty':state[m.EXTRA_KEY]['payload']['S']=json.dumps({**v[m.EXTRA_KEY],'usedRuns':2});state['DAY#'+m.DAY]['payload']['S']=json.dumps({'runs':6,'messages':4})
 def fake(service,op,**p):
  if op=='get-caller-identity':return {'Account':m.ACCOUNT}
  if op=='describe-table':return {'Table':{'TableArn':f'arn:aws:dynamodb:us-east-1:{m.ACCOUNT}:table/{m.TABLE}','TableStatus':'ACTIVE'}}
  if op=='get-item':return {'Item':state[p['key']['PK']['S']]}
  if op=='transact-write-items':writes.append(p);return {}
  raise AssertionError(op)
 with tempfile.TemporaryDirectory() as folder:
  if change=='empty':
   assert m.transfer(fake,now,Path(folder),True,clock=lambda:now)['status']=='NO_EXTRA_RUNS_REMAIN'
  else:
   try:m.transfer(fake,now,Path(folder),True,clock=lambda:now);raise AssertionError('unsafe transfer accepted '+change)
   except ValueError as e:assert str(e)==expected,(change,str(e),expected)
  assert not writes,change
for change,reason in [('lease','CLEANUP_REQUIRED_FIRST'),('auth','ORIGINAL_APPROVAL_CHANGED'),('day','DAILY_USAGE_CHANGED'),('extra','EXTRA_ALLOWANCE_DRIFT'),('empty','NO_EXTRA_RUNS_REMAIN')]:scenario(change,reason)
try:
 with tempfile.TemporaryDirectory() as folder:m.transfer(lambda *a,**k: (_ for _ in ()).throw(AssertionError('AWS called')),datetime.datetime(2026,10,4,tzinfo=datetime.timezone.utc),Path(folder),True)
 raise AssertionError('expired transfer accepted')
except ValueError as e:assert str(e)=='ONE_TIME_APPROVAL_EXPIRED'
print('guarded')
`], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('guarded');
  });
});
