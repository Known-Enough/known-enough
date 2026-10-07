import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { DynamoDBClient, GetItemCommand, BatchGetItemCommand, TransactWriteItemsCommand,
  type AttributeValue, type TransactWriteItem } from '@aws-sdk/client-dynamodb';
import { Groups } from '@deal-table/contracts';
import { partitionSeedRows, type PartitionKey } from './partitioned-group-repository.ts';
import { partitionDirectoryKey } from './partition-directory.ts';
import { MigrationControlSchema, migrationIO, migrationCall } from './partition-migration-runner.ts';
import { preparePartitionArchive, createPartitionArchiveRunner, ArchiveOperatorPolicy,
  type ArchiveAuthority, type ArchiveAtomicCommit, type ArchiveEntry } from './partition-archive.ts';
import { createDynamoPartitionArchivePorts } from './dynamo-partition-archive.ts';
import { PARTITION_MIGRATION_RESOURCES as resources } from './dynamo-partition-migration.ts';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const sourceSha = 'a'.repeat(40);
const attrs = (key: PartitionKey) => ({ PK: { S: key.PK }, SK: { S: key.SK } });
type Item = Record<string, AttributeValue>;
const encode = <T extends { revision: number }>(key: PartitionKey, row: T): Item => ({
  ...attrs(key), revision: { N: String(row.revision) }, payload: { S: JSON.stringify(row) },
});
const path = (table: string, key: PartitionKey) => `${table}/${key.PK}/${key.SK}`;
const headerKey = { PK: 'GROUP#garden', SK: 'STATE' };
const accountKey = { PK: 'ACCOUNT#iris', SK: 'STATE' };
const controlKey = { PK: 'MIGRATION#CONTROL', SK: 'STATE' };
const policyKey = { PK: 'OPERATIONS#ARCHIVE', SK: 'STATE' };
afterEach(() => vi.restoreAllMocks());

function fixture(count = 64, authority: ArchiveAuthority = { kind: 'ORGANIZER', subject: 'iris' }) {
  const account: Groups.Account = { subject: 'iris', emailHash: hash('iris'), displayName: 'Iris', version: 4, status: 'APPROVED' };
  const group: Groups.Group = { id: 'garden', name: 'Garden', organizer: 'iris', version: 3, members: ['iris'], drafts: [],
    decisions: Array.from({ length: count }, (_, n) => ({ id: `decision-${n}`, version: 2 })), invitations: [] };
  const seeds = partitionSeedRows({ accounts: [account], groups: [group] }, { accountSubjects: ['iris'], groupId: group.id });
  const entries: ArchiveEntry[] = seeds.filter(row => row.next?.kind !== 'ACCOUNT').map(row => ({ key: row.key, row: row.next! }));
  for (const decision of group.decisions) {
    const value = { type: 'DECISION' as const, groupId: group.id, decisionId: decision.id };
    entries.push({ key: partitionDirectoryKey(value), row: { schemaVersion: 1, revision: 1, kind: 'DIRECTORY', value } });
  }
  const plan = preparePartitionArchive(entries, group.id, sourceSha);
  const expected = { sourceSha, groupId: group.id, sourceHeaderRevision: plan.header.revision,
    sourceHash: plan.sourceHash, manifestHash: plan.manifestHash };
  const stored = new Map<string, Item>();
  for (const entry of plan.entries) stored.set(path(resources.target, entry.key), encode(entry.key, entry.row));
  stored.set(path(resources.target, accountKey), encode(accountKey, seeds.find(row => row.next?.kind === 'ACCOUNT')!.next!));
  stored.set(path(resources.target, controlKey), encode(controlKey, MigrationControlSchema.parse({ schemaVersion: 1,
    account: resources.account, region: resources.region, table: 'KnownEnoughPartitions', revision: 3, active: true, planHash: 'd'.repeat(64) })));
  stored.set(path(resources.target, policyKey), encode(policyKey, ArchiveOperatorPolicy.parse({ schemaVersion: 1,
    revision: 1, kind: 'ARCHIVE_POLICY', enabled: true, actors: [143764700] })));
  const recovery = { preserve: vi.fn(async () => ({ bytes: Buffer.from(plan.manifestBytes), versionId: 'immutable-v1' })),
    read: vi.fn(async () => ({ bytes: Buffer.from(plan.manifestBytes), versionId: 'immutable-v1' })) };
  const commits: ArchiveAtomicCommit[] = []; const transactions: TransactWriteItem[][] = []; const tokens: string[] = [];
  let lose = false; let before: (() => void) | null = null; let batchBefore: (() => void) | null = null;
  const send = vi.spyOn(DynamoDBClient.prototype, 'send').mockImplementation(async (command, options) => {
    expect(options?.abortSignal).toBeDefined();
    if (command instanceof GetItemCommand) {
      expect(command.input.ConsistentRead).toBe(true);
      const table = command.input.TableName!; expect([resources.target, resources.journal]).toContain(table);
      const key = { PK: command.input.Key!.PK!.S!, SK: command.input.Key!.SK!.S! };
      const Item = stored.get(path(table, key)); return Item ? { Item: structuredClone(Item) } : {};
    }
    if (command instanceof BatchGetItemCommand) {
      const request = command.input.RequestItems!; expect(Object.keys(request)).toEqual([resources.target]);
      expect(request[resources.target]!.ConsistentRead).toBe(true);
      const keys = request[resources.target]!.Keys!; expect(keys.length).toBeLessThanOrEqual(100);
      batchBefore?.(); batchBefore = null;
      return { Responses: { [resources.target]: keys.flatMap(key => {
        const value = stored.get(path(resources.target, { PK: key.PK!.S!, SK: key.SK!.S! })); return value ? [structuredClone(value)] : [];
      }).reverse() } };
    }
    expect(command).toBeInstanceOf(TransactWriteItemsCommand);
    const request = (command as TransactWriteItemsCommand).input; const writes = request.TransactItems!;
    transactions.push(writes); tokens.push(request.ClientRequestToken!); before?.(); before = null;
    const reasons = writes.map(action => {
      const current = action.Put ?? action.ConditionCheck!; const key = (action.Put?.Item ?? action.ConditionCheck!.Key)!;
      const prior = stored.get(path(current.TableName!, { PK: key.PK!.S!, SK: key.SK!.S! })); const conditions = current.ExpressionAttributeValues;
      const conflict = current.ConditionExpression === 'attribute_not_exists(PK)' ? prior !== undefined
        : prior?.revision?.N !== conditions?.[':r']?.N || prior?.payload?.S !== conditions?.[':p']?.S;
      return { Code: conflict ? 'ConditionalCheckFailed' : 'None' };
    });
    if (reasons.some(reason => reason.Code !== 'None')) throw Object.assign(new Error('synthetic conditional conflict'),
      { name: 'TransactionCanceledException', CancellationReasons: reasons });
    for (const action of writes) if (action.Put) stored.set(path(action.Put.TableName!, {
      PK: action.Put.Item!.PK!.S!, SK: action.Put.Item!.SK!.S! }), structuredClone(action.Put.Item!));
    if (lose) { lose = false; throw new Error('synthetic lost response'); }
    return {};
  });
  const port = () => createDynamoPartitionArchivePorts(plan.manifestBytes, expected, authority,
    { account: resources.account, region: resources.region }, recovery);
  const runner = (options = {}) => {
    const ports = port(); const commit = ports.commit;
    ports.commit = (request, context) => { commits.push(structuredClone(request)); return commit(request, context); };
    return createPartitionArchiveRunner(ports, plan.manifestBytes, expected, authority, options);
  };
  const edit = (key: PartitionKey, change: (value: Record<string, unknown>) => void) => {
    const current = stored.get(path(resources.target, key))!; const value = JSON.parse(current.payload!.S!); change(value);
    current.payload = { S: JSON.stringify(value) }; current.revision = { N: String(value.revision) };
  };
  return { plan, expected, authority, stored, recovery, port, runner, send, commits, transactions, tokens, edit,
    lose: () => { lose = true; }, before: (fn: () => void) => { before = fn; }, duringBatch: (fn: () => void) => { batchBefore = fn; } };
}

it('joins strong100-key ordered reads, four atomic guards and retained children through prepare/archive and fresh replay', async () => {
  const data = fixture(); const retained = structuredClone(data.stored);
  await data.runner().prepare(); const archived = await data.runner().archive();
  expect(archived.state).toBe('ARCHIVED'); expect(data.transactions).toHaveLength(2);
  for (const writes of data.transactions) { expect(writes).toHaveLength(4); expect(writes[3]!.Put!.TableName).toBe(resources.journal); }
  expect(data.transactions[1]![2]!.Put!.TableName).toBe(resources.target);
  expect(data.transactions[1]![2]!.Put!.Item!.PK).toEqual({ S: 'GROUP#garden' });
  for (const [key, item] of retained) if (key !== path(resources.target, headerKey)) expect(data.stored.get(key)).toEqual(item);
  expect(await data.runner().archive()).toEqual(archived); expect(data.transactions).toHaveLength(2);
  expect(data.recovery.preserve).toHaveBeenCalledTimes(1);
});

it('rejects a header changed during strong child reads before recovery or commit', async () => {
  const data = fixture(); data.duringBatch(() => data.edit(headerKey, row => { row.revision = 2; }));
  await expect(data.runner().prepare()).rejects.toThrow('ARCHIVE_SOURCE_CHANGED');
  expect(data.recovery.preserve).not.toHaveBeenCalled(); expect(data.transactions).toHaveLength(0);
});

it('charges every extra batch/unprocessed request and header recheck to the same bounded context', async () => {
  const data = fixture(2); const originals = data.plan.entries.filter(entry => entry.row.kind !== 'GROUP'); let round = 0;
  data.send.mockImplementation(async command => {
    if (command instanceof GetItemCommand) return { Item: data.stored.get(path(resources.target, headerKey)) };
    const keys = (command as BatchGetItemCommand).input.RequestItems![resources.target]!.Keys!;
    const chosen = originals[0]!;
    if (round++ === 0) return { Responses: { [resources.target]: originals.slice(1).map(entry => data.stored.get(path(resources.target, entry.key))!) },
      UnprocessedKeys: { [resources.target]: { Keys: [attrs(chosen.key)] } } };
    expect(keys).toEqual([attrs(chosen.key)]);
    return { Responses: { [resources.target]: [data.stored.get(path(resources.target, chosen.key))!] } };
  });
  const io = migrationIO({ maxRequests: 4 }); expect(await migrationCall(io, () => data.port().group('garden', io))).toHaveLength(5);
  expect(data.send).toHaveBeenCalledTimes(4);
  const limited = migrationIO({ maxRequests: 1 });
  await expect(migrationCall(limited, () => data.port().group('garden', limited))).rejects.toThrow('MIGRATION_REQUEST_LIMIT');
  expect(data.send).toHaveBeenCalledTimes(5);
});

it('rejects foreign duplicate missing and contradictory batch responses, malformed payloads and revision/key mismatch', async () => {
  for (const kind of ['foreign', 'duplicate', 'missing', 'both', 'bad', 'revision', 'key', 'uncanonical'] as const) {
    const data = fixture(1); const child = data.plan.entries.find(entry => entry.row.kind === 'BINDING')!;
    const original = data.send.getMockImplementation()!;
    data.send.mockImplementation(async (command, options) => {
      if (!(command instanceof BatchGetItemCommand)) return Reflect.apply(original, undefined, [command, options]);
      const items = data.plan.entries.filter(entry => entry.row.kind !== 'GROUP').map(entry => structuredClone(data.stored.get(path(resources.target, entry.key))!));
      const chosen = items.find(item => item.SK!.S === child.key.SK)!;
      if (kind === 'bad') chosen.payload = { S: '{broken' };
      if (kind === 'revision') chosen.revision = { N: '999' };
      if (kind === 'key') chosen.PK = { S: 'GROUP#other' };
      if (kind === 'uncanonical') chosen.payload = { S: ' '+chosen.payload!.S };
      return { Responses: { [kind === 'foreign' ? resources.source : resources.target]: kind === 'missing' ? []
        : kind === 'duplicate' ? [...items, chosen] : items },
        ...(kind === 'both' ? { UnprocessedKeys: { [resources.target]: { Keys: [attrs(child.key)] } } } : {}) };
    });
    await expect(data.runner().prepare()).rejects.toThrow(kind === 'missing' ? 'ARCHIVE_SOURCE_CHANGED' : 'ARCHIVE_INVALID');
    expect(data.transactions).toHaveLength(0); expect(data.recovery.preserve).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  }
});

it('limits repeated unprocessed reads to three attempts and sends nothing after an already aborted context', async () => {
  const data = fixture(1); data.send.mockImplementation(async command => command instanceof GetItemCommand
    ? command.input.TableName === resources.journal ? {} : { Item: data.stored.get(path(resources.target, headerKey)) }
    : { UnprocessedKeys: { [resources.target]: { Keys: (command as BatchGetItemCommand).input.RequestItems![resources.target]!.Keys! } } });
  await expect(data.runner().prepare()).rejects.toThrow('ARCHIVE_STORAGE_UNAVAILABLE'); expect(data.send).toHaveBeenCalledTimes(5);
  const controller = new AbortController(); controller.abort();
  await expect(data.port().group('garden', { signal: controller.signal, request: () => undefined })).rejects.toThrow('ARCHIVE_TIMEOUT');
  expect(data.send).toHaveBeenCalledTimes(5);
});

it('joins exact full account/policy/control values so revocation at commit fails even without revision changes', async () => {
  for (const operator of [false, true]) {
    const data = fixture(1, operator ? { kind: 'OPERATOR', actorId: 143764700 } : { kind: 'ORGANIZER', subject: 'iris' });
    await data.runner().prepare(); data.before(() => data.edit(operator ? policyKey : accountKey, row => {
      if (operator) row.enabled = false; else (row.value as Record<string, unknown>).status = 'DISABLED';
    }));
    await expect(data.runner().archive()).rejects.toThrow('ARCHIVE_AUTHORITY_DENIED');
    expect(data.stored.get(path(resources.target, headerKey))!.payload!.S).toContain('"kind":"GROUP"');
    vi.restoreAllMocks();
  }
  const data = fixture(1); await data.runner().prepare(); data.before(() => data.edit(controlKey, row => { row.active = false; }));
  await expect(data.runner().archive()).rejects.toThrow('ARCHIVE_TARGET_INACTIVE');
});

it('fresh reconstruction resolves lost prepare and terminal acknowledgements without a duplicate write', async () => {
  const data = fixture(1); data.lose(); await expect(data.runner().prepare()).rejects.toThrow('ARCHIVE_COMMIT_UNKNOWN');
  await data.runner().prepare(); expect(data.transactions).toHaveLength(1);
  data.lose(); await expect(data.runner().archive()).rejects.toThrow('ARCHIVE_COMMIT_UNKNOWN');
  expect((await data.runner().archive()).state).toBe('ARCHIVED'); expect(data.transactions).toHaveLength(2);
});

it('keeps concurrent prepare/archive journal timestamps and retained history with a deterministic request fingerprint', async () => {
  const data = fixture(1); const prepared = await Promise.all([data.runner().prepare(), data.runner().prepare()]);
  expect(prepared[0]).toEqual(prepared[1]);
  const first = data.commits[0]!; const result = await data.port().commit(first, migrationIO({})); expect(result).toBe(false);
  expect(data.tokens.at(-1)).toBe(data.tokens[0]); expect(data.tokens[0]).toMatch(/^[a-f0-9]{32}$/);
  const terminal = await Promise.all([data.runner().archive(), data.runner().archive()]); expect(terminal[0]).toEqual(terminal[1]);
  expect(terminal[0]!.createdAt).toBe(prepared[0]!.createdAt);
});

it('never misclassifies mixed missing malformed or permission cancellation reasons as definite conflict', async () => {
  const data = fixture(1); await data.runner().prepare();
  for (const codes of [['None', 'ConditionalCheckFailed', 'None', 'None'], ['None', 'None', 'None', 'None'],
    ['ConditionalCheckFailed'], ['None', 'ConditionalCheckFailed', 'AccessDenied', 'None']]) {
    data.send.mockRejectedValue(Object.assign(new Error('synthetic cancellation'), { name: 'TransactionCanceledException',
      CancellationReasons: codes.map(Code => ({ Code })) }));
    if (codes.length === 4 && codes.includes('ConditionalCheckFailed') && !codes.includes('AccessDenied')) {
      expect(await data.port().commit(data.commits[0]!, migrationIO({}))).toBe(false);
    } else await expect(data.port().commit(data.commits[0]!, migrationIO({}))).rejects.toThrow('ARCHIVE_STORAGE_UNAVAILABLE');
  }
});

it('pins constructor target/source/recovery/authority and rejects wrong keys without any SDK or recovery I/O', async () => {
  const data = fixture(1); const target = { account: resources.account, region: resources.region };
  for (const wrong of [{ ...target, account: '111111111111' }, { ...target, region: 'us-west-2' }]) {
    expect(() => createDynamoPartitionArchivePorts(data.plan.manifestBytes, data.expected, data.authority, wrong, data.recovery)).toThrow('ARCHIVE_INVALID');
  }
  expect(() => createDynamoPartitionArchivePorts(data.plan.manifestBytes, { ...data.expected, sourceSha: 'b'.repeat(40) },
    data.authority, target, data.recovery)).toThrow('ARCHIVE_SOURCE_CHANGED');
  const port = data.port(); const io = migrationIO({});
  await expect(port.group('other', io)).rejects.toThrow('ARCHIVE_INVALID');
  await expect(port.journal({ PK: 'ARCHIVE#other', SK: 'STATE' }, io)).rejects.toThrow('ARCHIVE_INVALID');
  await expect(port.authority({ kind: 'OPERATOR', actorId: 143764700 }, io)).rejects.toThrow('ARCHIVE_AUTHORITY_DENIED');
  expect(data.send).not.toHaveBeenCalled(); expect(data.recovery.preserve).not.toHaveBeenCalled();
});

it('deadline abort bounds a held SDK batch and prevents late recovery, header rechecks or writes', async () => {
  const data = fixture(1); const original = data.send.getMockImplementation()!;
  let release: (() => void) | undefined;
  data.send.mockImplementation(async (command, options) => {
    if (!(command instanceof BatchGetItemCommand)) return Reflect.apply(original, undefined, [command, options]);
    return new Promise<{ Responses: Record<string, Item[]> }>(resolve => { release = () => resolve({ Responses: { [resources.target]: data.plan.entries
      .filter(entry => entry.row.kind !== 'GROUP').map(entry => data.stored.get(path(resources.target, entry.key))!) } }); });
  });
  await expect(data.runner({ timeoutMs: 20 }).prepare()).rejects.toThrow('ARCHIVE_TIMEOUT');
  expect(data.send).toHaveBeenCalledTimes(3); release?.(); await new Promise(resolve => setTimeout(resolve, 10));
  expect(data.send).toHaveBeenCalledTimes(3); expect(data.recovery.preserve).not.toHaveBeenCalled(); expect(data.transactions).toHaveLength(0);
});

it('compiler rejects an altered bound commit before sending an SDK transaction', async () => {
  const data = fixture(1); await data.runner().prepare(); const request = structuredClone(data.commits[0]!);
  request.header.key.PK = 'GROUP#other'; data.send.mockClear();
  await expect(data.port().commit(request, migrationIO({}))).rejects.toThrow('ARCHIVE_INVALID');
  expect(data.send).not.toHaveBeenCalled();
});
