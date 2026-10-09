import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, access, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { DynamoDBClient, GetItemCommand, BatchGetItemCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { KnownEnough as KE } from '@deal-table/contracts';
import { partitionRecoveryStorage } from './partition-recovery.mjs';
import { MANIFEST_BUCKET } from './manifest.mjs';
import { partitionSeedRows } from '../../packages/adapters/src/partitioned-group-repository.ts';
import { partitionDirectoryKey } from '../../packages/adapters/src/partition-directory.ts';
import { preparePartitionArchive, createPartitionArchiveRunner } from '../../packages/adapters/src/partition-archive.ts';
import { createDynamoPartitionArchivePorts } from '../../packages/adapters/src/dynamo-partition-archive.ts';
import { createChunkedArchiveRecovery } from '../../packages/adapters/src/partition-archive-recovery.ts';
import { MigrationControlSchema } from '../../packages/adapters/src/partition-migration-runner.ts';
import { PARTITION_MIGRATION_RESOURCES as resources } from '../../packages/adapters/src/dynamo-partition-migration.ts';

// Pinned Node --experimental-transform-types; SDK and actual subprocess execution remain synthetic.
afterEach(() => mock.restoreAll());
function fixture(large = false) {
  const hash = text => createHash('sha256').update(text).digest('hex');
  const account = { subject: 'iris', emailHash: hash('iris'), displayName: 'Iris', status: 'APPROVED', version: 4 };
  const group = { id: 'garden', name: 'Garden', organizer: 'iris', version: 3, members: ['iris'], drafts: [],
    decisions: [{ id: 'decision-1', version: 2 }], invitations: [] };
  if (large) group.drafts = Array.from({ length: 24 }, (_, n) => ({ id: `draft-${n}`, revision: 2, groupVersion: 3,
    bodyHash: hash(String(n)), createdDecisionId: null, clarificationQuestions: [],
    frame: KE.PublicDecisionFrame.parse({ schemaVersion: 2, decisionId: `draft-${n}`, frameVersion: 1, semanticVersion: 1,
      contextToken: 'c'.repeat(64), title: 'Garden gathering', objective: 'Plan our gathering', description: '🌿'.repeat(1000),
      participants: [{ id: 'iris', displayName: 'Iris', requiredForApproval: true }], requiredParticipantIds: ['iris'], rules: [],
      variables: Array.from({ length: 8 }, (_, variable) => ({ id: `var-${variable}`, label: 'Choice', required: true,
        visibility: 'PUBLIC', type: 'ENUM', options: Array.from({ length: 64 }, (_, option) => ({ id: `option-${option}`, label: 'z'.repeat(100) })) })) }) }));
  const seeds = partitionSeedRows({ accounts: [account], groups: [group] }, { accountSubjects: ['iris'], groupId: group.id });
  const rows = seeds.filter(seed => seed.next.kind !== 'ACCOUNT').map(seed => ({ key: seed.key, row: seed.next }));
  const claim = { type: 'DECISION', decisionId: 'decision-1', groupId: group.id };
  rows.push({ key: partitionDirectoryKey(claim), row: { schemaVersion: 1, revision: 1, kind: 'DIRECTORY', value: claim } });
  const plan = preparePartitionArchive(rows, group.id, 'a'.repeat(40));
  const expected = { sourceSha: 'a'.repeat(40), groupId: group.id, sourceHeaderRevision: plan.header.revision,
    sourceHash: plan.sourceHash, manifestHash: plan.manifestHash };
  const keyCode = (table, key) => `${table}/${key.PK.S}/${key.SK.S}`;
  const encode = (key, row) => ({ PK: { S: key.PK }, SK: { S: key.SK }, revision: { N: String(row.revision) }, payload: { S: JSON.stringify(row) } });
  const stored = new Map();
  for (const seed of seeds) stored.set(keyCode(resources.target, encode(seed.key, seed.next)), encode(seed.key, seed.next));
  for (const entry of plan.entries) stored.set(keyCode(resources.target, encode(entry.key, entry.row)), encode(entry.key, entry.row));
  const controlKey = { PK: 'MIGRATION#CONTROL', SK: 'STATE' };
  stored.set(keyCode(resources.target, encode(controlKey, {})), encode(controlKey, MigrationControlSchema.parse({ schemaVersion: 1,
    account: resources.account, region: resources.region, table: 'KnownEnoughPartitions', revision: 3, active: true, planHash: 'd'.repeat(64) })));
  const objects = new Map(); let wrongVersion = false; let loseTerminal = false; const calls = []; const writes = []; const directories = new Set();
  const executor = async (command, argv, options) => {
    assert.equal(command, 'aws'); assert.ok(options.signal instanceof globalThis.AbortSignal);
    assert.equal(options.env.AWS_MAX_ATTEMPTS, '1');
    const streaming = argv[1] === 'get-object';
    const filename = argv[argv.indexOf(streaming ? '--bucket' : '--cli-input-json') + 1].slice(7); directories.add(dirname(filename));
    const input = streaming ? Object.fromEntries(await Promise.all(
      [['Bucket', '--bucket'], ['Key', '--key'], ['VersionId', '--version-id'], ['ExpectedBucketOwner', '--expected-bucket-owner']].map(async ([key, flag]) => {
        assert.ok(!argv.includes('--cli-input-json') && argv.includes(flag));
        const path = argv[argv.indexOf(flag) + 1]; assert.ok(path.startsWith('file://'));
        assert.equal((await stat(path.slice(7))).mode & 0o777, 0o600);
        const value = await readFile(path.slice(7), 'utf8'); assert.ok(!argv.includes(value)); return [key, value];
      }))) : JSON.parse(await readFile(filename, 'utf8'));
    calls.push(argv[1]);
    assert.equal(input.Bucket, MANIFEST_BUCKET); assert.equal(input.ExpectedBucketOwner, resources.account);
    assert.match(input.Key, /^manifests\/[a-f0-9]{64}\.json$/);
    if (argv[1] === 'put-object') {
      assert.equal(input.IfNoneMatch, '*'); assert.equal(input.ServerSideEncryption, 'AES256');
      if (objects.has(input.Key)) throw { stderr: 'An error occurred (PreconditionFailed) when calling PutObject: synthetic duplicate' };
      const object = { bytes: await readFile(argv[argv.indexOf('--body') + 1]), version: `immutable-v${objects.size + 1}` };
      assert.ok(object.bytes.length <= 1024 * 1024); assert.equal(input.Key, `manifests/${hash(object.bytes)}.json`);
      objects.set(input.Key, object); return { stdout: JSON.stringify({ VersionId: object.version }) };
    }
    const object = objects.get(input.Key);
    if (argv[1] === 'head-object') return { stdout: JSON.stringify({ ContentLength: object.bytes.length,
      VersionId: wrongVersion ? 'changed-version' : object.version }) };
    assert.equal(argv[1], 'get-object'); assert.equal(input.VersionId, object.version);
    await writeFile(argv.at(-1), object.bytes, { mode: 0o600 });
    return { stdout: JSON.stringify({ VersionId: object.version }) };
  };
  mock.method(DynamoDBClient.prototype, 'send', async (command, options) => {
    assert.ok(options.abortSignal);
    if (command instanceof GetItemCommand) {
      assert.equal(command.input.ConsistentRead, true); const value = stored.get(keyCode(command.input.TableName, command.input.Key));
      return value ? { Item: structuredClone(value) } : {};
    }
    if (command instanceof BatchGetItemCommand) {
      const request = command.input.RequestItems[resources.target]; assert.equal(request.ConsistentRead, true);
      return { Responses: { [resources.target]: request.Keys.map(key => structuredClone(stored.get(keyCode(resources.target, key)))) } };
    }
    assert.ok(command instanceof TransactWriteItemsCommand); const actions = command.input.TransactItems; writes.push(actions);
    const reasons = actions.map(action => {
      const item = action.Put ?? action.ConditionCheck; const key = action.Put?.Item ?? action.ConditionCheck.Key;
      const prior = stored.get(keyCode(item.TableName, key)); const values = item.ExpressionAttributeValues;
      const conflict = item.ConditionExpression === 'attribute_not_exists(PK)' ? prior !== undefined
        : prior?.revision.N !== values[':r'].N || prior?.payload.S !== values[':p'].S;
      return { Code: conflict ? 'ConditionalCheckFailed' : 'None' };
    });
    if (reasons.some(reason => reason.Code !== 'None')) throw Object.assign(new Error('synthetic conflict'),
      { name: 'TransactionCanceledException', CancellationReasons: reasons });
    for (const action of actions) if (action.Put) stored.set(keyCode(action.Put.TableName, action.Put.Item), structuredClone(action.Put.Item));
    if (loseTerminal && actions[2].Put) { loseTerminal = false; throw new Error('synthetic lost terminal response'); }
    return {};
  });
  const authority = { kind: 'ORGANIZER', subject: 'iris' };
  const recoverySettlements = [];
  const track = promise => {
    recoverySettlements.push(promise.then(() => undefined, () => undefined));
    return promise;
  };
  const recovery = () => {
    const bridge = partitionRecoveryStorage(executor);
    const storage = { preserve: (...args) => track(bridge.preserve(...args)), read: (...args) => track(bridge.read(...args)) };
    return large ? createChunkedArchiveRecovery(storage, plan.manifestBytes, expected) : storage;
  };
  const runner = (options = {}) => createPartitionArchiveRunner(createDynamoPartitionArchivePorts(plan.manifestBytes, expected,
    authority, { account: resources.account, region: resources.region }, recovery()),
  plan.manifestBytes, expected, authority, options);
  const cleanup = async () => {
    // Abort can return before transport finally: observe actual settlement, not200ms polling.
    let deadline;
    try {
      await Promise.race([Promise.all(recoverySettlements), new Promise((_, reject) => {
        deadline = globalThis.setTimeout(() => reject(new Error('synthetic cleanup settlement timeout')), 10_000);
      })]);
    } finally { globalThis.clearTimeout(deadline); }
    for (const directory of directories) await assert.rejects(access(directory), { code: 'ENOENT' });
  };
  return { runner, calls, writes, stored, plan, objects, cleanup, set wrongVersion(value) { wrongVersion = value; },
    set loseTerminal(value) { loseTerminal = value; } };
}

test('archive composes actual private-file recovery bridge with concrete atomic SDK requests and lost-terminal restart', async () => {
  const data = fixture(); const retained = structuredClone(data.stored);
  const prepared = await data.runner().prepare(); assert.equal(prepared.manifestVersion, 'immutable-v1');
  assert.deepEqual(data.calls, ['put-object', 'head-object', 'get-object', 'head-object', 'get-object']);
  data.loseTerminal = true; await assert.rejects(data.runner().archive(), /^PartitionArchiveError: ARCHIVE_COMMIT_UNKNOWN$/);
  const archived = await data.runner().archive(); assert.equal(archived.state, 'ARCHIVED'); assert.equal(data.writes.length, 2);
  assert.equal(archived.createdAt, prepared.createdAt);
  for (const [key, value] of retained) if (!key.endsWith('/GROUP#garden/STATE')) assert.deepEqual(data.stored.get(key), value);
  await data.cleanup();
});

test('pinned recovery version failure prevents terminal writes and cleans actual temporary requests', async () => {
  const data = fixture(); await data.runner().prepare(); data.wrongVersion = true;
  await assert.rejects(data.runner().archive(), /^PartitionArchiveError: ARCHIVE_STORAGE_UNAVAILABLE$/);
  assert.equal(data.writes.length, 1); assert.equal(data.calls.at(-1), 'head-object'); await data.cleanup();
});

test('recovery subprocesses consume the same request ceiling as archive reads before any journal mutation', async () => {
  const data = fixture(); await assert.rejects(data.runner({ maxRequests: 8 }).prepare(), /^PartitionArchiveError: ARCHIVE_REQUEST_LIMIT$/);
  assert.deepEqual(data.calls, ['put-object', 'head-object']); assert.equal(data.writes.length, 0); await data.cleanup();
});

test('large group archive composes sub1MiB immutable chunks with real local recovery files and atomic resume', async () => {
  const data = fixture(true); assert.ok(data.plan.manifestBytes.length > 1024 * 1024);
  const retained = structuredClone(data.stored); const prepared = await data.runner().prepare();
  assert.match(prepared.manifestVersion, /^arch1:[a-f0-9]{64}:immutable-v/); assert.ok(data.objects.size > 2);
  data.loseTerminal = true; await assert.rejects(data.runner().archive(), /^PartitionArchiveError: ARCHIVE_COMMIT_UNKNOWN$/);
  const archived = await data.runner().archive(); assert.equal(archived.state, 'ARCHIVED'); assert.equal(data.writes.length, 2);
  for (const [key, value] of retained) if (!key.endsWith('/GROUP#garden/STATE')) assert.deepEqual(data.stored.get(key), value);
  for (const object of data.objects.values()) assert.ok(object.bytes.length < 1024 * 1024);
  await data.cleanup();
});
