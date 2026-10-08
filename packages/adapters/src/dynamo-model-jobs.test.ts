import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { afterEach, expect, it, vi } from 'vitest';
import { createDynamoModelJobStore, createDynamoModelJobLoader, JOB_TARGET as r, checkedJobFence } from './dynamo-model-jobs.ts';
import { DurableModelJobs } from './durable-model-jobs.ts';
import { durableFixture } from './test-support/durable-model-fixture.ts';
import { encodeDecisionStateItem } from './dynamodb-codec.ts';
afterEach(() => vi.restoreAllMocks());
async function workerFixture() {
  const f = await durableFixture(implementation => vi.spyOn(DynamoDBClient.prototype, 'send').mockImplementation(implementation as never));
  const invoke = vi.fn(async () => ({ output: 'transient', usage: { inputTokens: 1, outputTokens: 1 } }));
  const make = () => new DurableModelJobs({ store: f.store(), now: f.now, execution: {
    reload: async () => ({ context: null, fence: f.fence() }), invoke,
    prepare: async () => ({ writes: [{ key: { PK: 'ROOM#decision', SK: 'STATE' }, payload: encodeDecisionStateItem({ ...f.record, job: null, controlVersion: f.record.controlVersion + 1, status: 'NO_AGREEMENT' }).payload!.S! }] }),
  } });
  return { ...f, make, invoke };
}
it('native durable restart/output transaction preserves TOTAL, state codec and guard counters', async () => {
  const f = await workerFixture(); await f.make().enqueue(f.reference);
  expect(await f.make().deliveries()).toEqual([{ jobId: f.reference.jobId }]);
  expect(await f.make().process({ jobId: f.reference.jobId })).toBe('APPLIED');
  expect(f.parsed(r.budget, 'TOTAL')).toEqual({ runs: 8, messages: 6, reservedTokens: 18_932, reservedCostMicros: 10_700 });
  expect(f.parsed(r.journal, `MODELJOB#${f.reference.jobId}`).phase).toBe('SUCCEEDED');
  expect(f.parsed(r.decisions, 'ROOM#decision').record.job).toBe(null);
  expect(f.get(r.decisions, 'ROOM#decision', 'GUARD').version!.N).toBe('2');
  const result = f.writes.at(-1)!; expect(result.filter(item => item.Put)).toHaveLength(5);
  expect(JSON.stringify(f.get(r.journal, `MODELJOB#${f.reference.jobId}`))).not.toMatch(/private-condition|transient/);
  expect(f.invoke).toHaveBeenCalledTimes(1);
});
it.each(['account', 'source', 'consent', 'guard', 'total'] as const)('atomic %s race rejects provider/result without partial writes', async target => {
  const f = await workerFixture(); await f.make().enqueue(f.reference); let changed = false;
  f.before(items => {
    const output = items.some(item => item.Put?.TableName === r.decisions);
    const calling = items.some(item => item.Put?.Item?.PK?.S?.startsWith('MODELJOB#') && JSON.parse(item.Put.Item.payload!.S!).phase === 'CALLING');
    if (changed || !(target === 'total' ? calling : output)) return; changed = true;
    const cell = target === 'guard' ? f.get(r.decisions, 'ROOM#decision', 'GUARD') : target === 'account' ? f.get(r.partitions, 'ACCOUNT#iris')
      : target === 'source' ? f.get(r.source, 'NP#GROUPS') : target === 'total' ? f.get(r.budget, 'TOTAL') : f.get(r.decisions, 'ROOM#decision');
    if (target === 'guard') cell.incarnation = { S: 'new-erasure-incarnation' };
    else if (target === 'total') { cell.version = { N: String(Number(cell.version!.N) + 1) }; const value = JSON.parse(cell.payload!.S!); value.reservedTokens += 99; cell.payload = { S: JSON.stringify(value) }; }
    else cell.payload = { S: JSON.stringify({ replaced: true }) };
  });
  expect(await f.make().process({ jobId: f.reference.jobId })).toBe('DEAD');
  expect(f.parsed(r.journal, `MODELJOB#${f.reference.jobId}`).phase).toBe('DEAD');
  expect(f.invoke).toHaveBeenCalledTimes(target === 'total' ? 0 : 1);
  expect(f.writes.filter(items => items.some(item => item.Put?.TableName === r.decisions))).toHaveLength(target === 'total' ? 0 : 1);
});
it('lost final acknowledgement is read back without duplicate charge or application', async () => {
  const f = await workerFixture(); await f.make().enqueue(f.reference);
  f.before(items => { if (items.some(item => item.Put?.TableName === r.decisions)) f.loseAck(); });
  expect(await f.make().process({ jobId: f.reference.jobId })).toBe('APPLIED');
  expect(await f.make().process({ jobId: f.reference.jobId })).toBe('SKIPPED'); expect(f.invoke).toHaveBeenCalledTimes(1);
  expect(f.parsed(r.budget, 'TOTAL').reservedTokens).toBe(18_932);
});
it('missing TOTAL or inactive-source configuration cannot seed/reset accounting', async () => {
  const f = await workerFixture(); f.cells.delete(`${r.budget}/TOTAL/STATE`);
  await expect(f.make().enqueue(f.reference)).rejects.toThrow('MODEL_JOB_INVALID'); expect(f.writes).toHaveLength(0);
});
it('native prior snapshots cannot be fabricated/mutated and envelope revisions must agree', async () => {
  const f = await workerFixture(); await f.make().enqueue(f.reference); const store = f.store(); const prior = await store.read(f.reference.jobId);
  prior.totals.reservedTokens = 0; await expect(store.commit(prior, structuredClone(prior))).rejects.toThrow('MODEL_JOB_INVALID');
  f.get(r.journal, 'OPERATIONS#MODEL_JOBS').revision = { N: '999' }; await expect(store.read(f.reference.jobId)).rejects.toThrow('MODEL_JOB_INVALID');
});
it.each(['ACCOUNT#iris', 'MIGRATION#CONTROL', 'OPERATIONS#RETENTION', 'RETENTION#iris', 'AUTH', 'ROOM#decision'])( 'requires current %s fence', async PK => {
  const f = await workerFixture(); const fence = f.fence(); fence.pins = fence.pins.filter(pin => pin.key.PK !== PK);
  expect(() => checkedJobFence(fence)).toThrow(); expect(f.writes).toHaveLength(0);
});
it('strict target, duplicate/fake/foreign pins, legacy authority and private job envelopes fail closed', async () => {
  const f = await workerFixture(); expect(() => createDynamoModelJobStore({ verifiedTarget: { account: '000000000000', region: r.region }, sourceSha: f.reference.sourceSha })).toThrow();
  const duplicate = f.fence(); duplicate.pins.push(duplicate.pins[0]!); expect(() => checkedJobFence(duplicate)).toThrow();
  const foreign = f.fence(); foreign.pins[0]!.key.PK = '*'; expect(() => checkedJobFence(foreign)).toThrow();
  const legacy = f.fence(); legacy.pins.find(pin => pin.table === r.budget)!.payload = JSON.stringify({ mode: 'legacy' }); expect(() => checkedJobFence(legacy)).toThrow('MODEL_JOB_DISABLED');
});
it.each(['approved', 'retentionReviewed', 'invocationLoggingDisabled'] as const)('standing AUTH %s withdrawal blocks execution without resetting usage', async flag => {
  const f = await workerFixture(); await f.make().enqueue(f.reference); const cell = f.get(r.budget, 'AUTH'), value = JSON.parse(cell.payload!.S!); value[flag] = false; cell.payload = { S: JSON.stringify(value) };
  expect(await f.make().process({ jobId: f.reference.jobId })).toBe('DEAD'); expect(f.invoke).not.toHaveBeenCalled(); expect(f.parsed(r.budget, 'TOTAL').reservedTokens).toBe(500);
});
it('standing per-run bounds and exact attempt reservation are enforced with current AUTH CAS', async () => {
  const f = await workerFixture(); await f.make().enqueue(f.reference); const cell = f.get(r.budget, 'AUTH'), value = JSON.parse(cell.payload!.S!); value.maxTokensPerRun = 100; cell.payload = { S: JSON.stringify(value) };
  expect(await f.make().process({ jobId: f.reference.jobId })).toBe('DEAD'); expect(f.invoke).not.toHaveBeenCalled(); expect(f.parsed(r.budget, 'TOTAL').reservedTokens).toBe(500);
});
it('native source/group discovery reloads all members atomically without scans or cached authorization', async () => {
  const f = await workerFixture(), load = createDynamoModelJobLoader({ verifiedTarget: { region: r.region, account: r.account }, sourceSha: f.reference.sourceSha });
  const first = await load(f.reference); expect(first.fence.pins.some(pin => pin.key.PK === 'ACCOUNT#omar')).toBe(true);
  expect(first.fence.pins.some(pin => pin.key.PK === 'RETENTION#omar')).toBe(true); expect(first.fence.pins.some(pin => pin.key.PK === 'DECISION#decision')).toBe(true);
  const group = f.get(r.partitions, 'GROUP#garden'), value = JSON.parse(group.payload!.S!); value.value.members = ['omar']; group.payload = { S: JSON.stringify(value) };
  await expect(load(f.reference)).rejects.toThrow('MODEL_JOB_STALE');
});
it('native copied-journal/source activation mismatch and corrupt guard fail closed', async () => {
  const f = await workerFixture(); const load = createDynamoModelJobLoader({ verifiedTarget: { account: r.account, region: r.region }, sourceSha: f.reference.sourceSha });
  const source = f.get(r.source, 'NP#GROUPS'), value = JSON.parse(source.payload!.S!); value.manifestVersion = 'foreign'; source.payload = { S: JSON.stringify(value) };
  await expect(load(f.reference)).rejects.toThrow('MODEL_JOB_STALE');
  value.manifestVersion = 'immutable-v1'; source.payload = { S: JSON.stringify(value) }; f.get(r.decisions, 'ROOM#decision', 'GUARD').version = { N: '0.5' };
  await expect(load(f.reference)).rejects.toThrow();
});
it('native per-store request bounds stop repeated recovery reads without provider work or permission widening', async () => {
  const f = await workerFixture(), store = f.store(); for (let n = 0; n < 64; n++) await store.deliveries();
  await expect(store.deliveries()).rejects.toThrow('MODEL_JOB_CAPACITY'); expect(f.invoke).not.toHaveBeenCalled(); expect(f.writes).toHaveLength(0);
});
