import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readKe13bConfig } from '../../apps/api/src/ke13b-lambda.ts';
import { verifySource } from './verify.mjs';

const execute = promisify(execFile);
const account = '092954139775'; const region = 'us-east-1'; const poolId = 'us-east-1_V9OMjd0zx';
const functionName = 'known-enough-stage-api';
const invalid = () => { throw new Error('PARTITION_PREFLIGHT_INVALID'); };
const callbacks = (client, origin) => Array.isArray(client.CallbackURLs) && client.CallbackURLs.includes(origin + '/');

/** Return an explicit public allowlist, never the Lambda environment or client configuration. */
export function partitionReleasePreflight(sourceSha, observed) {
  if (typeof sourceSha !== 'string' || !/^[a-f0-9]{40}$/.test(sourceSha) || !observed || !observed.lambda
    || observed.lambda.FunctionArn !== `arn:aws:lambda:${region}:${account}:function:${functionName}`
    || observed.lambda.Role !== `arn:aws:iam::${account}:role/KnownEnoughStageApiRole`
    || observed.lambda.State !== 'Active' || observed.lambda.LastUpdateStatus !== 'Successful'
    || observed.lambda.Handler !== 'api.handler' || !observed.lambda.RevisionId
    || !observed.lambda.CodeSha256) return invalid();
  const config = readKe13bConfig({ ...observed.lambda.Environment?.Variables, AWS_REGION: region });
  if (config.region !== region || config.tableName !== 'KnownEnoughStage' || config.userPoolId !== poolId
    || config.groups?.tableName !== 'KnownEnoughGroupsStage'
    || observed.pool?.Id !== poolId || observed.pool.Arn !== `arn:aws:cognito-idp:${region}:${account}:userpool/${poolId}`
    || config.groups.cognitoDomain !== `https://${observed.pool.Domain}.auth.${region}.amazoncognito.com`
    || observed.participant?.ClientId !== config.participantClientId || observed.participant.UserPoolId !== poolId
    || observed.display?.ClientId !== config.displayClientId || observed.display.UserPoolId !== poolId
    || observed.decisions?.TableArn !== `arn:aws:dynamodb:${region}:${account}:table/KnownEnoughStage`) return invalid();
  const common = client => client.AllowedOAuthFlowsUserPoolClient === true && client.AllowedOAuthFlows?.includes('code')
    && client.AllowedOAuthScopes?.includes('openid') && !client.ClientSecret && callbacks(client, config.allowedOrigin);
  const signup = observed.pool.AdminCreateUserConfig?.AllowAdminCreateUserOnly === false
    && observed.pool.AutoVerifiedAttributes?.includes('email');
  const participantOauth = common(observed.participant) && observed.participant.AllowedOAuthScopes?.includes('email');
  const displayOauth = common(observed.display);
  const count = observed.decisions.ItemCount;
  return { schemaVersion: 1, sourceSha, account, region, result: 'PARTITION_RELEASE_PREFLIGHT_READBACK',
    runtimeReady: true, models: config.models ? 'ENABLED' : 'DISABLED', groupsEnabled: true,
    signupReady: Boolean(signup), participantOauthReady: Boolean(participantOauth), displayOauthReady: Boolean(displayOauth),
    approximateDecisionTableItems: Number.isSafeInteger(count) && count >= 0 ? count : null,
    legacyCompatibilityRequired: true, activation: 'NOT_EXECUTED', deployment: 'NOT_EXECUTED',
    limitation: 'Configuration readback only; not a signed login, live partition runtime or cutover proof.' };
}

async function main() {
  const sourceSha = verifySource(process.env);
  const aws = async (service, action, ...args) => {
    const { stdout } = await execute('aws', [service, action, ...args, '--region', region,
      '--endpoint-url', `https://${service === 'sts' ? 'sts' : service}.${region}.amazonaws.com`,
      '--output', 'json', '--no-cli-pager', '--cli-connect-timeout', '5', '--cli-read-timeout', '8'],
    { timeout: 10_000, maxBuffer: 131072 });
    return JSON.parse(stdout);
  };
  const identity = await aws('sts', 'get-caller-identity');
  if (identity.Account !== account || typeof identity.Arn !== 'string'
    || !identity.Arn.startsWith(`arn:aws:sts::${account}:assumed-role/KnownEnoughGithubStagingInspector/`)) return invalid();
  const lambda = await aws('lambda', 'get-function-configuration', '--function-name', functionName);
  // Validate the fixed target before taking client identifiers from its private settings.
  if (lambda.FunctionArn !== `arn:aws:lambda:${region}:${account}:function:${functionName}`
    || lambda.Role !== `arn:aws:iam::${account}:role/KnownEnoughStageApiRole`) return invalid();
  const config = readKe13bConfig({ ...lambda.Environment?.Variables, AWS_REGION: region });
  if (config.userPoolId !== poolId || config.groups?.tableName !== 'KnownEnoughGroupsStage') return invalid();
  const pool = (await aws('cognito-idp', 'describe-user-pool', '--user-pool-id', poolId)).UserPool;
  const participant = (await aws('cognito-idp', 'describe-user-pool-client', '--user-pool-id', poolId, '--client-id', config.participantClientId)).UserPoolClient;
  const display = (await aws('cognito-idp', 'describe-user-pool-client', '--user-pool-id', poolId, '--client-id', config.displayClientId)).UserPoolClient;
  const decisions = (await aws('dynamodb', 'describe-table', '--table-name', 'KnownEnoughStage')).Table;
  const report = partitionReleasePreflight(sourceSha, { lambda, pool, participant, display, decisions });
  const privateDirectory = join(process.env.RUNNER_TEMP, 'partition-release-private');
  await mkdir(privateDirectory, { mode: 0o700 });
  await writeFile(join(privateDirectory, 'lambda-private.json'), JSON.stringify(lambda), { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify(report));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch (error) {
    const match = typeof error.stderr === 'string' ? error.stderr.match(/An error occurred \(([A-Za-z0-9]+)\)/)?.[1] : null;
    const code = ['AccessDenied', 'AccessDeniedException', 'ResourceNotFoundException', 'ExpiredToken'].includes(match) ? match : 'PARTITION_PREFLIGHT_FAILED';
    console.error(JSON.stringify({ result: 'BLOCKED', code, deployment: 'NOT_EXECUTED', activation: 'NOT_EXECUTED' })); process.exitCode = 1;
  }
}
