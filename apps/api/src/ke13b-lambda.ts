import { createServer, type RequestListener } from 'node:http';
import { genericCandidates, createDynamoGroupRepository, createAwsDynamoDBRoomRepository } from '@deal-table/adapters';
import { KnownEnoughApplication, MODEL_FAILURE_STAGES, type ModelFailureDiagnostic } from '@deal-table/application';
import { createCognitoKnownEnoughApiHandler } from './http-core.ts';
import { createKnownEnoughModelRuntime } from './model-runtime.ts';
import { ScenarioService, readScenarioMembers, scenarioCandidates, type ScenarioMember } from './scenario-service.ts';
import type { ConverseTransport } from '@deal-table/adapters';
import { GroupDecisionService } from './group-decisions.ts';
import { GroupService } from './group-service.ts';

/** API Gateway HTTP API payload-format 2.0. Only fields needed by the reviewed HTTP handler are accepted. */
export interface HttpApiEvent {
  version?: unknown;
  rawPath?: unknown;
  rawQueryString?: unknown;
  headers?: unknown;
  body?: unknown;
  isBase64Encoded?: unknown;
  requestContext?: { http?: { method?: unknown } };
}
export interface HttpApiResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  isBase64Encoded: false;
}
export interface Ke13bConfig {
  tableName: string;
  region: string;
  userPoolId: string;
  participantClientId: string;
  displayClientId: string;
  allowedOrigin: string;
  groups?: { tableName: string; emailKey: string; cognitoDomain: string };
  models?: { members: ScenarioMember[]; provider: { mode: 'BEDROCK'; paidCallsApproved: boolean;
    invocationLoggingDisabled: boolean; retentionReviewed: boolean } | { mode: 'INJECTED'; transport: ConverseTransport } };
}
const MAX_GATEWAY_BODY_BYTES = 64 * 1024;
/** Reconstruct a strict allowlist even if a caller bypasses TypeScript. Never serialize the original object. */
export function logModelFailure(value: ModelFailureDiagnostic, write: (line: string) => void = console.info): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join('|') !== 'kind|stage'
    || !['ARCHITECT', 'OWNER', 'NEGOTIATION'].includes(value.kind)
    || !MODEL_FAILURE_STAGES.some(stage => stage === value.stage)) return;
  try { write(JSON.stringify({ event: 'ke14-model-failure', kind: value.kind, stage: value.stage })); }
  catch { /* Logging cannot change the request outcome. */ }
}
const RESPONSE_HEADERS = [
  'content-type', 'cache-control', 'access-control-allow-origin', 'access-control-allow-methods',
  'access-control-allow-headers', 'vary',
] as const;
function failure(statusCode: number): HttpApiResult {
  return { statusCode, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    body: JSON.stringify({ ok: false, requestId: 'invalid-request',
      error: { code: statusCode === 422 ? 'INVALID_COMMAND'
        : statusCode === 404 ? 'NOT_FOUND' : 'RETRYABLE_SERVER_ERROR', httpStatus: statusCode } }),
    isBase64Encoded: false };
}
export function readKe13bConfig(env: NodeJS.ProcessEnv = process.env): Ke13bConfig {
  const tableName = env.KE13B_TABLE_NAME?.trim() ?? '';
  const region = env.AWS_REGION?.trim() ?? '';
  const userPoolId = env.COGNITO_USER_POOL_ID?.trim() ?? '';
  const participantClientId = env.COGNITO_PARTICIPANT_CLIENT_ID?.trim() ?? '';
  const displayClientId = env.COGNITO_DISPLAY_CLIENT_ID?.trim() ?? '';
  const allowedOrigin = env.KE13B_ALLOWED_ORIGIN?.trim() ?? '';
  const parsedOrigin = URL.parse(allowedOrigin);
  if (!/^[A-Za-z0-9_.-]{3,255}$/.test(tableName) || !/^[a-z]{2}-[a-z]+-\d$/.test(region)
    || !userPoolId.startsWith(`${region}_`) || !participantClientId || !displayClientId
    || participantClientId === displayClientId || !parsedOrigin || parsedOrigin.protocol !== 'https:'
    || parsedOrigin.origin !== allowedOrigin || parsedOrigin.username || parsedOrigin.password)
    throw new Error('KE13B deployment configuration is incomplete or invalid');
  const config: Ke13bConfig = { tableName, region, userPoolId, participantClientId, displayClientId, allowedOrigin };
  // Disabled unless ALL explicit deployment acknowledgments and registered subjects are present.
  // These flags are a configuration guard, not human authorization or a privacy review.
  if (env.KE14_MODEL_MODE !== undefined && env.KE14_MODEL_MODE !== 'DISABLED') {
    if (env.KE14_MODEL_MODE !== 'BEDROCK' || env.KE14_PAID_CALLS_APPROVED !== 'true'
      || env.KE14_INVOCATION_LOGGING_DISABLED !== 'true' || env.KE14_RETENTION_REVIEWED !== 'true')
      throw new Error('KE14 model configuration is not approved');
    config.models = { members: env.NP_GROUPS_ENABLED === 'true' && !env.KE14_MEMBER_BINDINGS ? [] : readScenarioMembers(JSON.parse(env.KE14_MEMBER_BINDINGS ?? 'null')),
      provider: { mode: 'BEDROCK', paidCallsApproved: true, invocationLoggingDisabled: true, retentionReviewed: true } };
  }
  if (env.NP_GROUPS_ENABLED === 'true') {
    const domain = URL.parse(env.NP_COGNITO_DOMAIN ?? '');
    if (!env.NP_GROUP_TABLE_NAME || !/^[A-Za-z0-9_.-]{3,255}$/.test(env.NP_GROUP_TABLE_NAME)
      || !env.NP_GROUP_EMAIL_KEY || env.NP_GROUP_EMAIL_KEY.length < 32 || !domain
      || domain.protocol !== 'https:' || !domain.hostname.endsWith(`.auth.${region}.amazoncognito.com`)
      || domain.origin !== env.NP_COGNITO_DOMAIN) throw new Error('NP group configuration incomplete');
    config.groups = { tableName: env.NP_GROUP_TABLE_NAME, emailKey: env.NP_GROUP_EMAIL_KEY, cognitoDomain: domain.origin };
  }
  return config;
}
function eventHeaders(value: unknown): Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const allowed = ['authorization', 'origin', 'content-type', 'x-request-id'];
  const headers: Record<string, string> = {};
  for (const [key, item] of Object.entries(raw)) {
    const name = key.toLowerCase();
    if (allowed.includes(name) && typeof item === 'string' && !/[\r\n]/.test(item) && item.length <= 8192)
      headers[name] = item;
  }
  return headers;
}
function eventBody(event: HttpApiEvent): string | null {
  if (event.body === undefined || event.body === null) return null;
  if (typeof event.body !== 'string' || (event.isBase64Encoded !== undefined && typeof event.isBase64Encoded !== 'boolean'))
    throw new Error('invalid gateway body');
  if (event.body.length > MAX_GATEWAY_BODY_BYTES * 4) throw new RangeError('body too large');
  if (event.isBase64Encoded && (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(event.body)))
    throw new Error('invalid gateway body');
  const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : Buffer.from(event.body, 'utf8');
  if (body.byteLength > MAX_GATEWAY_BODY_BYTES) throw new RangeError('body too large');
  return body.toString('utf8');
}
/** Transport adapter keeps the existing Cognito verification and application request path intact. */
export async function invokeHttpApi(listener: RequestListener, event: HttpApiEvent): Promise<HttpApiResult> {
  if (event.version !== '2.0' || typeof event.rawPath !== 'string' || !event.rawPath.startsWith('/')
    || event.rawPath.length > 2048 || typeof event.requestContext?.http?.method !== 'string') return failure(503);
  if (!['GET', 'POST', 'OPTIONS'].includes(event.requestContext.http.method)) return failure(404);
  let body: string | null;
  try { body = eventBody(event); } catch { return failure(422); }
  const headers = eventHeaders(event.headers);
  const server = createServer(listener);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
    });
    const address = server.address();
    if (!address || typeof address === 'string') return failure(503);
    const response = await fetch(`http://127.0.0.1:${address.port}${event.rawPath}`, {
      method: event.requestContext.http.method,
      headers,
      ...(body && event.requestContext.http.method === 'POST' ? { body } : {}),
      redirect: 'error', signal: AbortSignal.timeout(25_000),
    });
    const resultHeaders: Record<string, string> = {};
    for (const header of RESPONSE_HEADERS) {
      const value = response.headers.get(header);
      if (value !== null) resultHeaders[header] = value;
    }
    return { statusCode: response.status, headers: resultHeaders, body: await response.text(), isBase64Encoded: false };
  } catch { return failure(503); }
  finally {
    if (server.listening) {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }
}
export function createKe13bLambdaHandler(config: Ke13bConfig): (event: HttpApiEvent) => Promise<HttpApiResult> {
  const repository = createAwsDynamoDBRoomRepository(config.tableName, config.region);
  const application = new KnownEnoughApplication({ repository,
    clock: { now: () => new Date().toISOString() }, ids: { next: () => crypto.randomUUID() } });
  const runtime = config.models ? createKnownEnoughModelRuntime({ application,
    clock: { now: () => new Date().toISOString() }, ids: { next: () => crypto.randomUUID() },
    provider: config.models.provider, publicCandidates: frame => (frame.decisionId.startsWith('groupdecision-') ? genericCandidates(frame) : scenarioCandidates(frame))
      .map(values => values.filter(item => frame.variables.some(variable => variable.id === item.variableId))),
    trustedCandidates: frame => frame.decisionId.startsWith('groupdecision-') ? genericCandidates(frame) : scenarioCandidates(frame), diagnostic: logModelFailure }) : undefined;
  const scenarios = runtime && config.models?.members.length ? new ScenarioService({ application: runtime.application, architect: runtime.architect,
    members: config.models.members, clock: { now: () => new Date().toISOString() }, isEnabled: runtime.isEnabled,
    diagnostic: logModelFailure }) : undefined;
  const groups = config.groups ? new GroupService(createDynamoGroupRepository(config.groups.tableName, config.region), {
    emailKey: config.groups.emailKey, now: () => Date.now() }) : undefined;
  const groupDecisions = groups && runtime ? new GroupDecisionService({ groups, application: runtime.application,
    architect: runtime.architect, now: () => Date.now(), isEnabled: runtime.isEnabled }) : undefined;
  const listener = createCognitoKnownEnoughApiHandler({ application,
    ...(groupDecisions ? { groupDecisions } : {}),
    ...(groups ? { groups, registrationProfile: async (authorization: string | string[] | undefined) => {
      if (typeof authorization !== 'string') throw new Error('Unauthenticated');
      const response = await fetch(`${config.groups!.cognitoDomain}/oauth2/userInfo`, {
        headers: { authorization }, redirect: 'error', signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error('Profile unavailable');
      const profile = await response.json() as Record<string, unknown>;
      if (typeof profile.sub !== 'string' || typeof profile.email !== 'string') throw new Error('Invalid profile');
      return { subject: profile.sub, email: profile.email, verified: profile.email_verified === true || profile.email_verified === 'true' };
    } } : {}), userPoolId: config.userPoolId,
    participantClientId: config.participantClientId, displayClientId: config.displayClientId,
    allowedOrigins: [config.allowedOrigin], ...(runtime ? {
      ownerConversation: runtime.ownerConversation, negotiator: runtime.negotiator } : {}),
    ...(scenarios ? { scenarios } : {}) });
  return event => invokeHttpApi(listener, event);
}
let liveHandler: ((event: HttpApiEvent) => Promise<HttpApiResult>) | null = null;
/** AWS Lambda handler. Configuration is immutable for a warm execution environment. */
export async function handler(event: HttpApiEvent): Promise<HttpApiResult> {
  try { liveHandler ??= createKe13bLambdaHandler(readKe13bConfig()); return await liveHandler(event); }
  catch { return failure(503); }
}
