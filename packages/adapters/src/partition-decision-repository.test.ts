import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { DynamoDBClient, TransactGetItemsCommand, TransactWriteItemsCommand, type TransactWriteItem, type AttributeValue } from '@aws-sdk/client-dynamodb';
import { Groups, KnownEnough as KE } from '@deal-table/contracts';
import { KnownEnoughApplication, RepositoryCapacityError, type TrustedPrincipal } from '@deal-table/application';
import { InMemoryRoomRepository } from './index.ts';
import { withAdmissionFence } from './admission-context.ts';
import { preparePartitionMigration } from './partition-migration.ts';
import { partitionMemberId } from './partition-group-session.ts';
import { createPartitionDecisionRepository, createDynamoPartitionDecisionTransport, PARTITION_DECISION_TARGET,
  type PartitionDecisionTransport } from './partition-decision-repository.ts';
import { partitionIO, type PartitionTransport } from './partitioned-group-repository.ts';
import { decodeDecisionStateItem } from './dynamodb-codec.ts';

type Item = Record<string, AttributeValue>;
const actor = (subject = 'iris'): TrustedPrincipal => ({ kind: 'participant', subject });
const target = PARTITION_DECISION_TARGET;
const where = (table: string, key: Item) => `${table}/${key.PK!.S}/${key.SK!.S}`;
const cancellation = () => Object.assign(new Error('synthetic cancellation'), { name: 'TransactionCanceledException', CancellationReasons: [{ Code: 'ConditionalCheckFailed' }] });
afterEach(() => vi.restoreAllMocks());
async function fixture() {
  const account = (subject: string): Groups.Account => ({ subject, displayName: subject.toUpperCase(), status: 'APPROVED', version: 1,
    emailHash: createHash('sha256').update(subject).digest('hex') });
  const group: Groups.Group = { id: 'garden', name: 'Garden', organizer: 'iris', members: ['iris', 'omar'], version: 1,
    drafts: [], invitations: [], decisions: [{ id: 'decision', version: 1 }] };
  const plan = preparePartitionMigration(Buffer.from(JSON.stringify({ accounts: [account('iris'), account('omar')], groups: [group] })), 1, 'a'.repeat(40));
  const cells = new Map<string, Item>();
  for (const item of plan.batches.flat()) if (item.next) {
    const key = { PK: { S: item.key.PK }, SK: { S: item.key.SK } };
    cells.set(where(target.partitionArn, key), { ...key, revision: { N: String(item.next.revision) }, payload: { S: JSON.stringify(item.next) } });
  }
  const groupKey = { PK: { S: 'GROUP#garden' }, SK: { S: 'STATE' } };
  const groupLocation = where(target.partitionArn, groupKey);
  const stateKey = { PK: { S: 'ROOM#decision' }, SK: { S: 'STATE' } };
  const stateLocation = where(target.decisionArn, stateKey);
  function change(pk: string, update: (value: Record<string, unknown>) => void) {
    const key = { PK: { S: pk }, SK: { S: 'STATE' } }; const location = where(target.partitionArn, key); const cell = cells.get(location)!;
    const row = JSON.parse(cell.payload!.S!) as { revision: number; value: Record<string, unknown> };
    update(row.value); row.revision++; cells.set(location, { ...cell, revision: { N: String(row.revision) }, payload: { S: JSON.stringify(row) } });
  }
  const groups: PartitionTransport = {
    read: async key => { const cell = cells.get(`${target.partitionArn}/${key.PK}/${key.SK}`); return cell ? JSON.parse(cell.payload!.S!) : null; },
    readMany: async keys => keys.map(key => { const cell = cells.get(`${target.partitionArn}/${key.PK}/${key.SK}`); return cell ? JSON.parse(cell.payload!.S!) : null; }),
    commit: async changes => changes.every(item => Number(cells.get(`${target.partitionArn}/${item.key.PK}/${item.key.SK}`)?.revision?.N ?? 0) === item.expected),
  };
  const writes: TransactWriteItem[][] = []; const reads: TransactGetItemsCommand[] = []; let beforeWrite: () => void = () => {};
  let afterWrite: () => void = () => {}; let beforeRead: () => Promise<void> | void = () => {};
  function matches(entry: TransactWriteItem) {
    const value = entry.ConditionCheck ?? entry.Put ?? entry.Update!; const key = 'Item' in value ? value.Item! : value.Key!;
    const old = cells.get(where(value.TableName!, key)); const condition = value.ConditionExpression;
    if (condition?.startsWith('attribute_not_exists')) return !old;
    if (condition?.startsWith('attribute_exists')) return !!old;
    return (condition?.split(' AND ') ?? []).every(expression => {
      const [left, right] = expression.split('=').map(part => part.trim()); const field = value.ExpressionAttributeNames?.[left!] ?? left!;
      return JSON.stringify(old?.[field]) === JSON.stringify(value.ExpressionAttributeValues?.[right!]);
    });
  }
  const transport: PartitionDecisionTransport = { send: async (command, context) => {
    expect(context.signal).toBeDefined();
    if (command instanceof TransactGetItemsCommand) { reads.push(command); await beforeRead();
      return { Responses: command.input.TransactItems!.map(entry => ({ Item: structuredClone(cells.get(where(entry.Get!.TableName!, entry.Get!.Key!))) })) };
    }
    const items = command.input.TransactItems!; writes.push(structuredClone(items)); beforeWrite();
    if (!items.every(matches)) throw cancellation();
    for (const entry of items) {
      if (entry.Put) cells.set(where(entry.Put.TableName!, entry.Put.Item!), structuredClone(entry.Put.Item!));
      if (entry.Update) {
        const update = entry.Update; const location = where(update.TableName!, update.Key!); const cell = structuredClone(cells.get(location)!);
        for (const expression of update.UpdateExpression!.slice(4).split(',')) {
          const [name, value] = expression.split('=').map(part => part.trim()); cell[update.ExpressionAttributeNames![name!]!] = structuredClone(update.ExpressionAttributeValues![value!]!);
        }
        cells.set(location, cell);
      }
    }
    afterWrite(); return {};
  } };
  const memory = new InMemoryRoomRepository(); const participants = ['iris', 'omar'].map(subject => ({ id: partitionMemberId(subject), displayName: subject.toUpperCase(), requiredForApproval: true }));
  const definition = KE.DecisionDefinition.parse({ schemaVersion: KE.KE_SCHEMA_VERSION, decisionId: 'decision', frameVersion: 1, semanticVersion: 1,
    contextToken: 'c'.repeat(64), title: 'Garden gathering', objective: 'Choose together', description: '', participants,
    requiredParticipantIds: participants.map(person => person.id), variables: [], rules: [] });
  const application = new KnownEnoughApplication({ repository: memory, clock: { now: () => '2026-10-07T15:00:00Z' }, ids: { next: () => 'synthetic' } });
  await application.createDecision({ definition, creatorSubject: 'iris', memberships: ['iris', 'omar'].map(subject => ({ subject, participantId: partitionMemberId(subject), active: true })) });
  const initial = await memory.transactionDecision('decision', value => structuredClone(value!));
  const factory = (options: Partial<Parameters<typeof createPartitionDecisionRepository>[0]> = {}) => createPartitionDecisionRepository({ ...target, groups, transport, ...options });
  const current = () => decodeDecisionStateItem(cells.get(stateLocation), 'decision');
  return { groups, transport, cells, writes, reads, initial, factory, current, groupLocation, stateLocation, change,
    beforeWrite: (work: typeof beforeWrite) => { beforeWrite = work; }, afterWrite: (work: typeof afterWrite) => { afterWrite = work; }, beforeRead: (work: typeof beforeRead) => { beforeRead = work; } };
}

it('joins current account/group conditions to actual STATE/GUARD creation and guarded mutation without rewriting legacy guards', async () => {
  const f = await fixture(); const repository = f.factory().forParticipant(actor()); await repository.createDecision(f.initial);
  expect(f.writes[0]).toHaveLength(5); expect(f.writes[0]!.filter(item => item.ConditionCheck).map(item => item.ConditionCheck!.Key!.PK!.S).sort()).toEqual(['ACCOUNT#iris', 'ACCOUNT#omar', 'GROUP#garden']);
  const result = await repository.transactionDecision('decision', record => { record!.controlVersion++; return { version: record!.controlVersion }; });
  expect(result).toEqual({ version: 1 }); expect(f.current().controlVersion).toBe(1);
  expect(f.writes.at(-1)!.find(item => item.Update)!.Update!.ConditionExpression).toContain('#incarnation = :incarnation');
  expect(f.writes.at(-1)!.filter(item => item.ConditionCheck)).toHaveLength(3);
});

it('atomically conditions read-only publication and missing decisions on both admission and the decision guard', async () => {
  const f = await fixture(); const repository = f.factory().forParticipant(actor());
  expect(await repository.transactionDecision('decision', record => record)).toBeNull();
  expect(f.writes[0]!.filter(item => item.ConditionCheck)).toHaveLength(5);
  await repository.createDecision(f.initial); const before = f.current();
  expect(await repository.transactionDecision('decision', record => ({ version: record!.controlVersion }))).toEqual({ version: 0 });
  expect(f.writes.at(-1)!.find(item => item.ConditionCheck?.Key?.SK?.S === 'GUARD')!.ConditionCheck!.ConditionExpression).toContain('#totalReceipts=:totalReceipts');
  expect(f.current()).toEqual(before);
});

it('rejects disable/removal only at the atomic write without committing decision state or publishing a stale read', async () => {
  for (const readOnly of [true, false]) {
    const f = await fixture(); const repository = f.factory().forParticipant(actor('omar')); await f.factory().forParticipant(actor()).createDecision(f.initial);
    const before = structuredClone(f.cells.get(f.stateLocation)); f.beforeWrite(() => f.change('GROUP#garden', value => { value.members = ['iris']; value.version = 2; }));
    await expect(repository.transactionDecision('decision', record => { if (!readOnly) record!.controlVersion++; return 'private-result'; })).rejects.toThrow('STALE_CONTEXT');
    expect(f.cells.get(f.stateLocation)).toEqual(before); expect(f.writes).toHaveLength(2);
  }
  const f = await fixture(); const repository = f.factory().forParticipant(actor()); f.beforeWrite(() => f.change('ACCOUNT#iris', value => { value.status = 'DISABLED'; }));
  await expect(repository.createDecision(f.initial)).rejects.toThrow('STALE_CONTEXT'); expect(f.cells.has(f.stateLocation)).toBe(false);
});

it('requires a current organizer and the exact approved group roster for creation', async () => {
  const f = await fixture(); await expect(f.factory().forParticipant(actor('omar')).createDecision(f.initial)).rejects.toThrow('FORBIDDEN');
  for (const change of ['creator', 'membership', 'participant', 'name'] as const) {
    const record = structuredClone(f.initial);
    if (change === 'creator') record.creatorSubject = 'omar';
    if (change === 'membership') record.memberships.pop();
    if (change === 'participant') record.definition.participants.pop();
    if (change === 'name') record.definition.participants[0]!.displayName = 'Different';
    await expect(f.factory().forParticipant(actor()).createDecision(record)).rejects.toThrow(change === 'creator' ? 'FORBIDDEN' : 'STALE_CONTEXT');
  }
  f.change('ACCOUNT#omar', value => { value.status = 'DISABLED'; });
  await expect(f.factory().forParticipant(actor()).createDecision(f.initial)).rejects.toThrow('FORBIDDEN'); expect(f.writes).toEqual([]);
});

it('retries recognized decision conflicts from freshly loaded state within six attempts and retains admission conditions', async () => {
  const f = await fixture(); const repository = f.factory().forParticipant(actor()); await repository.createDecision(f.initial);
  let first = true; f.beforeWrite(() => { if (first) { first = false; throw cancellation(); } });
  const versions: number[] = []; await repository.transactionDecision('decision', record => { versions.push(record!.controlVersion); record!.controlVersion++; });
  expect(versions).toEqual([0, 0]); expect(f.reads).toHaveLength(2); expect(f.current().controlVersion).toBe(1);
  f.beforeWrite(() => { throw cancellation(); }); const writes = f.writes.length;
  await expect(repository.transactionDecision('decision', record => { record!.controlVersion++; })).rejects.toThrow('DECISION_CONFLICT');
  expect(f.writes.length - writes).toBe(6); expect(f.current().controlVersion).toBe(1);
});

it('never repeats an uncertain committed write and keeps the transport diagnostic private', async () => {
  const f = await fixture(); const repository = f.factory().forParticipant(actor()); await repository.createDecision(f.initial);
  const diagnostic = new Error('synthetic confidential service body'); f.afterWrite(() => { throw diagnostic; }); const before = f.writes.length;
  try { await repository.transactionDecision('decision', record => { record!.controlVersion++; }); throw new Error('missing rejection'); }
  catch (error) { expect(error).toMatchObject({ message: 'DECISION_STORAGE_UNAVAILABLE', cause: diagnostic }); }
  expect(f.writes.length - before).toBe(1); expect(f.current().controlVersion).toBe(1);
});

it('retains exact replay receipts and reserved counters in the same admitted write and on reconstruction', async () => {
  const f = await fixture(); await f.factory().forParticipant(actor()).createDecision(f.initial);
  const app = () => new KnownEnoughApplication({ repository: f.factory().forParticipant(actor()), clock: { now: () => '2026-10-07T15:00:00Z' }, ids: { next: () => 'synthetic' } });
  const frame = f.initial.definition;
  const envelope = { schemaVersion: KE.KE_SCHEMA_VERSION, type: 'CONFIRM_FRAME' as const, requestId: 'synthetic-request',
    decisionId: 'decision', idempotencyKey: 'synthetic-replay-key', expected: { contextToken: frame.contextToken,
      semanticVersion: frame.semanticVersion, controlVersion: 0, ownerVersion: 0 }, payload: { frameVersion: frame.frameVersion } };
  const first = await app().execute(actor(), envelope); const repeated = await app().execute(actor(), envelope);
  expect(first).toEqual(repeated); expect(first.ok).toBe(true); expect(f.current().frameConfirmations).toHaveLength(1);
  const write = f.writes.find(items => items.some(item => item.Put?.Item?.SK?.S?.startsWith('REPLAY#')))!;
  expect(write.filter(item => item.ConditionCheck)).toHaveLength(3); expect(write.find(item => item.Update)!.Update!.ConditionExpression).toContain('#total = :oldTotal');
  expect([...f.cells.values()].filter(item => item.SK?.S?.startsWith('REPLAY#'))).toHaveLength(1);
});

it('denies unsafe roles, malformed targets and mixed legacy authority without any decision access', async () => {
  const f = await fixture();
  for (const principal of [null, { kind: 'display', subject: 'iris', roomId: 'decision' }, { kind: 'service', subject: 'service', roomIds: ['decision'] }] as (TrustedPrincipal | null)[]) {
    await expect(f.factory().forParticipant(principal).transactionDecision('decision', () => true)).rejects.toThrow('FORBIDDEN');
  }
  expect(() => f.factory({ partitionArn: target.partitionArn.replace('092954139775', '111111111111') })).toThrow('DECISION_INVALID');
  await expect(withAdmissionFence('decision', { assertCurrent: async () => {}, serialize: work => work() }, () => f.factory().forParticipant(actor()).transactionDecision('decision', () => true))).rejects.toThrow('DECISION_INVALID');
  expect(f.reads).toEqual([]); expect(f.writes).toEqual([]);
});

it('shares one request/deadline budget through group resolution, decision loading, callback and final commit', async () => {
  const f = await fixture(); await f.factory().forParticipant(actor()).createDecision(f.initial); const before = f.writes.length;
  await expect(f.factory({ maxRequests: 5 }).forParticipant(actor()).transactionDecision('decision', () => true)).rejects.toThrow('DECISION_REQUEST_LIMIT');
  expect(f.writes).toHaveLength(before);
  let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; }); f.beforeRead(() => blocked);
  await expect(f.factory({ timeoutMs: 20 }).forParticipant(actor()).transactionDecision('decision', () => true)).rejects.toThrow('DECISION_TIMEOUT');
  release(); await new Promise<void>(resolve => globalThis.setTimeout(resolve, 1)); expect(f.writes).toHaveLength(before);
});

it('rejects uncloneable callback results before mutation and never commits after a callback deadline', async () => {
  const f = await fixture(); const repository = f.factory().forParticipant(actor()); await repository.createDecision(f.initial); const before = f.writes.length;
  await expect(repository.transactionDecision('decision', record => { record!.controlVersion++; return () => 'private'; })).rejects.toThrow('DECISION_STORAGE_UNAVAILABLE');
  expect(f.current().controlVersion).toBe(0); expect(f.writes).toHaveLength(before);
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  await expect(f.factory({ timeoutMs: 20 }).forParticipant(actor()).transactionDecision('decision', async record => { record!.controlVersion++; await held; return true; })).rejects.toThrow('DECISION_TIMEOUT');
  release(); await new Promise<void>(resolve => globalThis.setTimeout(resolve, 1)); expect(f.current().controlVersion).toBe(0); expect(f.writes).toHaveLength(before);
});

it('pins concrete SDK requests to the exact resources, single attempts and the shared abort signal', async () => {
  const send = vi.spyOn(DynamoDBClient.prototype, 'send').mockResolvedValue({} as never);
  const transport = createDynamoPartitionDecisionTransport(target); const context = partitionIO();
  await transport.send(new TransactGetItemsCommand({ TransactItems: [{ Get: { TableName: target.decisionArn, Key: { PK: { S: 'ROOM#decision' }, SK: { S: 'STATE' } } } }] }), context);
  expect(send.mock.calls[0]![1]).toMatchObject({ abortSignal: context.signal });
  const client = send.mock.contexts[0] as DynamoDBClient; expect(await client.config.maxAttempts()).toBe(1); expect(await client.config.region()).toBe('us-east-1');
  await expect(transport.send(new TransactGetItemsCommand({ TransactItems: [{ Get: { TableName: 'foreign', Key: { PK: { S: 'ROOM#decision' }, SK: { S: 'STATE' } } } }] }), context)).rejects.toThrow('DECISION_INVALID');
  const check = { ConditionCheck: { TableName: target.decisionArn, Key: { PK: { S: 'ROOM#decision' }, SK: { S: 'GUARD' } }, ConditionExpression: 'attribute_exists(PK)' } };
  await expect(transport.send(new TransactWriteItemsCommand({ TransactItems: [check, check] }), context)).rejects.toThrow('DECISION_INVALID');
  expect(send).toHaveBeenCalledTimes(1); expect(() => createDynamoPartitionDecisionTransport({ ...target, decisionArn: 'foreign' })).toThrow('DECISION_INVALID');
});


it('does not retry malformed or nonconflict cancellation reasons and preserves a captured request identity', async () => {
  const f = await fixture(); await f.factory().forParticipant(actor()).createDecision(f.initial);
  for (const reasons of [[{ Code: 'ValidationError' }], [{ Code: 'ConditionalCheckFailed', Message: 7 }], [{ Code: 'Unknown' }], []]) {
    const writes = f.writes.length; f.beforeWrite(() => { throw Object.assign(new Error('private cancellation detail'), { name: 'TransactionCanceledException', CancellationReasons: reasons }); });
    await expect(f.factory().forParticipant(actor()).transactionDecision('decision', record => { record!.controlVersion++; })).rejects.toThrow('DECISION_STORAGE_UNAVAILABLE');
    expect(f.writes.length - writes).toBe(1); expect(f.current().controlVersion).toBe(0);
  }
  f.beforeWrite(() => {}); const identity = actor('omar'); const repository = f.factory().forParticipant(identity);
  identity.subject = 'iris'; f.change('ACCOUNT#omar', value => { value.status = 'DISABLED'; });
  await expect(repository.transactionDecision('decision', () => true)).rejects.toThrow('FORBIDDEN');
});


it('preserves the existing capacity classification when a joined SDK transaction is rejected for item size', async () => {
  const f = await fixture(); const repository = f.factory().forParticipant(actor()); await repository.createDecision(f.initial);
  const before = f.current(); const writes = f.writes.length;
  f.beforeWrite(() => { throw Object.assign(new Error('synthetic item-size rejection'), { name: 'TransactionCanceledException',
    CancellationReasons: [{ Code: 'ValidationError', Message: 'Item size exceeded the size limit' }] }); });
  await expect(repository.transactionDecision('decision', record => { record!.controlVersion++; })).rejects.toBeInstanceOf(RepositoryCapacityError);
  expect(f.writes.length - writes).toBe(1); expect(f.current()).toEqual(before);
});
