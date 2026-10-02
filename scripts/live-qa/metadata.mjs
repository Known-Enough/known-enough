import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { aws } from './aws.mjs';
const apiId = 'u94iyvt6p9';
export const EXPECTED_ROUTING = {
  authorizerId: 'vnsmtt', integrationId: 'odmtgut',
  issuer: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_V9OMjd0zx',
  audiences: ['3accf7paalvon2m8ue8okfi853', '481ru24906sv26f30i569gq8g0'],
  functionArn: 'arn:aws:lambda:us-east-1:092954139775:function:known-enough-stage-api'
};
export const REQUIRED_ROUTES = ['GET /account', 'POST /account/register', 'GET /groups', 'POST /groups', 'POST /groups/accept',
  'POST /groups/{groupId}/invitations', 'POST /groups/{groupId}/remove', 'POST /groups/{groupId}/drafts',
  'GET /groups/{groupId}/drafts/{draftId}', 'POST /groups/{groupId}/drafts/{draftId}', 'POST /groups/{groupId}/drafts/{draftId}/create',
  'GET /groups/{groupId}/decisions/{decisionId}/review', 'POST /groups/{groupId}/decisions/{decisionId}/revise',
  'POST /decisions', 'ANY /decisions/{proxy+}'];
const OPTIONS_ROUTES = ['OPTIONS /account', 'OPTIONS /account/register', 'OPTIONS /groups', 'OPTIONS /groups/{proxy+}', 'OPTIONS /decisions', 'OPTIONS /decisions/{proxy+}'];
const exact = (actual, expected) => Array.isArray(actual) && actual.length === expected.length && [...actual].sort().join() === [...expected].sort().join();
/** Fixed independently observed staging identities; never copy expected identity from live routes. */
export function routingMatches(routing) {
  if (routing?.apiId !== apiId) return false;
  const e = EXPECTED_ROUTING;
  const authorizer = routing.authorizers?.find(item => item.AuthorizerId === e.authorizerId);
  const integration = routing.integrations?.find(item => item.IntegrationId === e.integrationId);
  if (authorizer?.AuthorizerType !== 'JWT' || !exact(authorizer.IdentitySource, ['$request.header.Authorization'])
    || authorizer.JwtConfiguration?.Issuer !== e.issuer || !exact(authorizer.JwtConfiguration?.Audience, e.audiences)
    || integration?.IntegrationType !== 'AWS_PROXY' || integration.IntegrationMethod !== 'POST'
    || integration.PayloadFormatVersion !== '2.0' || !['INTERNET', undefined].includes(integration.ConnectionType)
    || ![e.functionArn, 'arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/' + e.functionArn + '/invocations'].includes(integration.IntegrationUri)) return false;
  const routes = Array.isArray(routing.routes) ? routing.routes : [];
  return [...REQUIRED_ROUTES, ...OPTIONS_ROUTES].every(key => {
    const found = routes.filter(item => item.RouteKey === key);
    const route = found[0]; const options = key.startsWith('OPTIONS ');
    return found.length === 1 && route.Target === 'integrations/' + e.integrationId
      && route.AuthorizationType === (options ? 'NONE' : 'JWT')
      && (options ? !route.AuthorizerId : route.AuthorizerId === e.authorizerId);
  });
}
export function collectRouting(command = aws) {
  return { apiId,
    routes: command('apigatewayv2', 'get-routes', {ApiId: apiId}).Items,
    authorizers: command('apigatewayv2', 'get-authorizers', {ApiId: apiId}).Items,
    integrations: command('apigatewayv2', 'get-integrations', {ApiId: apiId}).Items };
}
export function compareMetadata(receipt,observed,environment){if(observed.collection?.status!=='passed'||observed.lambda?.codeSha256Hex!==receipt.primary?.backendSha256||observed.lambda?.state!=='Active'||observed.lambda?.lastUpdateStatus!=='Successful'||observed.lambda?.modelMode!=='DISABLED'||String(observed.lambda?.paidCallsApproved)!=='false'||observed.lambda?.runtimeInlineBedrockGrant===true||environment?.NP_GROUPS_ENABLED!=='true'||environment.NP_GROUP_TABLE_NAME!=='KnownEnoughGroupsStage'||!environment.NP_GROUP_EMAIL_KEY||environment.NP_GROUP_EMAIL_KEY.length<32||observed.tables?.group?.TableStatus!=='ACTIVE'||observed.cognito?.pool?.allowAdminCreateUserOnly!==false||!observed.cognito?.pool?.autoVerifiedAttributes?.includes('email')||!observed.cognito?.participantClient?.allowedOAuthScopes?.includes('email'))return {status:'BLOCKED_OR_FAILED',primary:'BLOCKED',differences:['primary model disabled; QA real model has lease/budget','separate pools/clients/tables/API/hosting identifiers']};if(!routingMatches(observed.routing))return {status:'BLOCKED_OR_FAILED',primary:'BLOCKED',differences:[]};return {status:'PASS',primary:'PASS',sourceCommit:receipt.sourceCommit,backendSha256:receipt.primary.backendSha256,differences:['primary model disabled; QA real model has lease/budget','separate pools/clients/tables/API/hosting identifiers']};}
if(process.argv[1]===fileURLToPath(import.meta.url)){try{const receipt=JSON.parse(readFileSync(process.argv[2],'utf8'));const observed=JSON.parse(readFileSync(process.argv[3],'utf8'));observed.routing=collectRouting();const environment=aws('lambda','get-function-configuration',{FunctionName:'known-enough-stage-api'}).Environment?.Variables;const report=compareMetadata(receipt,observed,environment);writeFileSync(process.argv[4],JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({status:report.status,primary:report.primary}));if(report.status!=='PASS')process.exitCode=1;}catch{writeFileSync(process.argv[4],JSON.stringify({status:'BLOCKED_OR_FAILED',primary:'BLOCKED'})+'\n',{mode:0o600});console.error('PRIMARY_METADATA_BLOCKED');process.exitCode=1;}}
