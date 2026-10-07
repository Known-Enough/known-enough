import { DynamoDBClient, TransactGetItemsCommand, TransactWriteItemsCommand,
  type TransactWriteItem, type AttributeValue } from '@aws-sdk/client-dynamodb';
import { KnownEnoughApplicationError, RepositoryCapacityError,
  type KnownEnoughRepository, type TrustedPrincipal, type DecisionTransactionOptions } from '@deal-table/application';
import { currentAdmissionFence } from './admission-context.ts';
import { DynamoDBRoomRepository } from './dynamodb.ts';
import { decodeGuardItem } from './dynamodb-codec.ts';
import { createPartitionGroupSession, PartitionSessionError } from './partition-group-session.ts';
import { partitionIO, partitionCall, partitionDynamoWrites, PartitionStorageError, checkPartitionRow,
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
  const puts = items.filter(item => item.Put?.TableName === PARTITION_DECISION_TARGET.partitionArn);
  if (puts.length) {
    // Only the exact draft-creation bundle may mutate partitions through this transport.
    if (puts.length !== 4) fail('DECISION_INVALID');
    const rows = puts.map(item => {
      const put = item.Put!; const key = itemKey(item);
      let value: unknown; try { value = JSON.parse(put.Item?.payload?.S ?? ''); } catch { return fail('DECISION_INVALID'); }
      const row = checkPartitionRow(value, { PK: key.pk, SK: key.sk });
      if (put.Item?.revision?.N !== String(row.revision)) fail('DECISION_INVALID');
      if (row.revision === 1) { if (put.ConditionExpression !== 'attribute_not_exists(PK)') fail('DECISION_INVALID'); }
      else if (put.ConditionExpression !== '#r=:r' || put.ExpressionAttributeNames?.['#r'] !== 'revision'
        || put.ExpressionAttributeValues?.[':r']?.N !== String(row.revision - 1)) fail('DECISION_INVALID');
      return row;
    });
    const header = rows.find(row => row.kind === 'GROUP'); const draft = rows.find(row => row.kind === 'DRAFT');
    const binding = rows.find(row => row.kind === 'BINDING'); const directory = rows.find(row => row.kind === 'DIRECTORY');
    if (header?.kind !== 'GROUP' || draft?.kind !== 'DRAFT' || binding?.kind !== 'BINDING' || directory?.kind !== 'DIRECTORY'
      || directory.value.type !== 'DECISION' || binding.revision !== 1 || directory.revision !== 1
      || header.revision < 2 || draft.revision < 2
      || directory.value.groupId !== header.value.id || directory.value.decisionId !== binding.value.id
      || draft.value.createdDecisionId !== binding.value.id || draft.value.groupVersion !== header.value.version
      || binding.value.version !== header.value.version || !header.value.decisionIds.includes(binding.value.id)
      || !header.value.draftIds.includes(draft.value.id)) fail('DECISION_INVALID');
    for (const item of puts) {
      const key = itemKey(item);
      if (key.pk !== `GROUP#${header.value.id}` && key.pk !== `DECISION#${binding.value.id}`) fail('DECISION_INVALID');
    }
    if (header.value.members.some(subject => !items.some(item => item.ConditionCheck?.TableName === PARTITION_DECISION_TARGET.partitionArn
      && item.ConditionCheck.Key?.PK?.S === `ACCOUNT#${subject}` && item.ConditionCheck.Key?.SK?.S === 'STATE'))) fail('DECISION_INVALID');
    const accountChecks = items.filter(item => item.ConditionCheck?.TableName === PARTITION_DECISION_TARGET.partitionArn);
    if (accountChecks.length !== header.value.members.length || accountChecks.some(item => item.ConditionCheck?.ConditionExpression !== '#r=:r'
      || item.ConditionCheck.ExpressionAttributeNames?.['#r'] !== 'revision'
      || !/^[1-9][0-9]*$/.test(item.ConditionCheck.ExpressionAttributeValues?.[':r']?.N ?? ''))) fail('DECISION_INVALID');
    const decisionPuts = items.filter(item => item.Put?.TableName === PARTITION_DECISION_TARGET.decisionArn);
    if (items.length !== 6 + accountChecks.length || decisionPuts.length !== 2 || !['STATE', 'GUARD'].every(sk => decisionPuts.some(item => itemKey(item).pk === `ROOM#${binding.value.id}`
      && itemKey(item).sk === sk && item.Put?.ConditionExpression === 'attribute_not_exists(#pk)'
      && item.Put.ExpressionAttributeNames?.['#pk'] === 'PK'))) fail('DECISION_INVALID');
  }
  for (const [index, key] of keys.entries()) {
    if (key.table === PARTITION_DECISION_TARGET.partitionArn) {
      if (items[index]!.Put && puts.length) continue;
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
  function conditions(fence: PartitionFence, creation = false) {
    if (fence.mutations.length < 2 || fence.mutations.length > (creation ? 21 : 17)
      || (!creation && fence.mutations.some(item => item.next !== null || item.expected < 1))) fail('DECISION_INVALID');
    const items = partitionDynamoWrites('KnownEnoughPartitions', structuredClone(fence.mutations));
    for (const item of items) { const action = item.ConditionCheck ?? item.Put; if (!action) fail('DECISION_INVALID'); action!.TableName = PARTITION_DECISION_TARGET.partitionArn; }
    if (!creation) checkedWrite(items); return items;
  }
  async function perform<T>(principal: TrustedPrincipal | null, decisionId: string, create: boolean,
    work: (repository: KnownEnoughRepository, io: PartitionIOContext, fence: PartitionFence) => Promise<T>,
    prepared?: { io: PartitionIOContext; fence: PartitionFence }): Promise<T> {
    return safe(async () => {
      // Mixed legacy authority is incompatible, never silently discarded or projected as one condition.
      if (currentAdmissionFence(decisionId)) fail('DECISION_INVALID');
      const io = prepared?.io ?? partitionIO(limits); const fence = prepared?.fence ?? await session.decisionFence(principal, decisionId, io);
      const guards = conditions(fence, create && prepared !== undefined);
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
  return {
    /** Server-only provisioning port. Pending binding changes join creation, never an earlier reservation. */
    async forDraft(rawPrincipal: TrustedPrincipal | null, groupId: string, draftId: string, raw: unknown, supplied?: PartitionIOContext) {
      return safe(async () => {
        const principal = rawPrincipal?.kind === 'participant' ? { kind: 'participant' as const, subject: rawPrincipal.subject } : null;
        let request: unknown; try { request = structuredClone(raw); } catch { return fail('DECISION_INVALID'); }
        const io = supplied ?? partitionIO(limits);
        const initial = await session.prepareDraftCreation(principal, groupId, draftId, request, io);
        const decisionId = initial.definition.decisionId;
        let creationFailure: unknown;
        const repository: KnownEnoughRepository = {
          createDecision: record => safe(async () => {
            const definition = { ...record.definition, contextToken: initial.definition.contextToken };
            if (record.decisionId !== decisionId || record.creatorSubject !== principal?.subject
              || record.creationBodyHash !== initial.creationBodyHash || JSON.stringify(definition) !== JSON.stringify(initial.definition)
              || JSON.stringify(record.memberships) !== JSON.stringify(initial.memberships)) stale();
            if (initial.created) stale();
            try { return await perform(principal, decisionId, true, async repository => repository.createDecision(structuredClone(record)), { io, fence: initial.fence }); }
            catch (error) { creationFailure = error; throw error; }
          }),
          transactionDecision: (selected, transition, transactionOptions) => safe(async () => {
            if (creationFailure && io.signal.aborted) throw creationFailure;
            if (selected !== decisionId || transactionOptions !== undefined) fail('DECISION_INVALID');
            const fresh = await session.prepareDraftCreation(principal, groupId, draftId, request, io);
            if (!fresh.created) {
              // No decision is authorized yet; an orphan cannot be adopted by a replay lookup.
              await fresh.fence.assertCurrent();
              return partitionCall(io, () => Promise.resolve(transition(null)), false);
            }
            return perform(principal, decisionId, false, async repository => repository.transactionDecision(decisionId, async record => {
              if (!record || record.creationBodyHash !== fresh.creationBodyHash) fail('DECISION_INVALID');
              return partitionCall(io, () => Promise.resolve(transition(record)), false);
            }), { io, fence: fresh.fence });
          }),
        };
        return { definition: structuredClone(initial.definition), memberships: structuredClone(initial.memberships),
          creationBodyHash: initial.creationBodyHash, created: initial.created, repository };
      });
    },
    forParticipant(rawPrincipal: TrustedPrincipal | null): KnownEnoughRepository {
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
