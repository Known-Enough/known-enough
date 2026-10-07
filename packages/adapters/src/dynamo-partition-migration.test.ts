import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { DynamoDBClient, GetItemCommand, BatchGetItemCommand, TransactWriteItemsCommand,
  type TransactWriteItem } from '@aws-sdk/client-dynamodb';
import { Groups } from '@deal-table/contracts';
import { preparePartitionMigration } from './partition-migration.ts';
import { createDynamoPartitionMigrationPorts, PARTITION_MIGRATION_RESOURCES as resource } from './dynamo-partition-migration.ts';
import { createPartitionMigrationRunner, type MigrationAtomicCommit, type MigrationJournal, type MigrationControl,
  type MigrationRunnerPorts } from './partition-migration-runner.ts';
import { partitionDynamoWrites, type PartitionMutation } from './partitioned-group-repository.ts';

const sourceSha = 'a'.repeat(40);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const attr = (PK: string, SK: string) => ({ PK: { S: PK }, SK: { S: SK } });
afterEach(() => vi.restoreAllMocks());
function input() {
  const state: Groups.GroupState = { accounts: [{ subject: 'iris', emailHash: hash('iris'), displayName: 'Iris', status: 'APPROVED', version: 4 }],
    groups: [{ id: 'garden', name: 'Garden', organizer: 'iris', version: 3, members: ['iris'], drafts: [], invitations: [],
      decisions: Array.from({ length: 64 }, (_, n) => ({ id: `decision-${n}`, version: 2 })) }] };
  const bytes = Buffer.from(JSON.stringify(state)); const plan = preparePartitionMigration(bytes, 12, sourceSha);
  const expected = { sourceSha, sourceRevision: 12, sourceHash: plan.sourceHash, manifestHash: plan.manifestHash };
  const control: MigrationControl = { schemaVersion: 1, account: resource.account, region: resource.region,
    table: 'KnownEnoughPartitions', revision: 0, active: false, planHash: null };
  const claimed = { ...control, revision: 1, planHash: plan.planHash };
  const journal: MigrationJournal = { schemaVersion: 1, actorId: 143764700, planHash: plan.planHash,
    manifestHash: plan.manifestHash, manifestVersion: 'immutable-version-1', sourceSha, sourceRevision: 12,
    sourceHash: plan.sourceHash, rowCount: plan.rowCount, revision: 1, nextBatch: 0, completedRows: 0, state: 'PREPARED' };
  const source = { table: 'KnownEnoughGroupsStage' as const, key: { PK: 'NP#GROUPS' as const, SK: 'STATE' as const }, revision: 12, payload: bytes };
  const prepare: MigrationAtomicCommit = { source, control: { expected: control, next: claimed }, journal: { expectedRevision: 0, next: journal }, rows: [] };
  const step: MigrationAtomicCommit = { source, control: { expected: claimed, next: null }, journal: { expectedRevision: 1,
    next: { ...journal, revision: 2, nextBatch: 1, completedRows: plan.batches[0]!.length, state: 'APPLYING' } }, rows: plan.batches[0]! };
  const manifests: MigrationRunnerPorts['manifests'] = { preserve: async () => ({ bytes: plan.manifestBytes, versionId: journal.manifestVersion }),
    read: async () => ({ bytes: plan.manifestBytes, versionId: journal.manifestVersion }) };
  const ports = () => createDynamoPartitionMigrationPorts(plan.manifestBytes, expected, { account: resource.account, region: resource.region }, manifests);
  return { state, bytes, plan, expected, prepare, step, control, claimed, journal, manifests, ports };
}
function context(max = 64) {
  const controller = new AbortController(); let count = 1;
  return { signal: controller.signal, controller, request: () => { if (++count > max) throw new Error('synthetic-request-limit'); }, get count() { return count; } };
}
function item(PK: string, SK: string, value: { revision: number }) {
  return { ...attr(PK, SK), revision: { N: String(value.revision) }, payload: { S: JSON.stringify(value) } };
}
function target(row: PartitionMutation) { return partitionDynamoWrites('KnownEnoughPartitions', [row])[0]!.Put!.Item!; }

it('builds one exact-account transaction with exclusive control/journal and exact legacy bytes then joined rows', async () => {
  const data = input(); const observed: TransactWriteItem[][] = []; const tokens: string[] = [];
  const send = vi.spyOn(DynamoDBClient.prototype, 'send').mockImplementation(async command => {
    expect(command).toBeInstanceOf(TransactWriteItemsCommand);
    const req = (command as TransactWriteItemsCommand).input; observed.push(req.TransactItems!); tokens.push(req.ClientRequestToken!);
    return {};
  });
  const port = data.ports(); expect(send).not.toHaveBeenCalled();
  expect(await port.commit(data.prepare, context())).toBe(true);
  expect(await port.commit(data.step, context())).toBe(true);
  expect(observed[0]).toHaveLength(3); expect(observed[1]).toHaveLength(99);
  expect(observed[0]![0]!.ConditionCheck).toMatchObject({ TableName: resource.source, Key: attr('NP#GROUPS', 'STATE'),
    ConditionExpression: '#v = :v AND #p = :p', ExpressionAttributeValues: { ':v': { N: '12' }, ':p': { S: data.bytes.toString() } } });
  expect(observed[0]![1]!.Put).toMatchObject({ TableName: resource.target, ConditionExpression: 'attribute_not_exists(PK)' });
  expect(observed[0]![2]!.Put).toMatchObject({ TableName: resource.journal, Item: attr(`PARTITION#${data.plan.planHash}`, 'JOURNAL'),
    ConditionExpression: 'attribute_not_exists(PK)' });
  expect(observed[1]![1]!.ConditionCheck).toMatchObject({ TableName: resource.target, ExpressionAttributeValues: { ':p': { S: JSON.stringify(data.claimed) } } });
  expect(observed[1]![2]!.Put).toMatchObject({ TableName: resource.journal,
    ConditionExpression: '#r = :r AND #p = :p', ExpressionAttributeValues: { ':r': { N: '1' },
      ':p': { S: observed[0]![2]!.Put!.Item!.payload!.S! } } });
  expect(observed[1]!.slice(3).every(write => write.Put?.TableName === resource.target && write.Put.ConditionExpression === 'attribute_not_exists(PK)')).toBe(true);
  await port.commit(data.step, context()); expect(tokens[1]).toBe(tokens[2]); expect(tokens[0]).not.toBe(tokens[1]);
});

it('rejects wrong target, edited source, row/batch/history/control or recovery binding before SDK I/O', async () => {
  const data = input(); const send = vi.spyOn(DynamoDBClient.prototype, 'send').mockImplementation(async () => ({}));
  expect(() => createDynamoPartitionMigrationPorts(data.plan.manifestBytes, data.expected,
    { account: '000000000000', region: resource.region }, data.manifests)).toThrow('MIGRATION_RUN_INVALID');
  const port = data.ports();
  for (const defect of ['bytes', 'row', 'journal', 'version', 'control', 'table']) {
    const request: MigrationAtomicCommit = { ...structuredClone(data.step), source: { ...data.step.source, payload: Buffer.from(data.bytes) } };
    if (defect === 'bytes') request.source.payload = Buffer.from(data.bytes.toString() + ' ');
    if (defect === 'row') request.rows = data.plan.batches[1]!;
    if (defect === 'journal') request.journal.next.completedRows--;
    if (defect === 'version') request.journal.next.manifestHash = 'b'.repeat(64);
    if (defect === 'control') request.control.expected.active = true;
    if (defect === 'table') request.source.key.PK = 'WRONG' as 'NP#GROUPS';
    await expect(port.commit(request, context())).rejects.toThrow('MIGRATION_RUN_INVALID');
  }
  expect(send).not.toHaveBeenCalled();
});

it('strongly reads exact legacy/control/partition journal keys, preserving bytes and rejecting corrupt envelopes', async () => {
  const data = input(); const calls: GetItemCommand[] = [];
  vi.spyOn(DynamoDBClient.prototype, 'send').mockImplementation(async command => {
    const req = command as GetItemCommand; calls.push(req);
    if (req.input.TableName === resource.source) return { Item: { ...attr('NP#GROUPS', 'STATE'), version: { N: '12' }, payload: { S: data.bytes.toString() } } };
    if (req.input.TableName === resource.target) return {};
    return { Item: item(`PARTITION#${data.plan.planHash}`, 'JOURNAL', data.journal) };
  });
  const port = data.ports(); expect(await port.source(context())).toEqual({ version: 12, payload: data.bytes });
  expect(await port.control(context())).toEqual(data.control);
  expect(await port.journal(data.plan.planHash, context())).toEqual(data.journal);
  expect(calls.every(command => command.input.ConsistentRead === true)).toBe(true);
  await expect(port.journal('b'.repeat(64), context())).rejects.toThrow('MIGRATION_RUN_INVALID');
  const send = vi.spyOn(DynamoDBClient.prototype, 'send').mockImplementation(async () => ({ Item: { ...item('MIGRATION#CONTROL', 'STATE', data.claimed), revision: { N: '2' } } }));
  await expect(port.control(context())).rejects.toThrow('MIGRATION_RUN_INVALID');
  send.mockImplementation(async () => ({ Item: { ...attr('NP#GROUPS', 'STATE'), version: { N: '01' }, payload: { S: data.bytes.toString() } } }));
  await expect(port.source(context())).rejects.toThrow('MIGRATION_RUN_INVALID');
});

it('returns target input order and nulls, charging partial/unprocessed strong reads to the shared budget', async () => {
  const data = input(); const chosen = data.plan.batches[0]!.slice(0, 3); let calls = 0;
  vi.spyOn(DynamoDBClient.prototype, 'send').mockImplementation(async command => {
    const req = (command as BatchGetItemCommand).input.RequestItems![resource.target]!;
    expect(req.ConsistentRead).toBe(true); calls++;
    if (calls === 1) return { Responses: { [resource.target]: [target(chosen[2]!)] },
      UnprocessedKeys: { [resource.target]: { Keys: [attr(chosen[0]!.key.PK, chosen[0]!.key.SK)] } } };
    return { Responses: { [resource.target]: [target(chosen[0]!)] } };
  });
  const ctx = context(); expect(await data.ports().targets(chosen.map(row => row.key), ctx)).toEqual([chosen[0]!.next, null, chosen[2]!.next]);
  expect(calls).toBe(2); expect(ctx.count).toBe(2);
});

it('rejects unsolicited/duplicate/overlapping/wrong-table or corrupt target batch responses', async () => {
  const data = input(); const chosen = data.plan.batches[0]![0]!;
  const send = vi.spyOn(DynamoDBClient.prototype, 'send'); const port = data.ports();
  const key = attr(chosen.key.PK, chosen.key.SK); const row = target(chosen);
  for (const response of [
    { Responses: { [resource.target]: [row, row] } },
    { Responses: { Other: [row] } },
    { Responses: { [resource.target]: [{ ...row, PK: { S: 'ACCOUNT#wrong' } }] } },
    { Responses: { [resource.target]: [row] }, UnprocessedKeys: { [resource.target]: { Keys: [key] } } },
    { Responses: { [resource.target]: [{ ...row, revision: { N: '2' } }] } },
  ]) {
    send.mockImplementation(async () => response);
    await expect(port.targets([chosen.key], context())).rejects.toThrow('MIGRATION_RUN_INVALID');
  }
  send.mockClear();
  await expect(port.targets([{ PK: 'ACCOUNT#unplanned', SK: 'STATE' }], context())).rejects.toThrow('MIGRATION_RUN_INVALID');
  expect(send).not.toHaveBeenCalled();
});

it('bounds repeated unprocessed requests and never sends after an already aborted operation', async () => {
  const data = input(); const chosen = data.plan.batches[0]![0]!;
  const send = vi.spyOn(DynamoDBClient.prototype, 'send').mockImplementation(async () => ({ UnprocessedKeys: { [resource.target]: { Keys: [attr(chosen.key.PK, chosen.key.SK)] } } }));
  await expect(data.ports().targets([chosen.key], context(2))).rejects.toThrow('synthetic-request-limit');
  expect(send).toHaveBeenCalledTimes(2); send.mockClear(); const ctx = context(); ctx.controller.abort();
  await expect(data.ports().source(ctx)).rejects.toThrow('MIGRATION_TIMEOUT');
  await expect(data.ports().commit(data.prepare, ctx)).rejects.toThrow('MIGRATION_TIMEOUT');
  expect(send).not.toHaveBeenCalled();
});

it('only retries definite full transaction conditions/conflicts; mixed or unknown cancellation stays a private failure', async () => {
  const data = input(); const send = vi.spyOn(DynamoDBClient.prototype, 'send'); const port = data.ports();
  send.mockRejectedValue(Object.assign(new Error('private synthetic conflict'), { name: 'TransactionConflictException' }));
  expect(await port.commit(data.prepare, context())).toBe(false);
  const cancel = (codes: string[]) => Object.assign(new Error('private synthetic transaction diagnostics'),
    { name: 'TransactionCanceledException', CancellationReasons: codes.map(Code => ({ Code })) });
  send.mockRejectedValue(cancel(['None', 'ConditionalCheckFailed', 'None']));
  expect(await port.commit(data.prepare, context())).toBe(false);
  for (const error of [cancel(['None', 'ConditionalCheckFailed', 'ProvisionedThroughputExceeded']),
    cancel(['ConditionalCheckFailed']), Object.assign(new Error('private synthetic denial'), { name: 'AccessDeniedException' })]) {
    send.mockRejectedValue(error);
    await expect(port.commit(data.prepare, context())).rejects.toThrow('MIGRATION_STORAGE_UNAVAILABLE');
  }
});

it('joins the coordinator with actual encoded transaction/read requests and resumes a lost batch response', async () => {
  const data = input(); const stored = new Map<string, unknown>(); let lose = true;
  const key = (table: string, PK: string, SK: string) => `${table}/${PK}/${SK}`;
  stored.set(key(resource.source, 'NP#GROUPS', 'STATE'), { ...attr('NP#GROUPS', 'STATE'), version: { N: '12' }, payload: { S: data.bytes.toString() } });
  vi.spyOn(DynamoDBClient.prototype, 'send').mockImplementation(async command => {
    if (command instanceof GetItemCommand) {
      const req = command.input; return { Item: stored.get(key(req.TableName!, req.Key!.PK!.S!, req.Key!.SK!.S!)) };
    }
    if (command instanceof BatchGetItemCommand) {
      const req = command.input.RequestItems![resource.target]!;
      return { Responses: { [resource.target]: req.Keys!.map(item => stored.get(key(resource.target, item.PK!.S!, item.SK!.S!))).filter(Boolean) } };
    }
    const req = (command as TransactWriteItemsCommand).input;
    const failures = req.TransactItems!.map(action => {
      const current = action.Put ?? action.ConditionCheck!; const rowKey = (action.Put?.Item ?? action.ConditionCheck!.Key)!;
      const prior = stored.get(key(current.TableName!, rowKey.PK!.S!, rowKey.SK!.S!)) as Record<string, { N?: string; S?: string }> | undefined;
      const values = current.ExpressionAttributeValues;
      const matches = current.ConditionExpression === 'attribute_not_exists(PK)' ? prior === undefined
        : current.ConditionExpression === '#v = :v AND #p = :p'
          ? prior?.version?.N === values?.[':v']?.N && prior?.payload?.S === values?.[':p']?.S
          : prior?.revision?.N === values?.[':r']?.N && prior?.payload?.S === values?.[':p']?.S;
      return { Code: matches ? 'None' : 'ConditionalCheckFailed' };
    });
    if (failures.some(reason => reason.Code !== 'None')) throw Object.assign(new Error('private synthetic condition rejection'),
      { name: 'TransactionCanceledException', CancellationReasons: failures });
    for (const action of req.TransactItems!) if (action.Put) {
      const put = action.Put; stored.set(key(put.TableName!, put.Item!.PK!.S!, put.Item!.SK!.S!), structuredClone(put.Item));
    }
    if (lose && req.TransactItems!.length > 3) { lose = false; throw new Error('private synthetic lost atomic response'); }
    return {};
  });
  const runner = () => createPartitionMigrationRunner(data.ports(), data.plan.manifestBytes, data.expected, { actorId: 143764700, sourceSha });
  await runner().prepare(); await expect(runner().step()).rejects.toThrow('MIGRATION_COMMIT_UNKNOWN');
  expect((await runner().step()).nextBatch).toBe(2);
  expect((await runner().step()).state).toBe('COPIED');
  expect((await runner().step()).completedRows).toBe(data.plan.rowCount);
});
