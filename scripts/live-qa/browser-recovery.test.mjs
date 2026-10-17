import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifiedSessionProfile, captureDelayedResponse } from './browser-recovery.mjs';
const domain = 'https://synthetic.auth.us-east-1.amazoncognito.com';
const session = { accessToken: 'PRIVATE_SYNTHETIC_TOKEN', method: 'SRP', kind: 'participant' };
const user = { Username: 'synthetic', UserAttributes: [{ Name: 'sub', Value: 'owner-one' },
  { Name: 'email', Value: 'synthetic@example.invalid' }, { Name: 'email_verified', Value: 'true' }] };
test('SRP looks up its own verified identity through token-authorized GetUser', async () => {
  const profile = await verifiedSessionProfile(session, { domain, username: 'synthetic', fetcher: async (url, init) => {
    assert.equal(url, 'https://cognito-idp.us-east-1.amazonaws.com/'); assert.equal(init.method, 'POST');
    assert.equal(init.headers['x-amz-target'], 'AWSCognitoIdentityProviderService.GetUser');
    assert.equal(JSON.parse(init.body).AccessToken, session.accessToken);
    return globalThis.Response.json(user);
  } });
  assert.deepEqual(profile, { subject: 'owner-one', email: 'synthetic@example.invalid', verified: true });
});
test('rejects provider failure, a different username, duplicate attributes and unverified email', async () => {
  for (const result of [globalThis.Response.json({}, { status: 401 }), globalThis.Response.json({ ...user, Username: 'other' }),
    globalThis.Response.json({ ...user, UserAttributes: [...user.UserAttributes, user.UserAttributes[0]] }),
    globalThis.Response.json({ ...user, UserAttributes: user.UserAttributes.slice(0,2) })]) {
    await assert.rejects(verifiedSessionProfile(session, { domain, username: 'synthetic', fetcher: async () => result }));
  }
});
test('PKCE uses its own configured hosted user-info endpoint', async () => {
  const profile = await verifiedSessionProfile({ ...session, method: 'PKCE' }, { domain, username: 'synthetic', fetcher: async (url, init) => {
    assert.equal(url, domain + '/oauth2/userInfo'); assert.equal(init.headers.authorization, 'Bearer ' + session.accessToken);
    return globalThis.Response.json({ sub: 'owner-one', username: 'synthetic', email: 'synthetic@example.invalid', email_verified: true });
  } });
  assert.equal(profile.verified, true);
});
test('captures the APIResponse headers and releases exactly the original response once', async () => {
  let fetches = 0, deliveries = 0;
  const response = { status: () => 200, headers: () => ({ 'x-request-id': 'opaque' }) };
  const held = await captureDelayedResponse({ fetch: async () => { fetches++; return response; },
    fulfill: async input => { deliveries++; assert.equal(input.response, response); } });
  assert.equal(held.status, 200); assert.equal(held.headers['x-request-id'], 'opaque'); assert.equal(deliveries, 0);
  await held.release(); await held.release(); assert.equal(fetches, 1); assert.equal(deliveries, 1);
});
test('a local header helper error releases the received response without repeating the server request', async () => {
  let fetches = 0, deliveries = 0;
  const response = { status: () => 200, headers: () => { throw new Error('synthetic'); } };
  await assert.rejects(captureDelayedResponse({ fetch: async () => { fetches++; return response; },
    fulfill: async input => { deliveries++; assert.equal(input.response, response); } }));
  assert.equal(fetches, 1); assert.equal(deliveries, 1);
});
