import { describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
// @ts-expect-error CloudFormation generation is exercised without any AWS request.
import { renderTemplates } from '../../scripts/live-qa/template.mjs';

describe('exact QA publishing permission repair, no cloud requests', () => {
  test.skipIf(process.platform === 'win32')('matches the generated role, defaults read-only, writes once and rejects drift/expiry', () => {
    const folder = mkdtempSync(join(tmpdir(), 'known-enough-policy-repair-test-'));
    try {
      const config = JSON.parse(readFileSync('infra/live-qa/config.example.json', 'utf8'));
      Object.assign(config, { sourceCommit: 'a'.repeat(40), mailboxProvider: 'mailtm', mailDomain: null, hostedZoneId: null });
      const { core } = renderTemplates(config, { apiKey: 'b'.repeat(64) + '/api.zip', brokerKey: 'c'.repeat(64) + '/broker.zip' });
      const role = core.Resources.ReleaseRole.Properties;
      const arns: Record<string, string> = Object.fromEntries([['ApiFunction', 'api'], ['Broker', 'fixtures'], ['PreSignup', 'pre-signup'], ['CustomMessage', 'custom-message']].map(([key, suffix]) => [key!, 'arn:aws:lambda:us-east-1:092954139775:function:known-enough-qa-' + suffix]));
      arns.Control = 'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughQaControl';
      function resolved(value: unknown): unknown {
        if (Array.isArray(value)) return value.map(resolved);
        if (value && typeof value === 'object') {
          const obj = value as Record<string, unknown>;
          if (typeof obj['Fn::Sub'] === 'string') return obj['Fn::Sub'].replace('${QaApp.AppId}', 'd2l23pkzmr1tio');
          if (obj['Fn::GetAtt']) return arns[(obj['Fn::GetAtt'] as string[])[0]!];
          return Object.fromEntries(Object.entries(obj).map(([key, item]) => [key, resolved(item)]));
        }
        return value;
      }
      writeFileSync(join(folder, 'role.json'), JSON.stringify({ policy: resolved(role.Policies[0].PolicyDocument), trust: role.AssumeRolePolicyDocument }));
      const program = `
import copy, importlib.util, json, os, sys
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('repair',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
folder=Path(sys.argv[2]);role=json.loads((folder/'role.json').read_text());fixed=role['policy']
old=copy.deepcopy(fixed);old['Statement'][1]['Resource'].remove(m.RESOURCE)
assert m.canonical(old)==m.canonical(m.baseline()), 'Baseline must match actually rendered policy'
before=copy.deepcopy(old);assert m.canonical(m.repaired(before)[0])==m.canonical(fixed);assert before==old
assert m.repaired(fixed)[1] is True
for mutator in [lambda p:p['Statement'][0]['Action'].append('lambda:InvokeFunction'),lambda p:p['Statement'][1]['Resource'].append('*'),lambda p:p['Statement'][3]['Condition'].clear()]:
 bad=copy.deepcopy(old);mutator(bad)
 try:m.repaired(bad);raise AssertionError('Drift accepted')
 except RuntimeError as e:assert str(e)=='COMPLETE_POLICY_DRIFT'
state={'policy':copy.deepcopy(old),'writes':0,'calls':[],'account':m.ACCOUNT,'boundary':False,'managed':[],'reads':0,'drift':False}
def fake(service,op,*args):
 state['calls'].append((service,op))
 if service=='sts':return {'Account':state['account']}
 if op=='get-role':return {'Role':{'Arn':m.ROLE_ARN,'RoleId':'fixed-role-id','AssumeRolePolicyDocument':role['trust'],**({'PermissionsBoundary':{'PermissionsBoundaryArn':'boundary'}} if state['boundary'] else {})}}
 if op=='list-role-policies':return {'PolicyNames':[m.POLICY]}
 if op=='list-attached-role-policies':return {'AttachedPolicies':state['managed']}
 if op=='get-role-policy':
  state['reads']+=1;p=copy.deepcopy(state['policy'])
  if state['drift'] and state['reads']==2:p['Statement'][0]['Action'].append('lambda:InvokeFunction')
  return {'PolicyDocument':p}
 if op=='simulate-principal-policy':
  names=args[args.index('--resource-arns')+1:]
  return {'EvaluationResults':[{'EvalResourceName':name,'EvalDecision':'allowed' if name==m.RESOURCE and m.repaired(state['policy'])[1] else 'implicitDeny'} for name in names]}
 if op=='put-role-policy':
  assert args[:4]==('--role-name',m.ROLE,'--policy-name',m.POLICY)
  state['writes']+=1;state['policy']=json.loads(Path(args[-1].removeprefix('file://')).read_text());return {}
 raise AssertionError('Unexpected AWS operation')
m.aws=fake
real=m.datetime.datetime
class FixedClock(real):
 @classmethod
 def now(cls,tz=None):return real(2026,10,3,tzinfo=m.datetime.timezone.utc)
m.datetime.datetime=FixedClock
with patch('pathlib.Path.home',return_value=folder):
 m.main();assert state['writes']==0;assert not (folder/'known-enough-qa-release-policy-repair').exists()
 m.main(True);assert state['writes']==1;assert m.canonical(state['policy'])==m.canonical(fixed)
 backup=folder/'known-enough-qa-release-policy-repair'/'before.json'
 assert m.canonical(json.loads(backup.read_text()))==m.canonical(old);assert backup.stat().st_mode & 0o077==0
 m.main(True);assert state['writes']==1
 for key,bad,good,code in [('account','000000000000',m.ACCOUNT,'WRONG_ACCOUNT'),('boundary',True,False,'ROLE_OR_TRUST_DRIFT'),('managed',[{'PolicyArn':'other'}],[],'MANAGED_POLICY_DRIFT')]:
  state[key]=bad
  try:m.main(True);raise AssertionError('Wrong context accepted')
  except RuntimeError as e:assert str(e)==code;assert state['writes']==1
  state[key]=good
 state['policy']=copy.deepcopy(old);state['reads']=0;state['drift']=True
 try:m.main(True);raise AssertionError('Fresh drift accepted')
 except RuntimeError as e:assert str(e)=='FRESH_POLICY_DRIFT';assert state['writes']==1
class ExpiredClock(real):
 @classmethod
 def now(cls,tz=None):return real(2026,10,10,tzinfo=m.datetime.timezone.utc)
m.datetime.datetime=ExpiredClock;state['calls']=[]
try:m.main(True);raise AssertionError('Expiry accepted')
except RuntimeError as e:assert str(e)=='ORIGINAL_WINDOW_EXPIRED';assert not state['calls']
print('GUARDS_AND_IDEMPOTENCY_PASS')
`;
      const output = execFileSync('python3', ['-B', '-c', program, resolve('scripts/live-qa/repair-qa-release-policy.py'), folder], { encoding: 'utf8' });
      expect(output).toContain('GUARDS_AND_IDEMPOTENCY_PASS');
      expect(output).toContain('"cloudWrites": false');
    } finally { rmSync(folder, { recursive: true, force: true }); }
  });
});
