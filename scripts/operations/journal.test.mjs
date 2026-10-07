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
