import { accessProfiles, ACCESS_TRUST, TERMINAL_JOB_CLEANUP_SID } from './access-setup.mjs';
export const JOB_RUNTIME_STACK = 'KnownEnoughModelJobRuntime';
const account = '092954139775', region = 'us-east-1';
const functionArn = `arn:aws:lambda:${region}:${account}:function:known-enough-stage-model-jobs`;
const ruleArn = `arn:aws:events:${region}:${account}:rule/KnownEnoughModelJobs`;
const deny = { Effect: 'Deny', Action: ['iam:*', 'sts:AssumeRole', 'dynamodb:DeleteTable', 's3:DeleteObject', 's3:DeleteObjectVersion'], Resource: '*' };
/** New isolated application runner; existing storage, primary flags, counters and roles are not replaced. */
export function jobRuntimeTemplate() {
  const worker = accessProfiles().jobs;
  worker.Statement = worker.Statement.filter(statement => statement.Sid !== TERMINAL_JOB_CLEANUP_SID);
  worker.Statement.push({ Sid: 'VerifyActualProviderLogging', Effect: 'Allow', Action: ['bedrock:GetModelInvocationLoggingConfiguration'], Resource: '*',
    Condition: { StringEquals: { 'aws:RequestedRegion': region } } });
  worker.Statement.push({ Sid: 'OnlyFiniteWorkerLogs', Effect: 'Allow', Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
    Resource: `arn:aws:logs:${region}:${account}:log-group:/aws/lambda/known-enough-stage-model-jobs:log-stream:*` });
  const release = { Version: '2012-10-17', Statement: [
    { Effect: 'Allow', Action: ['lambda:GetFunctionConfiguration', 'lambda:UpdateFunctionCode'], Resource: functionArn },
    { Effect: 'Allow', Action: ['s3:GetObject'], Resource: `arn:aws:s3:::known-enough-qa-artifacts-${account}/*/model-worker.zip` },
    { Effect: 'Allow', Action: ['events:DescribeRule', 'events:EnableRule', 'events:DisableRule'], Resource: ruleArn },
    { Effect: 'Allow', Action: ['logs:FilterLogEvents'], Resource: `arn:aws:logs:${region}:${account}:log-group:/aws/lambda/known-enough-stage-model-jobs:*` }, deny,
  ] };
  return { AWSTemplateFormatVersion: '2010-09-09', Description: 'Known Enough dedicated source-bound model job runner; installed disabled.',
    Parameters: { WorkerKey: { Type: 'String', AllowedPattern: '[a-f0-9]{64}/model-worker.zip' } },
    Resources: {
      WorkerLogs: { Type: 'AWS::Logs::LogGroup', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain', Properties: {
        LogGroupName: '/aws/lambda/known-enough-stage-model-jobs', RetentionInDays: 30 } },
      WorkerRole: { Type: 'AWS::IAM::Role', Properties: { RoleName: 'KnownEnoughModelJobRuntime', AssumeRolePolicyDocument: {
        Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }] },
        Policies: [{ PolicyName: 'ExactModelJobRuntime', PolicyDocument: worker }] } },
      Worker: { Type: 'AWS::Lambda::Function', DependsOn: 'WorkerLogs', Properties: {
        FunctionName: 'known-enough-stage-model-jobs', Runtime: 'nodejs24.x', Handler: 'worker.handler', MemorySize: 512, Timeout: 180,
        ReservedConcurrentExecutions: 1, Role: { 'Fn::GetAtt': ['WorkerRole', 'Arn'] },
        Code: { S3Bucket: 'known-enough-qa-artifacts-092954139775', S3Key: { Ref: 'WorkerKey' } } } },
      Tick: { Type: 'AWS::Events::Rule', Properties: { Name: 'KnownEnoughModelJobs', ScheduleExpression: 'rate(1 minute)', State: 'DISABLED',
        Targets: [{ Id: 'ModelJobs', Arn: { 'Fn::GetAtt': ['Worker', 'Arn'] }, RetryPolicy: { MaximumEventAgeInSeconds: 60, MaximumRetryAttempts: 0 } }] } },
      TickPermission: { Type: 'AWS::Lambda::Permission', Properties: { FunctionName: { Ref: 'Worker' }, Action: 'lambda:InvokeFunction',
        Principal: 'events.amazonaws.com', SourceAccount: account, SourceArn: { 'Fn::GetAtt': ['Tick', 'Arn'] } } },
      ReleaseBoundary: { Type: 'AWS::IAM::ManagedPolicy', Properties: { ManagedPolicyName: 'KnownEnoughGithubModelJobReleaseBoundary', PolicyDocument: release } },
      ReleaseRole: { Type: 'AWS::IAM::Role', Properties: { RoleName: 'KnownEnoughGithubModelJobRelease', MaxSessionDuration: 3600,
        AssumeRolePolicyDocument: structuredClone(ACCESS_TRUST), PermissionsBoundary: { Ref: 'ReleaseBoundary' },
        Policies: [{ PolicyName: 'ExactModelJobRelease', PolicyDocument: release }] } },
    } };
}
