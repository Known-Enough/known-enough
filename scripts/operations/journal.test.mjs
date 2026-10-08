import { test } from 'node:test';
import assert from 'node:assert/strict';
import { journalService } from './journal.mjs';
const envelope = { sourceSha: 'a'.repeat(40), operation: 'PARTITION', resourceArn: 'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughGroupsStage', contractHash: 'b'.repeat(64), maxItems: 10 };
const plan = { schemaVersion: 1, sourceSha: envelope.sourceSha, account: '092954139775', region: 'us-east-1', operation: envelope.operation, resourceArn: envelope.resourceArn, contractHash: envelope.contractHash, expectedRevision: 3, maxItems: 10, recoveryManifestHash: 'c'.repeat(64) };
function fakeStorage() {
  const rows = new Map();
  return {
    async read(key) { return structuredClone(rows.get(key)); },
    async createIfAbsent(key, row) { if (!rows.has(key)) rows.set(key, structuredClone(row)); },
    async compareAndSwap(key, revision, row) {
      if (rows.get(key)?.revision !== revision) return false;
      rows.set(key, structuredClone(row)); return true;
    }
  };
}
test('duplicate prepare preserves progress and recreated service reloads same port state', async () => {
  const port = fakeStorage(); const service = journalService(port);
  const initial = await service.prepare(plan, envelope);
  await service.advance(plan, envelope, 0, { ...initial.journal, state: 'APPLYING', completedItems: 2 });
  assert.equal((await service.prepare(plan, envelope)).journal.completedItems, 2);
  assert.equal((await journalService(port).load(plan, envelope)).revision, 1);
});
test('two concurrent writers permit exactly one conditional progression', async () => {
  const service = journalService(fakeStorage()); const initial = await service.prepare(plan, envelope);
  const outcomes = await Promise.allSettled([2, 3].map(completedItems => service.advance(plan, envelope, 0,
    { ...initial.journal, state: 'APPLYING', completedItems })));
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(x => x.status === 'rejected').length, 1);
  assert.equal((await service.load(plan, envelope)).revision, 1);
});
test('refuses missing conditional port or unavailable journal', async () => {
  assert.throws(() => journalService({}), /OPS_STORAGE_REQUIRED/);
  await assert.rejects(journalService(fakeStorage()).load(plan, envelope), /OPS_JOURNAL_UNAVAILABLE/);
});

for (const [label, acknowledgement] of [['undefined', undefined], ['null', null], ['zero', 0], ['one', 1],
  ['false string', 'false'], ['true string', 'true'], ['object', {}], ['array', []], ['boxed boolean', Object(true)]]) {
  test(`unknown CAS acknowledgement (${label}) cannot report journal progression or retry`, async () => {
    const port = fakeStorage(); const service = journalService(port); const initial = await service.prepare(plan, envelope);
    let writes = 0; let reads = 0; const read = port.read;
    port.read = async key => { reads++; return read(key); };
    port.compareAndSwap = async () => { writes++; return acknowledgement; };
    await assert.rejects(service.advance(plan, envelope, 0, { ...initial.journal, state: 'APPLYING', completedItems: 2 }),
      /^Error: OPS_JOURNAL_UNAVAILABLE$/);
    assert.equal(writes, 1); assert.equal(reads, 1);
    assert.deepEqual(await journalService(port).load(plan, envelope), initial);
  });
}

test('unknown acknowledgement after a committed write preserves progress for explicit read-only reconciliation', async () => {
  const port = fakeStorage(); const service = journalService(port); const initial = await service.prepare(plan, envelope);
  let writes = 0; const compare = port.compareAndSwap;
  port.compareAndSwap = async (...args) => { writes++; await compare(...args); return { acknowledged: true, private: 'PRIVATE' }; };
  const next = { ...initial.journal, state: 'APPLYING', completedItems: 2 };
  await assert.rejects(service.advance(plan, envelope, 0, next), /^Error: OPS_JOURNAL_UNAVAILABLE$/);
  const resumed = journalService(port);
  assert.deepEqual(await resumed.load(plan, envelope), { revision: 1, journal: next });
  await assert.rejects(resumed.advance(plan, envelope, 0, next), /^Error: OPS_PLAN_REJECTED$/);
  assert.equal(writes, 1);
});

const rejectedReadbacks = [
  { label: 'stale revision', revision: 0 },
  { label: 'different same-revision contents', revision: 1, state: 'COMPLETE' },
  { label: 'later count rollback', revision: 2, completedItems: 1 },
  { label: 'later phase rollback', revision: 2, proposedItems: 0, state: 'PREPARED', completedItems: 0 },
  { label: 'terminal phase rollback', revision: 2, proposedState: 'COMPLETE', state: 'APPLYING' },
  { label: 'terminal count change', revision: 2, proposedState: 'COMPLETE', completedItems: 3 },
  { label: 'different same-revision count', revision: 1, completedItems: 3 }
];
for (const { label, revision, proposedItems = 2, proposedState = 'APPLYING', state = proposedState, completedItems = proposedItems } of rejectedReadbacks) {
  test(`acknowledged CAS with ${label} cannot report verified progression`, async () => {
    const port = fakeStorage(); const service = journalService(port); const initial = await service.prepare(plan, envelope);
    const read = port.read; const compare = port.compareAndSwap; let writes = 0;
    port.compareAndSwap = async (...args) => { writes++; return compare(...args); };
    port.read = async key => {
      const row = await read(key);
      return row.revision ? { revision, journal: { ...row.journal, state, completedItems } } : row;
    };
    await assert.rejects(service.advance(plan, envelope, 0, { ...initial.journal, state: proposedState, completedItems: proposedItems }),
      /^Error: OPS_JOURNAL_UNAVAILABLE$/);
    assert.equal(writes, 1);
    assert.deepEqual(await read(initial.journal.planHash), { revision: 1,
      journal: { ...initial.journal, state: proposedState, completedItems: proposedItems } });
  });
}

for (const [label, proposedState, laterState, laterItems] of [['later applying progress', 'APPLYING', 'APPLYING', 3],
  ['later completion', 'APPLYING', 'COMPLETE', 3], ['unchanged terminal progress', 'COMPLETE', 'COMPLETE', 2]]) {
  test(`verified concurrent ${label} is returned without an extra service mutation`, async () => {
    const port = fakeStorage(); const service = journalService(port); const initial = await service.prepare(plan, envelope);
    const compare = port.compareAndSwap; let serviceWrites = 0;
    port.compareAndSwap = async (key, revision, row) => {
      serviceWrites++; const acknowledged = await compare(key, revision, row);
      // Another simulated atomic writer progresses before the first runner reads back.
      assert.equal(await compare(key, row.revision, { revision: row.revision + 1,
        journal: { ...row.journal, state: laterState, completedItems: laterItems } }), true);
      return acknowledged;
    };
    const result = await service.advance(plan, envelope, 0, { ...initial.journal, state: proposedState, completedItems: 2 });
    assert.deepEqual(result, { revision: 2, journal: { ...initial.journal, state: laterState, completedItems: laterItems } });
    assert.deepEqual(await journalService(port).prepare(plan, envelope), result); assert.equal(serviceWrites, 1);
  });
}
