import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, access } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { DynamoDBClient, GetItemCommand, BatchGetItemCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { partitionRecoveryStorage } from './partition-recovery.mjs';
import { MANIFEST_BUCKET } from './manifest.mjs';
import { partitionSeedRows } from '../../packages/adapters/src/partitioned-group-repository.ts';
import { partitionDirectoryKey } from '../../packages/adapters/src/partition-directory.ts';
import { preparePartitionArchive, createPartitionArchiveRunner } from '../../packages/adapters/src/partition-archive.ts';
import { createDynamoPartitionArchivePorts } from '../../packages/adapters/src/dynamo-partition-archive.ts';
import { MigrationControlSchema } from '../../packages/adapters/src/partition-migration-runner.ts';
import { PARTITION_MIGRATION_RESOURCES as resources } from '../../packages/adapters/src/dynamo-partition-migration.ts';

// Pinned Node --experimental-transform-types; SDK and actual subprocess execution remain synthetic.
afterEach(() => mock.restoreAll());
function fixture() {
  const hash = text => createHash('sha256').update(text).digest('hex');
  const account = { subject: 'iris', emailHash: hash('iris'), displayName: 'Iris', status: 'APPROVED', version: 4 };
  const group = { id: 'garden', name: 'Garden', organizer: 'iris', version: 3, members: ['iris'], drafts: [],
    decisions: [{ id: 'decision-1', version: 2 }], invitations: [] };
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
  let object; let wrongVersion = false; let loseTerminal = false; const calls = []; const writes = []; const directories = new Set();
  const executor = async (command, argv, options) => {
    assert.equal(command, 'aws'); assert.ok(options.signal instanceof globalThis.AbortSignal);
    assert.equal(options.env.AWS_MAX_ATTEMPTS, '1');
    const filename = argv[argv.indexOf('--cli-input-json') + 1].slice(7); directories.add(dirname(filename));
    const input = JSON.parse(await readFile(filename, 'utf8')); calls.push(argv[1]);
    assert.equal(input.Bucket, MANIFEST_BUCKET); assert.equal(input.ExpectedBucketOwner, resources.account);
    assert.equal(input.Key, `manifests/${plan.manifestHash}.json`);
    if (argv[1] === 'put-object') {
      assert.equal(input.IfNoneMatch, '*'); assert.equal(input.ServerSideEncryption, 'AES256');
      if (object) throw { stderr: 'An error occurred (PreconditionFailed) when calling PutObject: synthetic duplicate' };
      object = { bytes: await readFile(argv[argv.indexOf('--body') + 1]), version: 'immutable-v1' };
      assert.deepEqual(object.bytes, plan.manifestBytes); return { stdout: JSON.stringify({ VersionId: object.version }) };
    }
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
  const runner = (options = {}) => createPartitionArchiveRunner(createDynamoPartitionArchivePorts(plan.manifestBytes, expected,
    authority, { account: resources.account, region: resources.region }, partitionRecoveryStorage(executor)),
  plan.manifestBytes, expected, authority, options);
  const cleanup = async () => {
    // Deadline/request abort can return before the interrupted transport's finally has settled.
    for (const directory of directories) {
      for (let attempt = 0; attempt < 20; attempt++) {
        try { await access(directory); } catch { break; }
        await delay(10);
      }
      await assert.rejects(access(directory), { code: 'ENOENT' });
    }
  };
  return { runner, calls, writes, stored, plan, cleanup, set wrongVersion(value) { wrongVersion = value; },
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
