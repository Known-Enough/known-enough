import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { expect, it } from 'vitest';
import { Groups } from '@deal-table/contracts';
import { preparePartitionMigration } from './partition-migration.ts';
import { createPartitionMigrationRunner, type MigrationControl, type MigrationJournal,
  type MigrationAtomicCommit, type MigrationRunnerPorts } from './partition-migration-runner.ts';
import { type PartitionRow } from './partitioned-group-repository.ts';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const sourceSha = 'a'.repeat(40);
function fixture() {
  const state: Groups.GroupState = { accounts: [{ subject: 'iris', emailHash: hash('iris'), displayName: 'Iris', status: 'APPROVED', version: 4 }],
    groups: [{ id: 'garden', name: 'Garden', organizer: 'iris', version: 3, members: ['iris'], drafts: [], invitations: [],
      decisions: Array.from({ length: 64 }, (_, n) => ({ id: `decision-${n}`, version: 2 })) }] };
  const payload = Buffer.from(JSON.stringify(state));
  const plan = preparePartitionMigration(payload, 12, sourceSha);
  const expected = { sourceSha, sourceRevision: 12, sourceHash: plan.sourceHash, manifestHash: plan.manifestHash };
  return { plan, expected, payload };
}
function storage() {
  const input = fixture();
  let source = { version: 12, payload: Buffer.from(input.payload) };
  let control: MigrationControl = { schemaVersion: 1, account: '092954139775', region: 'us-east-1', table: 'KnownEnoughPartitions',
    revision: 0, active: false, planHash: null };
  let journal: MigrationJournal | null = null;
  const targets = new Map<string, PartitionRow>();
  const manifests = new Map<string, Buffer>();
  let saves = 0; let commits = 0; let collisions = 0; let loseAt = 0;
  const requests: MigrationAtomicCommit[] = [];
  let before: (request: MigrationAtomicCommit) => void | Promise<void> = () => {};
  const ports: MigrationRunnerPorts = {
    source: async () => ({ version: source.version, payload: Buffer.from(source.payload) }),
    control: async () => structuredClone(control),
    journal: async () => structuredClone(journal),
    targets: async keys => keys.map(key => structuredClone(targets.get(`${key.PK}/${key.SK}`) ?? null)),
    manifests: {
      preserve: async (bytes, digest) => {
        saves++; if (!manifests.has(digest)) manifests.set(digest, Buffer.from(bytes));
        return { bytes: Buffer.from(manifests.get(digest)!), versionId: 'immutable-version-1' };
      },
      read: async digest => ({ bytes: Buffer.from(manifests.get(digest)!), versionId: 'immutable-version-1' }),
    },
    commit: async request => {
      commits++; await before(request);
      if (source.version !== request.source.revision || !source.payload.equals(request.source.payload)
        || !isDeepStrictEqual(control, request.control.expected) || (journal?.revision ?? 0) !== request.journal.expectedRevision
        || request.rows.some(item => targets.has(`${item.key.PK}/${item.key.SK}`))) { collisions++; return false; }
      expect(request.rows.length).toBeLessThanOrEqual(96);
      expect(Buffer.isBuffer(request.source.payload)).toBe(true);
      expect(request.rows.every(item => item.expected === 0 && item.next?.revision === 1)).toBe(true);
      if (request.control.next) control = structuredClone(request.control.next);
      for (const item of request.rows) targets.set(`${item.key.PK}/${item.key.SK}`, structuredClone(item.next!));
      journal = structuredClone(request.journal.next); requests.push(request);
      if (commits === loseAt) throw new Error('private synthetic lost acknowledgement');
      return true;
    },
  };
  const runner = (options: { timeoutMs?: number; maxRequests?: number } = {}) => createPartitionMigrationRunner(
    ports, input.plan.manifestBytes, input.expected, { actorId: 143764700, sourceSha }, options);
  return { ...input, ports, targets, manifests, requests, runner,
    get source() { return source; }, set source(next) { source = next; },
    get control() { return control; }, set control(next) { control = next; },
    get journal() { return journal; }, set journal(next) { journal = next; },
    get saves() { return saves; }, get commits() { return commits; }, get collisions() { return collisions; },
    get loseAt() { return loseAt; }, set loseAt(value: number) { loseAt = value; },
    get before() { return before; }, set before(value: typeof before) { before = value; },
  };
}

it('preserves/readbacks recovery before exclusive journal/control creation and copies one atomic batch per reconstructed runner', async () => {
  const store = storage(); const prepared = await store.runner().prepare();
  expect(prepared.state).toBe('PREPARED'); expect(prepared.manifestVersion).toBe('immutable-version-1');
  expect(store.targets.size).toBe(0); expect(store.control.planHash).toBe(store.plan.planHash);
  const first = await store.runner().step();
  expect(first.nextBatch).toBe(1); expect(first.completedRows).toBe(96);
  expect(store.targets.has('GROUP#garden/STATE')).toBe(false);
  while (store.journal!.state !== 'COPIED') await store.runner().step();
  expect(store.journal!.completedRows).toBe(store.plan.rowCount);
  expect(store.requests.at(-1)!.rows.every(item => item.next?.kind === 'GROUP')).toBe(true);
  const count = store.commits;
  expect(await store.runner().step()).toEqual(store.journal);
  expect(store.commits).toBe(count); expect(store.control.active).toBe(false);
});

it('resumes a lost preparation acknowledgement without recreating the journal or target identities', async () => {
  const store = storage(); store.loseAt = 1;
  await expect(store.runner().prepare()).rejects.toThrow('MIGRATION_COMMIT_UNKNOWN');
  expect(store.journal!.revision).toBe(1);
  expect(await store.runner().prepare()).toEqual(store.journal);
  expect(store.commits).toBe(1); expect(store.targets.size).toBe(0);
});

it('resumes a lost batch acknowledgement from the matching atomic journal and never repeats committed exclusive row puts', async () => {
  const store = storage(); await store.runner().prepare(); store.loseAt = 2;
  await expect(store.runner().step()).rejects.toThrow('MIGRATION_COMMIT_UNKNOWN');
  expect(store.targets.size).toBe(96); expect(store.journal!.nextBatch).toBe(1);
  const next = await store.runner().step();
  expect(next.nextBatch).toBe(2); expect(store.collisions).toBe(0);
  expect(store.requests[1]!.rows.map(item => item.key)).not.toEqual(store.requests[2]!.rows.map(item => item.key));
});

it('serializes concurrent preparation and same-plan batches with control/journal CAS instead of losing progress', async () => {
  const store = storage();
  const prepared = await Promise.all([store.runner().prepare(), store.runner().prepare()]);
  expect(prepared[0]).toEqual(prepared[1]); expect(store.journal!.revision).toBe(1);
  await Promise.all([store.runner().step(), store.runner().step()]);
  expect(store.journal!.nextBatch).toBe(2); expect(store.journal!.completedRows).toBe(130);
  expect(store.collisions).toBeGreaterThanOrEqual(1); expect(store.targets.size).toBe(130);
});

it('rejects a changed legacy revision or same-revision byte change before preparation can preserve or commit', async () => {
  for (const changedVersion of [true, false]) {
    const store = storage();
    store.source = { version: changedVersion ? 13 : 12, payload: Buffer.from(store.payload.toString()+' ') };
    await expect(store.runner().prepare()).rejects.toThrow('MIGRATION_SOURCE_CHANGED');
    expect(store.saves).toBe(0); expect(store.commits).toBe(0);
  }
});

it('includes exact legacy bytes/revision at commit so a last-moment source disable cannot copy stale approval', async () => {
  const store = storage(); await store.runner().prepare();
  store.before = request => {
    if (request.rows.length) {
      const changed = JSON.parse(store.payload.toString()); changed.accounts[0].status = 'DISABLED';
      store.source = { version: 13, payload: Buffer.from(JSON.stringify(changed)) };
    }
  };
  await expect(store.runner().step()).rejects.toThrow('MIGRATION_SOURCE_CHANGED');
  expect(store.targets.size).toBe(0); expect(store.journal!.nextBatch).toBe(0);
});

it('rejects active/wrong-plan/malformed target control and a target activation race at the atomic boundary', async () => {
  for (const change of [{ active: true }, { planHash: 'b'.repeat(64) }]) {
    const store = storage(); store.control = { ...store.control, ...change };
    await expect(store.runner().prepare()).rejects.toThrow('MIGRATION_TARGET_CONFLICT');
    expect(store.commits).toBe(0);
  }
  const store = storage(); await store.runner().prepare();
  store.before = () => { store.control = { ...store.control, active: true, revision: 2 }; };
  await expect(store.runner().step()).rejects.toThrow('MIGRATION_TARGET_CONFLICT');
  expect(store.targets.size).toBe(0); expect(store.journal!.nextBatch).toBe(0);
});

it('rejects a pre-existing target identity instead of adopting unjournaled data even when its bytes match', async () => {
  const store = storage(); const first = store.plan.batches[0]![0]!;
  store.targets.set(`${first.key.PK}/${first.key.SK}`, structuredClone(first.next!));
  await expect(store.runner().prepare()).rejects.toThrow('MIGRATION_TARGET_CONFLICT');
  expect(store.journal).toBe(null); expect(store.control.planHash).toBe(null);
});

it('never overwrites an identity that appears after preparation or advances its journal on a row-condition collision', async () => {
  const store = storage(); await store.runner().prepare();
  const first = store.plan.batches[0]![0]!;
  store.targets.set(`${first.key.PK}/${first.key.SK}`, structuredClone(first.next!));
  await expect(store.runner().step()).rejects.toThrow('MIGRATION_CONFLICT');
  expect(store.journal!.nextBatch).toBe(0); expect(store.targets.size).toBe(1);
  expect(store.collisions).toBe(3); expect(store.targets.has('GROUP#garden/STATE')).toBe(false);
});

it('rejects a corrupted journal revision that cannot follow its recorded batch history', async () => {
  const store = storage(); await store.runner().prepare();
  store.journal = { ...store.journal!, revision: 5 };
  const count = store.commits;
  await expect(store.runner().step()).rejects.toThrow('MIGRATION_JOURNAL_INVALID');
  expect(store.commits).toBe(count); expect(store.targets.size).toBe(0);
});

it('rejects a control claim that would exhaust its safe revision before preservation or commit', async () => {
  const store = storage(); store.control = { ...store.control, revision: Number.MAX_SAFE_INTEGER - 1 };
  await expect(store.runner().prepare()).rejects.toThrow('MIGRATION_RUN_INVALID');
  expect(store.saves).toBe(0); expect(store.commits).toBe(0); expect(store.targets.size).toBe(0);
});

it('rejects corrupt progress, recovery bytes/version and committed target rows before another write', async () => {
  for (const defect of ['journal', 'bytes', 'version', 'target']) {
    const store = storage(); await store.runner().prepare(); await store.runner().step();
    const count = store.commits;
    if (defect === 'journal') store.journal = { ...store.journal!, completedRows: 1 };
    if (defect === 'bytes') store.manifests.set(store.plan.manifestHash, Buffer.from('{}'));
    if (defect === 'version') store.ports.manifests.read = async () => ({ bytes: store.plan.manifestBytes, versionId: 'other-version' });
    if (defect === 'target') store.targets.delete([...store.targets.keys()][0]!);
    await expect(store.runner().step()).rejects.toThrow(defect === 'journal' ? 'MIGRATION_JOURNAL_INVALID'
      : defect === 'target' ? 'MIGRATION_TARGET_CORRUPT' : 'MIGRATION_RECOVERY_INVALID');
    expect(store.commits).toBe(count);
  }
});

it('requires a real immutable manifest version and separate readback before journal preparation', async () => {
  const store = storage(); let reads = 0;
  store.ports.manifests.preserve = async bytes => ({ bytes, versionId: 'null' });
  await expect(store.runner().prepare()).rejects.toThrow('MIGRATION_RECOVERY_INVALID');
  expect(store.commits).toBe(0);
  store.ports.manifests.preserve = async bytes => ({ bytes, versionId: 'version-1' });
  store.ports.manifests.read = async () => { reads++; return { bytes: Buffer.from('{}'), versionId: 'version-1' }; };
  await expect(store.runner().prepare()).rejects.toThrow('MIGRATION_RECOVERY_INVALID');
  expect(reads).toBe(1); expect(store.commits).toBe(0);
});

it('shares request/deadline limits across recovery, reads and commit and never starts later writes after a timed-out read', async () => {
  const store = storage();
  await expect(store.runner({ maxRequests: 2 }).prepare()).rejects.toThrow('MIGRATION_REQUEST_LIMIT');
  expect(store.saves).toBe(0); expect(store.commits).toBe(0);
  store.ports.source = async () => { await new Promise(resolve => setTimeout(resolve, 25)); return store.source; };
  await expect(store.runner({ timeoutMs: 5 }).prepare()).rejects.toThrow('MIGRATION_TIMEOUT');
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(store.saves).toBe(0); expect(store.commits).toBe(0);
});

it('treats submitted commit timeouts as unknown and resumes a late atomic acknowledgement through the journal', async () => {
  const store = storage(); await store.runner().prepare();
  store.before = async () => { await new Promise(resolve => setTimeout(resolve, 25)); };
  await expect(store.runner({ timeoutMs: 5 }).step()).rejects.toThrow('MIGRATION_COMMIT_UNKNOWN');
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(store.journal!.nextBatch).toBe(1); expect(store.targets.size).toBe(96);
  store.before = () => {};
  expect((await store.runner().step()).nextBatch).toBe(2);
  expect(store.collisions).toBe(0);
});

it('keeps transport details private and rejects unverified project identity/source before port I/O', async () => {
  const store = storage();
  expect(() => createPartitionMigrationRunner(store.ports, store.plan.manifestBytes, store.expected, { actorId: 77, sourceSha })).toThrow('MIGRATION_RUN_INVALID');
  expect(() => createPartitionMigrationRunner(store.ports, store.plan.manifestBytes, store.expected, { actorId: 143764700, sourceSha: 'b'.repeat(40) })).toThrow('MIGRATION_RUN_INVALID');
  store.ports.control = async () => { throw new Error('private synthetic storage diagnostics'); };
  await expect(store.runner().prepare()).rejects.toThrow('MIGRATION_STORAGE_UNAVAILABLE');
  expect(store.saves).toBe(0); expect(store.commits).toBe(0);
});
