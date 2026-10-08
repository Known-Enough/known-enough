import { PARTITION_RESOURCES as r, partitionPermissionProfiles } from './partition-setup.mjs';
const budget = `arn:aws:dynamodb:${r.region}:${r.account}:table/KnownEnoughQaControl`;
const statement = (Sid, Resource, actions, keys, transactional = false) => ({ Sid, Effect: 'Allow', Resource,
  Action: actions.map(action => `dynamodb:${action}`), Condition: { 'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': keys },
    Null: { 'dynamodb:LeadingKeys': 'false' }, StringEqualsIfExists: { 'dynamodb:ReturnValues': 'NONE' },
    ...(transactional ? { 'ForAnyValue:StringEquals': { 'dynamodb:EnclosingOperation': ['TransactWriteItems'] } } : {}) } });
/** DynamoDB bounded outbox is the durable queue; no speculative SQS/Scheduler/role/cloud installation. */
export function jobPermissionProfiles() {
  const activation = partitionPermissionProfiles().participant.Statement.filter(s => /^(ActiveSource|CopiedJournal|ActivationControl)/.test(s.Sid));
  return { worker: { Version: '2012-10-17', Statement: [...activation,
    statement('JobControlDeliveryRead', r.journal, ['GetItem'], ['MODELJOB#*', 'OPERATIONS#MODEL_JOBS']),
    statement('JobLeaseAndDeliveryCAS', r.journal, ['PutItem', 'ConditionCheckItem'], ['MODELJOB#*', 'OPERATIONS#MODEL_JOBS'], true),
    statement('ExistingStandingBudgetRead', budget, ['GetItem'], ['AUTH', 'TOTAL']),
    statement('PreservedCumulativeReservationCAS', budget, ['PutItem'], ['TOTAL'], true),
    statement('CurrentStandingAuthorityCondition', budget, ['ConditionCheckItem'], ['AUTH'], true),
    statement('CurrentAllMemberAdmissionRead', r.target, ['GetItem'], ['ACCOUNT#*', 'GROUP#*', 'DECISION#*']),
    statement('CurrentAllMemberAdmissionConditions', r.target, ['ConditionCheckItem'], ['ACCOUNT#*', 'GROUP#*', 'DECISION#*'], true),
    statement('CurrentAllMemberRetentionRead', r.journal, ['GetItem'], ['OPERATIONS#RETENTION', 'RETENTION#*']),
    statement('CurrentAllMemberRetentionConditions', r.journal, ['ConditionCheckItem'], ['OPERATIONS#RETENTION', 'RETENTION#*'], true),
    statement('CurrentDecisionContextRead', r.decisions, ['GetItem'], ['ROOM#*']),
    statement('JoinedKernelStateAndGuardCAS', r.decisions, ['PutItem', 'ConditionCheckItem'], ['ROOM#*'], true),
  ] } };
}
export function jobSetupPreparation() {
  return { schemaVersion: 1, kind: 'OFFLINE_MODEL_JOB_PREPARATION', target: { account: r.account, region: r.region },
    tables: { journal: r.journal, budget, partitions: r.target, decisions: r.decisions },
    installation: 'UNKNOWN', activation: 'DISABLED', managedProof: 'UNKNOWN', delivery: { transport: 'DYNAMODB_BOUNDED_OUTBOX', body: ['jobId'], capacity: 64 },
    jobs: { kinds: ['NEGOTIATION'], conversationTurns: 'TRANSIENT_NEVER_PERSISTED', transientArchitectOwnerRecovery: 'CLIENT_RESUBMISSION_REQUIRED',
      privateContext: 'FRESH_SERVER_APPLICATION_RELOAD', output: 'REAL_KERNEL_APPLICATION_STATE_JOINED_WITH_JOB_TOTAL_AND_GUARD_CAS' },
    bounds: { slots: 2, leaseMs: 10000, providerTimeoutMs: 8000, jobExpiryMs: 300000, safePreCallRetries: 2,
      backoffMs: [500, 1000], requestsPerStore: 64, requestTimeoutMs: 20000, transactionItems: 100,
      maxTokensPerCall: 18432, reservedCostMicrosPerCall: 10000 },
    accounting: { inheritedTotal: 'PRESERVE_EXACT_EXISTING_TOTAL_NO_SEED_RESET_OR_REFUND', source: 'EXISTING_VERIFIED_STANDING_AUTH',
      reservation: 'ATOMIC_BEFORE_PROVIDER', actualTokens: 'PER_CALL_PROVIDER_USAGE', uncertainProvider: 'CHARGED_AND_SLOT_QUARANTINED_NO_AUTOMATIC_REISSUE' },
    recovery: { pending: 'NEW_WORKER_READS_EXISTING_ID_OUTBOX', expiredPreCallLease: 'NEW_EXCLUSIVE_TOKEN',
      uncertainCall: 'VERIFIED_PROVIDER_QUIESCENCE_AND_USAGE_RECONCILIATION_REQUIRED', outputAckLoss: 'READ_MATCHING_TERMINAL_JOB',
      staleSourceIdentityAdmissionConsentRetentionContextGuard: 'DENY_CALL_AND_ATOMIC_OUTPUT' },
    installationSteps: ['verify exact source, own workload identity and effective scoped access', 'verify OPS01 activation and OPS02 synthetic policy/stamps',
      'verify existing standing AUTH/TOTAL; never create or reset TOTAL', 'conditionally create DISABLED empty source-bound job control only if absent',
      'install checked native snapshot loader and one-attempt forced-tool Bedrock/usage composition; bind verified enqueue/session and trusted public catalog',
      'activate one source-matching server worker with finite requests and bounded ID reconciliation', 'verify restart, duplicate, unknown-call quarantine, consent/erasure/lease races, cumulative accounting and cleanup'],
    cleanup: 'PRESERVE_CUMULATIVE_TOTAL; terminal job journal retention and quarantined-call release need verified managed evidence; no automatic deletion or fake TTL proof',
    permissionProfiles: jobPermissionProfiles() };
}
export const jobPreparationBytes = () => JSON.stringify(jobSetupPreparation(), null, 2) + '\n';
