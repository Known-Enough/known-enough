import { MANIFEST_BUCKET } from './manifest.mjs';
export const PARTITION_RESOURCES = Object.freeze({ account: '092954139775', region: 'us-east-1',
  source: 'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughGroupsStage',
  target: 'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughPartitions',
  decisions: 'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughStage',
  journal: 'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughOperationsJournal' });
const dataKeys = ['ACCOUNT#*', 'GROUP#*', 'EMAIL#*', 'INVITATION#*', 'DECISION#*', 'MEMBER#*'];
const controlKey = ['MIGRATION#CONTROL'];
function statement(Sid, Resource, Action, keys, enclosing) {
  return { Sid, Effect: 'Allow', Action: Action.map(value => `dynamodb:${value}`), Resource,
    ...(keys ? { Condition: { 'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': keys },
      Null: { 'dynamodb:LeadingKeys': 'false' }, StringEqualsIfExists: { 'dynamodb:ReturnValues': 'NONE' },
      ...(enclosing ? { 'ForAnyValue:StringEquals': { 'dynamodb:EnclosingOperation': [enclosing] } } : {}) } } : {}) };
}
const read = (id, resource, actions, keys) => statement(id, resource, actions, keys);
const write = (id, resource, actions, keys) => statement(id, resource, actions, keys, 'TransactWriteItems');
function recoveryStatements() {
  return [{ Sid: 'PinnedPrivateRecoveryVersions', Effect: 'Allow', Action: ['s3:GetObject', 's3:GetObjectVersion'],
    Resource: `arn:aws:s3:::${MANIFEST_BUCKET}/manifests/*`, Condition: { Bool: { 'aws:SecureTransport': 'true' } } },
  { Sid: 'ExclusivePrivateRecoveryCreate', Effect: 'Allow', Action: ['s3:PutObject'],
    Resource: `arn:aws:s3:::${MANIFEST_BUCKET}/manifests/*`, Condition: { Bool: { 'aws:SecureTransport': 'true' },
      Null: { 's3:if-none-match': 'false' } } }];
}
/** Independent deltas, never an attachment, replacement role/trust or installed-access assertion. */
export function partitionPermissionProfiles() {
  const r = PARTITION_RESOURCES;
  const activation = [read('ActiveSourceRead', r.source, ['GetItem'], ['NP#GROUPS']),
    write('ActiveSourceCondition', r.source, ['ConditionCheckItem'], ['NP#GROUPS']),
    read('CopiedJournalRead', r.journal, ['GetItem'], ['PARTITION#*']),
    write('CopiedJournalCondition', r.journal, ['ConditionCheckItem'], ['PARTITION#*']),
    read('ActivationControlRead', r.target, ['GetItem'], controlKey),
    write('ActivationControlCondition', r.target, ['ConditionCheckItem'], controlKey)];
  const profiles = {
    participant: [...activation,
      read('ScopedPartitionRead', r.target, ['GetItem', 'BatchGetItem'], dataKeys),
      read('PrivateMembershipQuery', r.target, ['Query'], ['MEMBER#*']),
      write('ScopedPartitionCommit', r.target, ['PutItem', 'ConditionCheckItem'], dataKeys),
      statement('JoinedDecisionRead', r.decisions, ['GetItem'], ['ROOM#*'], 'TransactGetItems'),
      write('JoinedDecisionCommit', r.decisions, ['PutItem', 'UpdateItem', 'ConditionCheckItem'], ['ROOM#*'])],
    migration: [read('LegacySourceRead', r.source, ['GetItem'], ['NP#GROUPS']),
      write('SourceFreezeAndActivation', r.source, ['PutItem', 'ConditionCheckItem'], ['NP#GROUPS']),
      read('ForwardPartitionRead', r.target, ['GetItem', 'BatchGetItem'], [...dataKeys, ...controlKey]),
      write('ExclusiveForwardPartitionsAndControl', r.target, ['PutItem', 'ConditionCheckItem'], [...dataKeys, ...controlKey]),
      read('MigrationJournalRead', r.journal, ['GetItem'], ['PARTITION#*']),
      write('ConditionalMigrationJournal', r.journal, ['PutItem', 'ConditionCheckItem'], ['PARTITION#*']), ...recoveryStatements()],
    archive: [...activation,
      read('ArchiveHeaderChildrenAndAuthorityRead', r.target, ['GetItem', 'BatchGetItem'], ['GROUP#*', 'ACCOUNT#*', 'OPERATIONS#ARCHIVE']),
      write('ArchiveAuthorityConditions', r.target, ['ConditionCheckItem'], ['GROUP#*', 'ACCOUNT#*', 'OPERATIONS#ARCHIVE']),
      write('RetainedArchiveTombstone', r.target, ['PutItem'], ['GROUP#*']),
      read('ArchiveJournalRead', r.journal, ['GetItem'], ['ARCHIVE#*']),
      write('ConditionalArchiveJournal', r.journal, ['PutItem', 'ConditionCheckItem'], ['ARCHIVE#*']), ...recoveryStatements()],
    inspection: [read('ExactInstalledTables', Object.values(r).filter(value => value.startsWith('arn:')),
      ['DescribeTable', 'DescribeContinuousBackups', 'DescribeTimeToLive'])]
  };
  return Object.fromEntries(Object.entries(profiles).map(([name, Statement]) => [name, { Version: '2012-10-17', Statement }]));
}
export function partitionSetupTemplate() {
  return { AWSTemplateFormatVersion: '2010-09-09',
    Description: 'Known Enough retained partition storage only. Final cloud phase; no migration or runtime selection.',
    Metadata: { TargetAccount: PARTITION_RESOURCES.account, TargetRegion: PARTITION_RESOURCES.region,
      Installation: 'UNKNOWN', Migration: 'NOT_EXECUTED', Activation: 'DISABLED',
      PermissionProfiles: partitionPermissionProfiles(), RoleAttachment: 'EXISTING_ROLE_READBACK_REQUIRED',
      OperatorArchivePolicy: 'DISABLED_UNTIL_SEPARATE_VERIFIED_INSTALLATION' },
    Resources: { Partitions: { Type: 'AWS::DynamoDB::Table', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain',
      Properties: { TableName: 'KnownEnoughPartitions', BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: [{ AttributeName: 'PK', AttributeType: 'S' }, { AttributeName: 'SK', AttributeType: 'S' }],
        KeySchema: [{ AttributeName: 'PK', KeyType: 'HASH' }, { AttributeName: 'SK', KeyType: 'RANGE' }],
        SSESpecification: { SSEEnabled: true }, PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
        DeletionProtectionEnabled: true } } } };
}
