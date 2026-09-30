import { generateKeyPairSync, sign as signBytes } from 'node:crypto';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { SimpleJwksCache, type Jwk } from 'aws-jwt-verify/jwk';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryRoomRepository } from '@deal-table/adapters';
import { KnownEnoughApplication, type ModelFailureDiagnostic } from '@deal-table/application';
import { createCognitoKnownEnoughApiHandlerWithJwksCache } from './http-core.ts';
import { invokeHttpApi, logModelFailure, readKe13bConfig, type HttpApiEvent } from './ke13b-lambda.ts';
import { provisionStageDecision } from './ke13b-provision.ts';

const pool = 'us-east-1_testPool';
const participantClient = 'participant-client';
const displayClient = 'display-client';
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const keyId = 'ke13b-offline-key';
const cache = new SimpleJwksCache();
cache.addJwks(CognitoJwtVerifier.parseUserPoolId(pool).jwksUri, { keys: [{
  ...pair.publicKey.export({ format: 'jwk' }), kid: keyId, use: 'sig', alg: 'RS256',
} as unknown as Jwk] });
const subjects = { maya: 'subject-maya', leo: 'subject-leo', nina: 'subject-nina', ana: 'subject-ana', raul: 'subject-raul' };
function token(subject: string, client = participantClient, groups?: string[], tokenUse = 'access'): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: keyId, typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: subject, iss: CognitoJwtVerifier.parseUserPoolId(pool).issuer,
    token_use: tokenUse, client_id: client, iat: now, exp: now + 600, auth_time: now, jti: 'ke13b-jti',
    ...(groups ? { 'cognito:groups': groups } : {}) })).toString('base64url');
  const input = `${header}.${payload}`;
  return `${input}.${signBytes('RSA-SHA256', Buffer.from(input), pair.privateKey).toString('base64url')}`;
}
function event(method: string, path: string, bearer?: string, body?: unknown, extra: Record<string, string> = {}): HttpApiEvent {
  return { version: '2.0', rawPath: path, requestContext: { http: { method } },
    headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...extra },
    ...(body ? { body: JSON.stringify(body), isBase64Encoded: false } : {}) };
}
async function setup() {
  const repository = new InMemoryRoomRepository();
  const app = new KnownEnoughApplication({ repository,
    clock: { now: () => '2026-10-01T12:00:00.000Z' }, ids: { next: () => crypto.randomUUID() } });
  await provisionStageDecision(app, subjects);
  const listener = createCognitoKnownEnoughApiHandlerWithJwksCache({ application: app,
    userPoolId: pool, participantClientId: participantClient, displayClientId: displayClient,
    allowedOrigins: ['https://app.example.test'] }, cache);
  return (request: HttpApiEvent) => invokeHttpApi(listener, request);
}

describe('KE13B signed HTTP API composition', () => {
  it('logs only declared model failure stages; private extras/errors/identities never reach the sink', () => {
    const write = vi.fn();
    logModelFailure({ kind: 'ARCHITECT', stage: 'ARCHITECT_DEFINITION' }, write);
    expect(write.mock.calls).toEqual([[JSON.stringify({ event: 'ke14-model-failure', kind: 'ARCHITECT', stage: 'ARCHITECT_DEFINITION' })]]);
    for (const invalid of [null, [], { kind: 'ARCHITECT', stage: 'PRIVATE_OUTPUT' },
      { kind: 'PRIVATE_SUBJECT', stage: 'PROVIDER' },
      { kind: 'ARCHITECT', stage: 'PROVIDER', error: 'Bearer PRIVATE_TOKEN', subject: 'PRIVATE_SUBJECT' }])
      logModelFailure(invalid as ModelFailureDiagnostic, write);
    expect(write).toHaveBeenCalledTimes(1);
    expect(() => logModelFailure({ kind: 'ARCHITECT', stage: 'PROVIDER' }, () => { throw Error('PRIVATE_SINK'); })).not.toThrow();
  });
  it('rejects missing, mock-header, wrong-client and wrong-token-use identities', async () => {
    const invoke = await setup();
    for (const request of [
      event('GET', '/decisions/christmas-decision/me'),
      event('GET', '/decisions/christmas-decision/me', undefined, undefined, { 'x-deal-table-test-identity': 'NON_PRODUCTION maya' }),
      event('GET', '/decisions/christmas-decision/me', token(subjects.maya, 'untrusted-client')),
      event('GET', '/decisions/christmas-decision/me', token(subjects.maya, participantClient, undefined, 'id')),
    ]) expect((await invoke(request)).statusCode).toBe(401);
  });

  it('binds organizer, pending participant and display to their own scopes across invitations', async () => {
    const invoke = await setup();
    const maya = token(subjects.maya);
    const leo = token(subjects.leo);
    const display = token('display-subject', displayClient, ['deal-table-display-christmas-decision']);
    const owner = await invoke(event('GET', '/decisions/christmas-decision/me', maya));
    expect(owner.statusCode).toBe(200);
    expect(JSON.parse(owner.body).ownerParticipantId).toBe('maya');
    expect((await invoke(event('GET', '/decisions/christmas-decision/me', leo))).statusCode).toBe(404);
    const publicView = await invoke(event('GET', '/decisions/christmas-decision/public', display));
    expect(publicView.statusCode).toBe(200);
    expect(publicView.body).not.toContain('confirmedConstraints');
    expect((await invoke(event('GET', '/decisions/christmas-decision/me', display))).statusCode).toBe(404);
    expect((await invoke(event('POST', '/decisions/christmas-decision/commands', display, {
      type: 'CONFIRM_FRAME', requestId: 'display-command', decisionId: 'christmas-decision',
    }, { 'content-type': 'application/json' }))).statusCode).toBe(403);
    const invite = await invoke(event('POST', '/decisions/christmas-decision/invitations', maya,
      { requestId: 'issue-leo', participantId: 'leo' }, { 'content-type': 'application/json' }));
    expect(invite.statusCode).toBe(201);
    const invitationToken = JSON.parse(invite.body).token as string;
    expect(invitationToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect((await invoke(event('POST', '/decisions/christmas-decision/invitations/redeem', token('outsider'),
      { requestId: 'wrong-redeem', token: invitationToken }, { 'content-type': 'application/json' }))).statusCode).toBe(404);
    const redeemed = await invoke(event('POST', '/decisions/christmas-decision/invitations/redeem', leo,
      { requestId: 'leo-redeem', token: invitationToken }, { 'content-type': 'application/json' }));
    expect(redeemed.statusCode).toBe(200);
    const leoOwner = await invoke(event('GET', '/decisions/christmas-decision/me', leo));
    expect(leoOwner.statusCode).toBe(200);
    expect(JSON.parse(leoOwner.body).ownerParticipantId).toBe('leo');
    expect(leoOwner.body).not.toContain('subject-maya');
  });

  it('forwards only safe headers and exact CORS without exposing test identity', async () => {
    const invoke = await setup();
    const request = event('OPTIONS', '/decisions/christmas-decision/public', undefined, undefined,
      { origin: 'https://app.example.test', 'x-deal-table-test-identity': 'NON_PRODUCTION maya' });
    const response = await invoke(request);
    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('https://app.example.test');
    expect(response.headers['access-control-allow-headers']).not.toContain('X-Deal-Table-Test-Identity');
    const bad = await invoke({ ...request, headers: { origin: 'https://evil.example.test' } });
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects malformed gateway inputs before forwarding and requires exact HTTPS deployment config', async () => {
    const invoke = await setup();
    expect((await invoke({ version: '1.0' })).statusCode).toBe(503);
    expect((await invoke({ ...event('POST', '/decisions/christmas-decision/commands'), body: '!bad', isBase64Encoded: true })).statusCode).toBe(422);
    expect((await invoke(event('DELETE', '/decisions/christmas-decision/public'))).statusCode).toBe(404);
    expect((await invoke({ ...event('POST', '/decisions/christmas-decision/commands'),
      body: 'x'.repeat(70_000) })).statusCode).toBe(422);
    expect(() => readKe13bConfig({})).toThrow();
    expect(readKe13bConfig({ KE13B_TABLE_NAME: 'KnownEnoughStage', AWS_REGION: 'us-east-1',
      COGNITO_USER_POOL_ID: pool, COGNITO_PARTICIPANT_CLIENT_ID: participantClient,
      COGNITO_DISPLAY_CLIENT_ID: displayClient, KE13B_ALLOWED_ORIGIN: 'https://app.example.test' }).allowedOrigin)
      .toBe('https://app.example.test');
    expect(() => readKe13bConfig({ KE13B_TABLE_NAME: 'KnownEnoughStage', AWS_REGION: 'us-east-1',
      COGNITO_USER_POOL_ID: pool, COGNITO_PARTICIPANT_CLIENT_ID: participantClient,
      COGNITO_DISPLAY_CLIENT_ID: displayClient, KE13B_ALLOWED_ORIGIN: 'http://app.example.test' })).toThrow();
  });
});
