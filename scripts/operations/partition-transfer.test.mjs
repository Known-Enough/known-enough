import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, chmod, stat, rm, symlink, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DynamoDBClient, GetItemCommand, BatchGetItemCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { createDynamoPartitionMigrationPorts, PARTITION_MIGRATION_RESOURCES as resources } from '@deal-table/adapters/partition-operations';
import { partitionTransfer, transferAuthority, transferError, verifyTransferCheckout, transferSourceSnapshot } from './partition-transfer.mjs';

const sourceSha = 'a'.repeat(40); const folders = [];
const digest = value => createHash('sha256').update(value).digest('hex');
const key = (table, item) => `${table}/${item.PK.S}/${item.SK.S}`;
const attrs = (PK, SK) => ({ PK: { S: PK }, SK: { S: SK } });
const target = { account: resources.account, region: resources.region };
afterEach(async () => { mock.restoreAll(); for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });
function cancelled(entries, matches) { const error = new Error('PRIVATE_CONDITION_DETAILS'); error.name = 'TransactionCanceledException';
  error.CancellationReasons = entries.map(entry => ({ Code: matches(entry) ? 'None' : 'ConditionalCheckFailed' })); return error; }
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'ke-partition-transfer-test-')); folders.push(directory);
  await chmod(directory, 0o700);
  const payload = Buffer.from(JSON.stringify({ accounts: [{ subject: 'PRIVATE_IRIS', emailHash: digest('PRIVATE_EMAIL'),
    displayName: 'PRIVATE_NAME', status: 'APPROVED', version: 4 }], groups: [{ id: 'garden', name: 'PRIVATE_GROUP',
    organizer: 'PRIVATE_IRIS', version: 3, members: ['PRIVATE_IRIS'], drafts: [], invitations: [],
    decisions: Array.from({ length: 64 }, (_, n) => ({ id: `decision-${n}`, version: 2 })) }] }));
  const cells = new Map([[key(resources.source, attrs('NP#GROUPS', 'STATE')),
    { ...attrs('NP#GROUPS', 'STATE'), version: { N: '12' }, payload: { S: payload.toString() } }]]);
  const objects = new Map(); const commands = []; let sourceReads = 0; let saves = 0; let objectReads = 0;
  let loseCommit = false; let beforeCommit = () => {}; let corruptRecovery = false;
  function matches(entry) {
    const input = entry.ConditionCheck ?? entry.Put;
    const old = cells.get(key(input.TableName, input.Key ?? input.Item));
    if (input.ConditionExpression === 'attribute_not_exists(PK)') return !old;
    return input.ConditionExpression.split(' AND ').every(expression => {
      const [name, value] = expression.split('=').map(part => part.trim());
      return JSON.stringify(old?.[input.ExpressionAttributeNames[name] ?? name])
        === JSON.stringify(input.ExpressionAttributeValues[value]);
    });
  }
  mock.method(DynamoDBClient.prototype, 'send', async function(command, options) {
    assert.equal(this.config.region instanceof Function, true);
    assert.ok(options.abortSignal instanceof globalThis.AbortSignal); commands.push(structuredClone(command.input));
    if (command instanceof GetItemCommand) {
      assert.equal(command.input.ConsistentRead, true);
      return { Item: structuredClone(cells.get(key(command.input.TableName, command.input.Key))) };
    }
    if (command instanceof BatchGetItemCommand) return { Responses: Object.fromEntries(Object.entries(command.input.RequestItems)
      .map(([table, request]) => { assert.equal(request.ConsistentRead, true);
        return [table, request.Keys.map(item => structuredClone(cells.get(key(table, item)))).filter(Boolean)]; })) };
    assert.ok(command instanceof TransactWriteItemsCommand); beforeCommit(command.input);
    if (!command.input.TransactItems.every(matches)) throw cancelled(command.input.TransactItems, matches);
    assert.ok(command.input.TransactItems.length <= 100);
    for (const entry of command.input.TransactItems) if (entry.Put) cells.set(key(entry.Put.TableName, entry.Put.Item), structuredClone(entry.Put.Item));
    if (loseCommit) { loseCommit = false; throw new Error('PRIVATE_LOST_RESPONSE'); }
    return {};
  });
  const recovery = {
    async preserve(bytes, hash, context) {
      assert.ok(!context.signal.aborted); saves++;
      if (!objects.has(hash)) objects.set(hash, Buffer.from(bytes));
      return { bytes: Buffer.from(objects.get(hash)), versionId: 'immutable-1' };
    },
    async read(hash, version, context) {
      assert.equal(version, 'immutable-1'); assert.ok(!context.signal.aborted); objectReads++;
      return { bytes: corruptRecovery ? Buffer.from('PRIVATE_BAD_MANIFEST') : Buffer.from(objects.get(hash)), versionId: version };
    },
  };
  const options = { sourceSha, directory, authority: { actorId: 44531296, sourceSha },
    source: async () => { sourceReads++; const value = cells.get(key(resources.source, attrs('NP#GROUPS', 'STATE')));
      return { version: Number(value.version.N), payload: Buffer.from(value.payload.S) }; },
    recovery, ports: createDynamoPartitionMigrationPorts };
  const run = action => partitionTransfer({ ...options, action });
  const freezeForCompatibleServiceFixture = async () => {
    const bytes = await readFile(join(directory, 'manifest-private.json'));
    const binding = JSON.parse(await readFile(join(directory, 'binding-private.json'), 'utf8'));
    return createDynamoPartitionMigrationPorts(bytes, binding, target, recovery).freeze();
  };
  return { directory, payload, cells, objects, commands, options, run, freezeForCompatibleServiceFixture,
    get sourceReads() { return sourceReads; }, get saves() { return saves; }, get objectReads() { return objectReads; },
    set loseCommit(value) { loseCommit = value; }, set beforeCommit(value) { beforeCommit = value; },
    set corruptRecovery(value) { corruptRecovery = value; },
    changeSource() { cells.get(key(resources.source, attrs('NP#GROUPS', 'STATE'))).version.N = '13'; },
    get writes() { return commands.filter(input => input.TransactItems); },
  };
}

test('plan is a private immutable local snapshot with zero cloud writes; saved source never silently refreshes', async () => {
  const f = await fixture(); const report = await f.run('plan');
  assert.equal(report.result, 'TRANSFER_PLAN_READY'); assert.equal(report.plannedBatches, 3); assert.equal(f.sourceReads, 1);
  assert.equal(f.commands.length, 0); assert.equal(f.saves, 0);
  for (const file of ['manifest-private.json', 'binding-private.json']) assert.equal((await stat(join(f.directory, file))).mode & 0o777, 0o600);
  assert.ok(!JSON.stringify(report).includes('PRIVATE_')); f.changeSource();
  assert.deepEqual(await f.run('plan'), report); assert.equal(f.sourceReads, 1);
  await assert.rejects(f.run('prepare'), /MIGRATION_SOURCE_CHANGED|MIGRATION_RUN_INVALID/); assert.equal(f.writes.length, 0);
  await assert.rejects(access(join(f.directory, 'transfer.lock')));
});

test('real Dynamo ports prepare, copy three batches and read back all rows after reconstructed commands', async () => {
  const f = await fixture(); await f.run('plan');
  assert.equal((await f.run('status')).result, 'TRANSFER_NOT_PREPARED'); assert.equal(f.saves, 0); assert.equal(f.writes.length, 0);
  const prepared = await f.run('prepare'); assert.equal(prepared.state, 'PREPARED'); assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].TransactItems.filter(item => item.Put).length, 2); // control and journal only
  await f.freezeForCompatibleServiceFixture();
  const first = await f.run('step'); assert.equal(first.state, 'APPLYING'); assert.ok(first.completedRows > 0);
  await f.run('step');
  const last = await f.run('step'); assert.equal(last.state, 'COPIED'); assert.equal(last.completedRows, last.plannedRows);
  assert.equal(f.writes.length, 5); const saves = f.saves;
  const inspected = await f.run('status'); assert.equal(inspected.result, 'TRANSFER_STATUS_VERIFIED'); assert.equal(inspected.state, 'COPIED');
  assert.equal(f.saves, saves); assert.equal(f.writes.length, 5);
  assert.equal((await f.run('step')).result, 'TRANSFER_COPY_VERIFIED'); assert.equal(f.writes.length, 5);
  const control = JSON.parse(f.cells.get(key(resources.target, attrs('MIGRATION#CONTROL', 'STATE'))).payload.S);
  assert.equal(control.active, false); assert.equal(JSON.parse(f.cells.get(key(resources.source, attrs('NP#GROUPS', 'STATE'))).payload.S).phase, 'FROZEN');
  assert.ok(!JSON.stringify(inspected).includes('PRIVATE_')); assert.ok(f.objectReads > 0);
});

for (const action of ['prepare', 'step']) test(`lost ${action} acknowledgement leaves cloud evidence resumable without duplicate rows`, async () => {
  const f = await fixture(); await f.run('plan'); if (action === 'step') { await f.run('prepare'); await f.freezeForCompatibleServiceFixture(); }
  f.loseCommit = true; await assert.rejects(f.run(action), /MIGRATION_COMMIT_UNKNOWN/);
  const writes = f.writes.length;
  const observed = await f.run('status'); assert.equal(observed.state, action === 'prepare' ? 'PREPARED' : 'APPLYING');
  assert.equal(f.writes.length, writes);
  if (action === 'prepare') { await f.run('prepare'); assert.equal(f.writes.length, writes); }
  else { assert.equal((await f.run('step')).nextBatch, 2); assert.equal(f.writes.length, writes + 1); }
});

test('source change during atomic commit leaves no claim or data rows', async () => {
  const f = await fixture(); await f.run('plan'); f.beforeCommit = () => f.changeSource();
  await assert.rejects(f.run('prepare'), /MIGRATION_SOURCE_CHANGED|MIGRATION_RUN_INVALID/);
  assert.equal(f.cells.size, 1); assert.equal(f.writes.length, 1); assert.equal(f.objects.size, 1);
});

test('step requires the exact separately installed source freeze; this tool never installs it itself', async () => {
  const f = await fixture(); await f.run('plan'); await f.run('prepare');
  await assert.rejects(f.run('step'), /TRANSFER_FREEZE_REQUIRED/); assert.equal(f.writes.length, 1);
  assert.equal(f.cells.get(key(resources.source, attrs('NP#GROUPS', 'STATE'))).payload.S, f.payload.toString());
  await f.freezeForCompatibleServiceFixture();
  const source = f.cells.get(key(resources.source, attrs('NP#GROUPS', 'STATE')));
  const marker = JSON.parse(source.payload.S); marker.manifestHash = 'f'.repeat(64); source.payload.S = JSON.stringify(marker);
  await assert.rejects(f.run('step')); assert.equal(f.writes.length, 2);
});

test('conflicting target rows prevent journal/control writes', async () => {
  const f = await fixture(); await f.run('plan');
  f.cells.set(key(resources.target, attrs('ACCOUNT#PRIVATE_IRIS', 'STATE')), { ...attrs('ACCOUNT#PRIVATE_IRIS', 'STATE'), revision: { N: '1' }, payload: { S: '{}' } });
  await assert.rejects(f.run('status')); await assert.rejects(f.run('prepare')); assert.equal(f.writes.length, 0);
});

test('read-only inspection validates recovery bytes and stored journal counts', async () => {
  const f = await fixture(); await f.run('plan'); await f.run('prepare'); f.corruptRecovery = true;
  await assert.rejects(f.run('status'), /MIGRATION_RECOVERY_INVALID/); assert.equal(f.writes.length, 1);
  f.corruptRecovery = false;
  const entry = [...f.cells].find(([location]) => location.startsWith(resources.journal));
  const journal = JSON.parse(entry[1].payload.S); journal.completedRows = 42; entry[1].payload.S = JSON.stringify(journal);
  await assert.rejects(f.run('status'), /MIGRATION_JOURNAL_INVALID/); assert.equal(f.writes.length, 1);
});

test('copied target corruption fails read-only inspection and never changes source or data', async () => {
  const f = await fixture(); await f.run('plan'); await f.run('prepare'); await f.freezeForCompatibleServiceFixture(); await f.run('step'); await f.run('step'); await f.run('step');
  const row = [...f.cells].find(([location]) => location.startsWith(resources.target) && !location.includes('MIGRATION#'));
  row[1].revision.N = '2'; await assert.rejects(f.run('status'), /MIGRATION_TARGET_CORRUPT|MIGRATION_RUN_INVALID/);
  assert.equal(f.writes.length, 5);
});

for (const file of ['manifest-private.json', 'binding-private.json']) {
  test(`tampered or partial ${file} never triggers a new snapshot or mutation`, async () => {
    const f = await fixture(); await f.run('plan'); const path = join(f.directory, file);
    await writeFile(path, '{"PRIVATE":"TAMPERED"}', { mode: 0o600 });
    await assert.rejects(f.run('prepare')); assert.equal(f.sourceReads, 1); assert.equal(f.writes.length, 0);
    await rm(path); await assert.rejects(f.run('plan'), /TRANSFER_STATE_INCOMPLETE/); assert.equal(f.sourceReads, 1);
  });
  test(`symlink and permissive ${file} rejected before managed writes`, async () => {
    const f = await fixture(); await f.run('plan'); const path = join(f.directory, file);
    await chmod(path, 0o644); await assert.rejects(f.run('status'), /TRANSFER_STATE_INVALID/);
    const bytes = await readFile(path); await rm(path); const replacement = join(f.directory, 'replacement');
    await writeFile(replacement, bytes, { mode: 0o600 }); await symlink(replacement, path);
    await assert.rejects(f.run('prepare')); assert.equal(f.writes.length, 0);
  });
}

test('state belongs to one source and stays locked until the active invocation finishes', async () => {
  const f = await fixture(); let release;
  const held = partitionTransfer({ ...f.options, action: 'plan', source: () => new Promise(resolve => { release = resolve; }) });
  while (!release) await new Promise(resolve => globalThis.setTimeout(resolve, 1));
  await assert.rejects(f.run('plan'), /TRANSFER_STATE_LOCKED/);
  release({ version: 12, payload: f.payload }); await held;
  await assert.rejects(partitionTransfer({ ...f.options, action: 'status', sourceSha: 'b'.repeat(40),
    authority: { actorId: 44531296, sourceSha: 'b'.repeat(40) } }), /TRANSFER_STATE_INVALID/);
});

test('unsafe directory modes/symlinks, missing state, unrelated actors/actions rejected without source reads', async () => {
  const f = await fixture(); await assert.rejects(f.run('prepare'), /TRANSFER_STATE_INCOMPLETE/);
  await chmod(f.directory, 0o755); await assert.rejects(f.run('plan'), /TRANSFER_STATE_INVALID/); await chmod(f.directory, 0o700);
  const linked = `${f.directory}-link`; await symlink(f.directory, linked); folders.push(linked);
  await assert.rejects(partitionTransfer({ ...f.options, action: 'plan', directory: linked }), /TRANSFER_STATE_INVALID/);
  for (const change of [{ action: 'activate' }, { action: 'freeze' }, { sourceSha: '0'.repeat(40) }, { directory: 'relative' },
    { authority: { sourceSha, actorId: 123 } }]) await assert.rejects(partitionTransfer({ ...f.options, action: 'plan', ...change }), /TRANSFER_INPUT_INVALID/);
  assert.equal(f.sourceReads, 0);
});

test('CloudShell authority requires the actual own account root and CloudShell context', () => {
  const identity = { Account: target.account, Arn: `arn:aws:iam::${target.account}:root` };
  assert.deepEqual(transferAuthority(sourceSha, identity, { AWS_EXECUTION_ENV: 'CloudShell' }), { actorId: 44531296, sourceSha });
  for (const [id, env] of [[identity, {}], [{ ...identity, Account: '123456789012' }, { AWS_EXECUTION_ENV: 'CloudShell' }],
    [{ ...identity, Arn: `arn:aws:iam::${target.account}:user/other` }, { AWS_EXECUTION_ENV: 'CloudShell' }]]) assert.throws(() => transferAuthority(sourceSha, id, env));
});

for (const actorId of ['44531296', '143764700']) test(`GitHub actor ${actorId} requires matching source/main/manual and dedicated migration role`, () => {
  const env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'Known-Enough/known-enough', GITHUB_REF: 'refs/heads/main',
    GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_ACTOR_ID: actorId, GITHUB_SHA: sourceSha, EXPECTED_SOURCE: sourceSha, CHECKOUT_SOURCE: sourceSha };
  const identity = { Account: target.account, Arn: `arn:aws:sts::${target.account}:assumed-role/KnownEnoughGithubPartitionMigration/own-run` };
  assert.deepEqual(transferAuthority(sourceSha, identity, env), { actorId: Number(actorId), sourceSha });
  for (const change of [{ GITHUB_REF: 'refs/heads/other' }, { GITHUB_ACTOR_ID: '123' }, { EXPECTED_SOURCE: 'b'.repeat(40) },
    { CHECKOUT_SOURCE: 'b'.repeat(40) }, { GITHUB_EVENT_NAME: 'pull_request' }]) assert.throws(() => transferAuthority(sourceSha, identity, { ...env, ...change }), /TRANSFER_AUTHORITY_INVALID/);
  assert.throws(() => transferAuthority(sourceSha, { ...identity, Arn: identity.Arn.replace('KnownEnoughGithubPartitionMigration', 'KnownEnoughGithubQaRelease') }, env), /TRANSFER_ROLE_INVALID/);
});

test('finite error summaries never serialize SDK causes, raw messages or private paths', () => {
  for (const error of [new Error('PRIVATE_NAME /private/path', { cause: { token: 'PRIVATE_TOKEN' } }),
    { message: 'PRIVATE_MESSAGE', stderr: 'PRIVATE_STDERR' }]) {
    const report = transferError(error); assert.equal(report.code, 'TRANSFER_STORAGE_FAILED'); assert.ok(!JSON.stringify(report).includes('PRIVATE'));
  }
  assert.equal(transferError(new Error('MIGRATION_COMMIT_UNKNOWN')).code, 'MIGRATION_COMMIT_UNKNOWN');
  const denied = new Error('PRIVATE_ROLE_POLICY'); denied.name = 'AccessDeniedException';
  const report = transferError(new Error('MIGRATION_COMMIT_UNKNOWN', { cause: denied }));
  assert.equal(report.awsError, 'AccessDeniedException'); assert.ok(!JSON.stringify(report).includes('PRIVATE'));
  assert.equal(transferError({ stderr: 'aws: Unable to locate credentials; PRIVATE_PATH' }).awsError, 'NO_CREDENTIALS');
});

test('CLI refuses incomplete arguments before any Git/AWS invocation and emits only a finite failure', async () => {
  await assert.rejects(promisify(execFile)(process.execPath, ['--experimental-transform-types', 'scripts/operations/partition-transfer.mjs', 'activate']), error => {
    const line = error.stderr.trim().split('\n').at(-1); assert.equal(JSON.parse(line).code, 'TRANSFER_INPUT_INVALID'); return true;
  });
});


test('checkout provenance accepts the exact GitHub Actions origin without .git and rejects changed or foreign work', () => {
  const checkout = { head: sourceSha + '\n', branch: 'main\n', remote: 'https://github.com/Known-Enough/known-enough\n', dirty: '' };
  assert.equal(verifyTransferCheckout(sourceSha, checkout), sourceSha);
  for (const remote of ['https://github.com/Known-Enough/known-enough.git', 'git@github.com:Known-Enough/known-enough.git']) {
    assert.equal(verifyTransferCheckout(sourceSha, { ...checkout, remote }), sourceSha);
  }
  for (const change of [
    { head: 'b'.repeat(40) }, { branch: '' }, { branch: 'other' },
    { dirty: ' M package-lock.json' }, { dirty: '?? private.json' },
    { remote: 'https://github.com/Other/known-enough' },
    { remote: 'https://github.com/Known-Enough/known-enough.git.evil' },
    { remote: 'https://github.com/Known-Enough/known-enough?token=PRIVATE' },
    { remote: 'https://PRIVATE@github.com/Known-Enough/known-enough' },
  ]) assert.throws(() => verifyTransferCheckout(sourceSha, { ...checkout, ...change }), /TRANSFER_CHECKOUT_INVALID/);
});


test('actual source boundary distinguishes absence and malformed private shapes without exposing payload', () => {
  const item = { PK: { S: 'NP#GROUPS' }, SK: { S: 'STATE' }, version: { N: '4' }, payload: { S: '{"PRIVATE":"CANARY"}' } };
  assert.deepEqual(transferSourceSnapshot(item), { version: 4, payload: Buffer.from(item.payload.S) });
  for (const [raw, expected] of [
    [undefined, 'TRANSFER_SOURCE_ABSENT'], [null, 'TRANSFER_SOURCE_SHAPE_INVALID'],
    [{ ...item, PRIVATE: 'CANARY' }, 'TRANSFER_SOURCE_SHAPE_INVALID'],
    [{ ...item, PK: { S: 'OTHER' } }, 'TRANSFER_SOURCE_SHAPE_INVALID'],
    [{ ...item, version: { N: '0' } }, 'TRANSFER_SOURCE_REVISION_INVALID'],
    [{ ...item, version: { N: '9007199254740992' } }, 'TRANSFER_SOURCE_REVISION_INVALID'],
    [{ ...item, payload: { S: '' } }, 'TRANSFER_SOURCE_PAYLOAD_INVALID'],
    [{ ...item, payload: { S: 'p'.repeat(300001) } }, 'TRANSFER_SOURCE_PAYLOAD_INVALID'],
  ]) {
    try { transferSourceSnapshot(raw); assert.fail('Malformed source accepted'); }
    catch (error) { const report = transferError(error); assert.equal(report.code, expected); assert.ok(!JSON.stringify(report).includes('PRIVATE')); }
  }
});
