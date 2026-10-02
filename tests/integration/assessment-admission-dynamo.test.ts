import { AsyncLocalStorage } from 'node:async_hooks';
import { expect, test } from 'vitest';
import { DynamoDBClient, TransactGetItemsCommand, TransactWriteItemsCommand, type AttributeValue, type TransactWriteItem } from '@aws-sdk/client-dynamodb';
import { KnownEnoughApplication } from '@deal-table/application';
import { DynamoDBRoomRepository, InMemoryRoomRepository, MemoryGroupRepository, BoundedModelJobs, createGroupRepositoryTransport, withAdmissionFence } from '@deal-table/adapters';
import { buildChristmasFixture } from '../../packages/test-support/src/known-enough-fixtures.ts';
import type { Groups } from '@deal-table/contracts';
type Item = Record<string, AttributeValue>;
const location = (table: string, key: Item) => table + ':' + key.PK!.S + ':' + key.SK!.S;
async function harness() {
  const memory = new InMemoryRoomRepository(); const fixture = buildChristmasFixture();
  const application = new KnownEnoughApplication({ repository: memory, clock: { now: () => '2026-10-02T00:00:00Z' }, ids: { next: () => 'synthetic-id' } });
  await application.createDecision({ definition: fixture.definition, creatorSubject: 'maya', memberships: fixture.definition.participants.map(person => ({ subject: person.id, participantId: person.id, active: true })) });
  const record = await memory.transactionDecision(fixture.definition.decisionId, value => value!);
  const cells = new Map<string, Item>(); const writes: TransactWriteItem[][] = []; let revokeAtCommit = false;
  const groupKey = { PK: { S: 'NP#GROUPS' }, SK: { S: 'STATE' } }; const groupLocation = location('groups', groupKey);
  cells.set(groupLocation, { ...groupKey, version: { N: '1' }, payload: { S: JSON.stringify({ accounts: [], groups: [] }) } });
  const client = { send: async (command: TransactGetItemsCommand | TransactWriteItemsCommand) => {
    if (command instanceof TransactGetItemsCommand) return { Responses: command.input.TransactItems!.map(entry => ({ Item: structuredClone(cells.get(location(entry.Get!.TableName!, entry.Get!.Key!))) })) };
    const items = command.input.TransactItems!; writes.push(items);
    if (revokeAtCommit && items.some(entry => entry.ConditionCheck?.TableName === 'groups' || entry.Put?.TableName === 'groups')) {
      cells.set(groupLocation, { ...cells.get(groupLocation)!, version: { N: '2' } }); revokeAtCommit = false;
    }
    // Check every relevant version BEFORE applying any item: modeled DynamoDB atomic cancellation.
    for (const entry of items) {
      const check = entry.ConditionCheck ?? entry.Put;
      if (check?.TableName === 'groups' && Number(cells.get(groupLocation)!.version!.N) !== Number(check.ExpressionAttributeValues![':v']!.N)) {
        throw Object.assign(new Error('atomic conditional failure'), { name: 'TransactionCanceledException', CancellationReasons: [{ Code: 'ConditionalCheckFailed' }] });
      }
    }
    for (const entry of items) {
      if (entry.Put) cells.set(location(entry.Put.TableName!, entry.Put.Item!), structuredClone(entry.Put.Item!));
      if (entry.Update) {
        const update = entry.Update; const id = location(update.TableName!, update.Key!); const stored = structuredClone(cells.get(id)!);
        for (const assignment of update.UpdateExpression!.replace(/^SET /, '').split(',')) {
          const [name, value] = assignment.trim().split(/\s*=\s*/);
          stored[update.ExpressionAttributeNames![name!]!] = structuredClone(update.ExpressionAttributeValues![value!]!);
        }
        cells.set(id, stored);
      }
    }
    return {};
  } } as unknown as DynamoDBClient;
  const repository = new DynamoDBRoomRepository({ tableName: 'decisions', client, maxAttempts: 2, pause: async () => {} });
  await repository.createDecision(record);
  const groups = createGroupRepositoryTransport({
    read: async () => ({ version: Number(cells.get(groupLocation)!.version!.N), state: JSON.parse(cells.get(groupLocation)!.payload!.S!) as Groups.GroupState }),
    write: async () => { throw new Error('SEPARATE_GROUP_WRITE_FORBIDDEN'); },
    fenceWrite: (expected, state) => {
      const condition = { ConditionExpression: '#v=:v', ExpressionAttributeNames: { '#v': 'version' }, ExpressionAttributeValues: { ':v': { N: String(expected) } } };
      return state ? { Put: { TableName: 'groups', Item: { ...groupKey, version: { N: String(expected + 1) }, payload: { S: JSON.stringify(state) } }, ...condition } }
        : { ConditionCheck: { TableName: 'groups', Key: groupKey, ...condition } };
    }
  });
  return { repository, groups, record, client, cells, writes, groupLocation, revoke: () => { revokeAtCommit = true; } };
}
test('decision writes include the exact cross-table admission condition, even when revocation happens only at commit', async () => {
  const h = await harness(); const fence = await h.groups.fence(() => {}); const before = await h.repository.transactionDecision(h.record.decisionId, value => value!);
  h.revoke(); await expect(withAdmissionFence(h.record.decisionId, fence, () => h.repository.transactionDecision(h.record.decisionId, value => { value!.controlVersion++; }))).rejects.toThrow('STALE_CONTEXT');
  expect(await h.repository.transactionDecision(h.record.decisionId, value => value!)).toEqual(before);
  expect(h.writes.at(-1)![0]!.ConditionCheck).toMatchObject({ TableName: 'groups', ExpressionAttributeValues: { ':v': { N: '1' } } });
});
test('coordinated group binding and decision revision commit in one transaction', async () => {
  const h = await harness(); const fence = await h.groups.fence(state => { state.accounts.push({ subject: 'synthetic', emailHash: 'a'.repeat(64), displayName: 'Synthetic', status: 'APPROVED', version: 1 }); });
  await withAdmissionFence(h.record.decisionId, fence, () => h.repository.transactionDecision(h.record.decisionId, value => { value!.controlVersion++; }));
  const write = h.writes.at(-1)!; expect(write[0]!.Put?.TableName).toBe('groups'); expect(write.some(entry => entry.Put?.TableName === 'decisions')).toBe(true);
  expect(Number(h.cells.get(h.groupLocation)!.version!.N)).toBe(2); expect((await h.repository.transactionDecision(h.record.decisionId, value => value!)).controlVersion).toBe(1);
});
test('coordinated transaction cancellation changes neither decision nor proposed group payload', async () => {
  const h = await harness(); const before = await h.repository.transactionDecision(h.record.decisionId, value => value!);
  const fence = await h.groups.fence(state => { state.accounts.push({ subject: 'synthetic', emailHash: 'a'.repeat(64), displayName: 'Synthetic', status: 'APPROVED', version: 1 }); });
  h.revoke(); await expect(withAdmissionFence(h.record.decisionId, fence, () => h.repository.transactionDecision(h.record.decisionId, value => { value!.controlVersion++; }))).rejects.toThrow('STALE_CONTEXT');
  expect(JSON.parse(h.cells.get(h.groupLocation)!.payload!.S!).accounts).toHaveLength(0); expect(await h.repository.transactionDecision(h.record.decisionId, value => value!)).toEqual(before);
});
test('queued model work and both authority checks retain originating async context', async () => {
  const scope = new AsyncLocalStorage<string>(); const jobs = new BoundedModelJobs({ concurrency: 1 }); const seen: (string | undefined)[] = [];
  let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; });
  const run = (who: string, pause: boolean) => scope.run(who, () => jobs.run('OWNER', { expiresAt: Date.now() + 1000,
    assertCurrent: async () => { seen.push(scope.getStore()); } }, async () => { seen.push(scope.getStore()); if (pause) await blocked; return who; }));
  const first = run('first', true); const second = run('second', false); await new Promise(resolve => setTimeout(resolve, 0)); release();
  expect(await Promise.all([first, second])).toEqual(['first', 'second']); expect(seen).toEqual(['first', 'first', 'first', 'second', 'second', 'second']);
});

test('decision creation is atomically denied when admission changes at its write boundary', async () => {
  const h = await harness(); const fence = await h.groups.fence(() => {});
  const repository = new DynamoDBRoomRepository({ tableName: 'newdecisions', client: h.client, maxAttempts: 2, pause: async () => {} });
  h.revoke(); await expect(withAdmissionFence(h.record.decisionId, fence, () => repository.createDecision(h.record))).rejects.toThrow('STALE_CONTEXT');
  expect([...h.cells.keys()].some(key => key.startsWith('newdecisions:'))).toBe(false);
});
test('incompatible storage compositions cannot weaken the atomic admission guarantee', async () => {
  const h = await harness(); const durableFence = await h.groups.fence(() => {});
  await expect(withAdmissionFence(h.record.decisionId, durableFence, () => new InMemoryRoomRepository().createDecision(h.record))).rejects.toThrow('INCOMPATIBLE_ADMISSION_REPOSITORIES');
  const group = new MemoryGroupRepository(); const memoryFence = await group.fence(() => {});
  await expect(withAdmissionFence(h.record.decisionId, memoryFence, () => h.repository.transactionDecision(h.record.decisionId, value => value))).rejects.toThrow();
});
