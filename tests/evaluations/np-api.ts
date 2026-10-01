import { createServer } from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import { SimpleJwksCache, type Jwk } from 'aws-jwt-verify/jwk';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { KnownEnoughApplication } from '@deal-table/application';
import { InMemoryRoomRepository } from '@deal-table/adapters';
import { MemoryGroupRepository } from '@deal-table/adapters';
import { createCognitoKnownEnoughApiHandlerWithJwksCache } from '../../apps/api/src/http-core.ts';
import { GroupService } from '../../apps/api/src/group-service.ts';
import { operateAccount } from '../../apps/api/src/group-operator.ts';
import { createKnownEnoughModelRuntime } from '../../apps/api/src/model-runtime.ts';
import { GroupDecisionService } from '../../apps/api/src/group-decisions.ts';
import { genericCandidates, type ConverseTransport } from '@deal-table/adapters';
import { npTransport } from './np-model.ts';
/** Offline signed tokens, local HTTP and synthetic userInfo port; no real signup or cloud operations. */
export async function npApi(transport: ConverseTransport = npTransport()) {
  const repository = new MemoryGroupRepository();
  const groups = new GroupService(repository, { emailKey: 'synthetic-np-test-key-123456789012345', now: () => Date.now() });
  let sequence = 0;
  const decisionRepository = new InMemoryRoomRepository();
  const application = new KnownEnoughApplication({ repository: decisionRepository,
    clock: { now: () => new Date().toISOString() }, ids: { next: () => `np-${++sequence}` } });
  const runtime = createKnownEnoughModelRuntime({ application, clock: { now: () => new Date().toISOString() },
    ids: { next: () => `np-runtime-${++sequence}` }, provider: { mode: 'INJECTED', transport }, publicCandidates: genericCandidates });
  const groupDecisions = new GroupDecisionService({ groups, application: runtime.application, architect: runtime.architect, now: () => Date.now(), isEnabled: runtime.isEnabled });
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 }); const pool = 'us-east-1_npFixture';
  const parsed = CognitoJwtVerifier.parseUserPoolId(pool); const cache = new SimpleJwksCache();
  cache.addJwks(parsed.jwksUri, { keys: [{ ...pair.publicKey.export({ format: 'jwk' }), kid: 'np', use: 'sig', alg: 'RS256' } as unknown as Jwk] });
  const bearer = (subject: string, options: { expired?: boolean; display?: boolean; decisionId?: string } = {}) => {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'np' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: subject, iss: parsed.issuer, token_use: 'access', client_id: options.display ? 'display-client' : 'participant-client', ...(options.decisionId ? { 'custom:decision_id': options.decisionId } : {}), exp: Math.floor(Date.now() / 1000) + (options.expired ? -60 : 900) })).toString('base64url');
    return `${header}.${payload}.${sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), pair.privateKey).toString('base64url')}`;
  };
  const server = createServer(createCognitoKnownEnoughApiHandlerWithJwksCache({ application, groups, groupDecisions, ownerConversation: runtime.ownerConversation, negotiator: runtime.negotiator,
    registrationProfile: async authorization => {
      const value = JSON.parse(Buffer.from((authorization as string).split('.')[1]!, 'base64url').toString());
      return { subject: value.sub, email: `${value.sub}@example.invalid`, verified: value.sub !== 'unverified' };
    }, userPoolId: pool, participantClientId: 'participant-client', displayClientId: 'display-client', allowedOrigins: ['https://api.example.test'] }, cache));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing address');
  const base = `http://127.0.0.1:${address.port}`;
  const call = (who: string, path: string, body?: unknown) => fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${bearer(who)}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { base, bearer, call, groups, repository, decisionRepository, application, groupDecisions, runtime,
    approve: (who: string, version = 1) => operateAccount(repository, 'approve', who, version),
    disable: (who: string, version = 2) => operateAccount(repository, 'disable', who, version),
    close: async () => { await runtime.stop(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
