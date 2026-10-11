import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { DynamoDBClient, GetItemCommand, BatchGetItemCommand, TransactGetItemsCommand, TransactWriteItemsCommand,
  QueryCommand, type AttributeValue, type TransactWriteItem } from '@aws-sdk/client-dynamodb';
import { Groups } from '@deal-table/contracts';
import { KnownEnoughApplication, RepositoryCapacityError } from '@deal-table/application';
import { KnownEnough as KE } from '@deal-table/contracts';
import { InMemoryRoomRepository } from './index.ts';
import { createPartitionManagedDriver, type PartitionManagedOptions } from './partition-managed.ts';
import { preparePartitionMigration } from './partition-migration.ts';
import { MigrationJournalSchema, MigrationControlSchema } from './partition-migration-runner.ts';
import { partitionIO, partitionCall, partitionDynamoWrites, partitionAccountKey } from './partitioned-group-repository.ts';
import { createPartitionGroupSession, partitionMemberId } from './partition-group-session.ts';
import { createPartitionDecisionRepository, PARTITION_DECISION_TARGET as target } from './partition-decision-repository.ts';
import { decodeDecisionStateItem } from './dynamodb-codec.ts';
import { preparePartitionArchive, createPartitionArchiveRunner, type ArchiveAuthority } from './partition-archive.ts';

type Item = Record<string, AttributeValue>;
const sourceArn = 'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughGroupsStage';
const journalArn = 'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughOperationsJournal';
const attr = (PK: string, SK = 'STATE') => ({ PK: { S: PK }, SK: { S: SK } });
const where = (table: string, key: Item) => `${table}/${key.PK!.S}/${key.SK!.S}`;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
afterEach(() => vi.restoreAllMocks());
function fixture() {
  const state: Groups.GroupState = { accounts: [{ subject: 'iris', emailHash: hash('iris'), displayName: 'Iris', status: 'APPROVED', version: 1 }],
    groups: [{ id: 'garden', name: 'Garden', organizer: 'iris', version: 1, members: ['iris'], drafts: [], invitations: [], decisions: [{ id: 'decision', version: 1 }] }] };
  const plan = preparePartitionMigration(Buffer.from(JSON.stringify(state)), 12, 'a'.repeat(40));
  const options: PartitionManagedOptions = { manifestBytes: plan.manifestBytes, expected: { sourceSha: 'a'.repeat(40),
    sourceRevision: 12, sourceHash: plan.sourceHash, manifestHash: plan.manifestHash }, manifestVersion: 'version-1',
    verifiedTarget: { account: '092954139775', region: 'us-east-1' }, cursorKey: Buffer.alloc(32, 7) };
  const control = MigrationControlSchema.parse({ schemaVersion: 1, account: '092954139775', region: 'us-east-1',
    table: 'KnownEnoughPartitions', revision: 3, active: true, planHash: plan.planHash });
  const journal = MigrationJournalSchema.parse({ schemaVersion: 1, revision: plan.batches.length + 1, actorId: 143764700,
    planHash: plan.planHash, manifestHash: plan.manifestHash, manifestVersion: 'version-1', sourceSha: 'a'.repeat(40),
    sourceRevision: 12, sourceHash: plan.sourceHash, rowCount: plan.rowCount, nextBatch: plan.batches.length,
    completedRows: plan.rowCount, state: 'COPIED' });
  const marker = { schemaVersion: 1, kind: 'PARTITION_MIGRATION', phase: 'ACTIVE', planHash: plan.planHash,
    manifestHash: plan.manifestHash, manifestVersion: 'version-1', sourceSha: 'a'.repeat(40), sourceRevision: 12,
    sourceHash: plan.sourceHash, account: '092954139775', region: 'us-east-1', table: 'KnownEnoughPartitions' };
  const cells = new Map<string, Item>();
  const sourceLocation = where(sourceArn, attr('NP#GROUPS'));
  const controlLocation = where(target.partitionArn, attr('MIGRATION#CONTROL'));
  const journalLocation = where(journalArn, attr(`PARTITION#${plan.planHash}`, 'JOURNAL'));
  cells.set(sourceLocation, { ...attr('NP#GROUPS'), version: { N: '14' }, payload: { S: JSON.stringify(marker) } });
  cells.set(controlLocation, { ...attr('MIGRATION#CONTROL'), revision: { N: '3' }, payload: { S: JSON.stringify(control) } });
  cells.set(journalLocation, { ...attr(`PARTITION#${plan.planHash}`, 'JOURNAL'), revision: { N: String(journal.revision) }, payload: { S: JSON.stringify(journal) } });
  for (const row of plan.batches.flat()) {
    const item = partitionDynamoWrites('KnownEnoughPartitions', [row])[0]!.Put!.Item!;
    cells.set(where(target.partitionArn, item), item);
  }
  const commands: unknown[] = []; const writes: TransactWriteItem[][] = []; let beforeWrite = () => {};
  let afterWrite = () => {}; let afterGate: () => Promise<void> | void = () => {};
  const send = vi.spyOn(DynamoDBClient.prototype, 'send').mockImplementation(async function(this: DynamoDBClient, command, request) {
    expect(await this.config.region()).toBe('us-east-1'); expect(await this.config.maxAttempts()).toBe(1);
    const endpoint = await this.config.endpoint!(); expect(`${endpoint.protocol}//${endpoint.hostname}`).toBe('https://dynamodb.us-east-1.amazonaws.com');
    expect(request).toHaveProperty('abortSignal'); commands.push(command);
    if (command instanceof TransactGetItemsCommand) {
      const response = { Responses: command.input.TransactItems!.map(entry => ({ Item: structuredClone(cells.get(where(entry.Get!.TableName!, entry.Get!.Key!))) })) };
      if (command.input.TransactItems![0]!.Get!.TableName === sourceArn) await afterGate(); return response;
    }
    if (command instanceof GetItemCommand) return { Item: structuredClone(cells.get(where(command.input.TableName === 'KnownEnoughPartitions'
      ? target.partitionArn : command.input.TableName!, command.input.Key!))) };
    if (command instanceof BatchGetItemCommand) {
      const keys = command.input.RequestItems!['KnownEnoughPartitions']?.Keys ?? command.input.RequestItems![target.partitionArn]!.Keys!;
      const name = Object.keys(command.input.RequestItems!)[0]!;
      return { Responses: { [name]: keys.flatMap(key => { const item = cells.get(where(target.partitionArn, key)); return item ? [structuredClone(item)] : []; }) } };
    }
    if (command instanceof QueryCommand) {
      const pk = command.input.ExpressionAttributeValues![':pk']!.S!;
      return { Items: [...cells.values()].filter(item => item.PK!.S === pk && item.SK!.S!.startsWith('GROUP#')).map(item => structuredClone(item)) };
    }
    if (!(command instanceof TransactWriteItemsCommand)) throw new Error('unexpected command');
    const items = command.input.TransactItems!; writes.push(structuredClone(items)); beforeWrite();
    const matches = items.map(entry => {
      const action = entry.Put ?? entry.Update ?? entry.ConditionCheck!; const key = 'Item' in action ? action.Item! : action.Key!;
      const prior = cells.get(where(action.TableName!, key));
      if (action.ConditionExpression?.startsWith('attribute_not_exists')) return !prior;
      if (action.ConditionExpression?.startsWith('attribute_exists')) return !!prior;
      return action.ConditionExpression!.split(' AND ').every(expression => {
        const [left, right] = expression.split('=').map(value => value.trim());
        return JSON.stringify(prior?.[action.ExpressionAttributeNames![left!]!]) === JSON.stringify(action.ExpressionAttributeValues![right!]);
      });
    });
    if (matches.some(value => !value)) throw Object.assign(new Error('synthetic conditional rejection'), {
      name: 'TransactionCanceledException', CancellationReasons: matches.map(value => ({ Code: value ? 'None' : 'ConditionalCheckFailed' })) });
    for (const entry of items) if (entry.Put) cells.set(where(entry.Put.TableName!, entry.Put.Item!), structuredClone(entry.Put.Item!));
    for (const entry of items) if (entry.Update) {
      const update = entry.Update; const cell = structuredClone(cells.get(where(update.TableName!, update.Key!)))!;
      for (const expression of update.UpdateExpression!.slice(4).split(',')) {
        const [name, value] = expression.split('=').map(part => part.trim());
        cell[update.ExpressionAttributeNames![name!]!] = structuredClone(update.ExpressionAttributeValues![value!]!);
      }
      cells.set(where(update.TableName!, update.Key!), cell);
    }
    afterWrite(); return {};
  });
  return { options, plan, marker, control, journal, cells, commands, writes, send, sourceLocation, controlLocation, journalLocation,
    driver: () => createPartitionManagedDriver(options), beforeWrite: (work: () => void) => { beforeWrite = work; },
    afterWrite: (work: () => void) => { afterWrite = work; }, afterGate: (work: () => Promise<void> | void) => { afterGate = work; } };
}

it('requires independently bound version2 recovery/source/target and a private cursor key before any SDK I/O', () => {
  const data = fixture(); data.driver(); expect(data.send).not.toHaveBeenCalled();
  for (const defect of ['target', 'hash', 'source', 'version', 'key', 'legacy']) {
    const options = { ...data.options, expected: { ...data.options.expected }, verifiedTarget: { ...data.options.verifiedTarget } };
    if (defect === 'target') options.verifiedTarget.account = '000000000000';
    if (defect === 'hash') options.expected.manifestHash = 'f'.repeat(64);
    if (defect === 'source') options.expected.sourceSha = 'b'.repeat(40);
    if (defect === 'version') options.manifestVersion = 'null';
    if (defect === 'key') options.cursorKey = Buffer.alloc(1);
    if (defect === 'legacy') {
      const manifest = { ...JSON.parse(options.manifestBytes.toString()), schemaVersion: 1 };
      options.manifestBytes = Buffer.from(JSON.stringify(manifest)); options.expected.manifestHash = hash(options.manifestBytes.toString());
    }
    expect(() => createPartitionManagedDriver(options)).toThrow('PARTITION_MANAGED_INVALID');
  }
  expect(data.send).not.toHaveBeenCalled();
});

it.each(['source', 'phase', 'markerBinding', 'markerBytes', 'control', 'controlPlan', 'journal', 'journalVersion', 'journalProgress', 'journalEnvelope'])(
  'denies %s activation drift before reading participant rows', async defect => {
  const data = fixture();
  if (defect === 'source') data.cells.get(data.sourceLocation)!.version = { N: '13' };
  if (defect === 'phase') data.cells.get(data.sourceLocation)!.payload = { S: JSON.stringify({ ...data.marker, phase: 'FROZEN' }) };
  if (defect === 'markerBinding') data.cells.get(data.sourceLocation)!.payload = { S: JSON.stringify({ ...data.marker, sourceSha: 'b'.repeat(40) }) };
  if (defect === 'markerBytes') data.cells.get(data.sourceLocation)!.payload!.S += ' ';
  if (defect === 'control') data.cells.get(data.controlLocation)!.payload = { S: JSON.stringify({ ...data.control, active: false }) };
  if (defect === 'controlPlan') data.cells.get(data.controlLocation)!.payload = { S: JSON.stringify({ ...data.control, planHash: 'b'.repeat(64) }) };
  if (defect === 'journal') data.cells.delete(data.journalLocation);
  if (defect === 'journalVersion') data.cells.get(data.journalLocation)!.payload = { S: JSON.stringify({ ...data.journal, manifestVersion: 'version-2' }) };
  if (defect === 'journalProgress') data.cells.get(data.journalLocation)!.payload = { S: JSON.stringify({ ...data.journal, completedRows: 0 }) };
  if (defect === 'journalEnvelope') data.cells.get(data.journalLocation)!.revision = { N: '99' };
  await expect(data.driver().groups.read(partitionAccountKey('iris'))).rejects.toThrow('RETRYABLE_SERVER_ERROR');
  expect(data.commands).toHaveLength(1); expect(data.writes).toHaveLength(0);
});

it('joins exact source/control/copied journal with the actual group commit, preserving partition CAS', async () => {
  const data = fixture(); const driver = data.driver(); const io = partitionIO();
  const row = await partitionCall(io, () => driver.groups.read(partitionAccountKey('iris'), io));
  expect(row).toMatchObject({ kind: 'ACCOUNT', revision: 1 });
  expect(await partitionCall(io, () => driver.groups.commit([{ key: partitionAccountKey('iris'), expected: 1, next: null }], io))).toBe(true);
  expect(data.commands.filter(command => command instanceof TransactGetItemsCommand)).toHaveLength(1);
  expect(data.writes[0]).toHaveLength(4);
  expect(data.writes[0]![0]!.ConditionCheck).toMatchObject({ TableName: sourceArn, Key: attr('NP#GROUPS'),
    ExpressionAttributeValues: { ':v': { N: '14' }, ':p': { S: JSON.stringify(data.marker) } } });
  expect(data.writes[0]![1]!.ConditionCheck).toMatchObject({ TableName: target.partitionArn, Key: attr('MIGRATION#CONTROL'),
    ExpressionAttributeValues: { ':r': { N: '3' }, ':p': { S: JSON.stringify(data.control) } } });
  expect(data.writes[0]![2]!.ConditionCheck).toMatchObject({ TableName: journalArn, Key: attr(`PARTITION#${data.plan.planHash}`, 'JOURNAL') });
  expect(data.writes[0]![3]!.ConditionCheck).toMatchObject({ TableName: target.partitionArn, Key: attr('ACCOUNT#iris'), ExpressionAttributeValues: { ':r': { N: '1' } } });
});

it.each(['source', 'control', 'journal'])('rejects %s changes at publication after the initial atomic activation read', async defect => {
  const data = fixture(); data.beforeWrite(() => {
    const location = defect === 'source' ? data.sourceLocation : defect === 'control' ? data.controlLocation : data.journalLocation;
    data.cells.delete(location);
  });
  await expect(createPartitionGroupSession(data.driver().groups).status({ kind: 'participant', subject: 'iris' })).rejects.toThrow();
  expect(data.writes.length).toBeGreaterThan(0);
  expect(data.writes.every(items => items.length === 4)).toBe(true);
});

it('composes admitted group listing with source-bound discovery and one guarded whole-page publication', async () => {
  const data = fixture(); const driver = data.driver();
  const session = createPartitionGroupSession(driver.groups, { discovery: driver.membershipDiscovery });
  const page = await session.list({ kind: 'participant', subject: 'iris' }, { limit: 10 });
  expect(page).toEqual({ groups: [{ id: 'garden', name: 'Garden', version: 1, isOrganizer: true,
    members: [{ id: partitionMemberId('iris'), displayName: 'Iris', isOrganizer: true }],
    drafts: [], decisions: [{ id: 'decision', current: true }], pendingInvitations: 0 }], cursor: null });
  expect(data.commands.filter(command => command instanceof TransactGetItemsCommand)).toHaveLength(1);
  expect(data.writes.at(-1)).toHaveLength(5); // source/control/journal, account and group
  expect(JSON.stringify(page)).not.toMatch(/manifest|sourceSha|planHash|emailHash|PARTITION#/);
});

it('adds activation conditions to native decision publication without changing existing guards or commands', async () => {
  const data = fixture(); const driver = data.driver(); const io = partitionIO();
  const items = partitionDynamoWrites('KnownEnoughPartitions', [{ key: partitionAccountKey('iris'), expected: 1, next: null }]);
  items[0]!.ConditionCheck!.TableName = target.partitionArn;
  const command = new TransactWriteItemsCommand({ TransactItems: items });
  await partitionCall(io, () => driver.decisions.send(command, io));
  expect(data.writes[0]).toHaveLength(4); expect(data.writes[0]!.slice(3)).toEqual(items);
  expect(command.input.TransactItems).toEqual(items);
  const read = new TransactGetItemsCommand({ TransactItems: [{ Get: { TableName: target.decisionArn, Key: attr('ROOM#decision') } }] });
  await partitionCall(io, () => driver.decisions.send(read, io));
  expect(data.commands.filter(value => value instanceof TransactGetItemsCommand)).toHaveLength(2);
});

it('rejects caller-owned source/control conditions and wrong native targets before I/O', async () => {
  const data = fixture(); const driver = data.driver();
  for (const table of [sourceArn, journalArn, 'other', target.partitionArn]) {
    const command = new TransactWriteItemsCommand({ TransactItems: [{ ConditionCheck: { TableName: table,
      Key: attr('MIGRATION#CONTROL'), ConditionExpression: 'attribute_exists(PK)' } }] });
    await expect(driver.decisions.send(command, partitionIO())).rejects.toThrow('DECISION_INVALID');
  }
  expect(data.send).not.toHaveBeenCalled();
});

it('captures config, mutations and native commands before asynchronous activation', async () => {
  const data = fixture(); const driver = data.driver(); data.options.expected.sourceSha = 'b'.repeat(40); data.options.cursorKey.fill(0);
  let release: () => void = () => {}; data.afterGate(() => new Promise<void>(resolve => { release = resolve; }));
  const command = new TransactGetItemsCommand({ TransactItems: [{ Get: { TableName: target.decisionArn, Key: attr('ROOM#decision') } }] });
  const waiting = driver.decisions.send(command, partitionIO());
  await vi.waitFor(() => expect(data.commands).toHaveLength(1));
  command.input.TransactItems![0]!.Get!.TableName = 'other'; release(); await waiting;
  expect((data.commands.at(-1) as TransactGetItemsCommand).input.TransactItems![0]!.Get!.TableName).toBe(target.decisionArn);
});

it('charges each physical request and stops before storage on budget exhaustion or cancellation', async () => {
  const data = fixture(); const driver = data.driver(); const io = partitionIO({ maxRequests: 1 });
  await expect(partitionCall(io, () => driver.groups.read(partitionAccountKey('iris'), io))).rejects.toThrow('PARTITION_REQUEST_LIMIT');
  expect(data.commands).toHaveLength(0);
  const cancelled = new AbortController(); cancelled.abort();
  await expect(driver.groups.read(partitionAccountKey('iris'), { signal: cancelled.signal, request: () => {} })).rejects.toThrow('PARTITION_TIMEOUT');
  expect(data.commands).toHaveLength(0);
});

it('reserves three activation slots before any transaction', async () => {
  const data = fixture(); const changes = Array.from({ length: 98 }, (_, n) => ({ key: partitionAccountKey(`member-${n}`), expected: 0, next: null }));
  await expect(data.driver().groups.commit(changes)).rejects.toBeInstanceOf(RepositoryCapacityError);
  expect(data.commands).toHaveLength(0);
});

it('shares one activation read for concurrent calls and refuses uncertain applied commit without automatic replay', async () => {
  const data = fixture(); const driver = data.driver(); const io = partitionIO();
  await Promise.all([partitionCall(io, () => driver.groups.read(partitionAccountKey('iris'), io)),
    partitionCall(io, () => driver.groups.readMany!([partitionAccountKey('iris')], io))]);
  expect(data.commands.filter(command => command instanceof TransactGetItemsCommand)).toHaveLength(1);
  data.afterWrite(() => { throw new Error('synthetic response lost'); });
  await expect(driver.groups.commit([{ key: partitionAccountKey('iris'), expected: 1, next: null }])).rejects.toThrow('PARTITION_STORAGE_UNAVAILABLE');
  expect(data.writes).toHaveLength(1);
});

it.each([false, true])('preserves actual decision consent/replay guards and rejects activation change at %s write/publication', async readOnly => {
  const data = fixture(); const driver = data.driver(); const principal = { kind: 'participant' as const, subject: 'iris' };
  const participantId = partitionMemberId('iris'); const memory = new InMemoryRoomRepository();
  const application = new KnownEnoughApplication({ repository: memory, clock: { now: () => '2026-10-07T22:00:00Z' }, ids: { next: () => 'synthetic' } });
  const definition = KE.DecisionDefinition.parse({ schemaVersion: KE.KE_SCHEMA_VERSION, decisionId: 'decision', frameVersion: 1, semanticVersion: 1,
    contextToken: 'c'.repeat(64), title: 'Garden gathering', objective: 'Choose together', description: '',
    participants: [{ id: participantId, displayName: 'Iris', requiredForApproval: true }], requiredParticipantIds: [participantId], variables: [], rules: [] });
  await application.createDecision({ definition, creatorSubject: 'iris', memberships: [{ subject: 'iris', participantId, active: true }] });
  const initial = await memory.transactionDecision('decision', value => structuredClone(value!));
  const repository = createPartitionDecisionRepository({ ...driver, transport: driver.decisions }).forParticipant(principal);
  await repository.createDecision(initial);
  const stateLocation = where(target.decisionArn, attr('ROOM#decision')); const before = structuredClone(data.cells.get(stateLocation));
  data.beforeWrite(() => { data.cells.get(data.controlLocation)!.payload = { S: JSON.stringify({ ...data.control, active: false }) }; });
  await expect(repository.transactionDecision('decision', record => { if (!readOnly) record!.controlVersion++; return 'public-result'; })).rejects.toThrow('RETRYABLE_SERVER_ERROR');
  expect(data.cells.get(stateLocation)).toEqual(before);
  expect(data.writes).toHaveLength(3); // initial fence publication, creation, then one rejected attempt
  expect(data.writes[1]).toHaveLength(7); // three activation checks, account/group and two decision puts
  expect(data.writes.at(-1)!.filter(item => item.ConditionCheck?.TableName === journalArn)).toHaveLength(1);
  expect(decodeDecisionStateItem(data.cells.get(stateLocation), 'decision').controlVersion).toBe(0);
});

it('stops a stalled atomic activation read at the shared deadline and never sends participant storage', async () => {
  const data = fixture(); data.afterGate(() => new Promise<void>(() => {}));
  await expect(data.driver().groups.read(partitionAccountKey('iris'), partitionIO({ timeoutMs: 10 }))).rejects.toThrow('PARTITION_TIMEOUT');
  expect(data.commands).toHaveLength(1); expect(data.writes).toHaveLength(0);
});

it('rejects malformed cancellation diagnostics as unknown, without treating them as a definite rejection', async () => {
  const data = fixture(); data.beforeWrite(() => { throw Object.assign(new Error('synthetic truncated cancellation'), {
    name: 'TransactionCanceledException', CancellationReasons: [{ Code: 'ConditionalCheckFailed' }] }); });
  await expect(data.driver().groups.commit([{ key: partitionAccountKey('iris'), expected: 1, next: null }])).rejects.toThrow('PARTITION_STORAGE_UNAVAILABLE');
  expect(data.writes).toHaveLength(1);
});

function archiveFixture(data: ReturnType<typeof fixture>, authority: ArchiveAuthority = { kind: 'ORGANIZER', subject: 'iris' }) {
  const entries = data.plan.batches.flat().filter(row => row.key.PK === 'GROUP#garden' || row.key.PK === 'DECISION#decision')
    .map(row => ({ key: row.key, row: row.next! }));
  const archive = preparePartitionArchive(entries, 'garden', 'c'.repeat(40));
  const expected = { sourceSha: 'c'.repeat(40), groupId: 'garden', sourceHeaderRevision: archive.header.revision,
    sourceHash: archive.sourceHash, manifestHash: archive.manifestHash };
  let preserved = 0;
  const recovery = { preserve: async () => { preserved++; return { bytes: archive.manifestBytes, versionId: 'archive-version' }; },
    read: async () => ({ bytes: archive.manifestBytes, versionId: 'archive-version' }) };
  const options = { manifestBytes: archive.manifestBytes, expected, authority, recovery };
  const driver = data.driver(); const ports = driver.archivePorts(options);
  return { archive, expected, options, ports, get preserved() { return preserved; },
    runner: () => createPartitionArchiveRunner(ports, archive.manifestBytes, expected, authority) };
}

it('composes authorized archive recovery with six-item atomic prepare/final writes and retained decisions/children', async () => {
  const data = fixture(); const f = archiveFixture(data); const before = structuredClone(data.cells);
  await f.runner().prepare(); expect(f.preserved).toBe(1); await f.runner().archive();
  expect(data.writes).toHaveLength(2);
  for (const items of data.writes) {
    expect(items).toHaveLength(6);
    expect(items[0]!.ConditionCheck!.TableName).toBe(sourceArn);
    expect(items[1]!.ConditionCheck!.TableName).toBe(journalArn);
    expect(items[2]!.ConditionCheck!.Key).toEqual(attr('MIGRATION#CONTROL'));
    const locations = items.map(item => { const action = item.Put ?? item.ConditionCheck!; return where(action.TableName!, 'Item' in action ? action.Item! : action.Key!); });
    expect(new Set(locations).size).toBe(6);
  }
  expect(JSON.parse(data.cells.get(where(target.partitionArn, attr('GROUP#garden')))!.payload!.S!).kind).toBe('ARCHIVED_GROUP');
  for (const [location, item] of before) if (location !== where(target.partitionArn, attr('GROUP#garden'))) expect(data.cells.get(location)).toEqual(item);
  const count = data.writes.length; await f.runner().prepare(); await f.runner().archive();
  expect(data.writes).toHaveLength(count); expect(f.preserved).toBe(1);
});

it.each(['source', 'control', 'journal'])('refuses %s drift at archive commit and rechecks activation instead of repeating stale writes', async defect => {
  const data = fixture(); const f = archiveFixture(data); await f.runner().prepare();
  data.beforeWrite(() => data.cells.delete(defect === 'source' ? data.sourceLocation : defect === 'control' ? data.controlLocation : data.journalLocation));
  await expect(f.runner().archive()).rejects.toThrow('ARCHIVE_TARGET_INACTIVE');
  expect(data.writes).toHaveLength(2);
  expect(JSON.parse(data.cells.get(where(target.partitionArn, attr('GROUP#garden')))!.payload!.S!).kind).toBe('GROUP');
});

it('reconstructs a complete archive after a lost applied response without rewriting retained state or recovery', async () => {
  const data = fixture(); const f = archiveFixture(data); await f.runner().prepare();
  data.afterWrite(() => { throw new Error('synthetic lost archive response'); });
  await expect(f.runner().archive()).rejects.toThrow('ARCHIVE_COMMIT_UNKNOWN');
  data.afterWrite(() => {}); const before = structuredClone(data.cells); const restarted = archiveFixture(data);
  expect((await restarted.runner().archive()).state).toBe('ARCHIVED');
  expect(data.cells).toEqual(before); expect(data.writes).toHaveLength(2); expect(restarted.preserved).toBe(0);
});

it('keeps organizer and explicitly enabled operator archive authority independent from migration activation', async () => {
  const data = fixture(); const denied = archiveFixture(data, { kind: 'ORGANIZER', subject: 'stranger' });
  await expect(denied.runner().prepare()).rejects.toThrow(); expect(denied.preserved).toBe(0); expect(data.writes).toHaveLength(0);
  const operator = archiveFixture(data, { kind: 'OPERATOR', actorId: 143764700 });
  const key = attr('OPERATIONS#ARCHIVE'); const policy = { schemaVersion: 1, revision: 1, kind: 'ARCHIVE_POLICY', enabled: false, actors: [143764700] };
  data.cells.set(where(target.partitionArn, key), { ...key, revision: { N: '1' }, payload: { S: JSON.stringify(policy) } });
  await expect(operator.runner().prepare()).rejects.toThrow('ARCHIVE_AUTHORITY_DENIED'); expect(operator.preserved).toBe(0);
  data.cells.get(where(target.partitionArn, key))!.payload = { S: JSON.stringify({ ...policy, enabled: true }) };
  await operator.runner().prepare(); await operator.runner().archive();
  expect(data.writes.at(-1)![3]!.ConditionCheck!.Key).toEqual(key);
});


it('release-derived legacy public classification never reopens migrated or future group-generated decisions', () => {
  const f = fixture(); const driver = createPartitionManagedDriver(f.options);
  expect(driver.legacyPublicDecision('decision')).toBe(false);
  expect(driver.legacyPublicDecision('groupdecision-new')).toBe(false);
  expect(driver.legacyPublicDecision('../foreign')).toBe(false);
  expect(driver.legacyPublicDecision('legacy-public-room')).toBe(true);
});
