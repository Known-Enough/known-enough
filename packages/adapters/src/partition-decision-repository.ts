import { DynamoDBClient, TransactGetItemsCommand, TransactWriteItemsCommand,
  type TransactWriteItem, type AttributeValue } from '@aws-sdk/client-dynamodb';
import { KnownEnoughApplicationError, RepositoryCapacityError,
  type KnownEnoughRepository, type TrustedPrincipal, type DecisionTransactionOptions } from '@deal-table/application';
import { currentAdmissionFence } from './admission-context.ts';
import { DynamoDBRoomRepository } from './dynamodb.ts';
import { decodeGuardItem } from './dynamodb-codec.ts';
import { createPartitionGroupSession, PartitionSessionError } from './partition-group-session.ts';
import { partitionIO, partitionCall, partitionDynamoWrites, PartitionStorageError,
  type PartitionIOContext, type PartitionTransport, type PartitionFence } from './partitioned-group-repository.ts';

// Inactive server-only composition; managed identity/activation and API selection are external.
export const PARTITION_DECISION_TARGET = Object.freeze({
  decisionArn: 'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughStage',
  partitionArn: 'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughPartitions',
});
type Command = TransactGetItemsCommand | TransactWriteItemsCommand;
type Item = Record<string, AttributeValue>;
/** One physical request per call; honor signal. The concrete SDK transport pins maxAttempts=1. */
export interface PartitionDecisionTransport { send(command: Command, context: PartitionIOContext): Promise<unknown> }
export class PartitionDecisionError extends Error {
  constructor(readonly code: 'DECISION_INVALID' | 'DECISION_STORAGE_UNAVAILABLE' | 'DECISION_TIMEOUT'
    | 'DECISION_REQUEST_LIMIT' | 'DECISION_CONFLICT', options?: ErrorOptions) { super(code, options); this.name = 'PartitionDecisionError'; }
}
function fail(code: PartitionDecisionError['code']): never { throw new PartitionDecisionError(code); }
const stale = (): never => { throw new KnownEnoughApplicationError('STALE_CONTEXT'); };
function target(raw: { decisionArn: string; partitionArn: string }) {
  if (raw.decisionArn !== PARTITION_DECISION_TARGET.decisionArn || raw.partitionArn !== PARTITION_DECISION_TARGET.partitionArn) fail('DECISION_INVALID');
}
function retryable(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const value = error as { name?: unknown; CancellationReasons?: unknown };
  if (['TransactionConflictException', 'ConditionalCheckFailedException', 'TransactionInProgressException',
    'ProvisionedThroughputExceededException', 'ThrottlingException', 'RequestLimitExceeded'].includes(String(value.name))) return true;
  if (value.name !== 'TransactionCanceledException' || !Array.isArray(value.CancellationReasons) || !value.CancellationReasons.length) return false;
  const allowed = new Set(['ConditionalCheckFailed', 'TransactionConflict', 'ProvisionedThroughputExceeded', 'ThrottlingError']);
  return value.CancellationReasons.some(reason => allowed.has(reason?.Code))
    && value.CancellationReasons.every(reason => reason && typeof reason === 'object' && !Array.isArray(reason)
      && (reason.Message === undefined || typeof reason.Message === 'string') && (reason.Code === 'None' || allowed.has(reason.Code)));
}
async function safe<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (error instanceof KnownEnoughApplicationError || error instanceof RepositoryCapacityError || error instanceof PartitionDecisionError) throw error;
    if (error instanceof PartitionSessionError || error instanceof PartitionStorageError) {
      if (error.code.endsWith('CAPACITY')) throw new RepositoryCapacityError();
      const code = error.code.endsWith('TIMEOUT') ? 'DECISION_TIMEOUT' : error.code.endsWith('REQUEST_LIMIT') ? 'DECISION_REQUEST_LIMIT' : error.code.endsWith('STORAGE_UNAVAILABLE') ? 'DECISION_STORAGE_UNAVAILABLE' : 'DECISION_INVALID';
      throw new PartitionDecisionError(code, { cause: error });
    }
    throw new PartitionDecisionError('DECISION_STORAGE_UNAVAILABLE', { cause: error });
  }
}
function itemKey(entry: TransactWriteItem) {
  const action = entry.Put ?? entry.Update ?? entry.ConditionCheck ?? entry.Delete;
  if (!action) return fail('DECISION_INVALID');
  const key = 'Item' in action ? action.Item : action.Key;
  if (!key?.PK?.S || !key.SK?.S || !action.TableName) return fail('DECISION_INVALID');
  return { table: action.TableName, pk: key.PK.S, sk: key.SK.S };
}
function checkedWrite(items: TransactWriteItem[]) {
  if (!items.length || items.length > 100 || Buffer.byteLength(JSON.stringify(items)) > 3_500_000) throw new RepositoryCapacityError();
  const keys = items.map(itemKey);
  if (new Set(keys.map(key => `${key.table}/${key.pk}/${key.sk}`)).size !== keys.length) fail('DECISION_INVALID');
  for (const [index, key] of keys.entries()) {
    if (key.table === PARTITION_DECISION_TARGET.partitionArn) {
      if (!items[index]!.ConditionCheck || !/^(ACCOUNT|GROUP)#[A-Za-z0-9_-]{1,80}$/.test(key.pk) || key.sk !== 'STATE') fail('DECISION_INVALID');
    } else if (key.table !== PARTITION_DECISION_TARGET.decisionArn || !/^ROOM#[A-Za-z0-9_-]{1,80}$/.test(key.pk)
      || !/^(STATE|GUARD|REPLAY#[a-f0-9]{64})$/.test(key.sk)) fail('DECISION_INVALID');
  }
}
function checkedRead(command: TransactGetItemsCommand, decisionId?: string) {
  const items = command.input.TransactItems;
  if (!items?.length || items.length > 3) fail('DECISION_INVALID');
  for (const entry of items) {
    const value = entry.Get;
    if (value?.TableName !== PARTITION_DECISION_TARGET.decisionArn || !value.Key?.PK?.S || !value.Key.SK?.S
      || (decisionId ? value.Key.PK.S !== `ROOM#${decisionId}` : !/^ROOM#[A-Za-z0-9_-]{1,80}$/.test(value.Key.PK.S))
      || !/^(STATE|GUARD|REPLAY#[a-f0-9]{64})$/.test(value.Key.SK.S)) fail('DECISION_INVALID');
  }
}
export function createDynamoPartitionDecisionTransport(raw: { decisionArn: string; partitionArn: string }): PartitionDecisionTransport {
  target(raw); const client = new DynamoDBClient({ region: 'us-east-1', maxAttempts: 1 });
  return { send: async (command, context) => {
    if (context.signal.aborted) fail('DECISION_TIMEOUT');
    if (command instanceof TransactGetItemsCommand) checkedRead(command);
    else if (command instanceof TransactWriteItemsCommand) checkedWrite(command.input.TransactItems ?? []);
    else fail('DECISION_INVALID');
    return command instanceof TransactGetItemsCommand ? client.send(command, { abortSignal: context.signal })
      : client.send(command, { abortSignal: context.signal });
  } };
}
export function createPartitionDecisionRepository(options: { decisionArn: string; partitionArn: string;
  transport: PartitionDecisionTransport; groups: PartitionTransport; now?: () => number; timeoutMs?: number; maxRequests?: number }) {
  target(options);
  const limits = { ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.maxRequests === undefined ? {} : { maxRequests: options.maxRequests }) };
  const transport = options.transport; partitionIO(limits); const session = createPartitionGroupSession(options.groups, { ...limits, ...(options.now ? { now: options.now } : {}) });
  function conditions(fence: PartitionFence) {
    if (fence.mutations.length < 2 || fence.mutations.length > 17 || fence.mutations.some(item => item.next !== null || item.expected < 1)) fail('DECISION_INVALID');
    const items = partitionDynamoWrites('KnownEnoughPartitions', structuredClone(fence.mutations));
    for (const item of items) { if (!item.ConditionCheck) fail('DECISION_INVALID'); item.ConditionCheck!.TableName = PARTITION_DECISION_TARGET.partitionArn; }
    checkedWrite(items); return items;
  }
  async function perform<T>(principal: TrustedPrincipal | null, decisionId: string, create: boolean,
    work: (repository: KnownEnoughRepository, io: PartitionIOContext, fence: PartitionFence) => Promise<T>): Promise<T> {
    return safe(async () => {
      // Mixed legacy authority is incompatible, never silently discarded or projected as one condition.
      if (currentAdmissionFence(decisionId)) fail('DECISION_INVALID');
      const io = partitionIO(limits); const fence = await session.decisionFence(principal, decisionId, io);
      const guards = conditions(fence);
      for (let attempt = 0; attempt < (create ? 1 : 6); attempt++) {
        let sdkFailure: unknown; let wrote = false; let loaded: unknown;
        async function send(command: Command) {
          try {
            if (command instanceof TransactGetItemsCommand) {
              checkedRead(command, decisionId); const result = await partitionCall(io, () => transport.send(command, io));
              loaded = structuredClone(result); return result;
            }
            const items = command.input.TransactItems;
            if (!items || items.length < 2 || items.length > 3 || items.some(item => itemKey(item).table !== PARTITION_DECISION_TARGET.decisionArn
              || itemKey(item).pk !== `ROOM#${decisionId}`)) fail('DECISION_INVALID');
            const joined = [...structuredClone(guards), ...structuredClone(items)]; checkedWrite(joined);
            const result = await partitionCall(io, () => transport.send(new TransactWriteItemsCommand({ ...command.input, TransactItems: joined }), io));
            wrote = true; return result;
          } catch (error) { sdkFailure = error; throw error; }
        }
        // The tested repository uses only send; no client instance or shared runtime is mutated.
        const repository = new DynamoDBRoomRepository({ tableName: PARTITION_DECISION_TARGET.decisionArn,
          client: { send } as unknown as DynamoDBClient, maxAttempts: 1 });
        try {
          const result = await work(repository, io, fence);
          if (!wrote && !create) {
            const responses = (loaded as { Responses?: { Item?: Item }[] } | undefined)?.Responses;
            if (!responses || responses.length < 2) fail('DECISION_INVALID');
            const key = (sk: string) => ({ PK: { S: `ROOM#${decisionId}` }, SK: { S: sk } });
            const publication: TransactWriteItem[] = [];
            if (!responses[0]?.Item && !responses[1]?.Item) {
              for (const sk of ['STATE', 'GUARD']) publication.push({ ConditionCheck: { TableName: PARTITION_DECISION_TARGET.decisionArn,
                Key: key(sk), ConditionExpression: 'attribute_not_exists(PK)' } });
            } else {
              const guard = decodeGuardItem(responses[1]?.Item, decisionId);
              const fields = { version: guard.version, incarnation: guard.incarnation, ordinaryReceipts: guard.ordinaryReceipts,
                permissionHistoryReceipts: guard.permissionHistoryReceipts, safetyReserveReceipts: guard.safetyReserveReceipts, totalReceipts: guard.totalReceipts };
              publication.push({ ConditionCheck: { TableName: PARTITION_DECISION_TARGET.decisionArn, Key: key('GUARD'),
                ConditionExpression: Object.keys(fields).map(field => `#${field}=:${field}`).join(' AND '),
                ExpressionAttributeNames: Object.fromEntries(Object.keys(fields).map(field => [`#${field}`, field])),
                ExpressionAttributeValues: Object.fromEntries(Object.entries(fields).map(([field, value]) => [`:${field}`, typeof value === 'number' ? { N: String(value) } : { S: value }])) } });
            }
            const joined = [...structuredClone(guards), ...publication]; checkedWrite(joined);
            try { await partitionCall(io, () => transport.send(new TransactWriteItemsCommand({ TransactItems: joined }), io)); }
            catch (error) { sdkFailure = error; throw error; }
          }
          return result;
        } catch (error) {
          if (error instanceof RepositoryCapacityError || error instanceof KnownEnoughApplicationError) throw error;
          if (sdkFailure instanceof PartitionStorageError || sdkFailure instanceof PartitionDecisionError) throw sdkFailure;
          if (sdkFailure && retryable(sdkFailure)) {
            await fence.assertCurrent();
            if (!create && attempt < 5) continue;
            if (!create) fail('DECISION_CONFLICT');
          }
          if (sdkFailure) throw new PartitionDecisionError('DECISION_STORAGE_UNAVAILABLE', { cause: sdkFailure });
          throw error;
        }
      }
      return fail('DECISION_CONFLICT');
    });
  }
  return { forParticipant(rawPrincipal: TrustedPrincipal | null): KnownEnoughRepository {
    const principal = rawPrincipal?.kind === 'participant' ? { kind: 'participant' as const, subject: rawPrincipal.subject } : null;
    return {
      createDecision: decision => perform(principal, decision.decisionId, true, async (repository, io, fence) => {
        const header = fence.mutations.find(item => item.key.PK.startsWith('GROUP#'));
        if (!header) fail('DECISION_INVALID');
        const roster = await session.roster(principal, header!.key.PK.slice(6), io);
        if (principal?.kind !== 'participant' || decision.creatorSubject !== principal.subject) throw new KnownEnoughApplicationError('FORBIDDEN');
        const expected = roster.members.map(member => `${member.subject}/${member.participantId}`).sort();
        if (decision.memberships.length !== expected.length || decision.memberships.some(member => !member.active)
          || JSON.stringify(decision.memberships.map(member => `${member.subject}/${member.participantId}`).sort()) !== JSON.stringify(expected)
          || decision.definition.participants.length !== roster.members.length
          || decision.definition.participants.some(person => !roster.members.some(member => member.participantId === person.id && member.displayName === person.displayName))) stale();
        await repository.createDecision(structuredClone(decision));
      }),
      transactionDecision: (decisionId, transition, transactionOptions?: DecisionTransactionOptions) => perform(principal, decisionId, false, async (repository, io) => {
        const replay = transactionOptions?.replay;
        const hash = replay ? await partitionCall(io, () => replay.keyHash, false) : undefined;
        if (replay && (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))) fail('DECISION_INVALID');
        return repository.transactionDecision(decisionId, record => partitionCall(io,
          async () => structuredClone(await transition(record)), false), replay ? { replay: { ...replay, keyHash: Promise.resolve(hash!) } } : undefined);
      }),
    };
  } };
}
