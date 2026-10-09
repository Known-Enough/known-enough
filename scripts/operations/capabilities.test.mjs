import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { operationCapabilityReport } from './capabilities.mjs';

const sha = 'a'.repeat(40);
const env = { GITHUB_REPOSITORY: 'Known-Enough/known-enough', GITHUB_REF: 'refs/heads/main',
  GITHUB_ACTOR_ID: '143764700', GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_SHA: sha, EXPECTED_SOURCE: sha, CHECKOUT_SOURCE: sha };
const files = ['setup', 'partition-setup', 'retention-setup', 'jobs-setup'].map(name => `infra/operations/${name}.json`);
const saved = () => Object.fromEntries(files.map(file => [file, readFileSync(file, 'utf8')]));
const report = () => operationCapabilityReport(env, saved());
const profile = (result, task, name) => result.profiles.find(value => value.task === task && value.profile === name);
const statement = (result, task, name, sid) => profile(result, task, name).statements.find(value => value.sid === sid);

test('all checked profiles and exact proposal bytes are bound to source, without installed PASS', () => {
  const result = report();
  assert.equal(result.sourceSha, sha);
  assert.deepEqual(result.profiles.map(value => `${value.task}/${value.profile}`),
    ['OPS01/participant', 'OPS01/migration', 'OPS01/archive', 'OPS01/inspection',
      'OPS02/ownerService', 'OPS02/erasureExecutor', 'OPS02/policyInstallation', 'OPS03/worker']);
  for (const file of files) assert.equal(result.proposalHashes[file], createHash('sha256').update(saved()[file]).digest('hex'));
  assert.equal(result.result, 'OFFLINE_REQUIREMENTS_MAPPED');
  for (const p of result.profiles) for (const s of p.statements) for (const op of s.operations) {
    assert.equal(op.effectivePermission, 'UNKNOWN'); assert.equal(op.managedOperation, 'NOT_EXECUTED');
    assert.notEqual(op.resource, '*'); assert.ok(!/^(iam:|sts:)/.test(op.action));
  }
  assert.equal(result.limits.iamEvaluation, 'NOT_PERFORMED');
  assert.equal(result.limits.profileUnion, 'NOT_AUTHORIZED');
});

test('journal action/resource matches never promote PLAN scope to partition/archive/retention/job scope', () => {
  const result = report();
  for (const [task, name, sid] of [['OPS01', 'migration', 'MigrationJournalRead'],
    ['OPS01', 'archive', 'ArchiveJournalRead'], ['OPS02', 'ownerService', 'ConsentRead'],
    ['OPS02', 'policyInstallation', 'SourceCheckedRetentionConfiguration'], ['OPS03', 'worker', 'JobLeaseAndDeliveryCAS']]) {
    const s = statement(result, task, name, sid);
    const op = s.operations.find(value => ['dynamodb:GetItem', 'dynamodb:PutItem'].includes(value.action));
    assert.equal(op.declarationComparison.result, 'LEADING_KEY_SCOPE_DIFFERS');
    assert.deepEqual(op.declarationComparison.recoveryConditions, [{ 'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': ['PLAN#*'] } }]);
    assert.notDeepEqual(s.requiredCondition['ForAllValues:StringLike']['dynamodb:LeadingKeys'], ['PLAN#*']);
  }
});

test('same-table transaction conditions and foreign-table access remain undeclared', () => {
  const result = report();
  const cas = statement(result, 'OPS01', 'migration', 'ConditionalMigrationJournal');
  assert.equal(cas.operations.find(op => op.action === 'dynamodb:ConditionCheckItem').declarationComparison.result, 'RESOURCE_ACTION_NOT_DECLARED');
  assert.deepEqual(cas.requiredCondition['ForAnyValue:StringEquals']['dynamodb:EnclosingOperation'], ['TransactWriteItems']);
  assert.equal(cas.requiredCondition.Null['dynamodb:LeadingKeys'], 'false');
  assert.equal(cas.requiredCondition.StringEqualsIfExists['dynamodb:ReturnValues'], 'NONE');
  for (const op of statement(result, 'OPS01', 'participant', 'JoinedDecisionCommit').operations) {
    assert.equal(op.declarationComparison.result, 'RESOURCE_ACTION_NOT_DECLARED');
  }
});

test('reuse candidates preserve required manifest guards and per-table metadata limitations', () => {
  const result = report();
  for (const sid of ['PinnedPrivateRecoveryVersions', 'ExclusivePrivateRecoveryCreate']) {
    const s = statement(result, 'OPS01', 'migration', sid);
    assert.equal(s.requiredCondition.Bool['aws:SecureTransport'], 'true');
    assert.ok(s.operations.every(op => op.declarationComparison.result === 'RESOURCE_ACTION_REUSE_CANDIDATE'));
  }
  assert.equal(statement(result, 'OPS01', 'migration', 'ExclusivePrivateRecoveryCreate').requiredCondition.Null['s3:if-none-match'], 'false');
  const metadata = statement(result, 'OPS01', 'inspection', 'ExactInstalledTables').operations;
  assert.equal(metadata.filter(op => op.declarationComparison.result === 'RESOURCE_ACTION_REUSE_CANDIDATE').length, 3);
  assert.ok(metadata.filter(op => !op.resource.endsWith('/KnownEnoughOperationsJournal')).every(op => op.declarationComparison.result === 'RESOURCE_ACTION_NOT_DECLARED'));
  assert.ok(result.retainedRecoveryDenials[0].Action.includes('iam:*'));
  assert.equal(result.retainedManifestPolicy.Statement.find(s => s.Sid === 'RequireExclusiveManifestCreate').Condition.Null['s3:if-none-match'], 'true');
});

test('consent writers, erasure conditions and AUTH/TOTAL boundaries stay separate', () => {
  const result = report();
  assert.deepEqual(statement(result, 'OPS02', 'erasureExecutor', 'ParticipantConsentConditionOnly').operations.map(op => op.action), ['dynamodb:ConditionCheckItem']);
  assert.ok(statement(result, 'OPS02', 'ownerService', 'VerifiedSelfConsentWrite').operations.some(op => op.action === 'dynamodb:PutItem'));
  const total = statement(result, 'OPS03', 'worker', 'PreservedCumulativeReservationCAS');
  assert.deepEqual(total.requiredCondition['ForAllValues:StringLike']['dynamodb:LeadingKeys'], ['TOTAL']);
  assert.deepEqual(total.operations.map(op => op.action), ['dynamodb:PutItem']);
  assert.deepEqual(statement(result, 'OPS03', 'worker', 'CurrentStandingAuthorityCondition').operations.map(op => op.action), ['dynamodb:ConditionCheckItem']);
  assert.equal(result.resourcePreparation.createOnlyIfVerifiedAbsent.length, 1);
  assert.ok(result.resourcePreparation.createOnlyIfVerifiedAbsent[0].endsWith('/KnownEnoughPartitions'));
  assert.ok(result.resourcePreparation.retainExisting.some(value => value.endsWith('/KnownEnoughQaControl')));
  assert.equal(result.resourcePreparation.currentExistence, 'REQUIRES_ACTUAL_READBACK');
  assert.equal(result.limits.participantConsent, 'NOT_GRANTED');
});

test('source rejection precedes proposal access; untrusted objects cannot contribute serialized fields', () => {
  let accesses = 0;
  const unreadable = new Proxy({}, { get() { accesses++; throw new Error('private-sentinel'); } });
  for (const patch of [{ GITHUB_ACTOR_ID: '44531296' }, { GITHUB_REPOSITORY: 'other/repo' },
    { GITHUB_REF: 'refs/heads/other' }, { GITHUB_EVENT_NAME: 'push' }, { EXPECTED_SOURCE: 'b'.repeat(40) },
    { CHECKOUT_SOURCE: 'b'.repeat(40) }, { GITHUB_SHA: new String(sha) }]) {
    assert.throws(() => operationCapabilityReport({ ...env, ...patch }, unreadable), /^Error: OPS_SOURCE_REJECTED$/);
  }
  assert.equal(accesses, 0);
  assert.throws(() => operationCapabilityReport(env, unreadable), /^Error: OPS_CAPABILITY_INPUT_REJECTED$/);
  assert.equal(accesses, 1);
  for (const file of files) for (const changed of [undefined, saved()[file] + ' ', JSON.stringify(JSON.parse(saved()[file]))]) {
    assert.throws(() => operationCapabilityReport(env, { ...saved(), [file]: changed }), /^Error: OPS_CAPABILITY_PROPOSAL_DRIFT$/);
  }
  let hooks = 0;
  const input = { ...saved(), private: 'private-sentinel', toJSON() { hooks++; throw new Error('private-sentinel'); } };
  assert.ok(!JSON.stringify(operationCapabilityReport(env, input)).includes('private-sentinel'));
  assert.equal(hooks, 0);
});

test('each saved proposal is captured once and reports share no mutable condition state', () => {
  const input = saved(); const accesses = {};
  for (const file of files) {
    const bytes = input[file]; accesses[file] = 0;
    Object.defineProperty(input, file, { get() { return ++accesses[file] === 1 ? bytes : 'private-sentinel'; } });
  }
  const first = operationCapabilityReport(env, input);
  assert.ok(Object.values(accesses).every(value => value === 1));
  first.profiles[0].statements[0].requiredCondition.Null['dynamodb:LeadingKeys'] = 'true';
  assert.equal(report().profiles[0].statements[0].requiredCondition.Null['dynamodb:LeadingKeys'], 'false');
});

test('actual CLI emits only offline JSON; foreign source fails with a finite error', () => {
  const result = JSON.parse(execFileSync(process.execPath, ['scripts/operations/capabilities.mjs'], { env: { ...process.env, ...env }, encoding: 'utf8' }));
  assert.deepEqual(result, report());
  const rejected = spawnSync(process.execPath, ['scripts/operations/capabilities.mjs'], { env: { ...process.env, ...env, GITHUB_ACTOR_ID: '44531296' }, encoding: 'utf8' });
  assert.equal(rejected.status, 1); assert.equal(rejected.stdout, '');
  assert.equal(rejected.stderr, 'OPS_CAPABILITY_REPORT_FAILED\n');
});

test('the existing offline workflow maps capabilities before dependencies and grants no cloud credentials', () => {
  const workflow = readFileSync('.github/workflows/operations-verify.yml', 'utf8');
  assert.ok(workflow.indexOf('node scripts/operations/capabilities.mjs') > 0);
  assert.ok(workflow.indexOf('node scripts/operations/capabilities.mjs') < workflow.indexOf('npm ci'));
  assert.ok(workflow.includes('${{ runner.temp }}/capabilities-report.json'));
  assert.ok(!/id-token:|configure-aws-credentials|secrets\./.test(workflow));
});
