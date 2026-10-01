import { createServer } from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import { SimpleJwksCache, type Jwk } from 'aws-jwt-verify/jwk';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { describe, expect, test, vi } from 'vitest';
import { KnownEnough as KE } from '@deal-table/contracts';
import { createCognitoKnownEnoughApiHandlerWithJwksCache } from '../../apps/api/src/http-core.ts';
import { operateAccount } from '../../apps/api/src/group-operator.ts';
import { npApi } from '../evaluations/np-api.ts';
import { npTransport } from '../evaluations/np-model.ts';
import { freshGroup } from '../evaluations/np-lifecycle.ts';

async function setup() {
  const transport = npTransport();
  const sent = vi.spyOn(transport, 'send');
  const api = await npApi(transport);
  try {
    const h = await freshGroup(api);
    await h.ready();
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pool = 'us-east-1_localDisplay';
    const parsed = CognitoJwtVerifier.parseUserPoolId(pool);
    const cache = new SimpleJwksCache();
    cache.addJwks(parsed.jwksUri, { keys: [{
      ...pair.publicKey.export({ format: 'jwk' }), kid: 'local-display', use: 'sig', alg: 'RS256',
    } as unknown as Jwk] });
    const server = createServer(createCognitoKnownEnoughApiHandlerWithJwksCache({
      application: api.application, groups: api.groups, groupDecisions: api.groupDecisions,
      ownerConversation: api.runtime.ownerConversation, negotiator: api.runtime.negotiator,
      userPoolId: pool, participantClientId: 'participant-client', displayClientId: 'display-client',
      allowedOrigins: ['https://api.example.test'],
    }, cache));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('LOCAL_ADDRESS_MISSING');
    const base = `http://127.0.0.1:${address.port}`;
    const token = (who: string, roomId = h.decisionId) => {
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'local-display' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({
        sub: who, iss: parsed.issuer, token_use: 'access', client_id: 'display-client',
        'cognito:groups': ['deal-table-display-' + roomId], exp: Math.floor(Date.now() / 1000) + 900,
      })).toString('base64url');
      return `${header}.${payload}.${sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), pair.privateKey).toString('base64url')}`;
    };
    const call = (path: string, body?: unknown, bearer = token('shared-display')) => fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: 'Bearer ' + bearer, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const close = async () => {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await api.close();
    };
    return { api, h, sent, token, call, close };
  } catch (error) {
    await api.close();
    throw error;
  }
}

describe('LIVE04 preinstallation display repair; signed local identity and fixture model only', () => {
  test('verified bound display reads strict public projection but cannot read owners, write or invoke models', async () => {
    const s = await setup();
    try {
      const response = await s.call(`/decisions/${s.h.decisionId}/public`);
      expect(response.status).toBe(200);
      const publicSnapshot = KE.PublicDecisionSnapshot.parse(await response.json());
      expect(publicSnapshot.frame.decisionId).toBe(s.h.decisionId);
      expect(JSON.stringify(publicSnapshot)).not.toMatch(/NP_PRIVATE_RAW_CANARY|confirmedConstraints|permissionId|constraintId|requestIdentity/);
      const before = s.sent.mock.calls.length;
      const command = await s.h.envelope('iris', 'CONFIRM_FRAME', { frameVersion: publicSnapshot.frame.frameVersion });
      const deniedRoutes = [
        // Owner access conceals the resource with NOT_FOUND; writes are explicitly FORBIDDEN.
        [`/decisions/${s.h.decisionId}/me`, undefined, 404],
        [`/decisions/${s.h.decisionId}/commands`, command, 403],
        [`/decisions/${s.h.decisionId}/reasoning`, { requestId: 'display' }, 403],
        [`/decisions/${s.h.decisionId}/owner-conversation/draft`, { requestId: 'display', messages: [] }, 403],
        ['/groups', undefined, 403],
        [`/groups/${s.h.groupId}/drafts`, { objective: 'Display must not create', idempotencyKey: 'display' }, 403],
      ] as const;
      for (const [path, body, status] of deniedRoutes) {
        const denied = await s.call(path, body);
        expect(denied.status, path).toBe(status);
        expect(await denied.text()).not.toContain('NP_PRIVATE_RAW_CANARY');
      }
      expect(s.sent.mock.calls.length).toBe(before);
    } finally { await s.close(); }
  });

  test('bound display cannot access another decision and current group roster still freezes public reads', async () => {
    const s = await setup();
    try {
      expect((await s.call(`/decisions/${s.h.decisionId}/public`, undefined, s.token('shared-display', 'another-room'))).status).toBe(403);
      const principal = { kind: 'participant', subject: 'iris' } as const;
      const group = (await s.api.groups.list(principal))[0]!;
      const vin = group.members.find(m => m.displayName === 'vin')!;
      await s.api.groups.remove(principal, s.h.groupId, { memberId: vin.id, version: group.version });
      expect((await s.call(`/decisions/${s.h.decisionId}/public`)).status).toBe(409);
      const review = await s.api.groupDecisions.reviewRoster(principal, s.h.groupId, s.h.decisionId);
      await s.api.groupDecisions.reviseRoster(principal, s.h.groupId, s.h.decisionId, {
        controlVersion: review.controlVersion, groupVersion: review.groupVersion,
      });
      expect((await s.call(`/decisions/${s.h.decisionId}/public`)).status).toBe(200);
    } finally { await s.close(); }
  });

  test('a recorded pending or disabled account cannot bypass admission through the display client', async () => {
    const s = await setup();
    try {
      await s.api.groups.register({ kind: 'participant', subject: 'shared-display' },
        { email: 'shared-display@example.invalid', verified: true }, { displayName: 'Display' });
      expect((await s.call(`/decisions/${s.h.decisionId}/public`)).status).toBe(403);
      await operateAccount(s.api.repository, 'approve', 'shared-display', 1);
      expect((await s.call(`/decisions/${s.h.decisionId}/public`)).status).toBe(200);
      await operateAccount(s.api.repository, 'disable', 'shared-display', 2);
      expect((await s.call(`/decisions/${s.h.decisionId}/public`)).status).toBe(403);
    } finally { await s.close(); }
  });
});
