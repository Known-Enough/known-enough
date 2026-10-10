import { partitionPermissionProfiles, PARTITION_RESOURCES as r } from './partition-setup.mjs';
import { retentionPermissionProfiles } from './retention-setup.mjs';
import { jobPermissionProfiles } from './jobs-setup.mjs';

export const ACCESS_STACK = 'KnownEnoughOperationsAccess';
export const ACCESS_ROLES = Object.freeze({ migration: 'KnownEnoughGithubPartitionMigration',
  archive: 'KnownEnoughGithubGroupArchive', erasure: 'KnownEnoughGithubLifecycleExecutor',
  retention: 'KnownEnoughGithubRetentionPolicy', jobs: 'KnownEnoughGithubModelJobOperations' });
export const ACCESS_TRUST = Object.freeze({ Version: '2012-10-17', Statement: [{ Effect: 'Allow',
  Principal: { Federated: `arn:aws:iam::${r.account}:oidc-provider/token.actions.githubusercontent.com` },
  Action: 'sts:AssumeRoleWithWebIdentity', Condition: { StringEquals: {
    'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
    'token.actions.githubusercontent.com:sub': 'repo:Known-Enough@331386621/known-enough@1377587215:ref:refs/heads/main' } } }] });
const deny = { Sid: 'NoPrivilegeExpansionOrResourceRemoval', Effect: 'Deny',
  Action: ['iam:*', 'sts:AssumeRole', 'dynamodb:DeleteTable', 's3:DeleteObject', 's3:DeleteObjectVersion'], Resource: '*' };
const activation = /^(ActiveSource|CopiedJournal|ActivationControl)/;
/** Derived attachment documents only: immutable installed/preparation generators stay unchanged. */
export function attachableProfile(profile) {
  const value = structuredClone(profile);
  for (const s of value.Statement) {
    if (s.Action.every(action => ['dynamodb:GetItem', 'dynamodb:BatchGetItem', 'dynamodb:Query'].includes(action))) {
      if (s.Condition?.StringEqualsIfExists) {
        delete s.Condition.StringEqualsIfExists['dynamodb:ReturnValues'];
        if (!Object.keys(s.Condition.StringEqualsIfExists).length) delete s.Condition.StringEqualsIfExists;
      }
    }
  }
  return value;
}
export function accessProfiles() {
  const partitions = partitionPermissionProfiles(); const lifecycle = retentionPermissionProfiles();
  const policies = { migration: partitions.migration, archive: partitions.archive,
    erasure: lifecycle.erasureExecutor, retention: lifecycle.policyInstallation, jobs: jobPermissionProfiles().worker };
  const result = Object.fromEntries(Object.entries(policies).map(([name, policy]) => [name, attachableProfile(policy)]));
  // The real job provider is Nova Lite; no Bedrock administration or unrelated model grant.
  result.jobs.Statement.push({ Sid: 'ExactExistingNovaLiteProvider', Effect: 'Allow', Action: ['bedrock:InvokeModel'],
    Resource: `arn:aws:bedrock:${r.region}::foundation-model/amazon.nova-lite-v1:0` });
  for (const policy of Object.values(result)) policy.Statement.push(structuredClone(deny));
  result.ownerRuntime = attachableProfile(lifecycle.ownerService);
  // The installed exact participant policy already carries these six activation statements.
  result.ownerRuntime.Statement = result.ownerRuntime.Statement.filter(s => !activation.test(s.Sid));
  result.jobRuntime = attachableProfile(jobPermissionProfiles().worker);
  result.jobRuntime.Statement = result.jobRuntime.Statement.filter(s => !activation.test(s.Sid));
  return result;
}
function boundary(policy) {
  // Resource ceiling plus the exact inline key/transaction profile. No worker can edit either document.
  const resources = [...new Set(policy.Statement.filter(s => s.Effect === 'Allow').flatMap(s => [s.Resource].flat()))];
  const actions = [...new Set(policy.Statement.filter(s => s.Effect === 'Allow').flatMap(s => s.Action))];
  const services = [...new Set(actions.map(action => action.split(':')[0]))];
  return { Version: '2012-10-17', Statement: [...services.map(service => ({ Effect: 'Allow',
    Action: actions.filter(action => action.startsWith(`${service}:`)),
    Resource: resources.filter(resource => resource.startsWith(`arn:aws:${service}:`)) })), structuredClone(deny)] };
}
export function accessTemplate() {
  const profiles = accessProfiles(); const Resources = {};
  for (const [name, roleName] of Object.entries(ACCESS_ROLES)) {
    const id = name[0].toUpperCase() + name.slice(1);
    Resources[`${id}Boundary`] = { Type: 'AWS::IAM::ManagedPolicy', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain',
      Properties: { ManagedPolicyName: `${roleName}Boundary`, PolicyDocument: boundary(profiles[name]) } };
    Resources[`${id}Role`] = { Type: 'AWS::IAM::Role', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain',
      Properties: { RoleName: roleName, Path: '/', MaxSessionDuration: 3600, AssumeRolePolicyDocument: structuredClone(ACCESS_TRUST),
        PermissionsBoundary: { Ref: `${id}Boundary` }, Policies: [{ PolicyName: 'ScopedOperations', PolicyDocument: profiles[name] }] } };
  }
  Resources.OwnerRuntimePolicy = { Type: 'AWS::IAM::Policy', Properties: { PolicyName: 'KnownEnoughLifecycleOwner',
    Roles: ['KnownEnoughStageApiRole'], PolicyDocument: profiles.ownerRuntime } };
  Resources.JobRuntimePolicy = { Type: 'AWS::IAM::ManagedPolicy', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain',
    Properties: { ManagedPolicyName: 'KnownEnoughRuntimeModelJobs', Roles: ['KnownEnoughStageApiRole'], PolicyDocument: profiles.jobRuntime } };
  Resources.InspectorAccessMetadata = { Type: 'AWS::IAM::Policy', Properties: {
    PolicyName: 'KnownEnoughOperationsAccessMetadata', Roles: ['KnownEnoughGithubStagingInspector'],
    PolicyDocument: { Version: '2012-10-17', Statement: [
      { Effect: 'Allow', Action: ['iam:GetRole', 'iam:ListRolePolicies', 'iam:GetRolePolicy', 'iam:ListAttachedRolePolicies'],
        Resource: [...Object.values(ACCESS_ROLES), 'KnownEnoughStageApiRole'].map(name => `arn:aws:iam::${r.account}:role/${name}`) },
      { Effect: 'Allow', Action: ['iam:GetPolicy', 'iam:GetPolicyVersion'],
        Resource: [...Object.values(ACCESS_ROLES).map(name => `${name}Boundary`), 'KnownEnoughRuntimeModelJobs'].map(name => `arn:aws:iam::${r.account}:policy/${name}`) },
      { Effect: 'Allow', Action: ['cloudformation:DescribeStacks', 'cloudformation:GetTemplate', 'cloudformation:ListStackResources'],
        Resource: `arn:aws:cloudformation:${r.region}:${r.account}:stack/${ACCESS_STACK}/*` },
      { Sid: 'ReadActualProviderLoggingConfiguration', Effect: 'Allow', Action: ['bedrock:GetModelInvocationLoggingConfiguration'],
        Resource: '*', Condition: { StringEquals: { 'aws:RequestedRegion': r.region } } } ] } } };
  return { AWSTemplateFormatVersion: '2010-09-09', Description: 'Known Enough fixed operations delegation only; no data/runtime activation.', Resources };
}
export const accessTemplateBytes = () => JSON.stringify(accessTemplate(), null, 2) + '\n';
export const accessProfileBytes = () => JSON.stringify(accessProfiles(), null, 2) + '\n';
