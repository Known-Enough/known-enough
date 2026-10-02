import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import cliInputs from '../evaluations/aws-cli-input-keys.json';
// @ts-expect-error Operational JavaScript exercised by Vitest.
import { primaryApply, primaryRollback, assertPrimaryTable, primaryPlan, sameCognito, reconcilePendingSignup, reconcilePendingCode } from '../../scripts/live-qa/primary.mjs';
// @ts-expect-error Operational JavaScript exercised by Vitest.
import { digest } from '../../scripts/live-qa/config.mjs';
vi.mock('../../scripts/live-qa/aws.mjs', async importOriginal => ({
  ...await importOriginal<object>(),
  awsSkeleton: (_service: string, operation: string) => Object.fromEntries(cliInputs.operations[
    operation === 'update-user-pool' ? 'cognito-idp:update-user-pool' : 'cognito-idp:update-user-pool-client'
  ].members.map(key => [key, null]))
}));
const directories: string[] = [];
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); directories.splice(0).forEach(p => rmSync(p, { recursive: true, force: true })); });
const original = Buffer.from('original function bytes');
const replacement = Buffer.from('new verified function bytes');
const account = '092954139775';
const table = { TableName: 'KnownEnoughGroupsStage', TableArn: `arn:aws:dynamodb:us-east-1:${account}:table/KnownEnoughGroupsStage`, TableStatus: 'ACTIVE',
  KeySchema: [{ AttributeName: 'PK', KeyType: 'HASH' }, { AttributeName: 'SK', KeyType: 'RANGE' }],
  AttributeDefinitions: [{ AttributeName: 'PK', AttributeType: 'S' }, { AttributeName: 'SK', AttributeType: 'S' }],
  DeletionProtectionEnabled: true, SSEDescription: { Status: 'ENABLED' } };
const tags = [{ Key: 'KnownEnoughPrimaryGroup', Value: 'true' }];
function reverseObjects(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseObjects);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseObjects(item)]));
  return value;
}
function instantPolling() { vi.stubGlobal('setTimeout', (callback: () => void) => { callback(); return 1; }); }

function harness() {
  const directory = mkdtempSync(join(tmpdir(), 'ke-primary-regression-')); directories.push(directory);
  writeFileSync(directory + '/api.zip', replacement);
  const config = { account, primaryRollout: true, primaryExpectedRevision: 'original-revision' };
  const manifest = { artifacts: { api: { sha256: digest(replacement) } } };
  const state = {
    lambda: { RevisionId: 'original-revision', State: 'Active', LastUpdateStatus: 'Successful', CodeSha256: Buffer.from(digest(original), 'hex').toString('base64'),
      Environment: { Variables: { KE14_MODEL_MODE: 'DISABLED', KE14_PAID_CALLS_APPROVED: 'false', KEEP: 'yes' } }, Handler: 'original.handler', Role: `arn:aws:iam::${account}:role/Runtime` },
    pool: { AdminCreateUserConfig: { AllowAdminCreateUserOnly: true }, AutoVerifiedAttributes: [], Policies: { preserved: true } },
    client: { AllowedOAuthScopes: ['profile'], CallbackURLs: ['https://example.invalid/'] },
    routes: [{ RouteId: 'anchor', RouteKey: 'ANY /decisions/{proxy+}', AuthorizationType: 'JWT', AuthorizerId: 'exact', Target: 'integrations/exact' }],
    policy: null as unknown, revision: 0, reorderReads: false, poolPropagation: 0, clientPropagation: 0,
    poolOld: null as unknown, clientOld: null as unknown, poolDrift: false, clientDrift: false, fail: '', failAfter: '', stuck: '', stuckAfter: '', tableMissing: false, calls: [] as string[]
  };
  const aws = (_service: string, operation: string, input: Record<string, unknown> = {}) => {
    state.calls.push(operation);
    if (state.fail === operation) throw new Error('INJECTED_FAILURE');
    let result: unknown = {};
    switch (operation) {
      case 'get-function-configuration': result = { ...state.lambda, LastUpdateStatus: state.stuck || state.lambda.LastUpdateStatus }; break;
      case 'get-function': result = { Configuration: state.lambda, Code: { Location: 'https://example.invalid/rollback' } }; break;
      case 'describe-user-pool': {
        const snapshot = state.poolOld && state.poolPropagation-- > 0 ? state.poolOld : state.pool;
        result = { UserPool: state.reorderReads ? reverseObjects(snapshot) : snapshot }; break;
      }
      case 'describe-user-pool-client': {
        const snapshot = state.clientOld && state.clientPropagation-- > 0 ? state.clientOld : state.client;
        result = { UserPoolClient: state.reorderReads ? reverseObjects(snapshot) : snapshot }; break;
      }
      case 'get-routes': result = { Items: state.routes }; break;
      case 'describe-table': if (state.tableMissing) throw Object.assign(new Error('missing'), { missing: true }); result = { Table: table }; break;
      case 'create-table': state.tableMissing = false; break;
      case 'list-tags-of-resource': result = { Tags: tags }; break;
      case 'get-role-policy': if (!state.policy) throw Object.assign(new Error('missing'), { missing: true }); result = { PolicyDocument: state.policy }; break;
      case 'put-role-policy': state.policy = JSON.parse(input.PolicyDocument as string); break;
      case 'delete-role-policy': state.policy = null; break;
      case 'create-route': { const route = { ...input, RouteId: 'created-' + state.routes.length } as typeof state.routes[number]; state.routes.push(route); result = route; break; }
      case 'delete-route': state.routes = state.routes.filter(route => route.RouteId !== input.RouteId); break;
      case 'update-user-pool': { state.poolOld = structuredClone(state.pool); const fields = { ...input }; delete fields.UserPoolId; state.pool = { ...state.pool, ...fields, AutoVerifiedAttributes: (fields.AutoVerifiedAttributes ?? []) as string[] } as typeof state.pool; if (state.poolDrift) state.pool.Policies = { preserved: false }; break; }
      case 'update-user-pool-client': { state.clientOld = structuredClone(state.client); const fields = { ...input }; delete fields.UserPoolId; delete fields.ClientId; state.client = { ...state.client, ...fields, AllowedOAuthScopes: (fields.AllowedOAuthScopes ?? []) as string[] } as typeof state.client; state.client.AllowedOAuthScopes.reverse(); if (state.clientDrift) state.client.CallbackURLs = ['https://foreign.invalid/']; break; }
      case 'update-function-code':
      case 'update-function-configuration':
        expect(input.RevisionId).toBe(state.lambda.RevisionId);
        state.lambda.RevisionId = 'revision-' + ++state.revision;
        if (operation === 'update-function-code') state.lambda.CodeSha256 = Buffer.from(digest(Buffer.from(input.ZipFile as string, 'base64')), 'hex').toString('base64');
        else { state.lambda.Environment = structuredClone(input.Environment) as typeof state.lambda.Environment; state.lambda.Handler = input.Handler as string; }
        result = state.lambda; break;
      default: throw new Error('UNEXPECTED_OPERATION:' + operation);
    }
    if (state.stuckAfter === operation) state.stuck = 'InProgress';
    if (state.failAfter === operation) throw new Error('LOST_MUTATION_RESPONSE');
    return structuredClone(result);
  };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(original)));
  const journal = () => JSON.parse(readFileSync(directory + '/primary-private-journal.json', 'utf8'));
  return { directory, config, manifest, state, aws, journal, apply: () => primaryApply(config, manifest, directory, aws), rollback: () => primaryRollback(directory, aws) };
}
test('apply/retry/rollback preserve original snapshots and verify all restored resources', async () => {
  const h = harness(); const before = structuredClone(h.state);
  expect((await h.apply()).status).toBe('PASS');
  const baseline = h.journal(); const writes = h.state.calls.filter(call => /^(create|put|update)-/.test(call)).length;
  expect((await h.apply()).status).toBe('PASS');
  expect(h.state.calls.filter(call => /^(create|put|update)-/.test(call))).toHaveLength(writes);
  expect((await h.rollback()).status).toBe('PASS'); expect((await h.rollback()).status).toBe('PASS');
  expect(h.state.lambda.CodeSha256).toBe(before.lambda.CodeSha256);
  expect(h.state.lambda.Environment).toEqual(before.lambda.Environment); expect(h.state.lambda.Handler).toBe(before.lambda.Handler);
  expect(h.state.pool).toEqual(before.pool); expect(h.state.client).toEqual(before.client);
  expect(h.state.routes).toEqual(before.routes); expect(h.state.policy).toBeNull();
  expect(h.journal().config).toEqual(baseline.config); expect(h.journal().rollbackCode).toBe(digest(original));
});
test('failed rollback download retries without replacing original journal', async () => {
  const h = harness(); vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
  await expect(h.apply()).rejects.toThrow('ROLLBACK_CODE_UNAVAILABLE'); const before = h.journal();
  await expect(h.apply()).rejects.toThrow('ROLLBACK_CODE_UNAVAILABLE'); expect(h.journal()).toEqual(before);
  h.state.lambda.RevisionId = 'foreign'; await expect(h.apply()).rejects.toThrow('DRIFT'); expect(h.journal()).toEqual(before);
});
test.each(['create-table', 'put-role-policy', 'create-route', 'update-user-pool', 'update-user-pool-client', 'update-function-code', 'update-function-configuration'])('lost %s response preserves baseline and blocks adoption/retry', async operation => {
  const h = harness(); h.state.failAfter = operation; h.state.tableMissing = operation === 'create-table';
  await expect(h.apply()).rejects.toThrow('LOST_MUTATION_RESPONSE'); const before = h.journal();
  expect(before.config.RevisionId).toBe('original-revision'); expect(before.rollbackCode).toBe(digest(original)); expect(before.pending).toBeTruthy();
  h.state.failAfter = ''; await expect(h.apply()).rejects.toThrow('RECONCILIATION_REQUIRED'); expect(h.journal()).toEqual(before);
  await expect(h.rollback()).rejects.toThrow('RECONCILIATION_REQUIRED');
});
test.each(['InProgress', 'Failed'])('rollback fails closed on %s, before destructive resource cleanup', async status => {
  const h = harness(); await h.apply(); const before = h.state.calls.length; h.state.stuck = status;
  vi.stubGlobal('setTimeout', (callback: () => void) => { callback(); return 1; });
  await expect(h.rollback()).rejects.toThrow(status === 'Failed' ? '_FAILED' : '_TIMEOUT');
  expect(h.state.calls.slice(before)).not.toContain('delete-route'); expect(h.state.calls.slice(before)).not.toContain('delete-role-policy');
});
test('rollback waits after configuration, refuses foreign routes and corrupt rollback bytes', async () => {
  const h = harness(); await h.apply(); h.state.routes[1]!.Target = 'integrations/foreign';
  await expect(h.rollback()).rejects.toThrow('ROUTE_DRIFT'); expect(h.state.routes).toHaveLength(18);
  writeFileSync(h.directory + '/primary-rollback.zip', 'foreign'); await expect(h.rollback()).rejects.toThrow('ROLLBACK_BYTES_CHANGED');
});
test('legacy journal never silently overwritten', async () => {
  const h = harness(); const old = { schemaVersion: 1, config: h.state.lambda, createdRoutes: ['mine'], createdPolicy: true };
  writeFileSync(h.directory + '/primary-private-journal.json', JSON.stringify(old)); await expect(h.apply()).rejects.toThrow('LEGACY_PRIMARY'); expect(h.journal()).toEqual(old);
});
test('table validation rejects reversed keys, numeric keys, foreign ownership/account and missing safeguards', () => {
  expect(() => assertPrimaryTable(table, account, tags)).not.toThrow();
  for (const change of [{ KeySchema: [...table.KeySchema].reverse().map(k => ({ ...k, KeyType: k.KeyType === 'HASH' ? 'RANGE' : 'HASH' })) },
    { AttributeDefinitions: [{ AttributeName: 'PK', AttributeType: 'N' }, table.AttributeDefinitions[1]] }, { TableStatus: 'CREATING' },
    { DeletionProtectionEnabled: false }, { SSEDescription: {} }, { TableArn: table.TableArn.replace(account, '000000000000') },
    { GlobalSecondaryIndexes: [{}] }]) expect(() => assertPrimaryTable({ ...table, ...change }, account, tags)).toThrow('TABLE_CONFLICT');
  expect(() => assertPrimaryTable(table, account, [])).toThrow('TABLE_CONFLICT');
});

test.each(['update-function-code', 'update-function-configuration'])('rollback timeout after %s is resumable and cannot delete routing first', async operation => {
  const h = harness(); await h.apply(); const baseline = h.journal().config; h.state.stuckAfter = operation;
  vi.stubGlobal('setTimeout', (callback: () => void) => { callback(); return 1; });
  const before = h.state.calls.length; await expect(h.rollback()).rejects.toThrow('_TIMEOUT');
  expect(h.state.calls.slice(before)).not.toContain('delete-route'); expect(h.journal().config).toEqual(baseline);
  h.state.stuck = ''; h.state.stuckAfter = ''; expect((await h.rollback()).status).toBe('PASS');
});
test.each(['delete-route', 'delete-role-policy', 'update-user-pool', 'update-user-pool-client'])('lost rollback %s response cannot report PASS or discard baseline', async operation => {
  const h = harness(); await h.apply(); const baseline = h.journal().config; h.state.failAfter = operation;
  await expect(h.rollback()).rejects.toThrow('LOST_MUTATION_RESPONSE'); expect(h.journal().config).toEqual(baseline);
  h.state.failAfter = ''; await expect(h.rollback()).rejects.toThrow('RECONCILIATION_REQUIRED');
});

test('primary model-off guard also rejects retained paid-call approval', () => {
  const h = harness(); expect(() => primaryPlan(h.config, { ...h.state.lambda, Environment: { Variables: { KE14_MODEL_MODE: 'DISABLED', KE14_PAID_CALLS_APPROVED: 'true' } } })).toThrow('NP00_PRIMARY_HOLD');
});


test('Cognito compares object order and named sets while retaining exact values, duplicates, unknown arrays and missing defaults', () => {
  const a = { AdminCreateUserConfig: { UnusedAccountValidityDays: 7, AllowAdminCreateUserOnly: false }, AutoVerifiedAttributes: ['phone_number', 'email'], Policies: { PasswordPolicy: { MinimumLength: 12, RequireSymbols: true } } };
  expect(digest(a)).not.toBe(digest(reverseObjects(a)));
  expect(sameCognito(a, reverseObjects(a))).toBe(true);
  expect(sameCognito(a, { ...a, AutoVerifiedAttributes: ['email', 'phone_number'] })).toBe(true);
  expect(sameCognito(a, { ...a, AutoVerifiedAttributes: ['email'] })).toBe(false);
  expect(sameCognito(a, { ...a, AutoVerifiedAttributes: ['phone_number', 'email', 'email'] })).toBe(false);
  expect(sameCognito(a, { ...a, MfaConfiguration: 'OFF' })).toBe(false);
  expect(sameCognito({}, { AutoVerifiedAttributes: [], AllowedOAuthScopes: [] })).toBe(true);
  expect(sameCognito({}, { AutoVerifiedAttributes: ['email'] })).toBe(false);
  expect(sameCognito({ unknown: ['a', 'b'] }, { unknown: ['b', 'a'] })).toBe(false);
  expect(sameCognito({ AccountRecoverySetting: { RecoveryMechanisms: [{ Name: 'verified_email', Priority: 1 }, { Name: 'verified_phone_number', Priority: 2 }] } },
    { AccountRecoverySetting: { RecoveryMechanisms: [{ Name: 'verified_phone_number', Priority: 1 }, { Name: 'verified_email', Priority: 2 }] } })).toBe(false);
});

test('apply and rollback accept reordered Cognito readbacks, preserve all unrelated settings and wait for propagation', async () => {
  const h = harness(); instantPolling(); h.state.reorderReads = true; h.state.poolPropagation = 2; h.state.clientPropagation = 2;
  Object.assign(h.state.pool, { Id: 'us-east-1_V9OMjd0zx', CreationDate: '2026-09-01T00:00:00Z', LastModifiedDate: '2026-09-01T00:00:00Z',
    EmailConfiguration: { EmailSendingAccount: 'COGNITO_DEFAULT' }, LambdaConfig: { PreSignUp: 'arn:exact' }, UserPoolTags: { retained: 'yes' }, MfaConfiguration: 'OPTIONAL',
    AdminCreateUserConfig: { InviteMessageTemplate: { EmailSubject: 'retained', EmailMessage: '{username} {####}' }, AllowAdminCreateUserOnly: true, UnusedAccountValidityDays: 7 } });
  Object.assign(h.state.client, { ClientId: '3accf7paalvon2m8ue8okfi853', UserPoolId: 'us-east-1_V9OMjd0zx', CreationDate: '2026-09-01T00:00:00Z',
    SupportedIdentityProviders: ['COGNITO'], AllowedOAuthFlows: ['code'], AllowedOAuthFlowsUserPoolClient: true, TokenValidityUnits: { IdToken: 'minutes', AccessToken: 'minutes', RefreshToken: 'days' } });
  const beforePool = structuredClone(h.state.pool); const beforeClient = structuredClone(h.state.client);
  await expect(h.apply()).resolves.toMatchObject({ status: 'PASS' });
  expect(h.journal().pool).toEqual(beforePool); expect(h.journal().client).toEqual(beforeClient);
  expect(h.state.calls.filter(call => call === 'update-user-pool')).toHaveLength(1);
  expect(h.state.calls.filter(call => call === 'update-user-pool-client')).toHaveLength(1);
  expect(h.state.pool).toMatchObject({ EmailConfiguration: { EmailSendingAccount: 'COGNITO_DEFAULT' }, LambdaConfig: { PreSignUp: 'arn:exact' }, UserPoolTags: { retained: 'yes' }, MfaConfiguration: 'OPTIONAL' });
  // Service response metadata is retained but is not a settings drift.
  Object.assign(h.state.pool, { LastModifiedDate: '2026-10-02T00:00:00Z', EstimatedNumberOfUsers: 3 });
  await expect(h.apply()).resolves.toMatchObject({ status: 'PASS' });
  await expect(h.rollback()).resolves.toMatchObject({ status: 'PASS' });
  expect(sameCognito(h.state.pool.Policies, beforePool.Policies)).toBe(true);
  expect(sameCognito(h.state.client.AllowedOAuthScopes, beforeClient.AllowedOAuthScopes)).toBe(true);
});

test.each(['pool', 'client'])('genuine %s readback drift retains pending intent and refuses retry', async kind => {
  const h = harness(); instantPolling(); h.state.poolDrift = kind === 'pool'; h.state.clientDrift = kind === 'client';
  await expect(h.apply()).rejects.toThrow(kind === 'pool' ? 'PRIMARY_POOL_READBACK_FAILED' : 'PRIMARY_CLIENT_READBACK_FAILED');
  const originalJournal = readFileSync(h.directory + '/primary-private-journal.json');
  expect(h.journal().pending).toBe(kind === 'pool' ? 'enable-signup' : 'enable-client-scopes');
  await expect(h.apply()).rejects.toThrow('RECONCILIATION_REQUIRED');
  expect(readFileSync(h.directory + '/primary-private-journal.json')).toEqual(originalJournal);
});

test('exact interrupted signup reconciles with read-only cloud evidence then resumes without repeating the pool write', async () => {
  const h = harness(); h.state.failAfter = 'update-user-pool';
  await expect(h.apply()).rejects.toThrow('LOST_MUTATION_RESPONSE');
  h.state.failAfter = ''; h.state.reorderReads = true;
  const originalJournal = readFileSync(h.directory + '/primary-private-journal.json'); const baseline = h.journal();
  const originalRollback = readFileSync(h.directory + '/primary-rollback.zip'); const start = h.state.calls.length;
  await expect(reconcilePendingSignup(h.config, h.manifest, h.directory, h.aws)).resolves.toEqual({ status: 'PRIMARY_SIGNUP_RECONCILED', cloudWrites: false });
  expect(h.state.calls.slice(start).every(call => /^(get|describe|list)-/.test(call))).toBe(true);
  expect(readFileSync(h.directory + '/primary-before-assess09.json')).toEqual(originalJournal);
  expect(readFileSync(h.directory + '/primary-rollback.zip')).toEqual(originalRollback);
  expect(h.journal()).toMatchObject({ pending: null, poolDone: true, config: baseline.config, pool: baseline.pool, client: baseline.client, afterRevision: baseline.afterRevision });
  expect(h.journal().createdRoutes).toEqual(baseline.createdRoutes);
  await expect(h.apply()).resolves.toMatchObject({ status: 'PASS' });
  expect(h.state.calls.filter(call => call === 'update-user-pool')).toHaveLength(1);
  await expect(reconcilePendingSignup(h.config, h.manifest, h.directory, h.aws)).resolves.toMatchObject({ status: 'PRIMARY_RECONCILIATION_NOT_REQUIRED' });
  expect(readFileSync(h.directory + '/primary-before-assess09.json')).toEqual(originalJournal);
  await expect(h.rollback()).resolves.toMatchObject({ status: 'PASS' });
});

test.each(['pool-setting', 'missing-default', 'client', 'lambda', 'backup', 'other-pending', 'artifact', 'route', 'policy'])('reconciliation rejects %s and leaves journal/backup unchanged', async drift => {
  const h = harness(); instantPolling(); h.state.failAfter = 'update-user-pool';
  await expect(h.apply()).rejects.toThrow('LOST_MUTATION_RESPONSE'); h.state.failAfter = '';
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  if (drift === 'pool-setting') h.state.pool.Policies = { preserved: false };
  if (drift === 'missing-default') Object.assign(h.state.pool, { MfaConfiguration: 'OFF' });
  if (drift === 'client') h.state.client.CallbackURLs = ['https://foreign.invalid/'];
  if (drift === 'lambda') h.state.lambda.Environment.Variables.KEEP = 'foreign';
  if (drift === 'backup') writeFileSync(h.directory + '/primary-rollback.zip', 'foreign');
  if (drift === 'artifact') writeFileSync(h.directory + '/api.zip', 'foreign');
  if (drift === 'route') h.state.routes[1]!.Target = 'integrations/foreign';
  if (drift === 'policy') h.state.policy = { Statement: [] };
  if (drift === 'other-pending') writeFileSync(h.directory + '/primary-private-journal.json', JSON.stringify({ ...h.journal(), pending: 'update-code' }));
  const before = readFileSync(h.directory + '/primary-private-journal.json'); const backup = readFileSync(h.directory + '/primary-rollback.zip');
  const start = h.state.calls.length;
  await expect(reconcilePendingSignup(h.config, h.manifest, h.directory, h.aws)).rejects.toThrow();
  expect(readFileSync(h.directory + '/primary-private-journal.json')).toEqual(before);
  expect(readFileSync(h.directory + '/primary-rollback.zip')).toEqual(backup);
  expect(h.state.calls.slice(start).every(call => /^(get|describe|list)-/.test(call))).toBe(true);
  expect(JSON.stringify(errors.mock.calls)).not.toContain('foreign');
});


test('initially absent auto-verification field is appended to intent but ordered earlier by DescribeUserPool projection', async () => {
  const h = harness(); Reflect.deleteProperty(h.state.pool, 'AutoVerifiedAttributes');
  // This is the original comparison's top-level insertion-order defect, even when
  // DescribeUserPool preserves every nested key and returns exactly the intended value.
  const projected = { AdminCreateUserConfig: { AllowAdminCreateUserOnly: false }, AutoVerifiedAttributes: ['email'], Policies: h.state.pool.Policies, UserPoolId: 'us-east-1_V9OMjd0zx' };
  const intent = { AdminCreateUserConfig: projected.AdminCreateUserConfig, Policies: projected.Policies, UserPoolId: projected.UserPoolId, AutoVerifiedAttributes: ['email'] };
  expect(digest(projected)).not.toBe(digest(intent)); expect(sameCognito(projected, intent)).toBe(true);
  await expect(h.apply()).resolves.toMatchObject({ status: 'PASS' });
  expect(h.state.pool.AutoVerifiedAttributes).toEqual(['email']);
  expect(h.journal().pool).not.toHaveProperty('AutoVerifiedAttributes');
  await expect(h.rollback()).resolves.toMatchObject({ status: 'PASS' });
  expect(h.state.pool.AutoVerifiedAttributes).toEqual([]);
});


test('unapplied code upload reconciles by readback only, preserves backup and resumes once', async () => {
  const h = harness(); h.state.fail = 'update-function-code';
  await expect(h.apply()).rejects.toThrow('INJECTED_FAILURE');
  const before = readFileSync(h.directory + '/primary-private-journal.json');
  const rollback = readFileSync(h.directory + '/primary-rollback.zip');
  const start = h.state.calls.length;
  await expect(reconcilePendingCode(h.config, h.manifest, h.directory, h.aws)).resolves.toEqual({ status: 'PRIMARY_CODE_UPLOAD_NOT_APPLIED_RECONCILED', cloudWrites: false });
  expect(h.state.calls.slice(start).every(call => /^(get|describe|list)-/.test(call))).toBe(true);
  expect(readFileSync(h.directory + '/primary-before-lambda-upload-repair.json')).toEqual(before);
  expect(readFileSync(h.directory + '/primary-rollback.zip')).toEqual(rollback);
  expect(h.journal()).toMatchObject({ pending: null, codeDone: false });
  h.state.fail = '';
  await expect(h.apply()).resolves.toMatchObject({ status: 'PASS' });
  expect(h.state.calls.filter(call => call === 'update-user-pool')).toHaveLength(1);
  expect(h.state.calls.filter(call => call === 'update-user-pool-client')).toHaveLength(1);
  expect(h.journal().config.CodeSha256).toBe(JSON.parse(before.toString()).config.CodeSha256);
});

test.each(['applied', 'revision', 'role', 'environment', 'cognito', 'policy', 'route', 'backup', 'package', 'other-pending'])('pending upload rejects %s and preserves checkpoint', async drift => {
  const h = harness(); h.state.fail = 'update-function-code';
  await expect(h.apply()).rejects.toThrow('INJECTED_FAILURE'); h.state.fail = '';
  if (drift === 'applied') h.state.lambda.CodeSha256 = Buffer.from(digest(replacement), 'hex').toString('base64');
  if (drift === 'revision') h.state.lambda.RevisionId = 'foreign-revision';
  if (drift === 'role') h.state.lambda.Role += 'foreign';
  if (drift === 'environment') h.state.lambda.Environment.Variables.KEEP = 'foreign';
  if (drift === 'cognito') h.state.client.CallbackURLs = ['https://foreign.invalid/'];
  if (drift === 'policy') h.state.policy = { Statement: [] };
  if (drift === 'route') h.state.routes[1]!.Target = 'integrations/foreign';
  if (drift === 'backup') writeFileSync(h.directory + '/primary-rollback.zip', 'foreign');
  if (drift === 'package') writeFileSync(h.directory + '/api.zip', 'foreign');
  if (drift === 'other-pending') writeFileSync(h.directory + '/primary-private-journal.json', JSON.stringify({ ...h.journal(), pending: 'update-config' }));
  const before = readFileSync(h.directory + '/primary-private-journal.json');
  const start = h.state.calls.length;
  await expect(reconcilePendingCode(h.config, h.manifest, h.directory, h.aws)).rejects.toThrow();
  expect(readFileSync(h.directory + '/primary-private-journal.json')).toEqual(before);
  expect(h.state.calls.slice(start).every(call => /^(get|describe|list)-/.test(call))).toBe(true);
  expect(() => readFileSync(h.directory + '/primary-before-lambda-upload-repair.json')).toThrow();
});
