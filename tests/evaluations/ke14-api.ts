import { createServer } from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import { SimpleJwksCache, type Jwk } from 'aws-jwt-verify/jwk';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { createCognitoKnownEnoughApiHandlerWithJwksCache } from '../../apps/api/src/http-core.ts';
import { fixedScenarioHarness } from './ke14-fixed.ts';

/** Real HTTP/Cognito verifier with locally signed cached fixture JWKS. No cloud login. */
export async function signedScenarioApi() {
  const h = await fixedScenarioHarness();
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pool = 'us-east-1_ke14Fixture';
  const parsedPool = CognitoJwtVerifier.parseUserPoolId(pool);
  const cache = new SimpleJwksCache();
  cache.addJwks(parsedPool.jwksUri, { keys: [{ ...pair.publicKey.export({ format: 'jwk' }), kid: 'ke14', use: 'sig', alg: 'RS256' } as unknown as Jwk] });
  const bearer = (person: string, displayRoom?: string) => {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'ke14' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: `subject-${person}`, iss: parsedPool.issuer, token_use: 'access',
      client_id: displayRoom ? 'display-client' : 'participant-client', iat: now, exp: now + 900,
      ...(displayRoom ? { 'cognito:groups': [`deal-table-display-${displayRoom}`] } : {}) })).toString('base64url');
    const input = `${header}.${payload}`;
    return `${input}.${sign('RSA-SHA256', Buffer.from(input), pair.privateKey).toString('base64url')}`;
  };
  const server = createServer(createCognitoKnownEnoughApiHandlerWithJwksCache({ application: h.application,
    scenarios: h.scenarios, ownerConversation: h.runtime.ownerConversation, negotiator: h.runtime.negotiator,
    userPoolId: pool, participantClientId: 'participant-client', displayClientId: 'display-client', allowedOrigins: ['https://api.example.test', 'http://127.0.0.1:5179'] }, cache));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test API address');
  const base = `http://127.0.0.1:${address.port}`;
  const call = (person: string, path: string, body?: unknown, displayRoom?: string) => fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${bearer(person, displayRoom)}`,
      'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { ...h, base, bearer, call, close: async () => { await h.runtime.stop(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
