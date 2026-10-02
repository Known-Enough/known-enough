import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { digest } from './config.mjs';
import { preservationInput, awsSkeleton } from './aws.mjs';

const functionName = 'known-enough-stage-api';
const pool = 'us-east-1_V9OMjd0zx';
const client = '3accf7paalvon2m8ue8okfi853';
const api = 'u94iyvt6p9';
const groupTable = 'KnownEnoughGroupsStage';
const policyName = 'KnownEnoughStageGroups';
const routes = ['GET /account', 'POST /account/register', 'GET /groups', 'POST /groups',
  'POST /groups/accept', 'POST /groups/{groupId}/invitations', 'POST /groups/{groupId}/remove',
  'GET /groups/{groupId}/drafts/{draftId}', 'POST /groups/{groupId}/drafts',
  'POST /groups/{groupId}/drafts/{draftId}', 'POST /groups/{groupId}/drafts/{draftId}/create',
  'GET /groups/{groupId}/decisions/{decisionId}/review',
  'POST /groups/{groupId}/decisions/{decisionId}/revise',
  'OPTIONS /account', 'OPTIONS /account/register', 'OPTIONS /groups', 'OPTIONS /groups/{proxy+}'];
const delay = () => new Promise(resolve => globalThis.setTimeout(resolve, 1000));
const codeHash = hex => Buffer.from(hex, 'hex').toString('base64');
const same = (a, b) => digest(a) === digest(b);
const lambda = aws => aws('lambda', 'get-function-configuration', { FunctionName: functionName });
const readPool = aws => aws('cognito-idp', 'describe-user-pool', { UserPoolId: pool }).UserPool;
const readClient = aws => aws('cognito-idp', 'describe-user-pool-client',
  { UserPoolId: pool, ClientId: client }).UserPoolClient;
const readRoutes = aws => aws('apigatewayv2', 'get-routes', { ApiId: api }).Items ?? [];

function journalAt(directory) {
  const path = directory + '/primary-private-journal.json';
  return {
    exists: existsSync(path),
    read: () => JSON.parse(readFileSync(path, 'utf8')),
    save: state => {
      // A failed/truncated write must never replace the previous checkpoint.
      writeFileSync(path + '.next', JSON.stringify(state), { mode: 0o600 });
      renameSync(path + '.next', path);
    }
  };
}
function policy(account, table = groupTable) {
  return { Version: '2012-10-17', Statement: [{ Effect: 'Allow',
    Action: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:ConditionCheckItem'],
    Condition: { 'ForAllValues:StringEquals': { 'dynamodb:LeadingKeys': ['NP#GROUPS'] } },
    Resource: `arn:aws:dynamodb:us-east-1:${account}:table/${table}` }] };
}
function readPolicy(aws, role) {
  try {
    const raw = aws('iam', 'get-role-policy', { RoleName: role, PolicyName: policyName }).PolicyDocument;
    return typeof raw === 'string' ? JSON.parse(decodeURIComponent(raw)) : raw;
  } catch (error) { if (error.missing) return null; throw error; }
}
function routeShape(route) {
  return { RouteKey: route.RouteKey, Target: route.Target, AuthorizationType: route.AuthorizationType,
    ...(route.AuthorizationType === 'JWT' ? { AuthorizerId: route.AuthorizerId } : {}) };
}
function expectedRoute(route, anchor) {
  return { RouteKey: route, Target: anchor.Target,
    AuthorizationType: route.startsWith('OPTIONS ') ? 'NONE' : 'JWT',
    ...(route.startsWith('OPTIONS ') ? {} : { AuthorizerId: anchor.AuthorizerId }) };
}
function poolInput(snapshot) {
  return { ...preservationInput(snapshot, awsSkeleton('cognito-idp', 'update-user-pool')), UserPoolId: pool };
}
function clientInput(snapshot) {
  return { ...preservationInput(snapshot, awsSkeleton('cognito-idp', 'update-user-pool-client')),
    UserPoolId: pool, ClientId: client };
}
function assertLambda(state, current, expectedCode, environment, handler) {
  if (current.RevisionId !== state.afterRevision || current.State !== 'Active' ||
      current.CodeSha256 !== expectedCode || !same(current.Environment, environment) ||
      current.Handler !== handler) throw new Error('PRIMARY_REVISION_OR_CONFIG_DRIFT');
}
async function ready(aws, revision, prefix) {
  for (let i = 0; i < 60; i++) {
    const current = lambda(aws);
    if (current.RevisionId !== revision) throw new Error('PRIMARY_REVISION_OR_CONFIG_DRIFT');
    if (current.LastUpdateStatus === 'Failed') throw new Error(prefix + '_FAILED');
    if (current.LastUpdateStatus === 'Successful' && current.State === 'Active') return current;
    await delay();
  }
  throw new Error(prefix + '_TIMEOUT');
}
function assertNoPending(state) {
  if (state.pending) throw new Error('PRIMARY_MUTATION_RECONCILIATION_REQUIRED');
}
// Intent is persisted BEFORE every write. If response/checkpoint is lost, stop rather
// than adopt possibly foreign changes. An operator reconciles the exact pending action.
function mutate(journal, state, kind, operation, record = () => {}) {
  state.pending = kind;
  journal.save(state);
  const result = operation();
  record(result);
  state.pending = null;
  journal.save(state);
  return result;
}

export function primaryPlan(config, current) {
  if (!config.primaryRollout) return { enabled: false };
  if (current.RevisionId !== config.primaryExpectedRevision || current.State !== 'Active' ||
      current.LastUpdateStatus !== 'Successful' ||
      current.Environment?.Variables?.KE14_MODEL_MODE !== 'DISABLED' ||
      current.Environment?.Variables?.KE14_PAID_CALLS_APPROVED === 'true')
    throw new Error('NP00_PRIMARY_HOLD_OR_REVISION_CHANGED');
  return { enabled: true, functionName, pool, client, api, groupTable, routes };
}

export function assertPrimaryTable(table, account, tags) {
  const keys = table.KeySchema ?? [];
  const definitions = table.AttributeDefinitions ?? [];
  const valid = table.TableName === groupTable &&
    table.TableArn === `arn:aws:dynamodb:us-east-1:${account}:table/${groupTable}` &&
    table.TableStatus === 'ACTIVE' && keys.length === 2 && definitions.length === 2 &&
    keys.some(k => k.AttributeName === 'PK' && k.KeyType === 'HASH') &&
    keys.some(k => k.AttributeName === 'SK' && k.KeyType === 'RANGE') &&
    ['PK', 'SK'].every(name => definitions.some(d => d.AttributeName === name && d.AttributeType === 'S')) &&
    !(table.GlobalSecondaryIndexes?.length || table.LocalSecondaryIndexes?.length) &&
    table.DeletionProtectionEnabled === true &&
    ['ENABLED', 'ENABLING'].includes(table.SSEDescription?.Status) &&
    tags?.some(tag => tag.Key === 'KnownEnoughPrimaryGroup' && tag.Value === 'true');
  if (!valid) throw new Error('PRIMARY_TABLE_CONFLICT');
}
async function ensureTable(config, aws, journal, state) {
  let table;
  try { table = aws('dynamodb', 'describe-table', { TableName: groupTable }).Table; }
  catch (error) {
    if (!error.missing) throw error;
    mutate(journal, state, 'create-group-table', () => aws('dynamodb', 'create-table', {
      TableName: groupTable, BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [{ AttributeName: 'PK', AttributeType: 'S' }, { AttributeName: 'SK', AttributeType: 'S' }],
      KeySchema: [{ AttributeName: 'PK', KeyType: 'HASH' }, { AttributeName: 'SK', KeyType: 'RANGE' }],
      DeletionProtectionEnabled: true, SSESpecification: { Enabled: true },
      Tags: [{ Key: 'KnownEnoughPrimaryGroup', Value: 'true' }]
    }));
  }
  for (let i = 0; i < 60; i++) {
    table = aws('dynamodb', 'describe-table', { TableName: groupTable }).Table;
    if (table.TableStatus === 'ACTIVE') break;
    if (i === 59) throw new Error('PRIMARY_TABLE_TIMEOUT');
    await delay();
  }
  const tags = aws('dynamodb', 'list-tags-of-resource', { ResourceArn: table.TableArn }).Tags;
  assertPrimaryTable(table, config.account, tags);
}
function assertCognito(state, aws) {
  if (!same(readPool(aws), state.poolAfter) || !same(readClient(aws), state.clientAfter))
    throw new Error('PRIMARY_COGNITO_DRIFT');
}
function verifyRoutes(state, aws) {
  const live = readRoutes(aws);
  for (const route of routes) {
    const found = live.find(item => item.RouteKey === route);
    if (!found || !same(routeShape(found), expectedRoute(route, state.anchor)))
      throw new Error('PRIMARY_ROUTE_CONFLICT');
  }
}
function verifyApply(state, aws) {
  const current = lambda(aws);
  assertLambda(state, current, codeHash(state.targetCode), { Variables: state.next }, 'api.handler');
  if (current.LastUpdateStatus !== 'Successful') throw new Error('PRIMARY_CONFIG_NOT_READY');
  assertCognito(state, aws);
  verifyRoutes(state, aws);
  if (!same(readPolicy(aws, state.config.Role.split('/').at(-1)), state.policy))
    throw new Error('PRIMARY_POLICY_CONFLICT');
}

export async function primaryApply(config, manifest, directory, aws) {
  if (!config.primaryRollout) return { status: 'NOT_RUN' };
  const targetCode = manifest.artifacts.api.sha256;
  if (digest(readFileSync(directory + '/api.zip')) !== targetCode) throw new Error('PRIMARY_PACKAGE_BYTES_CHANGED');
  const journal = journalAt(directory);
  let state;
  if (journal.exists) {
    state = journal.read();
    if (state.schemaVersion !== 2) throw new Error('LEGACY_PRIMARY_JOURNAL_RECONCILIATION_REQUIRED');
    assertNoPending(state);
    if (state.targetCode !== targetCode || state.account !== config.account || state.rollback)
      throw new Error('PRIMARY_JOURNAL_TARGET_CHANGED');
  } else {
    const current = lambda(aws);
    primaryPlan(config, current);
    const beforeRoutes = readRoutes(aws);
    const anchor = beforeRoutes.find(route => route.RouteKey === 'ANY /decisions/{proxy+}');
    if (!anchor?.AuthorizerId || !anchor.Target) throw new Error('PRIMARY_ROUTE_ANCHOR_MISSING');
    state = { schemaVersion: 2, account: config.account, targetCode, config: current,
      pool: readPool(aws), client: readClient(aws), anchor: routeShape(anchor),
      createdRoutes: [], createdPolicy: false, afterRevision: current.RevisionId,
      rollbackCode: null, codeDone: false, configDone: false, complete: false };
    state.poolAfter = state.pool;
    state.clientAfter = state.client;
    state.policy = policy(config.account);
    state.next = { ...current.Environment.Variables, NP_GROUPS_ENABLED: 'true',
      NP_GROUP_TABLE_NAME: groupTable,
      NP_GROUP_EMAIL_KEY: current.Environment.Variables.NP_GROUP_EMAIL_KEY ?? randomBytes(32).toString('hex'),
      NP_COGNITO_DOMAIN: 'https://known-enough-092954139775.auth.us-east-1.amazoncognito.com' };
    journal.save(state);
  }

  const live = await ready(aws, state.afterRevision, 'PRIMARY_UPDATE');
  assertLambda(state, live, state.codeDone ? codeHash(targetCode) : state.config.CodeSha256,
    state.configDone ? { Variables: state.next } : state.config.Environment,
    state.configDone ? 'api.handler' : state.config.Handler);
  assertCognito(state, aws);
  if (!state.rollbackCode) {
    const deployed = aws('lambda', 'get-function', { FunctionName: functionName });
    if (deployed.Configuration?.CodeSha256 !== state.config.CodeSha256)
      throw new Error('PRIMARY_REVISION_OR_CONFIG_DRIFT');
    const response = await globalThis.fetch(deployed.Code.Location, { redirect: 'error' });
    if (!response.ok) throw new Error('ROLLBACK_CODE_UNAVAILABLE');
    const prior = Buffer.from(await response.arrayBuffer());
    if (codeHash(digest(prior)) !== state.config.CodeSha256) throw new Error('ROLLBACK_CODE_MISMATCH');
    writeFileSync(directory + '/primary-rollback.zip', prior, { mode: 0o600 });
    state.rollbackCode = digest(prior);
    journal.save(state);
  }
  if (digest(readFileSync(directory + '/primary-rollback.zip')) !== state.rollbackCode)
    throw new Error('ROLLBACK_BYTES_CHANGED');
  await ensureTable(config, aws, journal, state);
  if (state.complete) { verifyApply(state, aws); return { status: 'PASS', codeSha256: targetCode }; }

  const role = state.config.Role.split('/').at(-1);
  const existingPolicy = readPolicy(aws, role);
  if (existingPolicy && !same(existingPolicy, state.policy)) throw new Error('PRIMARY_POLICY_CONFLICT');
  if (!existingPolicy) mutate(journal, state, 'create-policy',
    () => aws('iam', 'put-role-policy', { RoleName: role, PolicyName: policyName, PolicyDocument: JSON.stringify(state.policy) }),
    () => { state.createdPolicy = true; });
  for (const route of routes) {
    const found = readRoutes(aws).find(item => item.RouteKey === route);
    const expected = expectedRoute(route, state.anchor);
    if (found) {
      if (!same(routeShape(found), expected)) throw new Error('PRIMARY_ROUTE_CONFLICT');
      continue;
    }
    mutate(journal, state, 'create-route:' + route,
      () => aws('apigatewayv2', 'create-route', { ApiId: api, ...expected }),
      created => { state.createdRoutes.push({ id: created.RouteId, ...expected }); });
  }
  if (!state.poolDone) {
    assertCognito(state, aws);
    const input = poolInput(state.pool);
    input.AdminCreateUserConfig = { ...state.pool.AdminCreateUserConfig, AllowAdminCreateUserOnly: false };
    input.AutoVerifiedAttributes = [...new Set([...(state.pool.AutoVerifiedAttributes ?? []), 'email'])];
    mutate(journal, state, 'enable-signup', () => {
      aws('cognito-idp', 'update-user-pool', input);
      return readPool(aws);
    }, result => {
      if (!same(poolInput(result), input)) throw new Error('PRIMARY_POOL_READBACK_FAILED');
      state.poolAfter = result; state.poolDone = true;
    });
  }
  if (!state.clientDone) {
    assertCognito(state, aws);
    const input = clientInput(state.client);
    input.AllowedOAuthScopes = [...new Set([...(state.client.AllowedOAuthScopes ?? []), 'openid', 'email'])];
    mutate(journal, state, 'enable-client-scopes', () => {
      aws('cognito-idp', 'update-user-pool-client', input);
      return readClient(aws);
    }, result => {
      if (!same(clientInput(result), input)) throw new Error('PRIMARY_CLIENT_READBACK_FAILED');
      state.clientAfter = result; state.clientDone = true;
    });
  }
  if (!state.codeDone) {
    const current = await ready(aws, state.afterRevision, 'PRIMARY_UPDATE');
    assertLambda(state, current, state.config.CodeSha256, state.config.Environment, state.config.Handler);
    mutate(journal, state, 'update-code', () => aws('lambda', 'update-function-code', {
      FunctionName: functionName, RevisionId: state.afterRevision,
      ZipFile: readFileSync(directory + '/api.zip').toString('base64')
    }), result => { state.afterRevision = result.RevisionId; state.codeDone = true; });
  }
  const codeReady = await ready(aws, state.afterRevision, 'PRIMARY_UPDATE');
  assertLambda(state, codeReady, codeHash(targetCode),
    state.configDone ? { Variables: state.next } : state.config.Environment,
    state.configDone ? 'api.handler' : state.config.Handler);
  if (!state.configDone) mutate(journal, state, 'update-config',
    () => aws('lambda', 'update-function-configuration', { FunctionName: functionName,
      RevisionId: state.afterRevision, Environment: { Variables: state.next }, Handler: 'api.handler' }),
    result => { state.afterRevision = result.RevisionId; state.configDone = true; });
  await ready(aws, state.afterRevision, 'PRIMARY_CONFIG');
  verifyApply(state, aws);
  state.complete = true;
  journal.save(state);
  return { status: 'PASS', codeSha256: targetCode };
}

export async function primaryRollback(directory, aws) {
  const journal = journalAt(directory);
  const state = journal.read();
  if (state.schemaVersion !== 2) throw new Error('LEGACY_PRIMARY_JOURNAL_RECONCILIATION_REQUIRED');
  assertNoPending(state);
  const code = readFileSync(directory + '/primary-rollback.zip');
  if (!state.rollbackCode || digest(code) !== state.rollbackCode ||
      codeHash(state.rollbackCode) !== state.config.CodeSha256) throw new Error('ROLLBACK_BYTES_CHANGED');
  const rollback = state.rollback ??= { codeDone: false, configDone: false, routes: [], policyDone: false,
    poolDone: false, clientDone: false };
  journal.save(state);
  assertCognito(state, aws);
  let current = await ready(aws, state.afterRevision, 'PRIMARY_ROLLBACK');
  assertLambda(state, current,
    rollback.codeDone ? state.config.CodeSha256 : state.codeDone ? codeHash(state.targetCode) : state.config.CodeSha256,
    rollback.configDone ? state.config.Environment : state.configDone ? { Variables: state.next } : state.config.Environment,
    rollback.configDone ? state.config.Handler : state.configDone ? 'api.handler' : state.config.Handler);
  if (!rollback.codeDone) mutate(journal, state, 'rollback-code',
    () => aws('lambda', 'update-function-code', { FunctionName: functionName, RevisionId: state.afterRevision,
      ZipFile: code.toString('base64') }),
    result => { state.afterRevision = result.RevisionId; rollback.codeDone = true; });
  current = await ready(aws, state.afterRevision, 'PRIMARY_ROLLBACK_CODE');
  if (current.CodeSha256 !== state.config.CodeSha256) throw new Error('PRIMARY_ROLLBACK_CODE_MISMATCH');
  if (!rollback.configDone) mutate(journal, state, 'rollback-config',
    () => aws('lambda', 'update-function-configuration', { FunctionName: functionName,
      RevisionId: state.afterRevision, Environment: state.config.Environment, Handler: state.config.Handler }),
    result => { state.afterRevision = result.RevisionId; rollback.configDone = true; });
  current = await ready(aws, state.afterRevision, 'PRIMARY_ROLLBACK_CONFIG');
  assertLambda(state, current, state.config.CodeSha256, state.config.Environment, state.config.Handler);

  for (const created of state.createdRoutes) {
    if (rollback.routes.includes(created.id)) continue;
    const found = readRoutes(aws).find(route => route.RouteId === created.id);
    if (!found || !same(routeShape(found), routeShape(created))) throw new Error('PRIMARY_ROLLBACK_ROUTE_DRIFT');
    mutate(journal, state, 'rollback-route:' + created.id,
      () => aws('apigatewayv2', 'delete-route', { ApiId: api, RouteId: created.id }),
      () => { rollback.routes.push(created.id); });
  }
  if (state.createdPolicy && !rollback.policyDone) {
    const role = state.config.Role.split('/').at(-1);
    if (!same(readPolicy(aws, role), state.policy)) throw new Error('PRIMARY_POLICY_CONFLICT');
    mutate(journal, state, 'rollback-policy',
      () => aws('iam', 'delete-role-policy', { RoleName: role, PolicyName: policyName }),
      () => { rollback.policyDone = true; });
  }
  if (!rollback.poolDone) {
    assertCognito(state, aws);
    const input = poolInput(state.pool);
    mutate(journal, state, 'rollback-pool', () => {
      aws('cognito-idp', 'update-user-pool', input);
      return readPool(aws);
    }, result => {
      if (!same(poolInput(result), input)) throw new Error('PRIMARY_ROLLBACK_POOL_MISMATCH');
      state.poolAfter = result; rollback.poolDone = true;
    });
  }
  if (!rollback.clientDone) {
    assertCognito(state, aws);
    const input = clientInput(state.client);
    mutate(journal, state, 'rollback-client', () => {
      aws('cognito-idp', 'update-user-pool-client', input);
      return readClient(aws);
    }, result => {
      if (!same(clientInput(result), input)) throw new Error('PRIMARY_ROLLBACK_CLIENT_MISMATCH');
      state.clientAfter = result; rollback.clientDone = true;
    });
  }
  current = await ready(aws, state.afterRevision, 'PRIMARY_ROLLBACK_CONFIG');
  assertLambda(state, current, state.config.CodeSha256, state.config.Environment, state.config.Handler);
  if (!same(poolInput(readPool(aws)), poolInput(state.pool)) ||
      !same(clientInput(readClient(aws)), clientInput(state.client)) ||
      readRoutes(aws).some(route => state.createdRoutes.some(created => created.id === route.RouteId)) ||
      (state.createdPolicy && readPolicy(aws, state.config.Role.split('/').at(-1)) !== null))
    throw new Error('PRIMARY_ROLLBACK_READBACK_FAILED');
  rollback.complete = true;
  journal.save(state);
  return { status: 'PASS', groupTable: 'RETAINED' };
}
