import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { accessProfiles, accessTemplate, accessProfileBytes, accessTemplateBytes, ACCESS_ROLES, ACCESS_TRUST } from './access-setup.mjs';
import { partitionPermissionProfiles } from './partition-setup.mjs';
import { retentionPermissionProfiles } from './retention-setup.mjs';
import { jobPermissionProfiles } from './jobs-setup.mjs';

test('generated profiles/template exactly match recorded source and contain no data provisioning or activation', () => {
  assert.equal(accessTemplateBytes(), readFileSync('infra/operations/access-setup.json', 'utf8'));
  assert.equal(accessProfileBytes(), readFileSync('infra/operations/access-profiles.json', 'utf8'));
  const resources = accessTemplate().Resources;
  assert.equal(Object.keys(resources).length, 13);
  assert.ok(Object.values(resources).every(value => ['AWS::IAM::Role', 'AWS::IAM::ManagedPolicy', 'AWS::IAM::Policy'].includes(value.Type)));
});
test('each workload has its own exact main OIDC trust, inline profile, resource boundary and explicit IAM/role/resource-removal deny', () => {
  const template = accessTemplate(); const profiles = accessProfiles();
  assert.equal(ACCESS_TRUST.Statement[0].Condition.StringEquals['token.actions.githubusercontent.com:sub'],
    'repo:Known-Enough@331386621/known-enough@1377587215:ref:refs/heads/main');
  for (const [name, roleName] of Object.entries(ACCESS_ROLES)) {
    const id = name[0].toUpperCase() + name.slice(1); const role = template.Resources[`${id}Role`];
    assert.equal(role.Properties.RoleName, roleName); assert.deepEqual(role.Properties.AssumeRolePolicyDocument, ACCESS_TRUST);
    assert.deepEqual(role.Properties.Policies, [{ PolicyName: 'ScopedOperations', PolicyDocument: profiles[name] }]);
    assert.deepEqual(role.Properties.PermissionsBoundary, { Ref: `${id}Boundary` });
    assert.equal(role.DeletionPolicy, 'Retain'); assert.equal(template.Resources[`${id}Boundary`].DeletionPolicy, 'Retain');
    assert.ok(JSON.stringify(profiles[name]).length < 10240);
    assert.ok(JSON.stringify(template.Resources[`${id}Boundary`].Properties.PolicyDocument).length < 6144);
    const deny = profiles[name].Statement.find(s => s.Effect === 'Deny'); assert.ok(deny.Action.includes('iam:*'));
    for (const statement of profiles[name].Statement.filter(s => s.Effect === 'Allow')) assert.notEqual(statement.Resource, '*');
  }
});
test('attachable projections remove only inapplicable read ReturnValues and preserve all original keys/actions/resource conditions', () => {
  const original = { migration: partitionPermissionProfiles().migration, archive: partitionPermissionProfiles().archive,
    erasure: retentionPermissionProfiles().erasureExecutor, retention: retentionPermissionProfiles().policyInstallation, jobs: jobPermissionProfiles().worker };
  const profiles = accessProfiles();
  for (const [name, policy] of Object.entries(original)) {
    for (const originalStatement of policy.Statement) {
      const projected = profiles[name].Statement.find(s => s.Sid === originalStatement.Sid);
      const expected = structuredClone(originalStatement);
      if (expected.Action.every(a => ['dynamodb:GetItem', 'dynamodb:BatchGetItem', 'dynamodb:Query'].includes(a))) {
        delete expected.Condition.StringEqualsIfExists?.['dynamodb:ReturnValues'];
        if (expected.Condition.StringEqualsIfExists && !Object.keys(expected.Condition.StringEqualsIfExists).length) delete expected.Condition.StringEqualsIfExists;
      }
      assert.deepEqual(projected, expected);
    }
  }
});
test('consent manufacture is only an additive existing trusted runtime delta, never a GitHub executor grant', () => {
  const profiles = accessProfiles();
  for (const [name, policy] of Object.entries(profiles).filter(([name]) => name !== 'ownerRuntime')) {
    assert.ok(!policy.Statement.some(s => s.Action.includes('dynamodb:PutItem') && s.Condition?.['ForAllValues:StringLike']?.['dynamodb:LeadingKeys']?.includes('CONSENT#*')), name);
  }
  const owner = accessTemplate().Resources.OwnerRuntimePolicy.Properties;
  assert.deepEqual(owner.Roles, ['KnownEnoughStageApiRole']); assert.equal(owner.PolicyName, 'KnownEnoughLifecycleOwner');
  assert.ok(profiles.ownerRuntime.Statement.some(s => s.Sid === 'VerifiedSelfConsentWrite'));
  assert.ok(profiles.ownerRuntime.Statement.every(s => !/^(ActiveSource|CopiedJournal|ActivationControl)/.test(s.Sid)));
});
test('only model job role includes the existing Nova Lite provider; no other model or Bedrock administration', () => {
  for (const [name, policy] of Object.entries(accessProfiles())) {
    const bedrock = policy.Statement.filter(s => s.Action.some(a => a.startsWith('bedrock:')));
    assert.equal(bedrock.length, name === 'jobs' ? 1 : 0);
    if (bedrock.length) assert.deepEqual(bedrock[0].Action, ['bedrock:InvokeModel']);
  }
});
test('job runtime addition fits managed quota and cannot restore the protected primary model grant', () => {
  const runtime = accessTemplate().Resources.JobRuntimePolicy.Properties;
  assert.deepEqual(runtime.Roles, ['KnownEnoughStageApiRole']);
  assert.ok(JSON.stringify(runtime.PolicyDocument).length < 6144);
  assert.ok(runtime.PolicyDocument.Statement.every(s => s.Action.every(a => !a.startsWith('bedrock:'))));
});
test('inspector addition only reads these five roles/boundaries and the exact new stack', () => {
  const addition = accessTemplate().Resources.InspectorAccessMetadata.Properties;
  assert.deepEqual(addition.Roles, ['KnownEnoughGithubStagingInspector']);
  assert.ok(addition.PolicyDocument.Statement.every(s => s.Action.every(a => /:(Get|List|Describe)/.test(a))));
  assert.ok(!JSON.stringify(addition).includes('PutRolePolicy'));
  const logging = addition.PolicyDocument.Statement.find(s => s.Sid === 'ReadActualProviderLoggingConfiguration');
  assert.deepEqual(logging.Action, ['bedrock:GetModelInvocationLoggingConfiguration']);
  assert.deepEqual(logging.Condition, { StringEquals: { 'aws:RequestedRegion': 'us-east-1' } });
});
