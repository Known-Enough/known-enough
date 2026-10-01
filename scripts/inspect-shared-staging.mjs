import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { safeAwsFailureDetail } from './shared-staging-error.mjs';

const ACCOUNT = '092954139775';
const REGION = 'us-east-1';
const INSPECTOR_ROLE = 'KnownEnoughGithubStagingInspector';
const LAMBDA_NAME = 'known-enough-stage-api';
const LAMBDA_ROLE_NAME = 'KnownEnoughStageApiRole';
const API_ID = 'u94iyvt6p9';
const POOL_ID = 'us-east-1_V9OMjd0zx';
const PARTICIPANT_CLIENT_ID = '3accf7paalvon2m8ue8okfi853';
const DISPLAY_CLIENT_ID = '481ru24906sv26f30i569gq8g0';
const AMPLIFY_APP_ID = 'd143q5ravxp5av';
const AMPLIFY_BRANCH = 'main';
const OUTPUT_PATH = resolve(process.env.STAGING_INSPECTION_OUTPUT ?? 'staging-inspection.json');
const manifest = JSON.parse(readFileSync(new URL('../tests/live/targets.json', import.meta.url), 'utf8'));
const connectedTarget = manifest.targets.find(target => target.id === 'amplify-connected-staging');

const requiredGroupRoutes = [
  'GET /account',
  'POST /account/register',
  'GET /groups',
  'POST /groups',
  'POST /groups/accept',
  'POST /groups/{groupId}/invitations',
  'POST /groups/{groupId}/remove',
  'OPTIONS /account',
  'OPTIONS /account/register',
  'OPTIONS /groups',
  'OPTIONS /groups/{proxy+}',
];

const output = {
  schemaVersion: 1,
  observedAt: new Date().toISOString(),
  region: REGION,
  collection: { status: 'blocked', issue: null },
  identity: null,
  amplify: null,
  lambda: null,
  api: null,
  tables: null,
  cognito: null,
  checks: [],
};

function check(name, status, detail) {
  output.checks.push({ name, status, detail });
}

function awsJson(args, label, { missingIsExpected = false } = {}) {
  const result = spawnSync('aws', [
    ...args,
    '--region', REGION,
    '--no-cli-pager',
    '--output', 'json',
  ], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });

  if (result.error || result.status !== 0) {
    const diagnostic = `${result.stderr ?? ''}\n${result.stdout ?? ''}`;
    if (missingIsExpected && /ResourceNotFoundException|ResourceNotFound|requested resource not found/i.test(diagnostic)) {
      return { missing: true };
    }
    throw new Error(`${label} was denied or unavailable${safeAwsFailureDetail(result.stderr)}`);
  }

  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`${label} returned an unreadable response`);
  }
}

function globMatches(pattern, value) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*').replaceAll('?', '.');
  return new RegExp(`^${escaped}$`).test(value);
}

function hasPotentialBedrockInlineGrant(policyDocument) {
  const policy = typeof policyDocument === 'string' ? JSON.parse(policyDocument) : policyDocument;
  const statements = Array.isArray(policy?.Statement) ? policy.Statement : [policy?.Statement];
  const actions = statement => Array.isArray(statement.Action) ? statement.Action : [statement.Action];
  const resources = statement => Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource];

  return statements.some(statement => {
    if (!statement || statement.Effect !== 'Allow' || !statement.Action || !statement.Resource) return false;
    const allowsModelAction = actions(statement).some(action => typeof action === 'string' && (
      globMatches(action.toLowerCase(), 'bedrock:invokemodel')
      || globMatches(action.toLowerCase(), 'bedrock:invokemodelwithresponsestream')
    ));
    const allowsNovaLite = resources(statement).some(resource => typeof resource === 'string' && (
      globMatches(resource, 'arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-lite-v1:0')
    ));
    return allowsModelAction && allowsNovaLite;
  });
}

function readNamedTable(tableName) {
  const response = awsJson([
    'dynamodb', 'describe-table',
    '--table-name', tableName,
    '--query', 'Table.{TableName:TableName,TableStatus:TableStatus,KeySchema:KeySchema,BillingMode:BillingModeSummary.BillingMode,DeletionProtectionEnabled:DeletionProtectionEnabled}',
  ], `DynamoDB DescribeTable (${tableName})`, { missingIsExpected: true });
  if (response.missing) return { name: tableName, exists: false };
  return { name: tableName, exists: true, ...response };
}

function readClient(clientId) {
  const client = awsJson([
    'cognito-idp', 'describe-user-pool-client',
    '--user-pool-id', POOL_ID,
    '--client-id', clientId,
    '--query', 'UserPoolClient.{ClientId:ClientId,AllowedOAuthFlows:AllowedOAuthFlows,AllowedOAuthScopes:AllowedOAuthScopes,HasClientSecret:ClientSecret != `null`,ReadAttributes:ReadAttributes,WriteAttributes:WriteAttributes,AccessTokenValidity:AccessTokenValidity}',
  ], `Cognito DescribeUserPoolClient (${clientId})`);
  return {
    clientId: client.ClientId,
    allowedOAuthFlows: client.AllowedOAuthFlows ?? [],
    allowedOAuthScopes: client.AllowedOAuthScopes ?? [],
    hasClientSecret: client.HasClientSecret === true,
    readAttributes: client.ReadAttributes ?? [],
    writeAttributes: client.WriteAttributes ?? [],
    accessTokenValidity: client.AccessTokenValidity ?? null,
  };
}

function evaluateObservations() {
  const lambda = output.lambda;
  const runtime = lambda?.state === 'Active' && lambda?.lastUpdateStatus === 'Successful';
  check('Lambda active and update is successful', runtime ? 'passed' : 'failed',
    `state=${lambda?.state ?? 'unavailable'}; lastUpdateStatus=${lambda?.lastUpdateStatus ?? 'unavailable'}`);

  const artifactMatches = Boolean(lambda?.codeSha256Hex)
    && lambda.codeSha256Hex === connectedTarget?.backend?.expectedArtifactSha256;
  check('Deployed Lambda ZIP matches the manifest', artifactMatches ? 'passed' : 'failed',
    `deployed=${lambda?.codeSha256Hex ?? 'unavailable'}; manifest=${connectedTarget?.backend?.expectedArtifactSha256 ?? 'unavailable'}; sourceCommit=${connectedTarget?.backend?.sourceCommit ?? 'unknown'}`);

  const modelIsOff = lambda?.modelMode === 'DISABLED'
    && String(lambda?.paidCallsApproved).toLowerCase() === 'false'
    && lambda?.runtimeInlineBedrockGrant !== true;
  check('NP00 model guard and runtime inline grant are off', modelIsOff ? 'passed' : 'blocked',
    modelIsOff
      ? 'Both model flags are off and no inline Nova Lite invocation allow was found.'
      : `Current mode=${lambda?.modelMode ?? 'unavailable'}, paidCallsApproved=${lambda?.paidCallsApproved ?? 'unavailable'}, inlineNovaLiteGrant=${lambda?.runtimeInlineBedrockGrant === true ? 'present' : 'not found'}; NP00 shutdown write is pending.`);

  const decisionRoutes = new Map((output.api?.routes ?? []).map(route => [route.routeKey, route]));
  const protectedDecisionRoutes = [
    ['POST /decisions', 'JWT'],
    ['ANY /decisions/{proxy+}', 'JWT'],
    ['OPTIONS /decisions', 'NONE'],
    ['OPTIONS /decisions/{proxy+}', 'NONE'],
  ];
  const badDecisionRoute = protectedDecisionRoutes.find(([key, expected]) => decisionRoutes.get(key)?.authorizationType !== expected);
  check('Existing decision routes retain their authorization', badDecisionRoute ? 'failed' : 'passed',
    badDecisionRoute ? `${badDecisionRoute[0]} does not have expected ${badDecisionRoute[1]} authorization.` : 'JWT protects decision routes; only OPTIONS routes use NONE.');

  const groupTable = output.tables?.group;
  const schema = groupTable?.KeySchema ?? [];
  const groupTableReady = groupTable?.exists === true
    && groupTable.TableStatus === 'ACTIVE'
    && schema.length === 2
    && schema.some(key => key.AttributeName === 'PK' && key.KeyType === 'HASH')
    && schema.some(key => key.AttributeName === 'SK' && key.KeyType === 'RANGE')
    && groupTable.BillingMode === 'PAY_PER_REQUEST'
    && groupTable.DeletionProtectionEnabled === true;
  check('NP05 group table', groupTableReady ? 'passed' : 'blocked', groupTableReady
    ? 'KnownEnoughGroupsStage has the expected active, protected PK/SK schema.'
    : groupTable?.exists
      ? 'KnownEnoughGroupsStage exists but is not yet in the prepared active/protected shape.'
      : 'KnownEnoughGroupsStage is absent; creating it is a separate NP05 deployment operation.');

  const currentRoutes = new Set((output.api?.routes ?? []).map(route => route.routeKey));
  const missingGroupRoutes = requiredGroupRoutes.filter(route => !currentRoutes.has(route));
  const wrongGroupRoute = requiredGroupRoutes.find(route => {
    const observed = decisionRoutes.get(route);
    if (!observed) return false;
    return route.startsWith('OPTIONS ')
      ? observed.authorizationType !== 'NONE'
      : observed.authorizationType !== 'JWT';
  });
  const groupRouteStatus = wrongGroupRoute ? 'failed' : missingGroupRoutes.length ? 'blocked' : 'passed';
  check('NP01 non-model group routes', groupRouteStatus, wrongGroupRoute
    ? `${wrongGroupRoute} has an unexpected authorization type.`
    : missingGroupRoutes.length
      ? `Missing ${missingGroupRoutes.length} prepared routes: ${missingGroupRoutes.join(', ')}.`
      : 'All prepared non-model routes exist with JWT protection and OPTIONS-only NONE authorization.');

  const pool = output.cognito?.pool;
  const participant = output.cognito?.participantClient;
  const signupStillClosed = pool?.allowAdminCreateUserOnly === true
    && !(pool?.autoVerifiedAttributes ?? []).includes('email')
    && participant?.allowedOAuthScopes?.includes('email') !== true;
  check('Signup and verification email remain gated', signupStillClosed ? 'passed' : 'failed', signupStillClosed
    ? 'Self-service signup remains admin-only, email auto-verification is unset, and participant scope is still openid only.'
    : 'Cognito signup or email verification settings differ from the authorized hold state; no signup/email test was run.');

  const signupReady = pool?.allowAdminCreateUserOnly === false
    && pool?.autoVerifiedAttributes?.includes('email') === true
    && participant?.allowedOAuthScopes?.includes('email') === true;
  check('Verified-email self-signup feature', signupReady ? 'passed' : 'blocked', signupReady
    ? 'Cognito settings are configured; this workflow still does not create users or send email.'
    : 'Self-service signup and verified-email configuration are intentionally withheld pending the separate email budget and authorization.');

  check('Paid-model qualification', 'blocked', 'No model API is invoked. Paid-model checks need their separate budget and authorization.');
  check('NP05 deployment writes', 'blocked', 'This role cannot create resources, update Lambda/API/Cognito, or deploy Amplify. NP05 deployment stays separate.');
}

try {
  const identity = awsJson(['sts', 'get-caller-identity', '--query', '{Account:Account,Arn:Arn}'], 'STS identity');
  const expectedPrefix = `arn:aws:sts::${ACCOUNT}:assumed-role/${INSPECTOR_ROLE}/`;
  if (identity.Account !== ACCOUNT || !identity.Arn.startsWith(expectedPrefix)) {
    throw new Error('AWS OIDC identity did not match the dedicated staging inspector role');
  }
  output.identity = { account: identity.Account, role: INSPECTOR_ROLE };
  check('GitHub OIDC account and role', 'passed', `account=${ACCOUNT}; role=${INSPECTOR_ROLE}`);

  const amplifyJobs = awsJson([
    'amplify', 'list-jobs',
    '--app-id', AMPLIFY_APP_ID,
    '--branch-name', AMPLIFY_BRANCH,
    '--max-results', '10',
    '--query', 'jobSummaries[].{JobId:jobId,CommitId:commitId,Status:status,StartTime:startTime,EndTime:endTime,JobType:jobType}',
  ], 'Amplify ListJobs');
  const successfulAmplifyJob = amplifyJobs
    .filter(job => ['SUCCEED', 'SUCCEEDED'].includes(job.Status))
    .sort((left, right) => Date.parse(right.EndTime ?? right.StartTime ?? 0) - Date.parse(left.EndTime ?? left.StartTime ?? 0))[0] ?? null;
  output.amplify = {
    appId: AMPLIFY_APP_ID,
    branch: AMPLIFY_BRANCH,
    latestSuccessfulJob: successfulAmplifyJob,
  };
  check('Amplify latest successful job is readable', successfulAmplifyJob ? 'passed' : 'blocked',
    successfulAmplifyJob
      ? `job=${successfulAmplifyJob.JobId}; commit=${successfulAmplifyJob.CommitId || 'not supplied by manual deployment'}; status=${successfulAmplifyJob.Status}`
      : 'No successful Amplify main-branch job summary was returned.');

  const lambda = awsJson([
    'lambda', 'get-function-configuration',
    '--function-name', LAMBDA_NAME,
    '--query', '{CodeSha256:CodeSha256,Runtime:Runtime,Handler:Handler,State:State,LastUpdateStatus:LastUpdateStatus,Role:Role,ModelMode:Environment.Variables.KE14_MODEL_MODE,PaidCallsApproved:Environment.Variables.KE14_PAID_CALLS_APPROVED}',
  ], 'Lambda GetFunctionConfiguration');
  const policyNames = awsJson([
    'iam', 'list-role-policies',
    '--role-name', LAMBDA_ROLE_NAME,
    '--query', 'PolicyNames',
  ], 'IAM ListRolePolicies');
  let runtimeInlineBedrockGrant = false;
  for (const policyName of policyNames) {
    const policy = awsJson([
      'iam', 'get-role-policy',
      '--role-name', LAMBDA_ROLE_NAME,
      '--policy-name', policyName,
      '--query', 'PolicyDocument',
    ], 'IAM GetRolePolicy');
    runtimeInlineBedrockGrant ||= hasPotentialBedrockInlineGrant(policy);
  }
  output.lambda = {
    functionName: LAMBDA_NAME,
    codeSha256Hex: Buffer.from(lambda.CodeSha256 ?? '', 'base64').toString('hex'),
    manifestCodeSha256: connectedTarget?.backend?.expectedArtifactSha256 ?? null,
    sourceCommit: connectedTarget?.backend?.sourceCommit ?? null,
    runtime: lambda.Runtime,
    handler: lambda.Handler,
    state: lambda.State,
    lastUpdateStatus: lambda.LastUpdateStatus,
    roleName: String(lambda.Role ?? '').split('/').at(-1),
    modelMode: lambda.ModelMode ?? null,
    paidCallsApproved: lambda.PaidCallsApproved ?? null,
    runtimeInlineBedrockGrant,
  };

  const routeItems = awsJson([
    'apigatewayv2', 'get-routes',
    '--api-id', API_ID,
    '--query', 'Items[].{RouteKey:RouteKey,AuthorizationType:AuthorizationType,AuthorizerId:AuthorizerId}',
  ], 'API Gateway GetRoutes');
  output.api = {
    apiId: API_ID,
    routes: routeItems.map(route => ({
      routeKey: route.RouteKey,
      authorizationType: route.AuthorizationType,
      authorizerId: route.AuthorizerId ?? null,
    })),
  };

  const currentTable = readNamedTable('KnownEnoughStage');
  const groupTable = readNamedTable('KnownEnoughGroupsStage');
  output.tables = { existing: currentTable, group: groupTable };
  check('Existing KnownEnoughStage table is active', currentTable.exists && currentTable.TableStatus === 'ACTIVE' ? 'passed' : 'failed',
    currentTable.exists ? `status=${currentTable.TableStatus}` : 'KnownEnoughStage is absent.');

  const pool = awsJson([
    'cognito-idp', 'describe-user-pool',
    '--user-pool-id', POOL_ID,
    '--query', 'UserPool.{Id:Id,Domain:Domain,AllowAdminCreateUserOnly:AdminCreateUserConfig.AllowAdminCreateUserOnly,AutoVerifiedAttributes:AutoVerifiedAttributes,EmailSendingAccount:EmailConfiguration.EmailSendingAccount}',
  ], 'Cognito DescribeUserPool');
  output.cognito = {
    pool: {
      id: pool.Id,
      domain: pool.Domain,
      allowAdminCreateUserOnly: pool.AllowAdminCreateUserOnly ?? null,
      autoVerifiedAttributes: pool.AutoVerifiedAttributes ?? [],
      emailSendingAccount: pool.EmailSendingAccount ?? null,
    },
    participantClient: readClient(PARTICIPANT_CLIENT_ID),
    displayClient: readClient(DISPLAY_CLIENT_ID),
  };

  evaluateObservations();
  output.collection = { status: 'passed', issue: null };
} catch (error) {
  output.collection = {
    status: 'failed',
    issue: error instanceof Error ? error.message : 'AWS inspection failed',
  };
  check('AWS inspection collection', 'failed', output.collection.issue);
}

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`STAGING_INSPECTION=${output.collection.status}; output=${OUTPUT_PATH}; private fields omitted\n`);
if (output.collection.status !== 'passed') process.exitCode = 1;
