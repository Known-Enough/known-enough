import { partitionPermissionProfiles, PARTITION_RESOURCES as r } from './partition-setup.mjs';
const statement = (Sid, Resource, actions, keys, transaction = false) => ({ Sid, Effect: 'Allow', Resource,
  Action: actions.map(action => `dynamodb:${action}`), Condition: { 'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': keys },
    Null: { 'dynamodb:LeadingKeys': 'false' }, StringEqualsIfExists: { 'dynamodb:ReturnValues': 'NONE' },
    ...(transaction ? { 'ForAnyValue:StringEquals': { 'dynamodb:EnclosingOperation': ['TransactWriteItems'] } } : {}) } });
/** Inactive deltas on existing tables. No role attachment, live policy, seed or deletion by this generator. */
export function retentionPermissionProfiles() {
  const activation = partitionPermissionProfiles().participant.Statement.filter(value => /^(ActiveSource|CopiedJournal|ActivationControl)/.test(value.Sid));
  const read = [
    statement('LifecyclePartitionInventory', r.target, ['GetItem', 'Query'], ['ACCOUNT#*', 'GROUP#*', 'MEMBER#*', 'DECISION#*']),
    statement('LifecycleDecisionInventory', r.decisions, ['GetItem', 'Query'], ['ROOM#*']),
    statement('LifecyclePolicyStampRead', r.journal, ['GetItem'], ['OPERATIONS#RETENTION', 'RETENTION#*']),
    statement('LifecyclePolicyStampConditions', r.journal, ['ConditionCheckItem'], ['OPERATIONS#RETENTION', 'RETENTION#*'], true),
    statement('LifecyclePartitionConditions', r.target, ['ConditionCheckItem'], ['ACCOUNT#*', 'GROUP#*', 'MEMBER#*', 'DECISION#*'], true),
    statement('LifecycleDecisionConditions', r.decisions, ['ConditionCheckItem'], ['ROOM#*'], true),
  ];
  const profiles = {
    ownerService: [...activation, ...read,
      statement('ConsentRead', r.journal, ['GetItem'], ['CONSENT#*']),
      statement('PublishedOwnerPlanAndProgressRead', r.journal, ['GetItem'], ['LIFECYCLE#*']),
      statement('VerifiedSelfConsentWrite', r.journal, ['PutItem', 'ConditionCheckItem'], ['CONSENT#*'], true)],
    erasureExecutor: [...activation, ...read,
      statement('ExactPlanJournalConsentRead', r.journal, ['GetItem'], ['LIFECYCLE#*', 'CONSENT#*']),
      statement('ParticipantConsentConditionOnly', r.journal, ['ConditionCheckItem'], ['CONSENT#*'], true),
      statement('SealedPlanAndProgress', r.journal, ['PutItem', 'ConditionCheckItem'], ['LIFECYCLE#*'], true),
      statement('AccountFreezeAndGroupTombstone', r.target, ['PutItem'], ['ACCOUNT#*', 'GROUP#*'], true),
      statement('ConsentScopedGroupChildrenErase', r.target, ['DeleteItem'], ['GROUP#*'], true),
      statement('GuardStateAndReplayErase', r.decisions, ['PutItem', 'DeleteItem'], ['ROOM#*'], true)],
    policyInstallation: [statement('RetentionConfigurationRead', r.journal, ['GetItem'], ['OPERATIONS#RETENTION', 'RETENTION#*']),
      statement('SourceCheckedRetentionConfiguration', r.journal, ['PutItem', 'ConditionCheckItem'], ['OPERATIONS#RETENTION', 'RETENTION#*'], true)],
  };
  return Object.fromEntries(Object.entries(profiles).map(([name, Statement]) => [name, { Version: '2012-10-17', Statement }]));
}
export function retentionSetupPreparation() {
  return { schemaVersion: 1, kind: 'OFFLINE_RETENTION_PREPARATION', target: { account: r.account, region: r.region },
    tables: { partitions: r.target, decisions: r.decisions, journal: r.journal }, installation: 'UNKNOWN', activation: 'DISABLED',
    roleAttachment: 'EXISTING_ROLE_EFFECTIVE_ACCESS_READBACK_REQUIRED', sourceBinding: 'EXACT_CHECKED_SOURCE_AND_MIGRATION_ACTIVATION',
    policy: { schemaVersion: 1, kind: 'RETENTION_POLICY', revision: 1, enabled: false, dataClass: 'SYNTHETIC', rawConversationMs: 0,
      structuredMs: 86400000, replayMs: 3600000, journalMs: 604800000, backupMs: null, providerMs: null, realPersonPolicy: 'UNAPPROVED' },
    stampInstallation: 'TRUSTED_TIMESTAMP_PROVENANCE_REQUIRED_NO_INVENTED_ACTIVITY', cleanup: 'EXPLICIT_SEALED_PLAN_AND_CURRENT_PARTICIPANT_GRANTS',
    limits: { requests: 64, timeoutMs: 20000, transactionItems: 100, sealedPlanBytes: 300000, rowBatch: 16 },
    retained: ['opaque identifier claims', 'disabled account identity', 'inaccessible group tombstone', 'new decision guard incarnation', 'ID/hash progress and consent'],
    separateManagedObligations: ['logs', 'immutable recovery objects', 'backups', 'provider systems', 'Cognito identity/email', 'real-person policy'],
    permissionProfiles: retentionPermissionProfiles() };
}
export const retentionPreparationBytes = () => JSON.stringify(retentionSetupPreparation(), null, 2) + '\n';
