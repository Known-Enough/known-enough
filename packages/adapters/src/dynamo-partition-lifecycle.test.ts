import { KnownEnough as KE } from '@deal-table/contracts';
import { afterEach, expect, it, vi } from 'vitest';
import { DynamoDBClient, GetItemCommand, BatchGetItemCommand, QueryCommand, TransactGetItemsCommand, TransactWriteItemsCommand,
  type AttributeValue, type TransactWriteItem } from '@aws-sdk/client-dynamodb';
import { createPartitionManagedDriver, type PartitionManagedOptions } from './partition-managed.ts';
import { createDynamoPartitionLifecycle, LIFECYCLE_RESOURCES as r } from './dynamo-partition-lifecycle.ts';
import { decodeDecisionStateItem, encodeDecisionStateItem, encodeGuardItem } from './dynamodb-codec.ts';
import { ErasingAccount } from './partition-erasure-contract.ts';
import { partitionDynamoWrites, checkPartitionRow, PartitionRowSchema, createPartitionedGroupRepository } from './partitioned-group-repository.ts';
import { partitionMemberId } from './partition-group-session.ts';
import { lifecycleFixture, sourceSha, now, policy, stamp, principal, signingKey, subject, hash } from './test-support/partition-lifecycle-fixture.ts';
import { MigrationControlSchema, MigrationJournalSchema } from './partition-migration-runner.ts';
import { preparePartitionArchive } from './partition-archive.ts';
import { type DynamoLifecycleOptions } from './dynamo-partition-lifecycle.ts';
import { lifecycleHash } from './partition-lifecycle.ts';
type Item = Record<string, AttributeValue>;
const attrs = (PK: string, SK = 'STATE'): Item => ({ PK: { S: PK }, SK: { S: SK } });
const where = (table: string, key: Item) => `${table}/${key.PK!.S}/${key.SK!.S}`;
const envelope = <T extends { revision: number }>(PK: string, SK: string, row: T): Item => ({ ...attrs(PK, SK), revision: { N: String(row.revision) }, payload: { S: JSON.stringify(row) } });
const sourceArn = 'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughGroupsStage';
afterEach(() => vi.restoreAllMocks());
async function fixture(replays = 2) {
  const initial = await lifecycleFixture(replays); const m = initial.migration;
  const options: PartitionManagedOptions = { manifestBytes: m.manifestBytes, expected: { sourceSha, sourceRevision: 12,
    sourceHash: m.sourceHash, manifestHash: m.manifestHash }, manifestVersion: 'immutable-v1', verifiedTarget: { account: r.account, region: r.region }, cursorKey: Buffer.alloc(32, 5) };
  const marker = { schemaVersion: 1, kind: 'PARTITION_MIGRATION', phase: 'ACTIVE', planHash: m.planHash, manifestHash: m.manifestHash,
    manifestVersion: 'immutable-v1', sourceSha, sourceRevision: 12, sourceHash: m.sourceHash, account: r.account, region: r.region, table: 'KnownEnoughPartitions' };
  const cells = new Map<string, Item>(); const sourceLocation = where(sourceArn, attrs('NP#GROUPS'));
  cells.set(sourceLocation, { ...attrs('NP#GROUPS'), version: { N: '14' }, payload: { S: JSON.stringify(marker) } });
  cells.set(where(r.partitions, attrs('MIGRATION#CONTROL')), envelope('MIGRATION#CONTROL', 'STATE', MigrationControlSchema.parse({ schemaVersion: 1, revision: 3,
    account: r.account, region: r.region, table: 'KnownEnoughPartitions', active: true, planHash: m.planHash })));
  cells.set(where(r.journal, attrs(`PARTITION#${m.planHash}`, 'JOURNAL')), envelope(`PARTITION#${m.planHash}`, 'JOURNAL', MigrationJournalSchema.parse({
    schemaVersion: 1, revision: m.batches.length + 1, actorId: 143764700, planHash: m.planHash, manifestHash: m.manifestHash,
    manifestVersion: 'immutable-v1', sourceSha, sourceRevision: 12, sourceHash: m.sourceHash, rowCount: m.rowCount,
    nextBatch: m.batches.length, completedRows: m.rowCount, state: 'COPIED' })));
  for (const entry of m.batches.flat()) {
    const value = partitionDynamoWrites('KnownEnoughPartitions', [entry])[0]!.Put!.Item!; cells.set(where(r.partitions, value), value);
  }
  const stateLocation = where(r.decisions, attrs('ROOM#decision')); const guardLocation = where(r.decisions, attrs('ROOM#decision', 'GUARD'));
  cells.set(stateLocation, encodeDecisionStateItem(initial.record)); cells.set(guardLocation, encodeGuardItem('decision', initial.guard));
  for (let n = 0; n < replays; n++) {
    const key = attrs('ROOM#decision', `REPLAY#${hash(String(n))}`); cells.set(where(r.decisions, key), { ...key,
      schemaVersion: { N: '1' }, incarnation: { S: initial.guard.incarnation }, keyHash: { S: hash(String(n)) }, bodyHash: { S: hash('body') },
      result: { S: 'iris-private-cached-result' } });
  }
  const policyLocation = where(r.journal, attrs('OPERATIONS#RETENTION'));
  cells.set(policyLocation, envelope('OPERATIONS#RETENTION', 'STATE', policy));
  cells.set(where(r.journal, attrs('RETENTION#iris', 'STAMP')), envelope('RETENTION#iris', 'STAMP', stamp));
  const writes: TransactWriteItem[][] = []; const commands: unknown[] = []; let before: (items: TransactWriteItem[]) => void = () => {}; let after: (items: TransactWriteItem[]) => void = () => {};
  let queryPageLimit = 80; let foreign = false; let malformedCursor = false; let journalUnavailable = false;
  const send = vi.spyOn(DynamoDBClient.prototype, 'send').mockImplementation(async function(this: DynamoDBClient, command, request) {
    expect(await this.config.region()).toBe('us-east-1'); expect(await this.config.maxAttempts()).toBe(1);
    const endpoint = await this.config.endpoint!(); expect(`${endpoint.protocol}//${endpoint.hostname}`).toBe('https://dynamodb.us-east-1.amazonaws.com');
    expect(request).toHaveProperty('abortSignal'); commands.push(command);
    if (command instanceof GetItemCommand) { expect(command.input.ConsistentRead).toBe(true);
      if (journalUnavailable && command.input.Key?.PK?.S?.startsWith('LIFECYCLE#') && command.input.Key?.SK?.S === 'JOURNAL') throw new Error('synthetic journal read unavailable');
      return { Item: structuredClone(cells.get(where(command.input.TableName === 'KnownEnoughPartitions' ? r.partitions : command.input.TableName!, command.input.Key!))) }; }
    if (command instanceof BatchGetItemCommand) {
      return { Responses: Object.fromEntries(Object.entries(command.input.RequestItems!).map(([table, value]) => [table,
        value.Keys!.flatMap(key => { const item = cells.get(where(table === 'KnownEnoughPartitions' ? r.partitions : table, key)); return item ? [structuredClone(item)] : []; })])) };
    }
    if (command instanceof TransactGetItemsCommand) return { Responses: command.input.TransactItems!.map(entry => ({
      Item: structuredClone(cells.get(where(entry.Get!.TableName!, entry.Get!.Key!))) })) };
    if (command instanceof QueryCommand) {
      expect(command.input.ConsistentRead).toBe(true); expect(command.input.KeyConditionExpression).toBe('PK = :pk');
      const pk = command.input.ExpressionAttributeValues![':pk']!.S!;
      const all = [...cells.entries()].filter(([name, item]) => name.startsWith(command.input.TableName! + '/') && item.PK!.S === pk)
        .map(([, item]) => item).sort((a, b) => a.SK!.S!.localeCompare(b.SK!.S!));
      const last = command.input.ExclusiveStartKey?.SK?.S;
      const remaining = last ? all.filter(item => item.SK!.S!.localeCompare(last) > 0) : all;
      const selected = remaining.slice(0, Math.min(queryPageLimit, command.input.Limit!));
      const cursor = remaining.length > selected.length ? attrs(pk, selected.at(-1)!.SK!.S!) : undefined;
      return { Items: selected.map(item => ({ ...structuredClone(item), ...(foreign ? { PK: { S: 'ROOM#foreign' } } : {}) })),
        ...(malformedCursor ? { LastEvaluatedKey: attrs('FOREIGN', 'CURSOR') } : cursor ? { LastEvaluatedKey: cursor } : {}) };
    }
    if (!(command instanceof TransactWriteItemsCommand)) throw new Error('unexpected synthetic command');
    const items = command.input.TransactItems!; writes.push(structuredClone(items)); before(items);
    const matches = items.map(entry => {
      const action = entry.Put ?? entry.Delete ?? entry.ConditionCheck!; const key = entry.Put?.Item ?? ('Key' in action ? action.Key! : {});
      const prior = cells.get(where(action.TableName!, key));
      if (action.ConditionExpression === 'attribute_not_exists(PK)') return !prior;
      return action.ConditionExpression!.split(' AND ').every(expression => {
        const [left, right] = expression.split('=').map(part => part.trim());
        return lifecycleHash(prior?.[action.ExpressionAttributeNames![left!]!]) === lifecycleHash(action.ExpressionAttributeValues![right!]);
      });
    });
    if (matches.some(value => !value)) throw Object.assign(new Error('synthetic conditional rejection'), { name: 'TransactionCanceledException',
      CancellationReasons: matches.map(value => ({ Code: value ? 'None' : 'ConditionalCheckFailed' })) });
    for (const entry of items) {
      if (entry.Put) cells.set(where(entry.Put.TableName!, entry.Put.Item!), structuredClone(entry.Put.Item!));
      if (entry.Delete) cells.delete(where(entry.Delete.TableName!, entry.Delete.Key!));
    }
    after(items); return {};
  });
  const driver = () => createPartitionManagedDriver(options);
  const lifecycle = (extra: Partial<Omit<DynamoLifecycleOptions, 'activation' | 'verifiedTarget'>> = {}) => driver().lifecycle({ sourceSha, signingKey, clock: () => now, ...extra });
  const get = (table: string, PK: string, SK = 'STATE') => cells.get(where(table, attrs(PK, SK)));
  const parsed = (table: string, PK: string, SK = 'STATE') => JSON.parse(get(table, PK, SK)!.payload!.S!);
  const setRow = <T extends { revision: number }>(table: string, PK: string, SK: string, row: T) => cells.set(where(table, attrs(PK, SK)), envelope(PK, SK, row));
  const journalPut = (items: TransactWriteItem[]) => items.find(entry => entry.Put?.Item?.SK?.S === 'JOURNAL' && entry.Put.Item.PK?.S?.startsWith('LIFECYCLE#'))?.Put?.Item;
  async function authorized(scope: Parameters<ReturnType<typeof lifecycle>['prepare']>[0], opId = 'erase-op') {
    const service = lifecycle(); const prepared = await service.prepare(scope, opId);
    for (const who of scope.kind === 'OWNER' || scope.kind === 'ACCOUNT' ? [subject] : [subject, 'omar']) {
      await service.consent(prepared.bytes, prepared, principal(who), new Date(now + 3_600_000).toISOString());
    }
    return { service, prepared, runner: () => lifecycle().runner(prepared.bytes, prepared) };
  }
  return { initial, cells, writes, commands, send, lifecycle, driver, get, parsed, setRow, sourceLocation, stateLocation, guardLocation, policyLocation,
    before: (work: typeof before) => { before = work; }, after: (work: typeof after) => { after = work; }, page: (limit: number) => { queryPageLimit = limit; },
    journalUnavailable: (value: boolean) => { journalUnavailable = value; }, foreign: () => { foreign = true; }, malformed: () => { malformedCursor = true; }, journalPut, authorized };
}
it('constructs inactive pinned clients and rejects a foreign source/target/key before native I/O', async () => {
  const f = await fixture(); f.lifecycle(); expect(f.send).not.toHaveBeenCalled();
  for (const patch of [{ sourceSha: '0'.repeat(40) }, { signingKey: Buffer.alloc(1) }, { verifiedTarget: { account: '000000000000', region: 'us-east-1' } }]) {
    expect(() => createDynamoPartitionLifecycle({ sourceSha, signingKey, verifiedTarget: { account: r.account, region: r.region },
      activation: { read: async () => {}, write: async () => {} }, ...patch })).toThrow('LIFECYCLE_INVALID');
  }
  expect(f.send).not.toHaveBeenCalled();
});
it('uses complete paginated strong inventory and atomically rechecks activation/policy/source before owner export', async () => {
  const f = await fixture(); f.page(2); const result = await f.lifecycle().exportOwn(principal());
  expect(JSON.stringify(result)).toContain('iris-private-condition'); expect(JSON.stringify(result)).not.toContain('omar-private-condition');
  expect(f.commands.filter(value => value instanceof QueryCommand).length).toBeGreaterThan(3);
  const barrier = f.writes.at(-1)!; expect(barrier.every(value => value.ConditionCheck)).toBe(true);
  expect(barrier[0]!.ConditionCheck!.TableName).toBe(sourceArn); expect(barrier[1]!.ConditionCheck!.Key!.PK!.S).toBe('MIGRATION#CONTROL');
  expect(barrier[2]!.ConditionCheck!.Key!.PK!.S).toMatch(/^PARTITION#/);
});
it.each(['foreign', 'cursor', 'missingStamp', 'expiredStamp', 'realPolicy'])( 'denies incomplete/unknown/native retention %s before private export', async defect => {
  const f = await fixture();
  if (defect === 'foreign') f.foreign(); if (defect === 'cursor') f.malformed();
  if (defect === 'missingStamp') f.cells.delete(where(r.journal, attrs('RETENTION#iris', 'STAMP')));
  if (defect === 'expiredStamp') f.setRow(r.journal, 'RETENTION#iris', 'STAMP', { ...stamp, createdAt: '2026-10-01T00:00:00Z', lastActivityAt: '2026-10-01T00:00:00Z' });
  if (defect === 'realPolicy') f.setRow(r.journal, 'OPERATIONS#RETENTION', 'STATE', { ...policy, dataClass: 'REAL_PERSON' });
  await expect(f.lifecycle().exportOwn(principal())).rejects.toThrow(/LIFECYCLE_/);
  expect(f.writes).toHaveLength(0);
});
it('denies a changed activation marker before any owned-data read or plan/erasure', async () => {
  const f = await fixture(); f.cells.get(f.sourceLocation)!.version = { N: '13' };
  await expect(f.lifecycle().prepare({ kind: 'OWNER', subject, decisionId: 'decision' }, 'wrong-source')).rejects.toThrow('RETRYABLE_SERVER_ERROR');
  expect(f.commands).toHaveLength(1); expect(f.writes).toHaveLength(0);
});
it('preserves/readbacks a sealed ID/hash plan before PREPARED, resumes native owner erasure and retains another private owner', async () => {
  const f = await fixture(35); const run = await f.authorized({ kind: 'OWNER', subject, decisionId: 'decision' });
  expect((await run.runner().advance()).state).toBe('PREPARED');
  const plan = f.get(r.journal, 'LIFECYCLE#erase-op', 'PLAN')!;
  expect(plan.sealed!.S).not.toMatch(/private-condition|cached-result|emailHash|displayName/);
  expect((await run.runner().advance()).nextStep).toBe(1);
  const state = decodeDecisionStateItem(f.cells.get(f.stateLocation), 'decision');
  expect(state.owners.find(owner => owner.participantId === partitionMemberId(subject))!.draft).toBeNull();
  expect(state.owners.find(owner => owner.participantId === partitionMemberId('omar'))!.draft!.sourceSummary).toBe('omar-private-condition');
  expect(state.job).toBeNull(); expect(f.cells.get(f.guardLocation)!.incarnation!.S).toMatch(/^erase-/);
  let result = await run.runner().advance(); while (result.state !== 'ERASED') result = await run.runner().advance();
  expect([...f.cells.values()].some(value => value.SK?.S?.startsWith('REPLAY#'))).toBe(false);
  const count = f.writes.length; expect((await run.runner().advance()).state).toBe('ERASED'); expect(f.writes).toHaveLength(count);
});
it('requires distinct participant grants, not an organizer/operator claim, for shared-decision erasure', async () => {
  const f = await fixture(); const service = f.lifecycle(); const plan = await service.prepare({ kind: 'DECISION', decisionId: 'decision' }, 'shared');
  await service.consent(plan.bytes, plan, principal(), new Date(now + 3_600_000).toISOString());
  await expect(service.runner(plan.bytes, plan).advance()).rejects.toThrow('LIFECYCLE_AUTHORITY_DENIED');
  await expect(service.consent(plan.bytes, plan, { kind: 'service', subject: 'operator', roomIds: [] }, new Date(now + 3_600_000).toISOString())).rejects.toThrow('LIFECYCLE_AUTHORITY_DENIED');
  await expect(service.consent(plan.bytes, plan, principal('stranger'), new Date(now + 3_600_000).toISOString())).rejects.toThrow('LIFECYCLE_AUTHORITY_DENIED');
  expect(f.cells.has(f.stateLocation)).toBe(true);
  await service.consent(plan.bytes, plan, principal('omar'), new Date(now + 3_600_000).toISOString());
  await service.runner(plan.bytes, plan).advance(); await service.runner(plan.bytes, plan).advance();
  expect(f.cells.has(f.stateLocation)).toBe(false); expect(f.cells.has(f.guardLocation)).toBe(true);
});
it('rechecks revocation in the deletion transaction and preserves journal/source on conditional rejection', async () => {
  const f = await fixture(); const run = await f.authorized({ kind: 'OWNER', subject, decisionId: 'decision' }); await run.runner().advance();
  let changed = false; f.before(items => {
    if (changed || !f.journalPut(items)) return; changed = true;
    const grant = f.parsed(r.journal, 'CONSENT#erase-op', 'SUBJECT#iris'); grant.revoked = true; grant.revision++;
    f.setRow(r.journal, 'CONSENT#erase-op', 'SUBJECT#iris', grant);
  });
  await expect(run.runner().advance()).rejects.toThrow('LIFECYCLE_CONFLICT');
  expect(f.parsed(r.journal, 'LIFECYCLE#erase-op', 'JOURNAL').state).toBe('PREPARED');
  expect(decodeDecisionStateItem(f.cells.get(f.stateLocation), 'decision').owners[0]!.draft).not.toBeNull();
});
it('reconciles a lost committed journal acknowledgement using exact native readback without duplicating erasure', async () => {
  const f = await fixture(); const run = await f.authorized({ kind: 'OWNER', subject, decisionId: 'decision' }); await run.runner().advance();
  let lost = false; f.after(items => { const j = f.journalPut(items); if (j && !lost && JSON.parse(j.payload!.S!).nextStep === 1) { lost = true; throw new Error('synthetic lost acknowledgement'); } });
  expect((await run.runner().advance()).nextStep).toBe(1); expect(lost).toBe(true);
  expect((await run.runner().advance()).state).toBe('ERASED');
  expect(f.writes.filter(items => items.some(entry => entry.Put?.Item?.PK?.S === 'ROOM#decision' && entry.Put.Item.SK?.S === 'STATE'))).toHaveLength(1);
});
it('keeps half-erased accounts inaccessible across restart and allows self revocation while frozen', async () => {
  const f = await fixture(); const run = await f.authorized({ kind: 'ACCOUNT', subject }); await run.runner().advance(); await run.runner().advance();
  const accountKey = { PK: 'ACCOUNT#iris', SK: 'STATE' }; const frozen = f.parsed(r.partitions, accountKey.PK);
  expect(ErasingAccount.parse(frozen).opId).toBe('erase-op'); expect(JSON.stringify(frozen)).not.toMatch(/profile|emailHash|displayName/);
  expect(() => checkPartitionRow(frozen, accountKey)).toThrow('PARTITION_STALE');
  await run.service.consent(run.prepared.bytes, run.prepared, principal(), new Date(now + 3_600_000).toISOString(), true);
  await expect(run.runner().advance()).rejects.toThrow('LIFECYCLE_AUTHORITY_DENIED');
  await run.service.consent(run.prepared.bytes, run.prepared, principal(), new Date(now + 3_600_000).toISOString());
  let result = await run.runner().advance(); while (result.state !== 'ERASED') result = await run.runner().advance();
  const account = checkPartitionRow(f.parsed(r.partitions, accountKey.PK), accountKey);
  expect(account.kind).toBe('ACCOUNT'); if (account.kind === 'ACCOUNT') { expect(account.value.status).toBe('DISABLED'); expect(account.value.emailHash).toBe('0'.repeat(64)); }
  expect(f.get(r.partitions, 'GROUP#garden')).toBeDefined(); expect(decodeDecisionStateItem(f.cells.get(f.stateLocation), 'decision').owners[1]!.draft).not.toBeNull();
  expect(f.get(r.partitions, `EMAIL#${hash(subject)}`, 'CLAIM')).toBeDefined();
});
it('archives the group root, deletes only consented child/decision content and retains immutable claims/other accounts', async () => {
  const f = await fixture(); const run = await f.authorized({ kind: 'GROUP', groupId: 'garden' });
  let result = await run.runner().advance(); while (result.state !== 'ERASED') result = await run.runner().advance();
  expect(f.parsed(r.partitions, 'GROUP#garden').kind).toBe('ARCHIVED_GROUP'); expect(f.cells.has(f.stateLocation)).toBe(false);
  expect(f.get(r.partitions, 'GROUP#garden', 'BINDING#decision')).toBeUndefined(); expect(f.get(r.partitions, 'DECISION#decision', 'GROUP')).toBeDefined();
  expect(f.parsed(r.partitions, 'ACCOUNT#omar').value.displayName).toBe('omar-synthetic-profile');
});
it('denies guard/replay changes between preparation and erasure, retaining source until a fresh consented plan', async () => {
  const f = await fixture(); const run = await f.authorized({ kind: 'OWNER', subject, decisionId: 'decision' }); await run.runner().advance();
  f.cells.get(f.guardLocation)!.version = { N: '2' };
  await expect(run.runner().advance()).rejects.toThrow('LIFECYCLE_SOURCE_CHANGED');
  expect(f.parsed(r.journal, 'LIFECYCLE#erase-op', 'JOURNAL').state).toBe('PREPARED');
  expect(decodeDecisionStateItem(f.cells.get(f.stateLocation), 'decision').owners[0]!.draft).not.toBeNull();
});
it('joins a discovery revision advance so a newly created group cannot escape a prepared account plan', async () => {
  const f = await fixture(); const run = await f.authorized({ kind: 'ACCOUNT', subject }); await run.runner().advance();
  const repository = createPartitionedGroupRepository(f.driver().groups);
  await repository.transaction({ accountSubjects: [subject], groupId: 'new-group' }, state => state.groups.push({ id: 'new-group', name: 'New',
    organizer: subject, version: 1, members: [subject], drafts: [], invitations: [], decisions: [] }));
  await expect(run.runner().advance()).rejects.toThrow('LIFECYCLE_SOURCE_CHANGED');
  expect(f.parsed(r.partitions, 'ACCOUNT#iris').kind).toBe('ACCOUNT'); expect(f.get(r.partitions, 'MEMBER#iris', 'GROUP#new-group')).toBeDefined();
});

function archived(f: Awaited<ReturnType<typeof fixture>>) {
  const entries = f.initial.data.entries.filter(entry => ['GROUP', 'DRAFT', 'BINDING'].includes(entry.row.kind)
    || entry.row.kind === 'DIRECTORY' && entry.row.value.type === 'DECISION');
  const plan = preparePartitionArchive(entries, 'garden', sourceSha); const expected = { groupId: 'garden', sourceSha,
    sourceHeaderRevision: plan.header.revision, sourceHash: plan.sourceHash, manifestHash: plan.manifestHash };
  f.setRow(r.partitions, 'GROUP#garden', 'STATE', { schemaVersion: 1, revision: 2, kind: 'ARCHIVED_GROUP', groupId: 'garden',
    organizer: subject, groupVersion: 2, sourceSha, sourceHash: expected.sourceHash, manifestHash: expected.manifestHash,
    manifestVersion: 'archive-v1', archivedAt: new Date(now).toISOString() });
  // Stored markers use the archive schema's canonical field order.
  const raw = f.parsed(r.partitions, 'GROUP#garden');
  f.setRow(r.partitions, 'GROUP#garden', 'STATE', raw);
  return { manifestBytes: plan.manifestBytes, expected, manifestVersion: 'archive-v1' };
}
it('exports/erases owned private history in archived groups while keeping other owners and the archive closed', async () => {
  const f = await fixture(); archived(f);
  expect(JSON.stringify(await f.lifecycle().exportOwn(principal()))).toContain('iris-private-condition');
  const run = await f.authorized({ kind: 'ACCOUNT', subject }); let result = await run.runner().advance();
  while (result.state !== 'ERASED') result = await run.runner().advance();
  expect(f.parsed(r.partitions, 'GROUP#garden').kind).toBe('ARCHIVED_GROUP');
  expect(decodeDecisionStateItem(f.cells.get(f.stateLocation), 'decision').owners.find(owner => owner.participantId === partitionMemberId('omar'))!.draft).not.toBeNull();
});
it('requires original immutable archive roster/hash/version for full archived-group erasure', async () => {
  const f = await fixture(); const recovery = archived(f);
  await expect(f.lifecycle().prepare({ kind: 'GROUP', groupId: 'garden' }, 'old-archive')).rejects.toThrow('LIFECYCLE_AUTHORITY_DENIED');
  await expect(f.lifecycle({ archiveRecoveries: [{ ...recovery, manifestVersion: 'wrong-version' }] }).prepare({ kind: 'GROUP', groupId: 'garden' }, 'bad-archive')).rejects.toThrow('LIFECYCLE_SOURCE_CHANGED');
  const service = f.lifecycle({ archiveRecoveries: [recovery] }); const plan = await service.prepare({ kind: 'GROUP', groupId: 'garden' }, 'old-archive');
  for (const who of [subject, 'omar']) await service.consent(plan.bytes, plan, principal(who), new Date(now + 3_600_000).toISOString());
  let result = await service.runner(plan.bytes, plan).advance(); while (result.state !== 'ERASED') result = await service.runner(plan.bytes, plan).advance();
  expect(f.cells.has(f.stateLocation)).toBe(false); expect(f.parsed(r.partitions, 'GROUP#garden').manifestVersion).toBe('ERASURE-old-archive');
  expect(recovery.manifestBytes.toString()).toContain('Synthetic garden');
});
it('logical job-use gate requires current retained approved owner without returning private context', async () => {
  const f = await fixture(); const gate = await f.lifecycle().assertRetained(principal());
  expect(gate).toEqual({ subject, policyRevision: 1, expiresAt: '2026-10-09T00:00:00.000Z' });
  const account = f.parsed(r.partitions, 'ACCOUNT#iris'); account.value.status = 'DISABLED'; account.revision++;
  f.setRow(r.partitions, 'ACCOUNT#iris', 'STATE', account);
  await expect(f.lifecycle().assertRetained(principal())).rejects.toThrow('LIFECYCLE_AUTHORITY_DENIED');
});
it('denies request exhaustion and aborts stalled work without publishing a partial export or mutation', async () => {
  const f = await fixture(); await expect(f.lifecycle({ limits: { maxRequests: 2 } }).exportOwn(principal())).rejects.toThrow('PARTITION_REQUEST_LIMIT');
  expect(f.writes).toHaveLength(0);
  f.send.mockImplementationOnce(async () => new Promise(() => {}));
  await expect(f.lifecycle({ limits: { timeoutMs: 10 } }).exportOwn(principal())).rejects.toThrow('PARTITION_TIMEOUT');
  expect(f.writes).toHaveLength(0);
});
it('rejects a revoked policy at the final export barrier and withholds all owned data', async () => {
  const f = await fixture(); let changed = false;
  f.before(() => { if (!changed) { changed = true; f.setRow(r.journal, 'OPERATIONS#RETENTION', 'STATE', { ...policy, revision: 2, enabled: false }); } });
  await expect(f.lifecycle().exportOwn(principal())).rejects.toThrow('synthetic conditional rejection');
});
it('preserves newer-incarnation replay receipts generated after an owner erasure', async () => {
  const f = await fixture(); const run = await f.authorized({ kind: 'OWNER', subject, decisionId: 'decision' });
  await run.runner().advance(); await run.runner().advance();
  const location = where(r.decisions, attrs('ROOM#decision', `REPLAY#${hash('0')}`)); const replay = f.cells.get(location)!;
  replay.incarnation = { ...f.cells.get(f.guardLocation)!.incarnation! }; replay.result = { S: 'new-unrelated-owned-result' };
  expect((await run.runner().advance()).state).toBe('ERASED'); expect(f.cells.get(location)!.result!.S).toBe('new-unrelated-owned-result');
  expect([...f.cells.values()].some(item => item.result?.S === 'iris-private-cached-result')).toBe(false);
});
it('redacts the erased account profile from retained group drafts without deleting other participant names or public facts', async () => {
  const f = await fixture(); const header = f.parsed(r.partitions, 'GROUP#garden'); header.value.draftIds = ['saved-draft'];
  f.setRow(r.partitions, 'GROUP#garden', 'STATE', header);
  const draft = PartitionRowSchema.parse({ schemaVersion: 1, revision: 1, kind: 'DRAFT', value: { id: 'saved-draft', bodyHash: hash('saved'),
    revision: 1, groupVersion: 1, frame: KE.PublicDecisionFrame.parse(f.initial.record.definition), clarificationQuestions: [], createdDecisionId: null } });
  f.setRow(r.partitions, 'GROUP#garden', 'DRAFT#saved-draft', draft);
  const run = await f.authorized({ kind: 'ACCOUNT', subject }); let result = await run.runner().advance();
  while (result.state !== 'ERASED') result = await run.runner().advance();
  const frame = f.parsed(r.partitions, 'GROUP#garden', 'DRAFT#saved-draft').value.frame;
  expect(frame.participants.find((value: { id: string }) => value.id === partitionMemberId(subject)).displayName).toBe('Erased participant');
  expect(frame.participants.find((value: { id: string }) => value.id === partitionMemberId('omar')).displayName).toBe('omar-synthetic-profile');
  expect(frame.title).toBe('Garden gathering');
});
it('reports owned coarse progress after revocation without grant/refusal/private content and denies another account', async () => {
  const f = await fixture(); const run = await f.authorized({ kind: 'OWNER', subject, decisionId: 'decision' }); await run.runner().advance();
  await run.service.consent(run.prepared.bytes, run.prepared, principal(), new Date(now + 3_600_000).toISOString(), true);
  const status = await run.service.status(run.prepared.bytes, run.prepared, principal());
  expect(status).toEqual({ state: 'PREPARED', nextStep: 0, totalSteps: 2 });
  await expect(run.service.status(run.prepared.bytes, run.prepared, principal('omar'))).rejects.toThrow('LIFECYCLE_AUTHORITY_DENIED');
});
it('keeps an uncertain plan-preservation acknowledgement separate from any executed erasure', async () => {
  const f = await fixture(); const run = await f.authorized({ kind: 'OWNER', subject, decisionId: 'decision' }); let lost = false;
  f.after(items => { if (!lost && items.some(entry => entry.Put?.Item?.SK?.S === 'PLAN')) { lost = true; throw new Error('synthetic lost preparation acknowledgement'); } });
  await expect(run.runner().advance()).rejects.toThrow('synthetic lost preparation acknowledgement');
  expect((await run.service.status(run.prepared.bytes, run.prepared, principal())).state).toBe('NOT_PREPARED');
  expect(decodeDecisionStateItem(f.cells.get(f.stateLocation), 'decision').owners[0]!.draft).not.toBeNull();
  expect((await run.runner().advance()).state).toBe('PREPARED');
});
it('preserves uncertain erasure as UNKNOWN until durable progress can actually be read on resume', async () => {
  const f = await fixture(); const run = await f.authorized({ kind: 'OWNER', subject, decisionId: 'decision' }); await run.runner().advance();
  let lost = false; f.after(items => { const j = f.journalPut(items); if (j && !lost) { lost = true; f.journalUnavailable(true); throw new Error('synthetic lost acknowledgement'); } });
  await expect(run.runner().advance()).rejects.toThrow('LIFECYCLE_COMMIT_UNKNOWN');
  const count = f.writes.length; f.journalUnavailable(false);
  expect((await run.service.status(run.prepared.bytes, run.prepared, principal())).nextStep).toBe(1);
  expect((await run.runner().advance()).state).toBe('ERASED'); expect(f.writes.length).toBe(count + 1);
});
it('allows remaining account export/erasure after a shared decision was completely erased without resurrecting its identity', async () => {
  const f = await fixture(); const run = await f.authorized({ kind: 'DECISION', decisionId: 'decision' });
  let result = await run.runner().advance(); while (result.state !== 'ERASED') result = await run.runner().advance();
  expect((await f.lifecycle().exportOwn(principal())).decisions).toEqual([]);
  const account = await f.authorized({ kind: 'ACCOUNT', subject }, 'erase-account');
  result = await account.runner().advance(); while (result.state !== 'ERASED') result = await account.runner().advance();
  expect(f.get(r.decisions, 'ROOM#decision')).toBeUndefined(); expect(f.get(r.decisions, 'ROOM#decision', 'GUARD')).toBeDefined();
});
it('guards a large retained draft collection using its actual header revision instead of exceeding the atomic item limit', async () => {
  const f = await fixture(); const header = f.parsed(r.partitions, 'GROUP#garden');
  header.value.draftIds = Array.from({ length: 64 }, (_, n) => `draft-${n}`); f.setRow(r.partitions, 'GROUP#garden', 'STATE', header);
  for (const id of header.value.draftIds) f.setRow(r.partitions, 'GROUP#garden', `DRAFT#${id}`, PartitionRowSchema.parse({
    schemaVersion: 1, revision: 1, kind: 'DRAFT', value: { id, bodyHash: hash(id), revision: 1, groupVersion: 1,
      frame: KE.PublicDecisionFrame.parse(f.initial.record.definition), clarificationQuestions: [], createdDecisionId: null } }));
  const plan = await f.lifecycle().prepare({ kind: 'ACCOUNT', subject }, 'many-drafts');
  expect(plan.bytes.length).toBeLessThan(300000); expect(f.writes.at(-1)!.length).toBeLessThan(20);
});
it('captures caller configuration and recovery bytes before asynchronous I/O', async () => {
  const f = await fixture(); const key = Buffer.from(signingKey); const source = { sourceSha, signingKey: key, limits: { maxRequests: 64 }, clock: () => now };
  const service = f.driver().lifecycle(source); key.fill(9); source.sourceSha = 'b'.repeat(40); source.limits.maxRequests = 1;
  const scope = { kind: 'OWNER' as const, subject, decisionId: 'decision' }; const pending = service.prepare(scope, 'captured');
  scope.subject = 'unrelated'; scope.decisionId = 'unrelated'; const plan = await pending;
  const expected = { opId: plan.opId, planHash: plan.planHash };
  const bytes = Buffer.from(plan.bytes); const runner = service.runner(bytes, expected); bytes.fill(0);
  const granting = service.consent(plan.bytes, expected, principal(), new Date(now + 3_600_000).toISOString());
  expected.planHash = 'f'.repeat(64); expected.opId = 'unrelated'; await granting;
  expect((await runner.advance()).state).toBe('PREPARED');
  const inspecting = service.status(plan.bytes, plan, principal()); plan.planHash = 'f'.repeat(64);
  expect((await inspecting).state).toBe('PREPARED');
});
