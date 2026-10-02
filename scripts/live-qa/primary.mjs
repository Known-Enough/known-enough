import { readFileSync, writeFileSync, existsSync, renameSync, openSync, fsyncSync, closeSync, lstatSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { digest } from './config.mjs';
import { preservationInput, awsSkeleton } from './aws.mjs';
const functionName = 'known-enough-stage-api';
const pool = 'us-east-1_V9OMjd0zx';
const client = '3accf7paalvon2m8ue8okfi853';
const api = 'u94iyvt6p9';
const groupTable = 'KnownEnoughGroupsStage';
const policyName = 'KnownEnoughStageGroups';
const routes = [
    'GET /account', 'POST /account/register', 'GET /groups', 'POST /groups',
    'POST /groups/accept', 'POST /groups/{groupId}/invitations', 'POST /groups/{groupId}/remove',
    'GET /groups/{groupId}/drafts/{draftId}', 'POST /groups/{groupId}/drafts',
    'POST /groups/{groupId}/drafts/{draftId}', 'POST /groups/{groupId}/drafts/{draftId}/create',
    'GET /groups/{groupId}/decisions/{decisionId}/review',
    'POST /groups/{groupId}/decisions/{decisionId}/revise',
    'OPTIONS /account', 'OPTIONS /account/register', 'OPTIONS /groups', 'OPTIONS /groups/{proxy+}'
];
const delay = () => new Promise(resolve => globalThis.setTimeout(resolve, 1000));
const codeHash = hex => Buffer.from(hex, 'hex').toString('base64');
// JSON object order is not configuration. Only named Cognito collection paths
// below are unordered; unknown arrays retain their order and all values remain exact.
const cognitoSets = new Set([
    'AutoVerifiedAttributes', 'AliasAttributes', 'UsernameAttributes', 'SchemaAttributes',
    'Policies.SignInPolicy.AllowedFirstAuthFactors',
    'UserAttributeUpdateSettings.AttributesRequireVerificationBeforeUpdate',
    'AccountRecoverySetting.RecoveryMechanisms', 'AllowedOAuthScopes', 'AllowedOAuthFlows',
    'ExplicitAuthFlows', 'SupportedIdentityProviders', 'CallbackURLs', 'LogoutURLs',
    'ReadAttributes', 'WriteAttributes'
]);
function canonical(value, path = '', sets = false) {
    if (Array.isArray(value)) {
        const items = value.map(item => canonical(item, path + '[]', sets));
        return sets && cognitoSets.has(path)
            ? items.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : items;
    }
    if (value && typeof value === 'object')
        return Object.fromEntries(Object.keys(value).filter(key =>
            // Absent/empty optional attribute or scope lists both select no entries.
            !(sets && path === '' && ['AutoVerifiedAttributes', 'AllowedOAuthScopes'].includes(key)
                && Array.isArray(value[key]) && value[key].length === 0)).sort().map(key => [key,
            canonical(value[key], path ? path + '.' + key : key, sets)]));
    return value;
}
const same = (a, b) => digest(canonical(a)) === digest(canonical(b));
export const sameCognito = (a, b) => digest(canonical(a, '', true)) === digest(canonical(b, '', true));
// These are observed modification time and population, not pool/client settings.
// Only empty optional attribute/scope lists normalize to absence; scalar defaults stay exact.
function stableCognito(snapshot) {
    return Object.fromEntries(Object.entries(snapshot).filter(([key]) =>
        key !== 'LastModifiedDate' && key !== 'EstimatedNumberOfUsers'));
}
const sameSnapshot = (a, b) => sameCognito(stableCognito(a), stableCognito(b));
function signupInput(snapshot) {
    const input = poolInput(snapshot);
    input.AdminCreateUserConfig = { ...snapshot.AdminCreateUserConfig, AllowAdminCreateUserOnly: false };
    input.AutoVerifiedAttributes = [...new Set([...(snapshot.AutoVerifiedAttributes ?? []), 'email'])];
    return input;
}
function scopesInput(snapshot) {
    const input = clientInput(snapshot);
    input.AllowedOAuthScopes = [...new Set([...(snapshot.AllowedOAuthScopes ?? []), 'openid', 'email'])];
    return input;
}
function expectedSnapshot(before, input) {
    const expected = { ...before, ...input };
    if (!Object.hasOwn(before, 'UserPoolId')) delete expected.UserPoolId;
    // ClientId already exists in real DescribeUserPoolClient; do not invent it for mocks.
    if (!Object.hasOwn(before, 'ClientId')) delete expected.ClientId;
    return expected;
}
async function cognitoReadback(read, inputFor, input, before, errorCode) {
    for (let attempt = 0; attempt < 10; attempt++) {
        const result = read();
        if (sameCognito(inputFor(result), input) && sameSnapshot(result, expectedSnapshot(before, input)))
            return result;
        if (attempt < 9) await delay();
    }
    throw new Error(errorCode);
}
const lambda = aws => aws('lambda', 'get-function-configuration', { FunctionName: functionName });
const readPool = aws => aws('cognito-idp', 'describe-user-pool', { UserPoolId: pool }).UserPool;
const readClient = aws => aws('cognito-idp', 'describe-user-pool-client', { UserPoolId: pool, ClientId: client }).UserPoolClient;
const readRoutes = aws => aws('apigatewayv2', 'get-routes', { ApiId: api }).Items ?? [];
function journalAt(directory) {
    const path = directory + '/primary-private-journal.json';
    return {
        exists: existsSync(path),
        read: () => JSON.parse(readFileSync(path, 'utf8')),
        save: state => {
            // A failed/truncated write must never replace the previous checkpoint.
            if ([path, path + '.next'].some(file => existsSync(file) && lstatSync(file).isSymbolicLink()))
                throw new Error('PRIVATE_STATE_SYMLINK_REJECTED');
            const descriptor = openSync(path + '.next', 'w', 0o600);
            try {
                writeFileSync(descriptor, JSON.stringify(state));
                fsyncSync(descriptor);
            } finally { closeSync(descriptor); }
            renameSync(path + '.next', path);
        }
    };
}
function policy(account, table = groupTable) {
    return {
        Version: '2012-10-17', Statement: [
            {
                Effect: 'Allow',
                Action: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:ConditionCheckItem'],
                Condition: { 'ForAllValues:StringEquals': { 'dynamodb:LeadingKeys': ['NP#GROUPS'] } },
                Resource: `arn:aws:dynamodb:us-east-1:${account}:table/${table}`
            }
        ]
    };
}
function readPolicy(aws, role) {
    try {
        const raw = aws('iam', 'get-role-policy', { RoleName: role, PolicyName: policyName }).PolicyDocument;
        return typeof raw === 'string' ? JSON.parse(decodeURIComponent(raw)) : raw;
    }
    catch (error) {
        if (error.missing)
            return null;
        throw error;
    }
}
function routeShape(route) {
    return {
        RouteKey: route.RouteKey, Target: route.Target, AuthorizationType: route.AuthorizationType,
        ...(route.AuthorizationType === 'JWT' ? { AuthorizerId: route.AuthorizerId } : {})
    };
}
function expectedRoute(route, anchor) {
    return {
        RouteKey: route, Target: anchor.Target,
        AuthorizationType: route.startsWith('OPTIONS ') ? 'NONE' : 'JWT',
        ...(route.startsWith('OPTIONS ') ? {} : { AuthorizerId: anchor.AuthorizerId })
    };
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
        current.Handler !== handler)
        throw new Error('PRIMARY_REVISION_OR_CONFIG_DRIFT');
}
async function ready(aws, revision, prefix) {
    for (let i = 0; i < 60; i++) {
        const current = lambda(aws);
        if (current.RevisionId !== revision)
            throw new Error('PRIMARY_REVISION_OR_CONFIG_DRIFT');
        if (current.LastUpdateStatus === 'Failed')
            throw new Error(prefix + '_FAILED');
        if (current.LastUpdateStatus === 'Successful' && current.State === 'Active')
            return current;
        await delay();
    }
    throw new Error(prefix + '_TIMEOUT');
}
function assertNoPending(state) {
    if (state.pending)
        throw new Error('PRIMARY_MUTATION_RECONCILIATION_REQUIRED');
}
// Intent is persisted BEFORE every write. If response/checkpoint is lost, stop rather
// than adopt possibly foreign changes. An operator reconciles the exact pending action.
async function mutate(journal, state, kind, operation, record = () => {
}) {
    state.pending = kind;
    journal.save(state);
    const result = await operation();
    await record(result);
    state.pending = null;
    journal.save(state);
    return result;
}
export function primaryPlan(config, current) {
    if (!config.primaryRollout)
        return { enabled: false };
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
    if (!valid)
        throw new Error('PRIMARY_TABLE_CONFLICT');
}
async function ensureTable(config, aws, journal, state) {
    let table;
    try {
        table = aws('dynamodb', 'describe-table', { TableName: groupTable }).Table;
    }
    catch (error) {
        if (!error.missing)
            throw error;
        await mutate(journal, state, 'create-group-table', () => aws('dynamodb', 'create-table', {
            TableName: groupTable, BillingMode: 'PAY_PER_REQUEST',
            AttributeDefinitions: [{ AttributeName: 'PK', AttributeType: 'S' }, { AttributeName: 'SK', AttributeType: 'S' }],
            KeySchema: [{ AttributeName: 'PK', KeyType: 'HASH' }, { AttributeName: 'SK', KeyType: 'RANGE' }],
            DeletionProtectionEnabled: true, SSESpecification: { Enabled: true },
            Tags: [{ Key: 'KnownEnoughPrimaryGroup', Value: 'true' }]
        }));
    }
    for (let i = 0; i < 60; i++) {
        table = aws('dynamodb', 'describe-table', { TableName: groupTable }).Table;
        if (table.TableStatus === 'ACTIVE')
            break;
        if (i === 59)
            throw new Error('PRIMARY_TABLE_TIMEOUT');
        await delay();
    }
    const tags = aws('dynamodb', 'list-tags-of-resource', { ResourceArn: table.TableArn }).Tags;
    assertPrimaryTable(table, config.account, tags);
}
function assertCognito(state, aws) {
    if (!sameSnapshot(readPool(aws), state.poolAfter) || !sameSnapshot(readClient(aws), state.clientAfter))
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
    if (current.LastUpdateStatus !== 'Successful')
        throw new Error('PRIMARY_CONFIG_NOT_READY');
    assertCognito(state, aws);
    verifyRoutes(state, aws);
    if (!same(readPolicy(aws, state.config.Role.split('/').at(-1)), state.policy))
        throw new Error('PRIMARY_POLICY_CONFLICT');
}
export async function primaryApply(config, manifest, directory, aws) {
    if (!config.primaryRollout)
        return { status: 'NOT_RUN' };
    const targetCode = manifest.artifacts.api.sha256;
    if (digest(readFileSync(directory + '/api.zip')) !== targetCode)
        throw new Error('PRIMARY_PACKAGE_BYTES_CHANGED');
    const journal = journalAt(directory);
    let state;
    if (journal.exists) {
        state = journal.read();
        if (state.schemaVersion !== 2)
            throw new Error('LEGACY_PRIMARY_JOURNAL_RECONCILIATION_REQUIRED');
        assertNoPending(state);
        if (state.targetCode !== targetCode || state.account !== config.account || state.rollback)
            throw new Error('PRIMARY_JOURNAL_TARGET_CHANGED');
    }
    else {
        const current = lambda(aws);
        primaryPlan(config, current);
        const beforeRoutes = readRoutes(aws);
        const anchor = beforeRoutes.find(route => route.RouteKey === 'ANY /decisions/{proxy+}');
        if (!anchor?.AuthorizerId || !anchor.Target)
            throw new Error('PRIMARY_ROUTE_ANCHOR_MISSING');
        state = {
            schemaVersion: 2, account: config.account, targetCode, config: current,
            pool: readPool(aws), client: readClient(aws), anchor: routeShape(anchor),
            createdRoutes: [], createdPolicy: false, afterRevision: current.RevisionId,
            rollbackCode: null, codeDone: false, configDone: false, complete: false
        };
        state.poolAfter = state.pool;
        state.clientAfter = state.client;
        state.policy = policy(config.account);
        state.next = {
            ...current.Environment.Variables, NP_GROUPS_ENABLED: 'true',
            NP_GROUP_TABLE_NAME: groupTable,
            NP_GROUP_EMAIL_KEY: current.Environment.Variables.NP_GROUP_EMAIL_KEY ?? randomBytes(32).toString('hex'),
            NP_COGNITO_DOMAIN: 'https://known-enough-092954139775.auth.us-east-1.amazoncognito.com'
        };
        journal.save(state);
    }
    if (state.codeDone) {
        await reconcileRecordedRevision(config, manifest, directory, aws);
        state = journal.read();
    }
    const live = await ready(aws, state.afterRevision, 'PRIMARY_UPDATE');
    assertLambda(state, live, state.codeDone ? codeHash(targetCode) : state.config.CodeSha256, state.configDone ? { Variables: state.next } : state.config.Environment, state.configDone ? 'api.handler' : state.config.Handler);
    assertCognito(state, aws);
    if (!state.rollbackCode) {
        const deployed = aws('lambda', 'get-function', { FunctionName: functionName });
        if (deployed.Configuration?.CodeSha256 !== state.config.CodeSha256)
            throw new Error('PRIMARY_REVISION_OR_CONFIG_DRIFT');
        const response = await globalThis.fetch(deployed.Code.Location, { redirect: 'error' });
        if (!response.ok)
            throw new Error('ROLLBACK_CODE_UNAVAILABLE');
        const prior = Buffer.from(await response.arrayBuffer());
        if (codeHash(digest(prior)) !== state.config.CodeSha256)
            throw new Error('ROLLBACK_CODE_MISMATCH');
        writeFileSync(directory + '/primary-rollback.zip', prior, { mode: 0o600 });
        state.rollbackCode = digest(prior);
        journal.save(state);
    }
    if (digest(readFileSync(directory + '/primary-rollback.zip')) !== state.rollbackCode)
        throw new Error('ROLLBACK_BYTES_CHANGED');
    await ensureTable(config, aws, journal, state);
    if (state.complete) {
        verifyApply(state, aws);
        return { status: 'PASS', codeSha256: targetCode };
    }
    const role = state.config.Role.split('/').at(-1);
    const existingPolicy = readPolicy(aws, role);
    if (existingPolicy && !same(existingPolicy, state.policy))
        throw new Error('PRIMARY_POLICY_CONFLICT');
    if (!existingPolicy)
        await mutate(journal, state, 'create-policy', () => aws('iam', 'put-role-policy', { RoleName: role, PolicyName: policyName, PolicyDocument: JSON.stringify(state.policy) }), () => {
            state.createdPolicy = true;
        });
    for (const route of routes) {
        const found = readRoutes(aws).find(item => item.RouteKey === route);
        const expected = expectedRoute(route, state.anchor);
        if (found) {
            if (!same(routeShape(found), expected))
                throw new Error('PRIMARY_ROUTE_CONFLICT');
            continue;
        }
        await mutate(journal, state, 'create-route:' + route, () => aws('apigatewayv2', 'create-route', { ApiId: api, ...expected }), created => {
            state.createdRoutes.push({ id: created.RouteId, ...expected });
        });
    }
    if (!state.poolDone) {
        assertCognito(state, aws);
        const input = signupInput(state.pool);
        await mutate(journal, state, 'enable-signup', () => {
            aws('cognito-idp', 'update-user-pool', input);
            return cognitoReadback(() => readPool(aws), poolInput, input, state.poolAfter, 'PRIMARY_POOL_READBACK_FAILED');
        }, result => {
            if (!sameCognito(poolInput(result), input))
                throw new Error('PRIMARY_POOL_READBACK_FAILED');
            state.poolAfter = result;
            state.poolDone = true;
        });
    }
    if (!state.clientDone) {
        assertCognito(state, aws);
        const input = scopesInput(state.client);
        await mutate(journal, state, 'enable-client-scopes', () => {
            aws('cognito-idp', 'update-user-pool-client', input);
            return cognitoReadback(() => readClient(aws), clientInput, input, state.clientAfter, 'PRIMARY_CLIENT_READBACK_FAILED');
        }, result => {
            if (!sameCognito(clientInput(result), input))
                throw new Error('PRIMARY_CLIENT_READBACK_FAILED');
            state.clientAfter = result;
            state.clientDone = true;
        });
    }
    if (!state.codeDone) {
        const current = await ready(aws, state.afterRevision, 'PRIMARY_UPDATE');
        assertLambda(state, current, state.config.CodeSha256, state.config.Environment, state.config.Handler);
        await mutate(journal, state, 'update-code', () => aws('lambda', 'update-function-code', {
            FunctionName: functionName, RevisionId: state.afterRevision,
            ZipFile: readFileSync(directory + '/api.zip').toString('base64')
        }), result => {
            state.afterRevision = result.RevisionId;
            state.codeDone = true;
        });
    }
    await reconcileRecordedRevision(config, manifest, directory, aws);
    state = journal.read();
    const codeReady = await ready(aws, state.afterRevision, 'PRIMARY_UPDATE');
    assertLambda(state, codeReady, codeHash(targetCode), state.configDone ? { Variables: state.next } : state.config.Environment, state.configDone ? 'api.handler' : state.config.Handler);
    if (!state.configDone)
        await mutate(journal, state, 'update-config', () => aws('lambda', 'update-function-configuration', { FunctionName: functionName,
            RevisionId: state.afterRevision, Environment: { Variables: state.next }, Handler: 'api.handler' }), result => {
            state.afterRevision = result.RevisionId;
            state.configDone = true;
        });
    await reconcileRecordedRevision(config, manifest, directory, aws);
    state = journal.read();
    await ready(aws, state.afterRevision, 'PRIMARY_CONFIG');
    verifyApply(state, aws);
    state.complete = true;
    journal.save(state);
    return { status: 'PASS', codeSha256: targetCode };
}
export async function primaryRollback(directory, aws) {
    const journal = journalAt(directory);
    const state = journal.read();
    if (state.schemaVersion !== 2)
        throw new Error('LEGACY_PRIMARY_JOURNAL_RECONCILIATION_REQUIRED');
    assertNoPending(state);
    const code = readFileSync(directory + '/primary-rollback.zip');
    if (!state.rollbackCode || digest(code) !== state.rollbackCode ||
        codeHash(state.rollbackCode) !== state.config.CodeSha256)
        throw new Error('ROLLBACK_BYTES_CHANGED');
    const rollback = state.rollback ??= { codeDone: false, configDone: false, routes: [], policyDone: false,
        poolDone: false, clientDone: false };
    journal.save(state);
    assertCognito(state, aws);
    let current = await ready(aws, state.afterRevision, 'PRIMARY_ROLLBACK');
    assertLambda(state, current, rollback.codeDone ? state.config.CodeSha256 : state.codeDone ? codeHash(state.targetCode) : state.config.CodeSha256, rollback.configDone ? state.config.Environment : state.configDone ? { Variables: state.next } : state.config.Environment, rollback.configDone ? state.config.Handler : state.configDone ? 'api.handler' : state.config.Handler);
    if (!rollback.codeDone)
        await mutate(journal, state, 'rollback-code', () => aws('lambda', 'update-function-code', { FunctionName: functionName, RevisionId: state.afterRevision,
            ZipFile: code.toString('base64') }), result => {
            state.afterRevision = result.RevisionId;
            rollback.codeDone = true;
        });
    current = await ready(aws, state.afterRevision, 'PRIMARY_ROLLBACK_CODE');
    if (current.CodeSha256 !== state.config.CodeSha256)
        throw new Error('PRIMARY_ROLLBACK_CODE_MISMATCH');
    if (!rollback.configDone)
        await mutate(journal, state, 'rollback-config', () => aws('lambda', 'update-function-configuration', { FunctionName: functionName,
            RevisionId: state.afterRevision, Environment: state.config.Environment, Handler: state.config.Handler }), result => {
            state.afterRevision = result.RevisionId;
            rollback.configDone = true;
        });
    current = await ready(aws, state.afterRevision, 'PRIMARY_ROLLBACK_CONFIG');
    assertLambda(state, current, state.config.CodeSha256, state.config.Environment, state.config.Handler);
    for (const created of state.createdRoutes) {
        if (rollback.routes.includes(created.id))
            continue;
        const found = readRoutes(aws).find(route => route.RouteId === created.id);
        if (!found || !same(routeShape(found), routeShape(created)))
            throw new Error('PRIMARY_ROLLBACK_ROUTE_DRIFT');
        await mutate(journal, state, 'rollback-route:' + created.id, () => aws('apigatewayv2', 'delete-route', { ApiId: api, RouteId: created.id }), () => {
            rollback.routes.push(created.id);
        });
    }
    if (state.createdPolicy && !rollback.policyDone) {
        const role = state.config.Role.split('/').at(-1);
        if (!same(readPolicy(aws, role), state.policy))
            throw new Error('PRIMARY_POLICY_CONFLICT');
        await mutate(journal, state, 'rollback-policy', () => aws('iam', 'delete-role-policy', { RoleName: role, PolicyName: policyName }), () => {
            rollback.policyDone = true;
        });
    }
    if (!rollback.poolDone) {
        assertCognito(state, aws);
        const input = poolInput(state.pool);
        await mutate(journal, state, 'rollback-pool', () => {
            aws('cognito-idp', 'update-user-pool', input);
            return cognitoReadback(() => readPool(aws), poolInput, input, state.pool, 'PRIMARY_ROLLBACK_POOL_MISMATCH');
        }, result => {
            if (!sameCognito(poolInput(result), input))
                throw new Error('PRIMARY_ROLLBACK_POOL_MISMATCH');
            state.poolAfter = result;
            rollback.poolDone = true;
        });
    }
    if (!rollback.clientDone) {
        assertCognito(state, aws);
        const input = clientInput(state.client);
        await mutate(journal, state, 'rollback-client', () => {
            aws('cognito-idp', 'update-user-pool-client', input);
            return cognitoReadback(() => readClient(aws), clientInput, input, state.client, 'PRIMARY_ROLLBACK_CLIENT_MISMATCH');
        }, result => {
            if (!sameCognito(clientInput(result), input))
                throw new Error('PRIMARY_ROLLBACK_CLIENT_MISMATCH');
            state.clientAfter = result;
            rollback.clientDone = true;
        });
    }
    current = await ready(aws, state.afterRevision, 'PRIMARY_ROLLBACK_CONFIG');
    assertLambda(state, current, state.config.CodeSha256, state.config.Environment, state.config.Handler);
    if (!sameCognito(poolInput(readPool(aws)), poolInput(state.pool)) ||
        !sameCognito(clientInput(readClient(aws)), clientInput(state.client)) ||
        readRoutes(aws).some(route => state.createdRoutes.some(created => created.id === route.RouteId)) ||
        (state.createdPolicy && readPolicy(aws, state.config.Role.split('/').at(-1)) !== null))
        throw new Error('PRIMARY_ROLLBACK_READBACK_FAILED');
    rollback.complete = true;
    journal.save(state);
    return { status: 'PASS', groupTable: 'RETAINED' };
}

/** Read-only cloud evidence; writes only the exact local checkpoint after proof. */
export async function reconcilePendingSignup(config, manifest, directory, aws) {
    const journal = journalAt(directory);
    const state = journal.read();
    if (state.schemaVersion !== 2 || state.account !== config.account || state.rollback ||
        state.targetCode !== manifest.artifacts.api.sha256 ||
        digest(readFileSync(directory + '/api.zip')) !== state.targetCode)
        throw new Error('PRIMARY_JOURNAL_TARGET_CHANGED');
    if (!state.pending) {
        assertCognito(state, aws);
        return { status: 'PRIMARY_RECONCILIATION_NOT_REQUIRED' };
    }
    if (state.pending !== 'enable-signup' || state.poolDone || state.clientDone ||
        state.codeDone || state.configDone || state.complete || !state.rollbackCode ||
        !sameSnapshot(state.poolAfter, state.pool) || !sameSnapshot(state.clientAfter, state.client))
        throw new Error('PRIMARY_MUTATION_RECONCILIATION_REQUIRED');
    primaryPlan(config, state.config);
    if (digest(readFileSync(directory + '/primary-rollback.zip')) !== state.rollbackCode ||
        codeHash(state.rollbackCode) !== state.config.CodeSha256)
        throw new Error('ROLLBACK_BYTES_CHANGED');
    const current = await ready(aws, state.afterRevision, 'PRIMARY_UPDATE');
    assertLambda(state, current, state.config.CodeSha256, state.config.Environment, state.config.Handler);
    if (!sameSnapshot(readClient(aws), state.client))
        throw new Error('PRIMARY_COGNITO_DRIFT');
    const table = aws('dynamodb', 'describe-table', { TableName: groupTable }).Table;
    assertPrimaryTable(table, config.account,
        aws('dynamodb', 'list-tags-of-resource', { ResourceArn: table.TableArn }).Tags);
    verifyRoutes(state, aws);
    if (!same(readPolicy(aws, state.config.Role.split('/').at(-1)), state.policy))
        throw new Error('PRIMARY_POLICY_CONFLICT');
    const input = signupInput(state.pool);
    let result;
    try {
        result = await cognitoReadback(() => readPool(aws), poolInput, input, state.pool,
            'PRIMARY_POOL_RECONCILIATION_MISMATCH');
    } catch (error) {
        if (error.message !== 'PRIMARY_POOL_RECONCILIATION_MISMATCH') throw error;
        // Top-level known field names only: never values, nested tag names or raw responses.
        const observed = stableCognito(readPool(aws));
        const expected = stableCognito(expectedSnapshot(state.pool, input));
        const fields = [...new Set([...Object.keys(expected), ...Object.keys(observed)])]
            .filter(key => !sameCognito({ [key]: observed[key] }, { [key]: expected[key] }))
            .map(key => Object.hasOwn(awsSkeleton('cognito-idp', 'update-user-pool'), key)
                ? key : 'OTHER_CONFIGURATION').filter((key, index, keys) => keys.indexOf(key) === index);
        console.error(JSON.stringify({ status: 'BLOCKED', code: error.message, fields }));
        throw error;
    }
    // Retain immutable pre-repair journal bytes as well as the untouched rollback ZIP.
    const backup = directory + '/primary-before-assess09.json';
    if (existsSync(backup)) {
        if (lstatSync(backup).isSymbolicLink() || !same(JSON.parse(readFileSync(backup, 'utf8')), state))
            throw new Error('PRIMARY_REPAIR_BACKUP_CONFLICT');
    } else {
        const descriptor = openSync(backup, 'wx', 0o600);
        try { writeFileSync(descriptor, readFileSync(directory + '/primary-private-journal.json')); fsyncSync(descriptor); }
        finally { closeSync(descriptor); }
    }
    state.poolAfter = result;
    state.poolDone = true;
    state.pending = null;
    journal.save(state);
    return { status: 'PRIMARY_SIGNUP_RECONCILED', cloudWrites: false };
}


/** Retry only a proven unapplied code upload; matching/foreign mutations require review. */
export async function reconcilePendingCode(config, manifest, directory, aws) {
    const journal = journalAt(directory);
    const state = journal.read();
    if (state.schemaVersion !== 2 || state.account !== config.account || state.rollback ||
        state.targetCode !== manifest.artifacts.api.sha256 ||
        digest(readFileSync(directory + '/api.zip')) !== state.targetCode)
        throw new Error('PRIMARY_JOURNAL_TARGET_CHANGED');
    if (!state.pending || state.pending === 'enable-signup')
        return { status: 'PRIMARY_CODE_RECONCILIATION_NOT_REQUIRED', cloudWrites: false };
    if (state.pending !== 'update-code' || !state.poolDone || !state.clientDone ||
        state.codeDone || state.configDone || state.complete || !state.rollbackCode)
        throw new Error('PRIMARY_MUTATION_RECONCILIATION_REQUIRED');
    primaryPlan(config, state.config);
    if (digest(readFileSync(directory + '/primary-rollback.zip')) !== state.rollbackCode ||
        codeHash(state.rollbackCode) !== state.config.CodeSha256)
        throw new Error('ROLLBACK_BYTES_CHANGED');
    const current = await ready(aws, state.afterRevision, 'PRIMARY_UPDATE');
    assertLambda(state, current, state.config.CodeSha256, state.config.Environment, state.config.Handler);
    if (current.Role !== state.config.Role)
        throw new Error('PRIMARY_REVISION_OR_CONFIG_DRIFT');
    assertCognito(state, aws);
    const table = aws('dynamodb', 'describe-table', { TableName: groupTable }).Table;
    assertPrimaryTable(table, config.account,
        aws('dynamodb', 'list-tags-of-resource', { ResourceArn: table.TableArn }).Tags);
    verifyRoutes(state, aws);
    if (!same(readPolicy(aws, state.config.Role.split('/').at(-1)), state.policy))
        throw new Error('PRIMARY_POLICY_CONFLICT');
    const backup = directory + '/primary-before-lambda-upload-repair.json';
    if (existsSync(backup)) {
        if (lstatSync(backup).isSymbolicLink() || !same(JSON.parse(readFileSync(backup, 'utf8')), state))
            throw new Error('PRIMARY_REPAIR_BACKUP_CONFLICT');
    } else {
        const descriptor = openSync(backup, 'wx', 0o600);
        try { writeFileSync(descriptor, readFileSync(directory + '/primary-private-journal.json')); fsyncSync(descriptor); }
        finally { closeSync(descriptor); }
    }
    // Exact original hash + revision/config/authority prove this upload was not applied.
    state.pending = null;
    journal.save(state);
    return { status: 'PRIMARY_CODE_UPLOAD_NOT_APPLIED_RECONCILED', cloudWrites: false };
}

/** Adopt a fresh guard only for an acknowledged update with complete state proof. */
export async function reconcileRecordedRevision(config, manifest, directory, aws) {
    const journal = journalAt(directory);
    const state = journal.read();
    const candidate = readFileSync(directory + '/api.zip');
    if (state.schemaVersion !== 2 || state.account !== config.account || state.rollback ||
        state.targetCode !== manifest.artifacts.api.sha256 || digest(candidate) !== state.targetCode)
        throw new Error('PRIMARY_JOURNAL_TARGET_CHANGED');
    const notRequired = { status: 'PRIMARY_RECORDED_REVISION_NOT_REQUIRED', cloudWrites: false };
    if (!state.codeDone) return notRequired;
    assertNoPending(state);
    if (!state.poolDone || !state.clientDone || !state.rollbackCode)
        throw new Error('PRIMARY_MUTATION_RECONCILIATION_REQUIRED');
    let current;
    for (let attempt = 0; attempt < 60; attempt++) {
        current = lambda(aws);
        if (current.LastUpdateStatus === 'Failed') throw new Error('PRIMARY_UPDATE_FAILED');
        if (current.LastUpdateStatus === 'Successful' && current.State === 'Active') break;
        if (attempt === 59) throw new Error('PRIMARY_UPDATE_TIMEOUT');
        await delay();
    }
    if (current.RevisionId === state.afterRevision) return notRequired;
    primaryPlan(config, state.config);
    if (digest(readFileSync(directory + '/primary-rollback.zip')) !== state.rollbackCode ||
        codeHash(state.rollbackCode) !== state.config.CodeSha256)
        throw new Error('ROLLBACK_BYTES_CHANGED');
    const expected = { ...state.config, CodeSha256: codeHash(state.targetCode), CodeSize: candidate.length,
        Environment: state.configDone ? { Variables: state.next } : state.config.Environment,
        Handler: state.configDone ? 'api.handler' : state.config.Handler };
    // Only update identifiers/timestamps/state messages are observational. Unknown
    // fields, runtime versions and every other configuration field remain exact.
    const observations = new Set(['RevisionId', 'LastModified', 'LastUpdateStatus',
        'LastUpdateStatusReason', 'LastUpdateStatusReasonCode', 'State', 'StateReason', 'StateReasonCode']);
    if (state.configDone) observations.add('ConfigSha256'); // Derived from the explicitly changed settings.
    const stable = value => Object.fromEntries(Object.entries(value).filter(([key]) => !observations.has(key)));
    if (!current.RevisionId || !same(stable(current), stable(expected))) {
        const error = new Error('PRIMARY_RECORDED_CONFIG_MISMATCH');
        const known = new Set(['Role', 'Runtime', 'RuntimeVersionConfig', 'MemorySize', 'Timeout', 'Description',
            'VpcConfig', 'Layers', 'LoggingConfig', 'Environment', 'Handler', 'Architectures', 'ConfigSha256',
            'CodeSize', 'CodeSha256', 'PackageType', 'FunctionArn', 'FunctionName', 'KMSKeyArn',
            'EphemeralStorage', 'TracingConfig', 'DeadLetterConfig', 'Version', 'SigningJobArn',
            'SigningProfileVersionArn', 'SnapStart', 'FileSystemConfigs']);
        const a = stable(current), b = stable(expected);
        error.fields = [...new Set([...Object.keys(a), ...Object.keys(b)])]
            .filter(key => !same({ [key]: a[key] }, { [key]: b[key] }))
            .map(key => known.has(key) ? key : 'OTHER_CONFIGURATION');
        throw error;
    }
    assertCognito(state, aws);
    const table = aws('dynamodb', 'describe-table', { TableName: groupTable }).Table;
    assertPrimaryTable(table, config.account,
        aws('dynamodb', 'list-tags-of-resource', { ResourceArn: table.TableArn }).Tags);
    verifyRoutes(state, aws);
    if (!same(readPolicy(aws, state.config.Role.split('/').at(-1)), state.policy))
        throw new Error('PRIMARY_POLICY_CONFLICT');
    await delay();
    // A second complete read proves stability throughout the authority checks.
    const confirmed = lambda(aws);
    if (!same(confirmed, current)) throw new Error('PRIMARY_REVISION_OR_CONFIG_DRIFT');
    const bytes = readFileSync(directory + '/primary-private-journal.json');
    if (!same(JSON.parse(bytes), state)) throw new Error('PRIMARY_JOURNAL_TARGET_CHANGED');
    const backup = directory + '/primary-before-recorded-revision-' + digest(bytes) + '.json';
    if (existsSync(backup)) {
        if (lstatSync(backup).isSymbolicLink() || !readFileSync(backup).equals(bytes))
            throw new Error('PRIMARY_REPAIR_BACKUP_CONFLICT');
    } else {
        const descriptor = openSync(backup, 'wx', 0o600);
        try { writeFileSync(descriptor, bytes); fsyncSync(descriptor); }
        finally { closeSync(descriptor); }
    }
    state.afterRevision = confirmed.RevisionId;
    journal.save(state);
    return { status: 'PRIMARY_RECORDED_REVISION_RECONCILED', cloudWrites: false };
}
