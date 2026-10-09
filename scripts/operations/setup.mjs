import { MANIFEST_BUCKET } from './manifest.mjs';
export const JOURNAL_ARN = 'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughOperationsJournal';
export const RECOVERY_ROLE = 'KnownEnoughGithubOperationsRecovery';
const bucketArn = `arn:aws:s3:::${MANIFEST_BUCKET}`;
export function setupTemplate() {
  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'Known Enough operations recovery only; install in account 092954139775/us-east-1 after final-phase readback.',
    Metadata: { TargetAccount: '092954139775', TargetRegion: 'us-east-1', InstallationStatus: 'PROPOSED', ApplyOperations: 'NONE' },
    Resources: {
      Journal: {
        Type: 'AWS::DynamoDB::Table', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain',
        Properties: { TableName: 'KnownEnoughOperationsJournal', BillingMode: 'PAY_PER_REQUEST',
          AttributeDefinitions: [{ AttributeName: 'PK', AttributeType: 'S' }, { AttributeName: 'SK', AttributeType: 'S' }],
          KeySchema: [{ AttributeName: 'PK', KeyType: 'HASH' }, { AttributeName: 'SK', KeyType: 'RANGE' }],
          SSESpecification: { SSEEnabled: true }, PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true }, DeletionProtectionEnabled: true }
      },
      Manifests: {
        Type: 'AWS::S3::Bucket', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain',
        Properties: { BucketName: MANIFEST_BUCKET, VersioningConfiguration: { Status: 'Enabled' },
          BucketEncryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] },
          OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] },
          PublicAccessBlockConfiguration: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true } }
      },
      ManifestPolicy: {
        Type: 'AWS::S3::BucketPolicy', Properties: { Bucket: { Ref: 'Manifests' }, PolicyDocument: { Version: '2012-10-17', Statement: [
          { Sid: 'RequireTLS', Effect: 'Deny', Principal: '*', Action: 's3:*', Resource: [bucketArn, `${bucketArn}/*`], Condition: { Bool: { 'aws:SecureTransport': 'false' } } },
          { Sid: 'RequireExclusiveManifestCreate', Effect: 'Deny', Principal: '*', Action: 's3:PutObject', Resource: `${bucketArn}/manifests/*`,
            Condition: { Null: { 's3:if-none-match': 'true' }, Bool: { 's3:ObjectCreationOperation': 'true' } } }
        ] } }
      },
      RecoveryRole: {
        Type: 'AWS::IAM::Role', Properties: { RoleName: RECOVERY_ROLE, MaxSessionDuration: 3600,
          AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Federated: 'arn:aws:iam::092954139775:oidc-provider/token.actions.githubusercontent.com' },
            Action: 'sts:AssumeRoleWithWebIdentity', Condition: { StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com', 'token.actions.githubusercontent.com:sub': 'repo:Known-Enough@331386621/known-enough@1377587215:ref:refs/heads/main' } } }] },
          Policies: [{ PolicyName: 'ExactRecoveryStorage', PolicyDocument: { Version: '2012-10-17', Statement: [
            { Effect: 'Allow', Action: ['dynamodb:GetItem', 'dynamodb:PutItem'], Resource: JOURNAL_ARN, Condition: { 'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': ['PLAN#*'] } } },
            { Effect: 'Allow', Action: ['dynamodb:DescribeTable', 'dynamodb:DescribeContinuousBackups', 'dynamodb:DescribeTimeToLive'], Resource: JOURNAL_ARN },
            { Effect: 'Allow', Action: ['s3:GetBucketVersioning', 's3:GetEncryptionConfiguration', 's3:GetBucketPublicAccessBlock', 's3:GetBucketPolicy', 's3:GetBucketOwnershipControls', 's3:GetLifecycleConfiguration'], Resource: bucketArn },
            { Effect: 'Allow', Action: ['s3:PutObject', 's3:GetObject', 's3:GetObjectVersion'], Resource: `${bucketArn}/manifests/*` },
            { Effect: 'Deny', Action: ['iam:*', 'sts:AssumeRole', 'dynamodb:DeleteTable', 's3:DeleteObject', 's3:DeleteObjectVersion'], Resource: '*' }
          ] } }] }
      }
    }
  };
}
