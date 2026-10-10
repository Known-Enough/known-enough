import test from 'node:test';
import assert from 'node:assert/strict';
import { partitionReleasePreflight } from './partition-release-preflight.mjs';

const sha = 'a'.repeat(40); const poolId = 'us-east-1_V9OMjd0zx'; const origin = 'https://known.example.invalid';
function fixture() {
  const client = id => ({ ClientId: id, UserPoolId: poolId, AllowedOAuthFlowsUserPoolClient: true,
    AllowedOAuthFlows: ['code'], AllowedOAuthScopes: ['openid', 'email'], CallbackURLs: [origin + '/'] });
  return { lambda: { FunctionArn: 'arn:aws:lambda:us-east-1:092954139775:function:known-enough-stage-api',
    Role: 'arn:aws:iam::092954139775:role/KnownEnoughStageApiRole', State: 'Active', LastUpdateStatus: 'Successful',
    Handler: 'api.handler', RevisionId: 'private-revision', CodeSha256: 'private-code', Environment: { Variables: {
      KE13B_TABLE_NAME: 'KnownEnoughStage', COGNITO_USER_POOL_ID: poolId, COGNITO_PARTICIPANT_CLIENT_ID: 'participant',
      COGNITO_DISPLAY_CLIENT_ID: 'display', KE13B_ALLOWED_ORIGIN: origin, KE14_MODEL_MODE: 'DISABLED', KE14_PAID_CALLS_APPROVED: 'false',
      NP_GROUPS_ENABLED: 'true', NP_GROUP_TABLE_NAME: 'KnownEnoughGroupsStage', NP_GROUP_EMAIL_KEY: 'PRIVATE_EMAIL_KEY_CANARY'.repeat(3),
      NP_COGNITO_DOMAIN: 'https://known-primary.auth.us-east-1.amazoncognito.com', UNRELATED_PRIVATE: 'PRIVATE_UNRELATED_CANARY' } } },
    pool: { Id: poolId, Domain: 'known-primary', Arn: 'arn:aws:cognito-idp:us-east-1:092954139775:userpool/' + poolId,
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: false }, AutoVerifiedAttributes: ['email'] },
    participant: client('participant'), display: client('display'),
    decisions: { TableArn: 'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughStage', ItemCount: 12 } };
}
test('actual-shaped primary metadata produces only an allowlisted readiness report, never its private environment', () => {
  const result = partitionReleasePreflight(sha, fixture());
  assert.equal(result.runtimeReady, true); assert.equal(result.signupReady, true);
  assert.equal(result.participantOauthReady, true); assert.equal(result.displayOauthReady, true);
  assert.equal(result.approximateDecisionTableItems, 12); assert.equal(result.legacyCompatibilityRequired, true);
  assert.equal(result.models, 'DISABLED'); assert.equal(result.activation, 'NOT_EXECUTED');
  assert.ok(!/PRIVATE|Environment|Variables|RevisionId|CodeSha256|NP_GROUP_EMAIL_KEY/.test(JSON.stringify(result)));
});
test('disabled signup, wrong callbacks, missing email scope and confidential clients are distinct readiness failures', () => {
  const cases = [
    [data => { data.pool.AdminCreateUserConfig.AllowAdminCreateUserOnly = true; }, 'signupReady'],
    [data => { data.pool.AutoVerifiedAttributes = []; }, 'signupReady'],
    [data => { data.participant.AllowedOAuthScopes = ['openid']; }, 'participantOauthReady'],
    [data => { data.participant.CallbackURLs = ['https://other.example.invalid/']; }, 'participantOauthReady'],
    [data => { data.participant.ClientSecret = 'PRIVATE_CLIENT_SECRET'; }, 'participantOauthReady'],
    [data => { data.display.AllowedOAuthFlows = ['implicit']; }, 'displayOauthReady'],
  ];
  for (const [mutate, field] of cases) {
    const data = fixture(); mutate(data); const report = partitionReleasePreflight(sha, data);
    assert.equal(report[field], false); assert.ok(!JSON.stringify(report).includes('PRIVATE'));
  }
});
test('foreign function/role/pool/table/clients and unsettled runtime cannot become private deployment configuration', () => {
  const mutations = [
    data => { data.lambda.FunctionArn += ':alias'; }, data => { data.lambda.Role += '-other'; },
    data => { data.lambda.LastUpdateStatus = 'InProgress'; }, data => { data.lambda.Handler = 'other.handler'; },
    data => { data.pool.Arn = 'arn:aws:cognito-idp:us-east-1:OTHER:userpool/' + poolId; },
    data => { data.pool.Domain = 'other-pool-domain'; },
    data => { data.decisions.TableArn += '-other'; }, data => { data.participant.UserPoolId = 'us-east-1_other'; },
    data => { data.lambda.Environment.Variables.NP_GROUP_TABLE_NAME = 'OtherGroups'; },
  ];
  for (const mutate of mutations) { const data = fixture(); mutate(data); assert.throws(() => partitionReleasePreflight(sha, data)); }
});
test('model-enabled metadata is observed without changing it; unknown table counts are not reported as zero', () => {
  const data = fixture(); Object.assign(data.lambda.Environment.Variables, { KE14_MODEL_MODE: 'BEDROCK',
    KE14_PAID_CALLS_APPROVED: 'true', KE14_INVOCATION_LOGGING_DISABLED: 'true', KE14_RETENTION_REVIEWED: 'true' });
  data.decisions.ItemCount = undefined;
  const before = structuredClone(data); const report = partitionReleasePreflight(sha, data);
  assert.equal(report.models, 'ENABLED'); assert.equal(report.approximateDecisionTableItems, null); assert.deepEqual(data, before);
});
