import test from 'node:test';
import assert from 'node:assert/strict';
import { jobRuntimeTemplate } from './jobs-runtime-setup.mjs';
import { readFileSync } from 'node:fs';
test('checked-in installation template matches the reviewed generator', () => {
  assert.equal(readFileSync('infra/operations/jobs-runtime-setup.json', 'utf8'), JSON.stringify(jobRuntimeTemplate(), null, 2) + '\n');
});
test('dedicated worker remains disabled and changes no existing data storage primary code or model flags', () => {
  const t = jobRuntimeTemplate(); const r = t.Resources;
  assert.equal(r.Tick.Properties.State, 'DISABLED'); assert.equal(r.Tick.Properties.ScheduleExpression, 'rate(1 minute)');
  assert.equal(r.Worker.Properties.ReservedConcurrentExecutions, 1);
  assert.equal(r.Worker.Properties.Timeout, 180); assert.equal(r.Worker.Properties.Handler, 'worker.handler');
  assert.deepEqual(r.Worker.Properties.Code.S3Key, { Ref: 'WorkerKey' });
  assert.ok(!Object.values(r).some(value => value.Type.startsWith('AWS::DynamoDB')));
  assert.ok(!JSON.stringify(t).includes('known-enough-stage-api'));
  assert.ok(!JSON.stringify(t).includes('KE14_MODEL_MODE'));
});
test('only the exact AWS rule can invoke and release role can update only worker code and its schedule', () => {
  const r = jobRuntimeTemplate().Resources;
  assert.equal(r.TickPermission.Properties.SourceAccount, '092954139775');
  assert.deepEqual(r.TickPermission.Properties.SourceArn, { 'Fn::GetAtt': ['Tick', 'Arn'] });
  const policy = r.ReleaseRole.Properties.Policies[0].PolicyDocument;
  assert.deepEqual(r.ReleaseBoundary.Properties.PolicyDocument, policy);
  const allowed = policy.Statement.filter(s => s.Effect === 'Allow');
  assert.ok(allowed.every(s => typeof s.Resource === 'string' && s.Resource.includes('092954139775')));
  assert.ok(allowed.every(s => !s.Action.includes('lambda:UpdateFunctionConfiguration') && !s.Action.includes('iam:PutRolePolicy')));
  assert.equal(r.WorkerLogs.Properties.RetentionInDays, 30);
});
test('provider and logging grants are narrow and storage cannot write participant records or reset AUTH', () => {
  const policy = jobRuntimeTemplate().Resources.WorkerRole.Properties.Policies[0].PolicyDocument;
  const allows = policy.Statement.filter(s => s.Effect === 'Allow');
  const model = allows.find(s => s.Action.includes('bedrock:InvokeModel'));
  assert.equal(model.Resource, 'arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-lite-v1:0');
  const logging = allows.find(s => s.Action.includes('bedrock:GetModelInvocationLoggingConfiguration'));
  assert.equal(logging.Condition.StringEquals['aws:RequestedRegion'], 'us-east-1');
  assert.ok(allows.filter(s => String(s.Resource).endsWith('KnownEnoughPartitions')).every(s => !s.Action.includes('dynamodb:PutItem')));
  const budgetWrite = allows.find(s => String(s.Resource).endsWith('KnownEnoughQaControl') && s.Action.includes('dynamodb:PutItem'));
  assert.deepEqual(budgetWrite.Condition['ForAllValues:StringLike']['dynamodb:LeadingKeys'], ['TOTAL']);
});
