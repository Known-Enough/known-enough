import { test } from 'node:test';
import assert from 'node:assert/strict';
import { journalService } from './journal.mjs';
import { dynamoJournal } from './dynamo-journal.mjs';
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

async function mutableJournal() {
  const inputPlan = { ...plan }; const inputEnvelope = { ...envelope };
  const raw = fakeStorage(); const service = journalService(raw);
  const initial = await service.prepare(inputPlan, inputEnvelope); const calls = [];
  for (const method of ['read', 'createIfAbsent', 'compareAndSwap']) {
    const original = raw[method];
    raw[method] = async (...args) => { calls.push({ method, key: args[0] }); return original(...args); };
  }
  return { plan: inputPlan, envelope: inputEnvelope, raw, service, initial, calls };
}
function changeJournalContract(p) {
  Object.assign(p.envelope, { sourceSha: 'd'.repeat(40), operation: 'ERASE',
    resourceArn: 'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughGroupsAlternate',
    contractHash: 'e'.repeat(64), maxItems: 20 });
  Object.assign(p.plan, p.envelope, { expectedRevision: 7, recoveryManifestHash: 'f'.repeat(64) });
}
for (const [action, method, occurrence] of [
  ['load', 'read', 0], ['prepare', 'createIfAbsent', 0], ['prepare', 'read', 0],
  ['advance', 'read', 0], ['advance', 'compareAndSwap', 0], ['advance', 'read', 1]
]) {
  test(`${action} keeps its checked plan through ${method} wait ${occurrence}`, async () => {
    const p = await mutableJournal(); let entered, release, observed = 0;
    const began = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const original = p.raw[method];
    p.raw[method] = async (...args) => {
      if (observed++ === occurrence) { entered(); await gate; }
      return original(...args);
    };
    const next = { ...p.initial.journal, state: 'APPLYING', completedItems: 2 };
    const pending = action === 'advance' ? p.service.advance(p.plan, p.envelope, 0, next)
      : p.service[action](p.plan, p.envelope);
    await began; changeJournalContract(p); release();
    const result = await pending;
    assert.deepEqual(result, action === 'advance' ? { revision: 1, journal: next } : p.initial);
    const methods = action === 'load' ? ['read'] : action === 'prepare' ? ['createIfAbsent', 'read']
      : ['read', 'compareAndSwap', 'read'];
    assert.deepEqual(p.calls, methods.map(method => ({ method, key: p.initial.journal.planHash })));
    assert.equal(p.plan.sourceSha, 'd'.repeat(40));
    assert.equal(p.envelope.maxItems, 20);
  });
}

// This regression uses the actual Dynamo adapter, with a synthetic service port.
test('a pending Dynamo progression preserves submitted state and item count', async () => {
  let item, entered, release, waiting = false; const calls = [];
  const began = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const port = dynamoJournal(async (op, input) => {
    calls.push(op);
    if (op === 'GetItem') {
      if (waiting) { entered(); await gate; waiting = false; }
      return { Item: structuredClone(item) };
    }
    item = structuredClone(input.Item); return {};
  }, 'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughOperationsJournal');
  const service = journalService(port); const initial = await service.prepare(plan, envelope);
  calls.length = 0;
  const next = { ...initial.journal, state: 'APPLYING', completedItems: 2 };
  const submitted = structuredClone(next); waiting = true;
  const pending = service.advance(plan, envelope, 0, next);
  await began; next.state = 'COMPLETE'; next.completedItems = 10; release();
  assert.deepEqual(await pending, { revision: 1, journal: submitted });
  assert.deepEqual(JSON.parse(item.journal.S), submitted);
  assert.deepEqual(calls, ['GetItem', 'PutItem', 'GetItem']);
  assert.equal(next.state, 'COMPLETE');
});
for (const action of ['load', 'prepare', 'advance']) {
  test(`${action} captures caller getters once before its first storage call`, async () => {
    const p = await mutableJournal(); const next = { ...p.initial.journal, state: 'APPLYING', completedItems: 2 };
    const submitted = structuredClone(next); const reads = new Map();
    function input(name, values) {
      const result = {};
      for (const [field, value] of Object.entries(values)) {
        const label = `${name}.${field}`; reads.set(label, 0);
        Object.defineProperty(result, field, { enumerable: true, get() {
          const count = reads.get(label) + 1; reads.set(label, count);
          if (count > 1) throw new Error('private changing getter details');
          assert.deepEqual(p.calls, []); return value;
        } });
      }
      return result;
    }
    const ownedPlan = input('plan', p.plan), ownedEnvelope = input('envelope', p.envelope);
    const result = action === 'advance'
      ? await p.service.advance(ownedPlan, ownedEnvelope, 0, input('next', next))
      : await p.service[action](ownedPlan, ownedEnvelope);
    assert.deepEqual(result, action === 'advance' ? { revision: 1, journal: submitted } : p.initial);
    assert.ok([...reads.values()].every(count => count === 1));
  });
}
test('invalid submitted intent is rejected before reading or mutating storage', async () => {
  for (const patch of [{ state: 'unknown' }, { planHash: 'd'.repeat(64) }, { completedItems: 11 }]) {
    const p = await mutableJournal();
    await assert.rejects(p.service.advance(p.plan, p.envelope, 0,
      { ...p.initial.journal, state: 'APPLYING', completedItems: 2, ...patch }), /^Error: OPS_PLAN_REJECTED$/);
    assert.deepEqual(p.calls, []);
  }
});
