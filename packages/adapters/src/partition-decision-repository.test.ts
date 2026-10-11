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


function draftFixture(f: Awaited<ReturnType<typeof fixture>>) {
  const participants = ['iris', 'omar'].map(subject => ({ id: partitionMemberId(subject), displayName: subject.toUpperCase(), requiredForApproval: true }));
  const draft = Groups.GroupDraft.parse({ id: 'draft-one', revision: 1, groupVersion: 1, bodyHash: 'b'.repeat(64), createdDecisionId: null,
    clarificationQuestions: [], frame: { schemaVersion: KE.KE_SCHEMA_VERSION, decisionId: 'draft-frame', frameVersion: 1, semanticVersion: 1,
      contextToken: 'c'.repeat(64), title: 'Choose together', objective: 'Choose a task', description: '', participants,
      requiredParticipantIds: participants.map(person => person.id), variables: [{ id: 'choice', label: 'Choice', type: 'BOOLEAN', visibility: 'PUBLIC', required: true }], rules: [] } });
  const header = f.cells.get(f.groupLocation)!; const row = JSON.parse(header.payload!.S!); row.value.draftIds = [draft.id];
  header.payload = { S: JSON.stringify(row) };
  const key = { PK: { S: 'GROUP#garden' }, SK: { S: `DRAFT#${draft.id}` } };
  f.cells.set(where(target.partitionArn, key), { ...key, revision: { N: '1' }, payload: { S: JSON.stringify({ schemaVersion: 1, kind: 'DRAFT', revision: 1, value: draft }) } });
  return draft;
}
async function preparedApp(f: Awaited<ReturnType<typeof fixture>>, context = partitionIO()) {
  draftFixture(f);
  const prepared = await f.factory().forDraft(actor(), 'garden', 'draft-one', { revision: 1 }, context);
  const app = new KnownEnoughApplication({ repository: prepared.repository, clock: { now: () => '2026-10-07T15:00:00Z' }, ids: { next: () => 'synthetic' } });
  const input = { definition: prepared.definition, memberships: prepared.memberships, creationBodyHash: prepared.creationBodyHash, creatorSubject: 'iris' };
  return { prepared, app, input };
}

it('atomically creates a decision with the draft lock, binding, directory, group header and approved account guards', async () => {
  const f = await fixture(); const { prepared, app, input } = await preparedApp(f);
  expect(f.writes).toEqual([]); await app.createDecision(input);
  const items = f.writes[0]!;
  expect(items.filter(item => item.Put)).toHaveLength(6); expect(items.filter(item => item.ConditionCheck)).toHaveLength(2);
  const id = prepared.definition.decisionId;
  expect(JSON.parse(f.cells.get(`${target.partitionArn}/GROUP#garden/DRAFT#draft-one`)!.payload!.S!).value.createdDecisionId).toBe(id);
  expect(f.cells.has(`${target.partitionArn}/DECISION#${id}/GROUP`)).toBe(true);
  expect(f.cells.has(`${target.partitionArn}/GROUP#garden/BINDING#${id}`)).toBe(true);
  const snapshot = await app.getCreatedDecision(actor(), id, prepared.creationBodyHash);
  expect(snapshot!.frame.decisionId).toBe(id);
  expect(JSON.stringify(snapshot)).not.toMatch(/creationBodyHash|creatorSubject|emailHash|tokenHash|ACCOUNT#|GROUP#/);
  const repeat = await f.factory().forDraft(actor(), 'garden', 'draft-one', { revision: 1 });
  expect(repeat.created).toBe(true); expect(repeat.creationBodyHash).toBe(prepared.creationBodyHash);
});

it('fails atomic draft creation on commit-time disable, roster or draft edit without a partial binding', async () => {
  for (const race of ['disable', 'roster', 'draft'] as const) {
    const f = await fixture(); const { prepared, app, input } = await preparedApp(f);
    f.beforeWrite(() => {
      if (race === 'disable') f.change('ACCOUNT#omar', value => { value.status = 'DISABLED'; });
      else f.change('GROUP#garden', value => { if (race === 'roster') { value.version = 2; value.members = ['iris']; } });
    });
    await expect(app.createDecision(input)).rejects.toThrow(race === 'disable' ? 'FORBIDDEN' : 'STALE_CONTEXT');
    expect(f.cells.has(`${target.decisionArn}/ROOM#${prepared.definition.decisionId}/STATE`)).toBe(false);
    expect(f.cells.has(`${target.partitionArn}/DECISION#${prepared.definition.decisionId}/GROUP`)).toBe(false);
    expect(JSON.parse(f.cells.get(`${target.partitionArn}/GROUP#garden/DRAFT#draft-one`)!.payload!.S!).value.createdDecisionId).toBeNull();
    expect(f.writes).toHaveLength(1);
  }
});

it('recovers an uncertain applied creation through current explicit replay without repeating the creation write', async () => {
  const f = await fixture(); const { prepared, app, input } = await preparedApp(f); let first = true;
  f.afterWrite(() => { if (first) { first = false; throw new Error('synthetic response lost'); } });
  await app.createDecision(input);
  expect(f.writes.filter(items => items.some(item => item.Put?.TableName === target.decisionArn))).toHaveLength(1);
  expect((await app.getCreatedDecision(actor(), prepared.definition.decisionId, prepared.creationBodyHash))!.frame.decisionId).toBe(prepared.definition.decisionId);
});

it('does not create a second decision during concurrent identical draft creation', async () => {
  const f = await fixture(); const { prepared, app, input } = await preparedApp(f);
  const second = await f.factory().forDraft(actor(), 'garden', 'draft-one', { revision: 1 });
  const other = new KnownEnoughApplication({ repository: second.repository, clock: { now: () => '2026-10-07T15:00:00Z' }, ids: { next: () => 'synthetic' } });
  await app.createDecision(input); await other.createDecision(input);
  expect(f.writes.filter(items => items.some(item => item.Put?.TableName === target.decisionArn))).toHaveLength(2);
  const keys = [...f.cells.keys()].filter(key => key.startsWith(`${target.decisionArn}/ROOM#${prepared.definition.decisionId}/`));
  expect(keys).toHaveLength(2);
});

it('binds the creation port to immutable server input and rejects wrong decision/hash/roster before writing', async () => {
  for (const wrong of ['id', 'hash', 'membership', 'frame'] as const) {
    const f = await fixture(); const { app, input } = await preparedApp(f);
    if (wrong === 'id') input.definition.decisionId = 'other';
    if (wrong === 'hash') input.creationBodyHash = 'd'.repeat(64);
    if (wrong === 'membership') input.memberships[0]!.subject = 'other';
    if (wrong === 'frame') input.definition.title = 'Different';
    await expect(app.createDecision(input)).rejects.toThrow(wrong === 'id' ? 'DECISION_INVALID' : wrong === 'membership' ? 'INVALID_COMMAND' : 'STALE_CONTEXT');
    expect(f.writes).toEqual([]);
  }
});

it('retains one request budget and cancellation across preparation and actual creation', async () => {
  const f = await fixture(); const base = partitionIO(); let charged = 0;
  const io = { signal: base.signal, request: () => { charged++; base.request(); } };
  const { app, input } = await preparedApp(f, io);
  while (charged < 64) io.request();
  await expect(app.createDecision(input)).rejects.toThrow('DECISION_REQUEST_LIMIT'); expect(f.writes).toEqual([]);
});


it('rejects a retained directory collision without creating a decision or changing its owner', async () => {
  const f = await fixture(); const { prepared, app, input } = await preparedApp(f);
  const id = prepared.definition.decisionId; const key = { PK: { S: `DECISION#${id}` }, SK: { S: 'GROUP' } };
  f.cells.set(where(target.partitionArn, key), { ...key, revision: { N: '1' }, payload: { S: JSON.stringify({ schemaVersion: 1, kind: 'DIRECTORY', revision: 1,
    value: { type: 'DECISION', decisionId: id, groupId: 'foreign' } }) } });
  await expect(app.createDecision(input)).rejects.toThrow('DECISION_INVALID');
  expect(f.cells.has(`${target.decisionArn}/ROOM#${id}/STATE`)).toBe(false);
  expect(JSON.parse(f.cells.get(where(target.partitionArn, key))!.payload!.S!).value.groupId).toBe('foreign');
});

it('denies replay after an uncertain applied write if an account was disabled and preserves the whole atomic record', async () => {
  const f = await fixture(); const { prepared, app, input } = await preparedApp(f); let first = true;
  f.afterWrite(() => { if (first) { first = false; f.change('ACCOUNT#iris', value => { value.status = 'DISABLED'; }); throw new Error('synthetic lost response'); } });
  await expect(app.createDecision(input)).rejects.toThrow('FORBIDDEN');
  expect(f.cells.has(`${target.decisionArn}/ROOM#${prepared.definition.decisionId}/STATE`)).toBe(true);
  expect(f.cells.has(`${target.partitionArn}/DECISION#${prepared.definition.decisionId}/GROUP`)).toBe(true);
  expect(f.writes).toHaveLength(1);
});

it('captures the trusted principal and command and denies detached provisioning or command replay ports', async () => {
  const f = await fixture(); draftFixture(f); const who = actor(); const command = { revision: 1 };
  const prepared = await f.factory().forDraft(who, 'garden', 'draft-one', command); who.subject = 'omar'; command.revision = 2;
  const app = new KnownEnoughApplication({ repository: prepared.repository, clock: { now: () => '2026-10-07T15:00:00Z' }, ids: { next: () => 'synthetic' } });
  await app.createDecision({ definition: prepared.definition, memberships: prepared.memberships, creationBodyHash: prepared.creationBodyHash, creatorSubject: 'iris' });
  await expect(prepared.repository.transactionDecision('other', () => true)).rejects.toThrow('DECISION_INVALID');
  await expect(prepared.repository.transactionDecision(prepared.definition.decisionId, () => true, { replay: { keyHash: Promise.resolve('a'.repeat(64)) } } as never)).rejects.toThrow('DECISION_INVALID');
  expect(f.writes).toHaveLength(1);
});

it('validates native creation bundles before any SDK request and preserves the single shared abort signal', async () => {
  const f = await fixture(); const { app, input } = await preparedApp(f); await app.createDecision(input);
  const bundle = f.writes[0]!; const send = vi.spyOn(DynamoDBClient.prototype, 'send').mockResolvedValue({} as never);
  const transport = createDynamoPartitionDecisionTransport(target); const io = partitionIO();
  await transport.send(new TransactWriteItemsCommand({ TransactItems: bundle }), io);
  expect(send.mock.calls[0]![1]).toMatchObject({ abortSignal: io.signal });
  for (const wrong of ['missing', 'unguarded', 'binding', 'decision', 'revision', 'account'] as const) {
    const items = structuredClone(bundle);
    if (wrong === 'missing') items.splice(items.findIndex(item => item.Put?.TableName === target.partitionArn), 1);
    if (wrong === 'unguarded') items.find(item => item.Put?.TableName === target.partitionArn)!.Put!.ConditionExpression = 'attribute_exists(PK)';
    if (wrong === 'binding') {
      const item = items.find(item => item.Put?.Item?.SK?.S?.startsWith('BINDING#'))!.Put!;
      const row = JSON.parse(item.Item!.payload!.S!); row.value.version = 2; item.Item!.payload = { S: JSON.stringify(row) };
    }
    if (wrong === 'decision') items.find(item => item.Put?.TableName === target.decisionArn)!.Put!.Item!.PK = { S: 'ROOM#other' };
    if (wrong === 'revision') items.find(item => item.Put?.TableName === target.partitionArn)!.Put!.Item!.revision = { N: '99' };
    if (wrong === 'account') items.splice(items.findIndex(item => item.ConditionCheck), 1);
    await expect(transport.send(new TransactWriteItemsCommand({ TransactItems: items }), io)).rejects.toThrow('DECISION_INVALID');
  }
  expect(send).toHaveBeenCalledTimes(1);
});


it('never adopts an orphan decision after its draft binding is missing', async () => {
  const f = await fixture(); const { prepared, app, input } = await preparedApp(f); await app.createDecision(input);
  const id = prepared.definition.decisionId;
  f.cells.delete(`${target.partitionArn}/DECISION#${id}/GROUP`); f.cells.delete(`${target.partitionArn}/GROUP#garden/BINDING#${id}`);
  f.change('GROUP#garden', value => { value.decisionIds = (value.decisionIds as string[]).filter(value => value !== id); });
  const cell = f.cells.get(`${target.partitionArn}/GROUP#garden/DRAFT#draft-one`)!; const row = JSON.parse(cell.payload!.S!);
  row.value.createdDecisionId = null; row.revision++; cell.revision = { N: String(row.revision) }; cell.payload = { S: JSON.stringify(row) };
  const fresh = await f.factory().forDraft(actor(), 'garden', 'draft-one', { revision: 1 });
  const replay = new KnownEnoughApplication({ repository: fresh.repository, clock: { now: () => '2026-10-07T15:00:00Z' }, ids: { next: () => 'synthetic' } });
  expect(await replay.getCreatedDecision(actor(), id, fresh.creationBodyHash)).toBeNull();
  await expect(replay.createDecision({ definition: fresh.definition, memberships: fresh.memberships, creationBodyHash: fresh.creationBodyHash, creatorSubject: 'iris' })).rejects.toThrow('DECISION_STORAGE_UNAVAILABLE');
  expect(f.cells.has(`${target.partitionArn}/DECISION#${id}/GROUP`)).toBe(false);
  expect(JSON.parse(cell.payload!.S!).value.createdDecisionId).toBeNull();
});


it('uses a supplied physical request budget for participant admission and public publication instead of resetting it', async () => {
  const f = await fixture(); await f.factory().forParticipant(actor()).createDecision(f.initial);
  const base = partitionIO(); let charged = 0; const io = { signal: base.signal, request: () => { charged++; base.request(); } };
  const repository = f.factory().forParticipant(actor(), io); await repository.transactionDecision('decision', record => record!.decisionId);
  while (charged < 64) io.request(); const writes = f.writes.length;
  await expect(repository.transactionDecision('decision', record => record!.decisionId)).rejects.toThrow('DECISION_REQUEST_LIMIT');
  expect(f.writes).toHaveLength(writes);
});

it('uses the captured supplied cancellation context for participant work without a late decision write', async () => {
  const f = await fixture(); await f.factory().forParticipant(actor()).createDecision(f.initial);
  const controller = new AbortController(); const base = partitionIO(); const io = { ...base, signal: AbortSignal.any([base.signal, controller.signal]) };
  const repository = f.factory().forParticipant(actor(), io); controller.abort(); const writes = f.writes.length;
  await expect(repository.transactionDecision('decision', record => { record!.controlVersion++; })).rejects.toThrow('DECISION_TIMEOUT');
  expect(f.writes).toHaveLength(writes); expect(f.current().controlVersion).toBe(0);
});

async function rosterRevision(f: Awaited<ReturnType<typeof fixture>>, version = 2) {
  const prepared = await f.factory().forRoster(actor(), 'garden', 'decision', version);
  const app = new KnownEnoughApplication({ repository: prepared.repository, clock: { now: () => '2026-10-07T15:00:00Z' }, ids: { next: () => 'synthetic' } });
  const before = f.current();
  const definition = KE.DecisionDefinition.parse({ ...before.definition, frameVersion: before.definition.frameVersion + 1,
    semanticVersion: before.definition.semanticVersion + 1, participants: prepared.participants,
    requiredParticipantIds: prepared.participants.map(person => person.id), variables: before.definition.variables.map(variable => ({ ...variable, ownerParticipantId: null })) });
  return { prepared, app, input: { decisionId: 'decision', expectedControlVersion: before.controlVersion, definition, memberships: prepared.memberships } };
}
function removedRoster(f: Awaited<ReturnType<typeof fixture>>) { f.change('GROUP#garden', value => { value.members = ['iris']; value.version = 2; }); }
function bindingVersion(f: Awaited<ReturnType<typeof fixture>>) {
  return JSON.parse(f.cells.get(`${target.partitionArn}/GROUP#garden/BINDING#decision`)!.payload!.S!).value.version as number;
}

it('joins stale-binding recovery to the actual semantic decision revision and final ordinary admission', async () => {
  const f = await fixture(); await f.factory().forParticipant(actor()).createDecision(f.initial); removedRoster(f); f.writes.length = 0;
  const { prepared, app, input } = await rosterRevision(f);
  expect(bindingVersion(f)).toBe(1); expect(f.writes).toEqual([]);
  await app.reviseDecision(actor(), input);
  expect(bindingVersion(f)).toBe(2); expect(f.current().definition.semanticVersion).toBe(2);
  expect(f.current().memberships).toEqual(prepared.memberships); expect(f.current().frameConfirmations).toEqual([]);
  const bundle = f.writes[0]!; expect(bundle.filter(item => item.Put?.TableName === target.partitionArn)).toHaveLength(2);
  expect(bundle.filter(item => item.ConditionCheck).map(item => item.ConditionCheck!.Key!.PK!.S)).toEqual(['ACCOUNT#iris']);
  const normal = new KnownEnoughApplication({ repository: f.factory().forParticipant(actor()), clock: { now: () => '2026-10-07T15:00:00Z' }, ids: { next: () => 'synthetic' } });
  expect((await normal.getPublicSnapshot(actor(), 'decision')).frame.participants).toHaveLength(1);
  await expect(f.factory().forParticipant(actor('omar')).transactionDecision('decision', () => true)).rejects.toThrow('NOT_FOUND');
});

it('permits guarded stale-roster review but forbids binding repair by reading the revision port', async () => {
  const f = await fixture(); await f.factory().forParticipant(actor()).createDecision(f.initial); removedRoster(f); f.writes.length = 0;
  const review = await f.factory().forRoster(actor(), 'garden', 'decision');
  expect(await review.repository.transactionDecision('decision', record => record!.controlVersion)).toBe(0);
  expect(f.writes[0]!.every(item => item.ConditionCheck)).toBe(true); expect(bindingVersion(f)).toBe(1);
  const { prepared } = await rosterRevision(f);
  await expect(prepared.repository.transactionDecision('decision', () => true)).rejects.toThrow('DECISION_INVALID');
  expect(bindingVersion(f)).toBe(1);
  await expect(review.repository.transactionDecision('decision', record => { record!.definition.semanticVersion++; })).rejects.toThrow('DECISION_INVALID');
  await expect(prepared.repository.transactionDecision('other', () => true)).rejects.toThrow('DECISION_INVALID');
});

it('rejects account/roster races at the joined revision commit without partial repair', async () => {
  for (const race of ['account', 'roster']) {
    const f = await fixture(); await f.factory().forParticipant(actor()).createDecision(f.initial); removedRoster(f);
    const { app, input } = await rosterRevision(f); const before = f.current();
    f.beforeWrite(() => { f.beforeWrite(() => {}); f.change(race === 'account' ? 'ACCOUNT#iris' : 'GROUP#garden', value => { if (race === 'account') value.status = 'DISABLED'; else value.version = 3; }); });
    await expect(app.reviseDecision(actor(), input)).rejects.toThrow('STALE_CONTEXT');
    expect(f.current()).toEqual(before); expect(bindingVersion(f)).toBe(1);
  }
});

it('rejects stale control versions, closed decisions and substituted revision membership without binding mutation', async () => {
  for (const kind of ['control', 'closed', 'membership']) {
    const f = await fixture(); if (kind === 'closed') f.initial.status = 'CLOSED';
    await f.factory().forParticipant(actor()).createDecision(f.initial); removedRoster(f);
    const { app, input } = await rosterRevision(f); const before = f.current();
    if (kind === 'control') input.expectedControlVersion++;
    if (kind === 'membership') input.memberships[0]!.subject = 'other';
    await expect(app.reviseDecision(actor(), input)).rejects.toThrow(kind === 'closed' ? 'FORBIDDEN' : kind === 'control' ? 'STALE_CONTEXT' : 'DECISION_INVALID');
    expect(f.current()).toEqual(before); expect(bindingVersion(f)).toBe(1);
  }
});

it('does not retry an uncertain applied roster revision or report an already-used control version as new consent', async () => {
  const f = await fixture(); await f.factory().forParticipant(actor()).createDecision(f.initial); removedRoster(f); f.writes.length = 0;
  const { app, input } = await rosterRevision(f);
  f.afterWrite(() => { f.afterWrite(() => {}); throw new Error('PRIVATE synthetic response lost'); });
  await expect(app.reviseDecision(actor(), input)).rejects.toThrow('DECISION_STORAGE_UNAVAILABLE');
  expect(f.writes).toHaveLength(1); expect(bindingVersion(f)).toBe(2); expect(f.current().definition.semanticVersion).toBe(2);
  const fresh = await rosterRevision(f);
  await expect(fresh.app.reviseDecision(actor(), { ...fresh.input, expectedControlVersion: input.expectedControlVersion })).rejects.toThrow('STALE_CONTEXT');
  expect(f.current().definition.semanticVersion).toBe(2); expect(f.writes).toHaveLength(1);
});

it('checks exact native roster bundles before SDK execution and forbids unguarded or cross-decision writes', async () => {
  const f = await fixture(); await f.factory().forParticipant(actor()).createDecision(f.initial); removedRoster(f); f.writes.length = 0;
  const { app, input } = await rosterRevision(f); await app.reviseDecision(actor(), input);
  const bundle = f.writes[0]!; const send = vi.spyOn(DynamoDBClient.prototype, 'send').mockResolvedValue({} as never);
  const native = createDynamoPartitionDecisionTransport(target); const io = partitionIO();
  await native.send(new TransactWriteItemsCommand({ TransactItems: bundle }), io);
  expect(send.mock.calls[0]![1]).toMatchObject({ abortSignal: io.signal });
  for (const kind of ['header', 'account', 'condition', 'binding', 'decision', 'guard', 'guard-name', 'guard-version']) {
    const items = structuredClone(bundle);
    if (kind === 'header') items.splice(items.findIndex(item => item.Put?.Item?.SK?.S === 'STATE' && item.Put?.TableName === target.partitionArn), 1);
    if (kind === 'account') items.splice(items.findIndex(item => item.ConditionCheck), 1);
    if (kind === 'condition') items.find(item => item.Put?.TableName === target.partitionArn)!.Put!.ConditionExpression = 'attribute_exists(PK)';
    if (kind === 'binding') { const put = items.find(item => item.Put?.Item?.SK?.S === 'BINDING#decision')!.Put!; const row = JSON.parse(put.Item!.payload!.S!); row.value.version++; put.Item!.payload = { S: JSON.stringify(row) }; }
    if (kind === 'decision') items.find(item => item.Put?.TableName === target.decisionArn)!.Put!.Item!.PK = { S: 'ROOM#other' };
    if (kind === 'guard') items.find(item => item.Update)!.Update!.ConditionExpression = 'attribute_exists(PK)';
    if (kind === 'guard-name') items.find(item => item.Update)!.Update!.ExpressionAttributeNames!['#version'] = 'other';
    if (kind === 'guard-version') items.find(item => item.Update)!.Update!.ExpressionAttributeValues![':nextVersion'] = { N: '999' };
    await expect(native.send(new TransactWriteItemsCommand({ TransactItems: items }), io)).rejects.toThrow('DECISION_INVALID');
  }
  expect(send).toHaveBeenCalledTimes(1);
});


it('publishes only the strict public display projection, including an atomic absent-account guard', async () => {
  const f = await fixture(); await f.factory().forParticipant(actor()).createDecision(f.initial); f.writes.length = 0;
  const principal: TrustedPrincipal = { kind: 'display', subject: 'screen', roomId: 'decision' };
  const app = new KnownEnoughApplication({ repository: f.factory().forDisplay(principal), clock: { now: () => '2026-10-07T12:00:00Z' }, ids: { next: () => 'synthetic' } });
  const value = await app.getPublicSnapshot(principal, 'decision');
  expect(value.frame.decisionId).toBe('decision'); expect(value.viewerParticipantId).toBeNull();
  expect(JSON.stringify(value)).not.toMatch(/creatorSubject|creationBodyHash|memberships|confirmedConstraints|emailHash|ACCOUNT#|GROUP#/);
  const checks = f.writes.at(-1)!;
  expect(checks.every(item => item.ConditionCheck)).toBe(true);
  expect(checks.some(item => item.ConditionCheck?.Key?.PK?.S === 'ACCOUNT#screen'
    && item.ConditionCheck.ConditionExpression === 'attribute_not_exists(PK)')).toBe(true);
});

it('display repository refuses creation, private-shaped callbacks, replay and foreign-room selection without data writes', async () => {
  const f = await fixture(); await f.factory().forParticipant(actor()).createDecision(f.initial); f.writes.length = 0;
  const principal: TrustedPrincipal = { kind: 'display', subject: 'screen', roomId: 'decision' };
  const repository = f.factory().forDisplay(principal);
  await expect(repository.createDecision(f.initial)).rejects.toThrow('FORBIDDEN');
  await expect(repository.transactionDecision('other', record => record)).rejects.toThrow('FORBIDDEN');
  await expect(repository.transactionDecision('decision', record => record)).rejects.toThrow('FORBIDDEN');
  await expect(repository.transactionDecision('decision', () => 'PRIVATE')).rejects.toThrow('FORBIDDEN');
  expect(f.writes).toEqual([]);
});

it('account creation or group removal at final display publication blocks the captured snapshot', async () => {
  for (const change of ['account', 'group'] as const) {
    const f = await fixture(); await f.factory().forParticipant(actor()).createDecision(f.initial); f.writes.length = 0;
    const principal: TrustedPrincipal = { kind: 'display', subject: 'screen', roomId: 'decision' };
    const app = new KnownEnoughApplication({ repository: f.factory().forDisplay(principal), clock: { now: () => '2026-10-07T12:00:00Z' }, ids: { next: () => 'synthetic' } });
    f.beforeWrite(() => {
      if (change === 'group') f.change('GROUP#garden', group => { group.version = 2; group.members = ['iris']; });
      else f.cells.set(where(target.partitionArn, { PK: { S: 'ACCOUNT#screen' }, SK: { S: 'STATE' } }),
        { PK: { S: 'ACCOUNT#screen' }, SK: { S: 'STATE' }, revision: { N: '1' }, payload: { S: JSON.stringify({ schemaVersion: 1, kind: 'ACCOUNT', revision: 1,
          value: { subject: 'screen', emailHash: 'a'.repeat(64), displayName: 'Screen', status: 'PENDING', version: 1 } }) } });
    });
    await expect(app.getPublicSnapshot(principal, 'decision')).rejects.toThrow();
  }
});


it('a display projection can sweep its copied record while backing storage stays unchanged', async () => {
  const f = await fixture(); await f.factory().forParticipant(actor()).createDecision(f.initial);
  const principal: TrustedPrincipal = { kind: 'display', subject: 'screen', roomId: 'decision' };
  const repository = f.factory().forDisplay(principal);
  const app = new KnownEnoughApplication({ repository, clock: { now: () => '2026-10-07T12:00:00Z' }, ids: { next: () => 'synthetic' } });
  const snapshot = await app.getPublicSnapshot(principal, 'decision'); const before = structuredClone(f.current()); f.writes.length = 0;
  const value = await repository.transactionDecision('decision', record => { record!.controlVersion++; return snapshot; });
  expect(value).toEqual(snapshot); expect(f.current()).toEqual(before);
  expect(f.writes.flat().every(item => item.ConditionCheck)).toBe(true);
});


it('explicit legacy public eligibility preserves a room grant while atomically conditioning directory absence', async () => {
  const f = await fixture(); await f.factory().forParticipant(actor()).createDecision(f.initial); f.writes.length = 0;
  const directory = where(target.partitionArn, { PK: { S: 'DECISION#decision' }, SK: { S: 'GROUP' } });
  f.cells.delete(directory);
  const principal: TrustedPrincipal = { kind: 'display', subject: 'screen', roomId: 'decision' };
  const app = new KnownEnoughApplication({ repository: f.factory({ legacyPublicDecision: selected => selected === 'decision' }).forDisplay(principal),
    clock: { now: () => '2026-10-07T12:00:00Z' }, ids: { next: () => 'synthetic' } });
  expect((await app.getPublicSnapshot(principal, 'decision')).viewerParticipantId).toBeNull();
  expect(f.writes.at(-1)!.some(item => item.ConditionCheck?.Key?.PK?.S === 'DECISION#decision'
    && item.ConditionCheck.ConditionExpression === 'attribute_not_exists(PK)')).toBe(true);
  expect(f.writes.flat().every(item => item.ConditionCheck)).toBe(true);
  await expect(new KnownEnoughApplication({ repository: f.factory().forDisplay(principal),
    clock: { now: () => '2026-10-07T12:00:00Z' }, ids: { next: () => 'synthetic' } }).getPublicSnapshot(principal, 'decision')).rejects.toThrow('NOT_FOUND');
});

it('a new group directory at legacy display publication prevents the captured unbound snapshot from escaping', async () => {
  const f = await fixture(); await f.factory().forParticipant(actor()).createDecision(f.initial); f.writes.length = 0;
  const directory = where(target.partitionArn, { PK: { S: 'DECISION#decision' }, SK: { S: 'GROUP' } });
  const saved = structuredClone(f.cells.get(directory)!); f.cells.delete(directory);
  const principal: TrustedPrincipal = { kind: 'display', subject: 'screen', roomId: 'decision' };
  const app = new KnownEnoughApplication({ repository: f.factory({ legacyPublicDecision: () => true }).forDisplay(principal),
    clock: { now: () => '2026-10-07T12:00:00Z' }, ids: { next: () => 'synthetic' } });
  f.beforeWrite(() => { f.cells.set(directory, saved); });
  await expect(app.getPublicSnapshot(principal, 'decision')).rejects.toThrow('STALE_CONTEXT');
});
