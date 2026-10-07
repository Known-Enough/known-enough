import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import type { AttributeValue, TransactWriteItem } from '@aws-sdk/client-dynamodb';
import { Groups, KnownEnough as KE } from '@deal-table/contracts';
import { partitionSeedRows, createPartitionedGroupRepository, type PartitionKey } from './partitioned-group-repository.ts';
import { partitionDirectoryKey, type PartitionDirectoryClaim } from './partition-directory.ts';
import { preparePartitionArchive, loadPartitionArchive, createPartitionArchiveRunner, archiveDynamoWrites,
  ArchiveOperatorPolicy, type ArchiveAuthority, type ArchiveEntry, type PartitionArchivePorts, type ArchiveAtomicCommit } from './partition-archive.ts';
import { PARTITION_MIGRATION_RESOURCES as resources } from './dynamo-partition-migration.ts';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const sourceSha = 'a'.repeat(40); const subject = 'iris';
const keyCode = (key: PartitionKey) => `${key.PK}/${key.SK}`;
function snapshot(count = 2, large = false) {
  const account: Groups.Account = { subject, emailHash: hash(subject), displayName: 'Iris', status: 'APPROVED', version: 4 };
  const drafts: Groups.GroupDraft[] = Array.from({ length: count }, (_, index) => ({ id: `draft-${index}`, bodyHash: hash(String(index)),
    revision: 2, groupVersion: 3, createdDecisionId: index === 0 ? 'decision-0' : null,
    frame: KE.PublicDecisionFrame.parse({ schemaVersion: 2, decisionId: `draft-${index}`, frameVersion: 1, semanticVersion: 1,
      contextToken: 'c'.repeat(64), title: 'Garden gathering', objective: 'x'.repeat(2000), description: 'x'.repeat(4000),
      participants: [{ id: subject, displayName: 'Iris', requiredForApproval: true }], requiredParticipantIds: [subject],
      variables: large ? Array.from({ length: 8 }, (_, n) => ({ id: `var-${n}`, label: 'Choice', required: true, visibility: 'PUBLIC', type: 'ENUM',
        options: Array.from({ length: 64 }, (_, m) => ({ id: `option-${m}`, label: 'z'.repeat(100) })) })) : [], rules: [] }),
    clarificationQuestions: Array.from({ length: 12 }, () => 'q'.repeat(500)) }));
  const group: Groups.Group = { id: 'garden', name: 'Garden', organizer: subject, version: 3, members: [subject], drafts,
    decisions: [{ id: 'decision-0', version: 2 }], invitations: [{ tokenHash: hash('old-invitation'), recipientHash: hash('recipient'), expiresAt: 1, acceptedBy: null }] };
  const seed = partitionSeedRows({ accounts: [account], groups: [group] }, { accountSubjects: [subject], groupId: group.id });
  const actor = seed.find(row => row.next?.kind === 'ACCOUNT')!.next!;
  const entries: ArchiveEntry[] = seed.filter(row => row.next?.kind !== 'ACCOUNT').map(row => ({ key: row.key, row: row.next! }));
  const claims: PartitionDirectoryClaim[] = [{ type: 'DECISION', decisionId: 'decision-0', groupId: group.id },
    { type: 'INVITATION', tokenHash: group.invitations[0]!.tokenHash, recipientHash: group.invitations[0]!.recipientHash, expiresAt: 1, groupId: group.id }];
  for (const value of claims) entries.push({ key: partitionDirectoryKey(value), row: { schemaVersion: 1, revision: 1, kind: 'DIRECTORY', value } });
  return { entries, actor, group };
}
function storage(authority: ArchiveAuthority = { kind: 'ORGANIZER', subject }) {
  const initial = snapshot(); const plan = preparePartitionArchive(initial.entries, 'garden', sourceSha);
  const expected = { sourceSha, groupId: 'garden', sourceHeaderRevision: plan.header.revision, sourceHash: plan.sourceHash, manifestHash: plan.manifestHash };
  type Item = Record<string, AttributeValue>;
  const key = (table: string, item: { PK: AttributeValue; SK: AttributeValue }) => `${table}/${item.PK.S}/${item.SK.S}`;
  const attrs = <T extends { revision: number }>(PK: string, SK: string, row: T): Item => ({ PK: { S: PK }, SK: { S: SK }, revision: { N: String(row.revision) }, payload: { S: JSON.stringify(row) } });
  const stored = new Map<string, Item>(); const transactions: TransactWriteItem[][] = [];
  for (const entry of plan.entries) stored.set(`${resources.target}/${keyCode(entry.key)}`, attrs(entry.key.PK, entry.key.SK, entry.row));
  const accountKey = `${resources.target}/ACCOUNT#iris/STATE`; const controlKey = `${resources.target}/MIGRATION#CONTROL/STATE`;
  const policyKey = `${resources.target}/OPERATIONS#ARCHIVE/STATE`; const headerKey = `${resources.target}/GROUP#garden/STATE`;
  const journalKey = `${resources.journal}/ARCHIVE#garden/OP#${plan.manifestHash}`;
  stored.set(accountKey, attrs('ACCOUNT#iris', 'STATE', initial.actor));
  stored.set(controlKey, attrs('MIGRATION#CONTROL', 'STATE', { schemaVersion: 1, account: resources.account, region: resources.region,
    table: 'KnownEnoughPartitions', revision: 3, active: true, planHash: 'd'.repeat(64) }));
  stored.set(policyKey, attrs('OPERATIONS#ARCHIVE', 'STATE', ArchiveOperatorPolicy.parse({ schemaVersion: 1, kind: 'ARCHIVE_POLICY', revision: 1, enabled: true, actors: [143764700] })));
  const value = (path: string) => JSON.parse(stored.get(path)!.payload!.S!);
  const edit = (path: string, change: (row: Record<string, unknown>) => void) => { const row = value(path); change(row); stored.set(path,
    { ...stored.get(path)!, revision: { N: String(row.revision) }, payload: { S: JSON.stringify(row) } }); };
  let before: (() => void) | null = null; let lose: 'PREPARED' | 'ARCHIVED' | null = null;
  const recovery = { preserve: vi.fn(async () => ({ bytes: plan.manifestBytes, versionId: 'immutable-v1' })),
    read: vi.fn(async () => ({ bytes: plan.manifestBytes, versionId: 'immutable-v1' })) };
  const ports: PartitionArchivePorts = {
    group: async () => plan.entries.map(entry => ({ key: entry.key, row: value(`${resources.target}/${keyCode(entry.key)}`) })),
    control: async () => value(controlKey), authority: async actor => value(actor.kind === 'ORGANIZER' ? accountKey : policyKey),
    journal: async () => stored.has(journalKey) ? value(journalKey) : null, recovery,
    commit: async request => {
      const writes = archiveDynamoWrites(request, plan.manifestBytes, expected, authority); transactions.push(writes);
      before?.(); before = null;
      if (writes.some(action => {
        const current = action.Put ?? action.ConditionCheck!; const keys = (action.Put?.Item ?? action.ConditionCheck!.Key)!;
        const prior = stored.get(key(current.TableName!, keys as { PK: AttributeValue; SK: AttributeValue })); const values = current.ExpressionAttributeValues;
        return current.ConditionExpression === 'attribute_not_exists(PK)' ? prior !== undefined
          : prior?.revision?.N !== values?.[':r']?.N || prior?.payload?.S !== values?.[':p']?.S;
      })) return false;
      for (const action of writes) if (action.Put) stored.set(key(action.Put.TableName!, action.Put.Item as { PK: AttributeValue; SK: AttributeValue }), structuredClone(action.Put.Item!));
      if (lose === request.journal.next.state) { lose = null; throw new Error('synthetic lost archive response'); }
      return true;
    },
  };
  const runner = (config = {}) => createPartitionArchiveRunner(ports, plan.manifestBytes, expected, authority, config);
  return { initial, plan, expected, ports, runner, recovery, stored, transactions, value, edit, accountKey, controlKey, policyKey, headerKey, journalKey,
    conflict: (fn: () => void) => { before = fn; }, lose: (phase: typeof lose) => { lose = phase; } };
}

it('preserves a realistic >300000-byte private group in canonical immutable recovery without account snapshots', () => {
  const source = snapshot(32); const plan = preparePartitionArchive(source.entries, 'garden', sourceSha);
  expect(plan.manifestBytes.length).toBeGreaterThan(300_000); expect(plan.manifestBytes.length).toBeLessThan(1024 * 1024);
  const expected = { sourceSha, groupId: 'garden', sourceHeaderRevision: plan.header.revision, sourceHash: plan.sourceHash, manifestHash: plan.manifestHash };
  source.entries[0]!.row.revision = 9; plan.entries[0]!.row.revision = 10;
  expect(loadPartitionArchive(plan.manifestBytes, expected).entries).not.toEqual(plan.entries);
  expect(plan.manifestBytes.toString()).not.toContain('"kind":"ACCOUNT"');
});

it('rejects private account backup, foreign/unreferenced/missing/duplicate rows, directory mismatch and exhausted revisions', () => {
  for (const defect of ['account', 'foreign', 'missing', 'duplicate', 'directory', 'revision', 'binding']) {
    const source = snapshot();
    if (defect === 'account') source.entries.push({ key: { PK: 'ACCOUNT#iris', SK: 'STATE' }, row: source.actor });
    if (defect === 'foreign') source.entries[0]!.key.PK = 'GROUP#other';
    if (defect === 'missing') source.entries.pop();
    if (defect === 'duplicate') source.entries.push(source.entries[0]!);
    if (defect === 'directory') source.entries.find(entry => entry.row.kind === 'DIRECTORY' && entry.row.value.type === 'DECISION')!.row.revision = 2;
    if (defect === 'revision') source.entries.find(entry => entry.row.kind === 'GROUP')!.row.revision = Number.MAX_SAFE_INTEGER;
    if (defect === 'binding') source.entries = source.entries.filter(entry => entry.row.kind !== 'BINDING');
    expect(() => preparePartitionArchive(source.entries, 'garden', sourceSha)).toThrow('ARCHIVE_INVALID');
  }
  expect(() => preparePartitionArchive(snapshot(24, true).entries, 'garden', sourceSha)).toThrow('ARCHIVE_CAPACITY');
});

it('independently binds manifest source/target/hash/schema and exact canonical UTF8 before execution', () => {
  const s = storage();
  for (const field of ['sourceSha', 'groupId', 'sourceHash', 'manifestHash', 'sourceHeaderRevision']) {
    const changed = { ...s.expected, [field]: field === 'sourceHeaderRevision' ? 2 : field === 'groupId' ? 'other' : field === 'sourceSha' ? 'b'.repeat(40) : 'b'.repeat(64) };
    expect(() => loadPartitionArchive(s.plan.manifestBytes, changed)).toThrow('ARCHIVE_SOURCE_CHANGED');
  }
  const raw = JSON.parse(s.plan.manifestBytes.toString()); raw.table = 'Other';
  expect(() => loadPartitionArchive(Buffer.from(JSON.stringify(raw)), s.expected)).toThrow('ARCHIVE_INVALID');
  expect(() => loadPartitionArchive(Buffer.concat([s.plan.manifestBytes, Buffer.from(' ')]), s.expected)).toThrow('ARCHIVE_SOURCE_CHANGED');
  expect(() => loadPartitionArchive(Buffer.from([255]), s.expected)).toThrow('ARCHIVE_INVALID');
});

it('atomically archives only the header/journal and retains all replay/expired-invitation history', async () => {
  const s = storage(); const before = structuredClone([...s.stored]);
  const prepared = await s.runner().prepare(); expect(prepared.state).toBe('PREPARED'); expect(s.value(s.headerKey).kind).toBe('GROUP');
  const result = await s.runner().archive(); expect(result.state).toBe('ARCHIVED');
  expect(s.value(s.headerKey)).toMatchObject({ kind: 'ARCHIVED_GROUP', revision: 2, groupVersion: 4, organizer: subject, manifestVersion: 'immutable-v1' });
  expect(s.transactions[1]).toHaveLength(4); expect(s.transactions[1]!.filter(write => write.Put)).toHaveLength(2);
  for (const [key, value] of before) if (key !== s.headerKey) expect(s.stored.get(key)).toEqual(value);
  const count = s.transactions.length; expect((await s.runner().archive()).state).toBe('ARCHIVED'); expect(s.transactions).toHaveLength(count);
  const repo = createPartitionedGroupRepository({ read: async key => s.value(`${resources.target}/${keyCode(key)}`),
    readMany: async keys => keys.map(key => s.value(`${resources.target}/${keyCode(key)}`)), commit: async () => { throw new Error('must not resurrect'); } });
  await expect(repo.transaction({ groupId: 'garden', accountSubjects: [subject] }, state => state.groups.push(s.initial.group))).rejects.toThrow('PARTITION_INVALID');
});

it('resumes lost preparation and terminal acknowledgements using pinned readback without a second archival write', async () => {
  const s = storage(); s.lose('PREPARED'); await expect(s.runner().prepare()).rejects.toThrow('ARCHIVE_COMMIT_UNKNOWN');
  const first = s.transactions.length; await s.runner().prepare(); expect(s.transactions).toHaveLength(first);
  s.lose('ARCHIVED'); await expect(s.runner().archive()).rejects.toThrow('ARCHIVE_COMMIT_UNKNOWN');
  const last = s.transactions.length; const result = await s.runner().archive(); expect(result.state).toBe('ARCHIVED');
  expect(s.transactions).toHaveLength(last); expect((await s.runner().prepare()).archivedAt).toBe(result.archivedAt);
});

it('handles concurrent fresh prepares and terminal retries without replacing retained journal history', async () => {
  const s = storage(); const prepared = await Promise.all([s.runner().prepare(), s.runner().prepare()]);
  expect(prepared[0]).toEqual(prepared[1]);
  const results = await Promise.all([s.runner().archive(), s.runner().archive()]); expect(results[0]).toEqual(results[1]);
  expect(s.value(s.journalKey).revision).toBe(2);
});

it('rejects account disable or organizer/roster change at commit and never archives stale participant authority', async () => {
  for (const defect of ['account', 'header']) {
    const s = storage(); await s.runner().prepare();
    s.conflict(() => s.edit(defect === 'account' ? s.accountKey : s.headerKey, row => {
      if (defect === 'account') (row.value as Groups.Account).status = 'DISABLED'; else (row.value as Groups.Group).organizer = 'other';
    }));
    await expect(s.runner().archive()).rejects.toThrow(defect === 'account' ? 'ARCHIVE_AUTHORITY_DENIED' : 'ARCHIVE_SOURCE_CHANGED');
    expect(s.value(s.headerKey).kind).toBe('GROUP'); expect(s.value(s.journalKey).state).toBe('PREPARED');
  }
});

it('requires an enabled exact operator policy and rejects policy/active-control revocation in the terminal transaction', async () => {
  for (const defect of ['policy', 'control']) {
    const s = storage({ kind: 'OPERATOR', actorId: 143764700 }); await s.runner().prepare();
    s.conflict(() => s.edit(defect === 'policy' ? s.policyKey : s.controlKey, row => { if (defect === 'policy') row.enabled = false; else row.active = false; }));
    await expect(s.runner().archive()).rejects.toThrow(defect === 'policy' ? 'ARCHIVE_AUTHORITY_DENIED' : 'ARCHIVE_TARGET_INACTIVE');
    expect(s.value(s.headerKey).kind).toBe('GROUP');
  }
  const s = storage({ kind: 'OPERATOR', actorId: 143764700 }); s.edit(s.policyKey, row => { row.actors = []; });
  await expect(s.runner().prepare()).rejects.toThrow('ARCHIVE_AUTHORITY_DENIED'); expect(s.recovery.preserve).not.toHaveBeenCalled();
});

it('never mutates a group before independent immutable recovery bytes/version readback succeeds', async () => {
  const s = storage(); s.recovery.read.mockImplementation(async () => ({ bytes: s.plan.manifestBytes, versionId: 'wrong' }));
  await expect(s.runner().prepare()).rejects.toThrow('ARCHIVE_RECOVERY_INVALID'); expect(s.transactions).toHaveLength(0);
  s.recovery.read.mockImplementation(async () => ({ bytes: s.plan.manifestBytes, versionId: 'immutable-v1' })); await s.runner().prepare();
  s.recovery.read.mockImplementation(async () => ({ bytes: Buffer.from('{}'), versionId: 'immutable-v1' }));
  await expect(s.runner().archive()).rejects.toThrow('ARCHIVE_RECOVERY_INVALID'); expect(s.transactions).toHaveLength(1);
});

it('rejects missing/unprepared/corrupt progress and changed retained replay rows', async () => {
  const s = storage(); await expect(s.runner().archive()).rejects.toThrow('ARCHIVE_JOURNAL_INVALID'); await s.runner().prepare();
  s.edit(s.journalKey, row => { row.state = 'ARCHIVED'; }); await expect(s.runner().archive()).rejects.toThrow('ARCHIVE_JOURNAL_INVALID');
  s.edit(s.journalKey, row => { row.state = 'PREPARED'; });
  s.edit(`${resources.target}/GROUP#garden/DRAFT#draft-0`, row => { (row.value as Groups.GroupDraft).createdDecisionId = null; });
  await expect(s.runner().archive()).rejects.toThrow('ARCHIVE_SOURCE_CHANGED'); expect(s.value(s.headerKey).kind).toBe('GROUP');
});

it('validates exact wire resources/guards/history and cannot compile an altered tombstone or foreign header', async () => {
  const s = storage(); await s.runner().prepare();
  const commits: ArchiveAtomicCommit[] = []; const original = s.ports.commit;
  s.ports.commit = async (request, context) => { commits.push(structuredClone(request)); return original(request, context); };
  await s.runner().archive(); const request = commits[0]!;
  const writes = archiveDynamoWrites(request, s.plan.manifestBytes, s.expected, { kind: 'ORGANIZER', subject });
  expect(writes[0]!.ConditionCheck!.TableName).toBe(resources.target); expect(writes[3]!.Put!.TableName).toBe(resources.journal);
  expect(writes.every(write => (write.Put ?? write.ConditionCheck)!.ConditionExpression!.includes('#p = :p'))).toBe(true);
  for (const defect of ['header', 'tombstone', 'history', 'authority']) {
    const copy = structuredClone(request);
    if (defect === 'header') copy.header.key.PK = 'GROUP#other';
    if (defect === 'tombstone') copy.header.next!.sourceHash = 'e'.repeat(64);
    if (defect === 'history') copy.journal.next.createdAt = '2020-01-01T00:00:00Z';
    if (defect === 'authority') copy.authority.key.PK = 'ACCOUNT#other';
    expect(() => archiveDynamoWrites(copy, s.plan.manifestBytes, s.expected, { kind: 'ORGANIZER', subject })).toThrow('ARCHIVE_INVALID');
  }
});

it('bounds hung reads/recovery and request exhaustion without any late write', async () => {
  const s = storage(); await expect(s.runner({ maxRequests: 2 }).prepare()).rejects.toThrow('ARCHIVE_REQUEST_LIMIT'); expect(s.transactions).toHaveLength(0);
  s.ports.group = () => new Promise(() => {});
  await expect(s.runner({ timeoutMs: 10 }).prepare()).rejects.toThrow('ARCHIVE_TIMEOUT'); expect(s.transactions).toHaveLength(0);
  const recovery = storage(); recovery.recovery.read.mockImplementation(() => new Promise(() => {}));
  await expect(recovery.runner({ timeoutMs: 10 }).prepare()).rejects.toThrow('ARCHIVE_TIMEOUT'); expect(recovery.transactions).toHaveLength(0);
});


it('rechecks organizer permission on terminal replay instead of using the historical recovery account', async () => {
  const s = storage(); await s.runner().prepare(); await s.runner().archive(); const count = s.transactions.length;
  s.edit(s.accountKey, row => { (row.value as Groups.Account).status = 'DISABLED'; });
  await expect(s.runner().archive()).rejects.toThrow('ARCHIVE_AUTHORITY_DENIED');
  await expect(s.runner().prepare()).rejects.toThrow('ARCHIVE_AUTHORITY_DENIED');
  expect(s.transactions).toHaveLength(count); expect(s.value(s.headerKey).kind).toBe('ARCHIVED_GROUP');
});

it('fails malformed current snapshots and changed terminal markers with fixed errors before writes', async () => {
  const malformed = storage(); malformed.ports.group = async () => [{ key: null, row: {} }];
  await expect(malformed.runner().prepare()).rejects.toThrow('ARCHIVE_SOURCE_CHANGED'); expect(malformed.transactions).toHaveLength(0);
  const s = storage(); await s.runner().prepare(); await s.runner().archive(); const count = s.transactions.length;
  s.edit(s.headerKey, row => { row.manifestVersion = 'other-version'; });
  await expect(s.runner().archive()).rejects.toThrow('ARCHIVE_SOURCE_CHANGED'); expect(s.transactions).toHaveLength(count);
});
