import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
// @ts-expect-error Operational JavaScript exercised by Vitest.
import { primaryApply, primaryRollback, assertPrimaryTable, primaryPlan } from '../../scripts/live-qa/primary.mjs';
// @ts-expect-error Operational JavaScript exercised by Vitest.
import { digest } from '../../scripts/live-qa/config.mjs';
vi.mock('../../scripts/live-qa/aws.mjs', async importOriginal => ({
  ...await importOriginal<object>(),
  awsSkeleton: (_service: string, operation: string) => operation === 'update-user-pool'
    ? { UserPoolId: '', AdminCreateUserConfig: {}, AutoVerifiedAttributes: [], Policies: {} }
    : { UserPoolId: '', ClientId: '', AllowedOAuthScopes: [], CallbackURLs: [] }
}));
const directories: string[] = [];
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); directories.splice(0).forEach(p => rmSync(p, { recursive: true, force: true })); });
const original = Buffer.from('original function bytes');
const replacement = Buffer.from('new verified function bytes');
const account = '092954139775';
const table = { TableName: 'KnownEnoughGroupsStage', TableArn: `arn:aws:dynamodb:us-east-1:${account}:table/KnownEnoughGroupsStage`, TableStatus: 'ACTIVE',
  KeySchema: [{ AttributeName: 'PK', KeyType: 'HASH' }, { AttributeName: 'SK', KeyType: 'RANGE' }],
  AttributeDefinitions: [{ AttributeName: 'PK', AttributeType: 'S' }, { AttributeName: 'SK', AttributeType: 'S' }],
  DeletionProtectionEnabled: true, SSEDescription: { Status: 'ENABLED' } };
const tags = [{ Key: 'KnownEnoughPrimaryGroup', Value: 'true' }];
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
    policy: null as unknown, revision: 0, fail: '', failAfter: '', stuck: '', stuckAfter: '', tableMissing: false, calls: [] as string[]
  };
  const aws = (_service: string, operation: string, input: Record<string, unknown> = {}) => {
    state.calls.push(operation);
    if (state.fail === operation) throw new Error('INJECTED_FAILURE');
    let result: unknown = {};
    switch (operation) {
      case 'get-function-configuration': result = { ...state.lambda, LastUpdateStatus: state.stuck || state.lambda.LastUpdateStatus }; break;
      case 'get-function': result = { Configuration: state.lambda, Code: { Location: 'https://example.invalid/rollback' } }; break;
      case 'describe-user-pool': result = { UserPool: state.pool }; break;
      case 'describe-user-pool-client': result = { UserPoolClient: state.client }; break;
      case 'get-routes': result = { Items: state.routes }; break;
      case 'describe-table': if (state.tableMissing) throw Object.assign(new Error('missing'), { missing: true }); result = { Table: table }; break;
      case 'create-table': state.tableMissing = false; break;
      case 'list-tags-of-resource': result = { Tags: tags }; break;
      case 'get-role-policy': if (!state.policy) throw Object.assign(new Error('missing'), { missing: true }); result = { PolicyDocument: state.policy }; break;
      case 'put-role-policy': state.policy = JSON.parse(input.PolicyDocument as string); break;
      case 'delete-role-policy': state.policy = null; break;
      case 'create-route': { const route = { ...input, RouteId: 'created-' + state.routes.length } as typeof state.routes[number]; state.routes.push(route); result = route; break; }
      case 'delete-route': state.routes = state.routes.filter(route => route.RouteId !== input.RouteId); break;
      case 'update-user-pool': { const fields = { ...input }; delete fields.UserPoolId; state.pool = fields as typeof state.pool; break; }
      case 'update-user-pool-client': { const fields = { ...input }; delete fields.UserPoolId; delete fields.ClientId; state.client = fields as typeof state.client; break; }
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
