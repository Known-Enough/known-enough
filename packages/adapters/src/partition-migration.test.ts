import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { Groups, KnownEnough as KE } from '@deal-table/contracts';
import { preparePartitionMigration, loadPartitionMigration } from './partition-migration.ts';
import { createPartitionedGroupRepository, type PartitionRow, type PartitionTransport } from './partitioned-group-repository.ts';

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const sourceSha = 'a'.repeat(40);
const account = (subject: string, status: Groups.Account['status'] = 'APPROVED'): Groups.Account => ({
  subject, emailHash: digest(subject), displayName: subject, status, version: 7,
});
const group = (id = 'garden'): Groups.Group => ({ id, name: id, organizer: 'iris', version: 8,
  members: ['iris'], drafts: [], decisions: [], invitations: [],
});
const draft = (id: string): Groups.GroupDraft => ({ id, bodyHash: digest(id), revision: 3, groupVersion: 4,
  frame: KE.PublicDecisionFrame.parse({ schemaVersion: KE.KE_SCHEMA_VERSION, decisionId: id, frameVersion: 1,
    semanticVersion: 1, contextToken: 'c'.repeat(64), title: 'Garden gathering', objective: 'Choose a time', description: 'Shared garden',
    participants: [{ id: 'iris', displayName: 'Iris', requiredForApproval: true }], requiredParticipantIds: ['iris'], variables: [], rules: [] }),
  clarificationQuestions: [], createdDecisionId: null,
});
const state = (): Groups.GroupState => ({ accounts: [account('iris')], groups: [group()] });
const prepare = (value: Groups.GroupState) => preparePartitionMigration(Buffer.from(JSON.stringify(value)), 12, sourceSha);
const expected = (plan: ReturnType<typeof prepare>) => ({ sourceSha, sourceRevision: 12, sourceHash: plan.sourceHash, manifestHash: plan.manifestHash });
const rows = (plan: ReturnType<typeof prepare>) => plan.batches.flat();

it('preserves exact private recovery bytes and all account/group/draft/invitation versions without granting new consent', () => {
  const original = state(); original.accounts.push(account('disabled', 'DISABLED'), account('pending', 'PENDING'));
  original.groups[0]!.drafts.push({ ...draft('draft'), createdDecisionId: 'decision' });
  original.groups[0]!.decisions.push({ id: 'decision', version: 6 });
  original.groups[0]!.invitations.push({ tokenHash: digest('invite'), recipientHash: digest('pending'), expiresAt: 123, acceptedBy: 'disabled' });
  const payload = Buffer.from(' \n'+JSON.stringify(original, null, 2)+'\n');
  const plan = preparePartitionMigration(payload, 12, sourceSha);
  const loaded = loadPartitionMigration(plan.manifestBytes, expected(plan));
  expect(loaded.sourceSnapshot.payload).toEqual(payload);
  expect(loaded.sourceSnapshot.state).toEqual(original);
  expect(loaded.sourceSnapshot.version).toBe(12);
  expect(loaded.planHash).toBe(plan.planHash);
  expect(rows(plan).find(item => item.key.PK === 'ACCOUNT#disabled')!.next!.value).toMatchObject({ status: 'DISABLED', version: 7 });
  expect(rows(plan).find(item => item.key.SK === 'DRAFT#draft')!.next!.value).toMatchObject({ revision: 3, groupVersion: 4, createdDecisionId: 'decision' });
  expect(rows(plan).every(item => item.next!.revision === 1 && item.expected === 0)).toBe(true);
});

it('compiles100-plus retained children into bounded preparation batches and publishes every header in the last batch', async () => {
  const value = state(); const garden = value.groups[0]!;
  garden.drafts = Array.from({ length: 64 }, (_, n) => ({ ...draft(`draft-${n}`), createdDecisionId: `decision-${n}` }));
  garden.decisions = Array.from({ length: 64 }, (_, n) => ({ id: `decision-${n}`, version: 2 }));
  const plan = prepare(value);
  expect(plan.rowCount).toBe(195); expect(plan.batches.map(batch => batch.length)).toEqual([96, 96, 2, 1]);
  expect(plan.batches.slice(0, -1).flat().every(item => item.next!.kind !== 'GROUP')).toBe(true);
  expect(plan.batches.at(-1)!.every(item => item.next!.kind === 'GROUP')).toBe(true);
  const persisted = new Map<string, PartitionRow>();
  for (const batch of plan.batches) for (const item of batch) persisted.set(`${item.key.PK}/${item.key.SK}`, structuredClone(item.next!));
  const transport: PartitionTransport = {
    read: async key => structuredClone(persisted.get(`${key.PK}/${key.SK}`) ?? null),
    readMany: async keys => keys.map(key => structuredClone(persisted.get(`${key.PK}/${key.SK}`) ?? null)),
    commit: async changes => changes.every(item => (persisted.get(`${item.key.PK}/${item.key.SK}`)?.revision ?? 0) === item.expected),
  };
  const repo = createPartitionedGroupRepository(transport);
  expect(await repo.transaction({ groupId: 'garden', accountSubjects: ['iris'] }, snapshot => snapshot)).toEqual(value);
  // This applies compiled rows in a fake store, not a crash-safe migration executor.
});

it('reconstructs the same plan from preserved bytes after callers mutate an earlier returned plan or snapshot', () => {
  const plan = prepare(state()); const copy = structuredClone(plan.batches);
  plan.batches[0]![0]!.next = null;
  const loaded = loadPartitionMigration(plan.manifestBytes, expected(plan));
  expect(loaded.batches).toEqual(copy);
  loaded.sourceSnapshot.state.groups[0]!.name = 'changed copy';
  loaded.sourceSnapshot.payload.fill(0);
  expect(loadPartitionMigration(plan.manifestBytes, expected(plan)).sourceSnapshot.state).toEqual(state());
});

it('binds reload to independent source revision/hash/SHA and recovery hash instead of trusting submitted metadata', () => {
  const plan = prepare(state());
  for (const change of [{ sourceRevision: 13 }, { sourceHash: 'b'.repeat(64) }, { sourceSha: 'b'.repeat(40) }, { manifestHash: 'b'.repeat(64) }]) {
    expect(() => loadPartitionMigration(plan.manifestBytes, { ...expected(plan), ...change })).toThrow('PARTITION_MIGRATION_SOURCE_CHANGED');
  }
  const altered = JSON.parse(plan.manifestBytes.toString()); altered.sourceRevision = 13;
  const bytes = Buffer.from(JSON.stringify(altered));
  expect(() => loadPartitionMigration(bytes, { ...expected(plan), manifestHash: digest(bytes) })).toThrow('PARTITION_MIGRATION_SOURCE_CHANGED');
  expect(() => loadPartitionMigration(plan.manifestBytes, { ...expected(plan), extra: true } as never)).toThrow('PARTITION_MIGRATION_INVALID');
});

it('rejects target/account/schema/private-field and noncanonical base64 tampering before row compilation', () => {
  const plan = prepare(state());
  for (const change of [{ targetTable: 'Other' }, { sourceTable: 'Other' }, { account: '000000000000' }, { schemaVersion: 2 },
    { privateCondition: 'do not publish' }, { sourcePayloadBase64: JSON.parse(plan.manifestBytes.toString()).sourcePayloadBase64+'\n' }]) {
    const bytes = Buffer.from(JSON.stringify({ ...JSON.parse(plan.manifestBytes.toString()), ...change }));
    expect(() => loadPartitionMigration(bytes, { ...expected(plan), manifestHash: digest(bytes) })).toThrow('PARTITION_MIGRATION_INVALID');
  }
});

it('rejects conflicting global email, subject, group, invitation and decision identities', () => {
  const cases: Groups.GroupState[] = [];
  let value = state(); value.accounts.push({ ...account('omar'), emailHash: value.accounts[0]!.emailHash }); cases.push(value);
  value = state(); value.accounts.push(account('iris')); cases.push(value);
  value = state(); value.groups.push(group()); cases.push(value);
  value = state(); value.groups.push(group('art'));
  value.groups.forEach(item => item.decisions.push({ id: 'same-decision', version: 1 })); cases.push(value);
  value = state(); value.groups.push(group('art'));
  value.groups.forEach(item => item.invitations.push({ tokenHash: digest('same'), recipientHash: digest('iris'), expiresAt: 100, acceptedBy: null })); cases.push(value);
  for (const original of cases) expect(() => prepare(original)).toThrow('PARTITION_MIGRATION_INVALID');
});

it('rejects absent roster identities, duplicate members, missing reserved binding and ambiguous draft replay', () => {
  const cases: Groups.GroupState[] = [];
  let value = state(); value.groups[0]!.members.push('missing'); cases.push(value);
  value = state(); value.groups[0]!.members.push('iris'); cases.push(value);
  value = state(); value.groups[0]!.organizer = 'missing'; cases.push(value);
  value = state(); value.groups[0]!.drafts.push({ ...draft('draft'), createdDecisionId: 'missing' }); cases.push(value);
  value = state(); value.groups[0]!.drafts.push({ ...draft('one'), createdDecisionId: 'same' }, { ...draft('two'), createdDecisionId: 'same' });
  value.groups[0]!.decisions.push({ id: 'same', version: 1 }); cases.push(value);
  for (const original of cases) expect(() => prepare(original)).toThrow('PARTITION_MIGRATION_INVALID');
});

it('rejects unsafe versions, impossible future drafts and dangling accepted subjects without printing private values', () => {
  for (const edit of [
    (value: Groups.GroupState) => { value.accounts[0]!.version = Number.MAX_SAFE_INTEGER+1; },
    (value: Groups.GroupState) => { value.groups[0]!.drafts.push({ ...draft('draft'), groupVersion: 9 }); },
    (value: Groups.GroupState) => { value.groups[0]!.invitations.push({ tokenHash: digest('invite'), recipientHash: digest('iris'), expiresAt: 100, acceptedBy: 'missing' }); },
  ]) {
    const value = state(); edit(value);
    expect(() => prepare(value)).toThrow('PARTITION_MIGRATION_INVALID');
  }
});

it('bounds source/recovery bytes, invalid UTF8 and derived rows under the existing1000-item operations envelope', () => {
  expect(() => preparePartitionMigration(Buffer.alloc(300001), 1, sourceSha)).toThrow('PARTITION_MIGRATION_CAPACITY');
  expect(() => preparePartitionMigration(Buffer.from([0xff]), 1, sourceSha)).toThrow('PARTITION_MIGRATION_INVALID');
  expect(() => preparePartitionMigration(Buffer.from('{'), 1, sourceSha)).toThrow('PARTITION_MIGRATION_INVALID');
  expect(() => loadPartitionMigration(Buffer.alloc(1024*1024+1), {} as never)).toThrow('PARTITION_MIGRATION_CAPACITY');
  const value = state(); value.accounts = Array.from({ length: 256 }, (_, n) => account(`account-${n}`));
  value.accounts[0] = account('iris');
  value.groups = Array.from({ length: 5 }, (_, n) => ({ ...group(`group-${n}`),
    decisions: Array.from({ length: 64 }, (_, k) => ({ id: `decision-${n}-${k}`, version: 1 })) }));
  expect(Buffer.byteLength(JSON.stringify(value))).toBeLessThan(300000);
  expect(() => prepare(value)).toThrow('PARTITION_MIGRATION_CAPACITY');
});

it('handles empty snapshots and32 group headers without making an installed-activation claim', () => {
  expect(prepare({ accounts: [], groups: [] }).batches).toEqual([]);
  const value = state(); value.groups = Array.from({ length: 32 }, (_, n) => group(`group-${n}`));
  const plan = prepare(value);
  expect(plan.batches.at(-1)!.length).toBe(32);
  const manifest = JSON.parse(plan.manifestBytes.toString());
  expect(manifest.sourceKey).toEqual({ PK: 'NP#GROUPS', SK: 'STATE' });
  expect(manifest.targetTable).toBe('KnownEnoughPartitions');
});
