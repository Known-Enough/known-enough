import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { DynamoDBClient, GetItemCommand, BatchGetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { PartitionRowSchema, partitionAccountKey, partitionGroupKey } from './partitioned-group-repository.ts';
import { createPartitionMembershipReader, partitionMembershipSeeds, PartitionMembershipRow } from './partition-membership.ts';
import { ArchivedGroupRow } from './partition-archive.ts';
import { MigrationControlSchema } from './partition-migration-runner.ts';
import { PARTITION_MIGRATION_RESOURCES as resources } from './dynamo-partition-migration.ts';

afterEach(() => vi.restoreAllMocks());
const sourceSha = 'a'.repeat(40); const planHash = 'd'.repeat(64); const secret = Buffer.alloc(32, 7);
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const config = { sourceSha, planHash, cursorKey: secret, verifiedTarget: { account: resources.account, region: resources.region } };
const code = (key: { PK: string; SK: string }) => `${key.PK}/${key.SK}`;
const encode = (key: { PK: string; SK: string }, row: { revision: number }) => ({ PK: { S: key.PK }, SK: { S: key.SK },
  revision: { N: String(row.revision) }, payload: { S: JSON.stringify(row) } });
function group(id: string, members = ['iris']) {
  return PartitionRowSchema.parse({ schemaVersion: 1, revision: 2, kind: 'GROUP', value: { id, name: `Group ${id}`,
    organizer: members[0], version: 3, members, draftIds: [], decisionIds: [], invitations: [{ tokenHash: digest('invitation'),
      recipientHash: digest('private-recipient'), expiresAt: 1000, acceptedBy: null }] } });
}
function fixture(count = 24) {
  const account = PartitionRowSchema.parse({ schemaVersion: 1, revision: 4, kind: 'ACCOUNT', value: {
    subject: 'iris', displayName: 'Iris', emailHash: digest('iris'), status: 'APPROVED', version: 4 } });
  const control = MigrationControlSchema.parse({ schemaVersion: 1, account: resources.account, region: resources.region,
    table: 'KnownEnoughPartitions', revision: 3, active: true, planHash });
  const stored = new Map<string, ReturnType<typeof encode>>([[code(partitionAccountKey('iris')), encode(partitionAccountKey('iris'), account)],
    ['MIGRATION#CONTROL/STATE', encode({ PK: 'MIGRATION#CONTROL', SK: 'STATE' }, control)]]);
  for (let index = 0; index < count; index++) {
    const row = group(`group-${String(index).padStart(2, '0')}`);
    if (row.kind !== 'GROUP') throw new Error('fixture');
    stored.set(code(partitionGroupKey(row.value.id)), encode(partitionGroupKey(row.value.id), row));
    const seed = partitionMembershipSeeds(row)[0]!; stored.set(code(seed.key), encode(seed.key, seed.row));
  }
  let time = 1000; let calls = 0;
  let intercept: ((command: unknown, response: Record<string, unknown>) => void | Promise<void>) | null = null;
  const send = vi.spyOn(DynamoDBClient.prototype, 'send').mockImplementation(async (command, options) => {
    calls++; expect(options?.abortSignal).toBeInstanceOf(globalThis.AbortSignal);
    let response: Record<string, unknown>;
    if (command instanceof GetItemCommand) {
      expect(command.input.TableName).toBe(resources.target); expect(command.input.ConsistentRead).toBe(true);
      const key = command.input.Key!; const item = stored.get(`${key.PK!.S}/${key.SK!.S}`);
      response = item ? { Item: structuredClone(item) } : {};
    } else if (command instanceof QueryCommand) {
      expect(command.input.TableName).toBe(resources.target); expect(command.input.ConsistentRead).toBe(true);
      expect(command.input.ScanIndexForward).toBe(true); expect(command.input.IndexName).toBeUndefined(); expect(command.input.FilterExpression).toBeUndefined();
      expect(command.input.KeyConditionExpression).toBe('#pk=:pk AND begins_with(#sk,:prefix)');
      const pk = command.input.ExpressionAttributeValues![':pk']!.S!; const after = command.input.ExclusiveStartKey?.SK?.S ?? '';
      const matching = [...stored.values()].filter(item => item.PK.S === pk && item.SK.S > after).sort((a, b) => a.SK.S < b.SK.S ? -1 : 1);
      const selected = matching.slice(0, command.input.Limit!);
      response = { Items: structuredClone(selected), ...(matching.length > selected.length ? {
        LastEvaluatedKey: { PK: selected.at(-1)!.PK, SK: selected.at(-1)!.SK } } : {}) };
    } else if (command instanceof BatchGetItemCommand) {
      const request = command.input.RequestItems![resources.target]!; expect(request.ConsistentRead).toBe(true);
      response = { Responses: { [resources.target]: request.Keys!.flatMap(key => {
        const item = stored.get(`${key.PK!.S}/${key.SK!.S}`); return item ? [structuredClone(item)] : [];
      }).reverse() } };
    } else throw new Error('unexpected SDK command');
    await intercept?.(command, response); return response;
  });
  const reader = (extra: Partial<Parameters<typeof createPartitionMembershipReader>[0]> = {}) => createPartitionMembershipReader({ ...config, now: () => time, ...extra });
  return { stored, send, reader, count: () => calls, time: (value: number) => { time = value; },
    intercept: (work: NonNullable<typeof intercept>) => { intercept = work; } };
}

it('pages one strongly consistent subject index in UTF8 key order and returns only allowlisted fresh group summaries', async () => {
  const data = fixture(); const reader = data.reader(); let cursor: string | undefined; const ids: string[] = [];
  do {
    const page = await reader.list({ subject: 'iris', limit: 10, ...(cursor ? { cursor } : {}) });
    ids.push(...page.groups.map(group => group.id)); cursor = page.cursor ?? undefined;
    expect(page.groups.every(group => Object.keys(group).sort().join(',') === 'id,isOrganizer,name,version')).toBe(true);
    if (cursor) expect(Buffer.from(cursor, 'base64url').toString()).not.toContain('iris');
  } while (cursor);
  expect(ids).toEqual(Array.from({ length: 24 }, (_, n) => `group-${String(n).padStart(2, '0')}`));
  expect(data.count()).toBe(21);
});

it('retained inactive, missing, removed and archived membership candidates grant no access and preserve page continuation', async () => {
  const data = fixture(6);
  const edge = data.stored.get('MEMBER#iris/GROUP#group-00')!; const inactive = PartitionMembershipRow.parse(JSON.parse(edge.payload.S)); inactive.value.active = false;
  edge.payload.S = JSON.stringify(inactive); data.stored.delete('GROUP#group-01/STATE');
  data.stored.set('GROUP#group-02/STATE', encode(partitionGroupKey('group-02'), group('group-02', ['other'])));
  data.stored.set('GROUP#group-03/STATE', encode(partitionGroupKey('group-03'), ArchivedGroupRow.parse({ schemaVersion: 1, kind: 'ARCHIVED_GROUP',
    revision: 3, groupId: 'group-03', organizer: 'iris', groupVersion: 4, sourceSha, sourceHash: digest('source'), manifestHash: digest('manifest'),
    manifestVersion: 'immutable', archivedAt: '2026-10-07T00:00:00.000Z' })));
  const first = await data.reader().list({ subject: 'iris', limit: 4 }); expect(first.groups).toEqual([]); expect(first.cursor).toBeTypeOf('string');
  const second = await data.reader().list({ subject: 'iris', limit: 4, cursor: first.cursor! }); expect(second.groups.map(row => row.id)).toEqual(['group-04', 'group-05']);
  expect(second.cursor).toBeNull();
});

it('denies absent/non-approved account and inactive/foreign-plan control before querying discovery rows', async () => {
  for (const defect of ['absent', 'PENDING', 'REJECTED', 'DISABLED', 'inactive', 'plan']) {
    const data = fixture();
    if (defect === 'absent') data.stored.delete('ACCOUNT#iris/STATE');
    else if (defect === 'inactive' || defect === 'plan') {
      const item = data.stored.get('MIGRATION#CONTROL/STATE')!; const row = JSON.parse(item.payload.S);
      if (defect === 'inactive') row.active = false; else row.planHash = 'e'.repeat(64); item.payload.S = JSON.stringify(row);
    } else { const item = data.stored.get('ACCOUNT#iris/STATE')!; const row = JSON.parse(item.payload.S); row.value.status = defect; item.payload.S = JSON.stringify(row); }
    await expect(data.reader().list({ subject: 'iris' })).rejects.toThrow('MEMBERSHIP_DENIED');
    expect(data.send.mock.calls.some(([command]) => command instanceof QueryCommand)).toBe(false); vi.restoreAllMocks();
  }
});

it('rejects cursor tampering, wrong subject/key/source/plan/limit and expiration before SDK access', async () => {
  const data = fixture(); const first = await data.reader().list({ subject: 'iris' }); const token = first.cursor!;
  for (const [reader, request] of [
    [data.reader(), { subject: 'iris', cursor: token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a') }],
    [data.reader(), { subject: 'other', cursor: token }], [data.reader(), { subject: 'iris', limit: 5, cursor: token }],
    [data.reader({ cursorKey: Buffer.alloc(32, 8) }), { subject: 'iris', cursor: token }],
    [data.reader({ sourceSha: 'b'.repeat(40) }), { subject: 'iris', cursor: token }],
    [data.reader({ planHash: 'e'.repeat(64) }), { subject: 'iris', cursor: token }],
  ] as const) {
    const before = data.count(); await expect(reader.list(request)).rejects.toThrow('MEMBERSHIP_INVALID'); expect(data.count()).toBe(before);
  }
  data.time(901000); const before = data.count(); await expect(data.reader().list({ subject: 'iris', cursor: token })).rejects.toThrow('MEMBERSHIP_INVALID'); expect(data.count()).toBe(before);
});

it('a changed approved account revision invalidates an old cursor before another query', async () => {
  const data = fixture(); const page = await data.reader().list({ subject: 'iris' }); const item = data.stored.get('ACCOUNT#iris/STATE')!;
  const row = JSON.parse(item.payload.S); row.revision++; item.revision.N = String(row.revision); item.payload.S = JSON.stringify(row);
  const before = data.count(); await expect(data.reader().list({ subject: 'iris', cursor: page.cursor! })).rejects.toThrow('MEMBERSHIP_STALE'); expect(data.count() - before).toBe(2);
});

it('fresh account/control/header rechecks reject concurrent disable/removal/rename without exposing a stale page', async () => {
  for (const defect of ['account', 'control', 'header']) {
    const data = fixture(1); let changed = false;
    data.intercept((command) => { if (command instanceof BatchGetItemCommand && !changed) {
      changed = true; const item = data.stored.get(defect === 'account' ? 'ACCOUNT#iris/STATE' : defect === 'control' ? 'MIGRATION#CONTROL/STATE' : 'GROUP#group-00/STATE')!;
      const row = JSON.parse(item.payload.S); if (defect === 'account') row.value.status = 'DISABLED';
      else if (defect === 'control') row.active = false; else row.value.name = 'Changed'; item.payload.S = JSON.stringify(row);
    } });
    await expect(data.reader().list({ subject: 'iris' })).rejects.toThrow(defect === 'header' ? 'MEMBERSHIP_STALE' : 'MEMBERSHIP_DENIED'); vi.restoreAllMocks();
  }
});

it('rejects malformed/foreign/duplicate/out-of-order/binding-mismatched membership wire rows and continuation keys', async () => {
  for (const defect of ['foreign', 'duplicate', 'order', 'binding', 'revision', 'extra', 'last', 'size', 'json']) {
    const data = fixture(3);
    data.intercept((command, response) => { if (command instanceof QueryCommand) {
      const items = response.Items as ReturnType<typeof encode>[];
      if (defect === 'foreign') items[0]!.PK.S = 'MEMBER#other';
      if (defect === 'duplicate') items[1] = structuredClone(items[0]!);
      if (defect === 'order') items.reverse();
      if (defect === 'binding') { const row = JSON.parse(items[0]!.payload.S); row.value.groupId = 'foreign'; items[0]!.payload.S = JSON.stringify(row); }
      if (defect === 'revision') items[0]!.revision.N = '01';
      if (defect === 'extra') Object.assign(items[0]!, { secret: { S: 'synthetic' } });
      if (defect === 'last') response.LastEvaluatedKey = { PK: { S: 'MEMBER#iris' }, SK: { S: 'GROUP#foreign' } };
      if (defect === 'size') items.push(...Array.from({ length: 10 }, () => structuredClone(items[0]!)));
      if (defect === 'json') items[0]!.payload.S = ' ' + items[0]!.payload.S;
    } });
    await expect(data.reader().list({ subject: 'iris' })).rejects.toThrow('MEMBERSHIP_INVALID'); vi.restoreAllMocks();
  }
});

it('rejects foreign/duplicate/corrupt batch groups and contradictory or repeated unprocessed keys', async () => {
  for (const defect of ['foreign', 'duplicate', 'key', 'revision', 'contradictory', 'repeat']) {
    const data = fixture(2);
    data.intercept((command, response) => { if (command instanceof BatchGetItemCommand) {
      const results = response.Responses as Record<string, ReturnType<typeof encode>[]>; const items = results[resources.target]!;
      if (defect === 'foreign') results.foreign = [];
      if (defect === 'duplicate') items.push(structuredClone(items[0]!));
      if (defect === 'key') items[0]!.PK.S = 'GROUP#foreign';
      if (defect === 'revision') items[0]!.revision.N = '8';
      if (defect === 'contradictory') response.UnprocessedKeys = { [resources.target]: { Keys: [{ PK: items[0]!.PK, SK: items[0]!.SK }] } };
      if (defect === 'repeat') { results[resources.target] = []; response.UnprocessedKeys = command.input.RequestItems; }
    } });
    await expect(data.reader().list({ subject: 'iris' })).rejects.toThrow(defect === 'repeat' ? 'MEMBERSHIP_STORAGE_UNAVAILABLE' : 'MEMBERSHIP_INVALID'); vi.restoreAllMocks();
  }
});

it('retries only the bounded unprocessed header keys and restores input order under the same request ceiling', async () => {
  const data = fixture(3); let first = true;
  data.intercept((command, response) => { if (command instanceof BatchGetItemCommand && first) {
    first = false; const results = response.Responses as Record<string, ReturnType<typeof encode>[]>; const item = results[resources.target]!.pop()!;
    response.UnprocessedKeys = { [resources.target]: { Keys: [{ PK: item.PK, SK: item.SK }] } };
  } });
  expect((await data.reader().list({ subject: 'iris' })).groups.map(row => row.id)).toEqual(['group-00', 'group-01', 'group-02']);
  expect(data.count()).toBe(8);
  await expect(data.reader({ maxRequests: 3 }).list({ subject: 'iris' })).rejects.toThrow('MEMBERSHIP_REQUEST_LIMIT');
});

it('deadline aborts a held query and prevents late header/authority requests', async () => {
  const data = fixture(1); let release: (() => void) | undefined;
  data.intercept(async command => { if (command instanceof QueryCommand) await new Promise<void>(resolve => { release = resolve; }); });
  await expect(data.reader({ timeoutMs: 20 }).list({ subject: 'iris' })).rejects.toThrow('MEMBERSHIP_TIMEOUT');
  expect(data.count()).toBe(3); release?.(); await new Promise(resolve => setTimeout(resolve, 15)); expect(data.count()).toBe(3);
});

it('invalid targets/configuration/requests send nothing and a copied private cursor key survives external mutation', async () => {
  const data = fixture();
  for (const extra of [{ sourceSha: '0'.repeat(40) }, { planHash: '0'.repeat(64) }, { cursorKey: Buffer.alloc(31) },
    { verifiedTarget: { account: 'foreign', region: resources.region } }]) expect(() => data.reader(extra)).toThrow('MEMBERSHIP_INVALID');
  const reader = data.reader();
  for (const request of [{ subject: '../other' }, { subject: 'iris', limit: 21 }, { subject: 'iris', private: 'value' },
    { subject: 'iris', cursor: '' }]) await expect(reader.list(request)).rejects.toThrow('MEMBERSHIP_INVALID');
  expect(data.count()).toBe(0);
  const own = Buffer.alloc(32, 7); const pinned = data.reader({ cursorKey: own }); own.fill(8);
  const page = await pinned.list({ subject: 'iris' }); expect((await pinned.list({ subject: 'iris', cursor: page.cursor! })).groups).toHaveLength(10);
});

it('compiles strict private candidate seeds from a valid group header without accounts, invitations or authority adoption', () => {
  const row = group('garden', ['iris', 'ivy']); const seeds = partitionMembershipSeeds(row);
  expect(seeds.map(item => item.key)).toEqual([{ PK: 'MEMBER#iris', SK: 'GROUP#garden' }, { PK: 'MEMBER#ivy', SK: 'GROUP#garden' }]);
  expect(seeds.every(item => Object.keys(item.row.value).sort().join(',') === 'active,groupId,subject')).toBe(true);
  if (row.kind !== 'GROUP') throw new Error('fixture'); row.value.members.push('iris'); expect(() => partitionMembershipSeeds(row)).toThrow('MEMBERSHIP_INVALID');
});


it('rejects malformed SDK collection shapes with a fixed error instead of leaking parser exceptions', async () => {
  for (const defect of ['items', 'batch', 'keys', 'empty-continuation']) {
    const data = fixture(2);
    data.intercept((command, response) => {
      if (command instanceof QueryCommand && defect === 'items') response.Items = { private: 'synthetic' };
      if (command instanceof QueryCommand && defect === 'empty-continuation') {
        response.Items = []; response.LastEvaluatedKey = { PK: { S: 'MEMBER#iris' }, SK: { S: 'GROUP#group-00' } };
      }
      if (command instanceof BatchGetItemCommand && defect === 'batch') response.Responses = { [resources.target]: { private: 'synthetic' } };
      if (command instanceof BatchGetItemCommand && defect === 'keys') response.UnprocessedKeys = { [resources.target]: { Keys: { private: 'synthetic' } } };
    });
    await expect(data.reader().list({ subject: 'iris' })).rejects.toThrow('MEMBERSHIP_INVALID'); vi.restoreAllMocks();
  }
});

it('storage failures retain private causes but expose only a fixed safe message; invalid limits are rejected at construction', async () => {
  const data = fixture(1); data.intercept(command => { if (command instanceof QueryCommand) throw new Error('synthetic private storage detail'); });
  await expect(data.reader().list({ subject: 'iris' })).rejects.toMatchObject({ message: 'MEMBERSHIP_STORAGE_UNAVAILABLE' });
  expect(() => data.reader({ maxRequests: 0 })).toThrow('MEMBERSHIP_INVALID');
  expect(() => data.reader({ timeoutMs: 20001 })).toThrow('MEMBERSHIP_INVALID');
});
