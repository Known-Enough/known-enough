import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { DynamoDBClient, GetItemCommand, BatchGetItemCommand, PutItemCommand, TransactWriteItemsCommand,
  type AttributeValue, type TransactWriteItem } from '@aws-sdk/client-dynamodb';
import { Groups } from '@deal-table/contracts';
import { createDynamoGroupRepository } from './group-repository.ts';
import { preparePartitionMigration } from './partition-migration.ts';
import { createDynamoPartitionMigrationPorts, PARTITION_MIGRATION_RESOURCES as resource } from './dynamo-partition-migration.ts';
import { createPartitionMigrationRunner } from './partition-migration-runner.ts';

afterEach(() => vi.restoreAllMocks());
type Item = Record<string, AttributeValue>;
const sourceSha = 'a'.repeat(40);
function fixture(state: Groups.GroupState = { accounts: [{ subject: 'iris', emailHash: createHash('sha256').update('iris').digest('hex'),
  displayName: 'Iris', status: 'DISABLED', version: 4 }], groups: [] }, version = 12) {
  const bytes = Buffer.from(JSON.stringify(state)); const plan = preparePartitionMigration(bytes, version, sourceSha);
  const expected = { sourceSha, sourceRevision: version, sourceHash: plan.sourceHash, manifestHash: plan.manifestHash };
  const key = (table: string, PK: string, SK: string) => `${table}/${PK}/${SK}`;
  const sourceKey = key(resource.source, 'NP#GROUPS', 'STATE');
  const controlKey = key(resource.target, 'MIGRATION#CONTROL', 'STATE');
  const journalKey = key(resource.journal, `PARTITION#${plan.planHash}`, 'JOURNAL');
  const stored = new Map<string, Item>(); const transactions: TransactWriteItem[][] = [];
  stored.set(sourceKey, { PK: { S: 'NP#GROUPS' }, SK: { S: 'STATE' }, version: { N: String(version) }, payload: { S: bytes.toString() } });
  let losePhase: string | null = null; let conflict: (() => void) | null = null;
  const send = vi.spyOn(DynamoDBClient.prototype, 'send').mockImplementation(async command => {
    if (command instanceof GetItemCommand) {
      const req = command.input; return { Item: structuredClone(stored.get(key(req.TableName!, req.Key!.PK!.S!, req.Key!.SK!.S!))) };
    }
    if (command instanceof BatchGetItemCommand) {
      const req = command.input.RequestItems![resource.target]!;
      return { Responses: { [resource.target]: req.Keys!.map(item => structuredClone(stored.get(key(resource.target, item.PK!.S!, item.SK!.S!)))).filter(Boolean) } };
    }
    if (command instanceof PutItemCommand) throw new Error('unexpected non-atomic migration write');
    const req = (command as TransactWriteItemsCommand).input; transactions.push(req.TransactItems!);
    conflict?.(); conflict = null;
    const failures = req.TransactItems!.map(action => {
      const write = action.Put ?? action.ConditionCheck!; const item = (action.Put?.Item ?? action.ConditionCheck!.Key)!;
      const prior = stored.get(key(write.TableName!, item.PK!.S!, item.SK!.S!)); const values = write.ExpressionAttributeValues;
      const matches = write.ConditionExpression === 'attribute_not_exists(PK)' ? prior === undefined
        : write.ConditionExpression === '#v=:v' ? prior?.version?.N === values?.[':v']?.N
          : write.ConditionExpression === '#v = :v AND #p = :p'
            ? prior?.version?.N === values?.[':v']?.N && prior?.payload?.S === values?.[':p']?.S
            : prior?.revision?.N === values?.[':r']?.N && prior?.payload?.S === values?.[':p']?.S;
      return { Code: matches ? 'None' : 'ConditionalCheckFailed' };
    });
    if (failures.some(reason => reason.Code !== 'None')) throw Object.assign(new Error('synthetic rejected atomic condition'),
      { name: 'TransactionCanceledException', CancellationReasons: failures });
    for (const action of req.TransactItems!) if (action.Put) {
      const put = action.Put; stored.set(key(put.TableName!, put.Item!.PK!.S!, put.Item!.SK!.S!), structuredClone(put.Item!));
    }
    const phase = req.TransactItems![0]?.Put?.Item?.payload?.S;
    if (losePhase && phase && JSON.parse(phase).phase === losePhase) { losePhase = null; throw new Error('synthetic lost transition acknowledgement'); }
    return {};
  });
  const manifests = { preserve: vi.fn(async () => ({ bytes: plan.manifestBytes, versionId: 'version-1' })),
    read: vi.fn(async () => ({ bytes: plan.manifestBytes, versionId: 'version-1' })) };
  const port = () => createDynamoPartitionMigrationPorts(plan.manifestBytes, expected, { account: resource.account, region: resource.region }, manifests);
  const runner = () => createPartitionMigrationRunner(port(), plan.manifestBytes, expected, { actorId: 143764700, sourceSha });
  const value = (id: string) => JSON.parse(stored.get(id)!.payload!.S!);
  const edit = (id: string, mutate: (value: Record<string, unknown>) => void) => {
    const row = stored.get(id)!; const payload = value(id); mutate(payload); row.payload = { S: JSON.stringify(payload) };
  };
  const copied = async () => { await runner().prepare(); await port().freeze(); while ((await runner().step()).state !== 'COPIED') { /* one bounded batch each call */ } };
  return { bytes, plan, expected, port, runner, send, stored, transactions, manifests, sourceKey, controlKey, journalKey, value, edit, copied,
    lose: (phase: string) => { losePhase = phase; }, conflict: (work: () => void) => { conflict = work; } };
}

it('cannot copy from a still mutable legacy source; freeze fences actual queued legacy decision conditions and reads', async () => {
  const f = fixture(); await f.runner().prepare();
  const legacy = createDynamoGroupRepository(resource.source, resource.region);
  const fence = await legacy.fence(() => {}); const write = fence.write!;
  const changedFence = await legacy.fence(state => { state.accounts[0]!.displayName = 'Changed'; });
  await expect(f.runner().step()).rejects.toThrow('MIGRATION_CONFLICT');
  expect(f.value(f.journalKey).nextBatch).toBe(0);
  const frozen = await f.port().freeze(); expect(frozen.active).toBe(false); expect(frozen.revision).toBe(2);
  expect(f.stored.get(f.sourceKey)!.version).toEqual({ N: '13' });
  expect(Groups.GroupState.safeParse(f.value(f.sourceKey)).success).toBe(false);
  await expect(legacy.transaction(() => {})).rejects.toThrow();
  await expect(new DynamoDBClient({}).send(new TransactWriteItemsCommand({ TransactItems: [write] }))).rejects.toThrow('synthetic rejected atomic condition');
  await expect(new DynamoDBClient({}).send(new TransactWriteItemsCommand({ TransactItems: [changedFence.write!] }))).rejects.toThrow('synthetic rejected atomic condition');
  const batch = await f.runner().step(); expect(batch.state).toBe('COPIED');
  const account = f.plan.batches.flat().find(row => row.next?.kind === 'ACCOUNT')!;
  expect(f.stored.get(`${resource.target}/${account.key.PK}/${account.key.SK}`)!.payload!.S).toContain('DISABLED');
});

it('atomically activates only complete pinned data and recovery, and reconstructs both lost transition acknowledgements', async () => {
  const f = fixture(); await f.runner().prepare(); f.lose('FROZEN');
  await expect(f.port().freeze()).rejects.toThrow('MIGRATION_COMMIT_UNKNOWN');
  const count = f.transactions.length;
  expect((await f.port().freeze()).revision).toBe(2); expect(f.transactions).toHaveLength(count);
  await f.runner().step(); f.lose('ACTIVE');
  await expect(f.port().activate()).rejects.toThrow('MIGRATION_COMMIT_UNKNOWN');
  expect(f.value(f.sourceKey).phase).toBe('ACTIVE'); expect(f.value(f.controlKey).active).toBe(true);
  const activated = f.transactions.length;
  expect((await f.port().activate()).revision).toBe(3); expect(f.transactions).toHaveLength(activated);
  expect(f.stored.get(f.sourceKey)!.version).toEqual({ N: '14' });
  expect(f.transactions.at(-1)).toHaveLength(3);
  expect(f.transactions.at(-1)![2]!.ConditionCheck!.TableName).toBe(resource.journal);
  await expect(f.runner().step()).rejects.toThrow();
});

it('blocks activation while rows are incomplete and rejects missing or altered copied rows without writes', async () => {
  const f = fixture(); await f.runner().prepare(); await f.port().freeze();
  await expect(f.port().activate()).rejects.toThrow('MIGRATION_JOURNAL_INVALID');
  await f.runner().step(); const row = f.plan.batches[0]![0]!; const id = `${resource.target}/${row.key.PK}/${row.key.SK}`;
  const original = f.stored.get(id)!; const count = f.transactions.length;
  f.stored.delete(id); await expect(f.port().activate()).rejects.toThrow('MIGRATION_TARGET_CORRUPT');
  f.stored.set(id, original); f.edit(id, value => { value.revision = 2; }); f.stored.get(id)!.revision = { N: '2' };
  await expect(f.port().activate()).rejects.toThrow('MIGRATION_TARGET_CORRUPT');
  expect(f.transactions).toHaveLength(count); expect(f.value(f.controlKey).active).toBe(false);
});

it('requires exact recovery version/bytes for freeze and activation before mutation', async () => {
  const f = fixture(); await f.runner().prepare(); const count = f.transactions.length;
  f.manifests.read.mockImplementation(async () => ({ bytes: f.plan.manifestBytes, versionId: 'wrong-version' }));
  await expect(f.port().freeze()).rejects.toThrow('MIGRATION_RECOVERY_INVALID'); expect(f.transactions).toHaveLength(count);
  f.manifests.read.mockImplementation(async () => ({ bytes: f.plan.manifestBytes, versionId: 'version-1' }));
  await f.port().freeze(); await f.runner().step(); const copied = f.transactions.length;
  f.manifests.read.mockImplementation(async () => ({ bytes: Buffer.from('{}'), versionId: 'version-1' }));
  await expect(f.port().activate()).rejects.toThrow('MIGRATION_RECOVERY_INVALID'); expect(f.transactions).toHaveLength(copied);
});

it('rejects stale source, control or journal at the atomic transition and does not overwrite changed authority', async () => {
  for (const path of ['source', 'control', 'journal']) {
    const f = fixture(); await f.runner().prepare();
    f.conflict(() => f.edit(path === 'source' ? f.sourceKey : path === 'control' ? f.controlKey : f.journalKey,
      value => { if (path === 'source') value.accounts = []; else if (path === 'control') value.active = true; else value.sourceHash = 'b'.repeat(64); }));
    await expect(f.port().freeze()).rejects.toThrow();
    expect(f.stored.get(f.sourceKey)!.version).toEqual({ N: '12' });
  }
});

it('rechecks exact frozen source and COPIED journal at activation, preserving all copied data on rejection', async () => {
  for (const path of ['source', 'journal']) {
    const f = fixture(); await f.copied(); const count = f.stored.size;
    f.conflict(() => f.edit(path === 'source' ? f.sourceKey : f.journalKey, value => { value.sourceHash = 'b'.repeat(64); }));
    await expect(f.port().activate()).rejects.toThrow();
    expect(f.value(f.controlKey).active).toBe(false); expect(f.stored.size).toBe(count);
  }
});

it('rejects corrupt marker physical versions, bindings and journal progress without reconstructing legacy consent', async () => {
  for (const defect of ['version', 'planHash', 'manifestVersion', 'nextBatch']) {
    const f = fixture(); await f.runner().prepare(); await f.port().freeze(); const count = f.transactions.length;
    if (defect === 'version') f.stored.get(f.sourceKey)!.version = { N: '12' };
    else if (defect === 'nextBatch') f.edit(f.journalKey, value => { value.nextBatch = 1; });
    else f.edit(f.sourceKey, value => { value[defect] = defect === 'planHash' ? 'b'.repeat(64) : 'wrong-version'; });
    await expect(f.runner().step()).rejects.toThrow(); expect(f.transactions).toHaveLength(count);
    expect(f.value(f.controlKey).active).toBe(false);
  }
});

it('supports a genuinely empty source and bounds reads, hung recovery and transition version exhaustion', async () => {
  const f = fixture({ accounts: [], groups: [] }); expect((await f.runner().prepare()).state).toBe('COPIED');
  await f.port().freeze(); expect((await f.port().activate()).active).toBe(true);
  const bounded = fixture(); await bounded.runner().prepare(); const count = bounded.transactions.length;
  await expect(bounded.port().freeze({ maxRequests: 2 })).rejects.toThrow('MIGRATION_REQUEST_LIMIT');
  bounded.manifests.read.mockImplementation(() => new Promise(() => {}));
  await expect(bounded.port().freeze({ timeoutMs: 10 })).rejects.toThrow('MIGRATION_TIMEOUT');
  expect(bounded.transactions).toHaveLength(count);
  const exhausted = fixture({ accounts: [], groups: [] }, Number.MAX_SAFE_INTEGER - 1);
  exhausted.send.mockClear(); expect(() => exhausted.port()).toThrow('MIGRATION_RUN_INVALID'); expect(exhausted.send).not.toHaveBeenCalled();
});
