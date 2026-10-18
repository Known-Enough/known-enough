import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifiedSessionProfile, captureDelayedResponse, assertDecisionTarget, checkpointDecisionWrite, writeAcknowledgementDisposition } from './browser-recovery.mjs';
const domain = 'https://synthetic.auth.us-east-1.amazoncognito.com';
const session = { accessToken: 'PRIVATE_SYNTHETIC_TOKEN', method: 'SRP', kind: 'participant' };
const user = { Username: 'synthetic', UserAttributes: [{ Name: 'sub', Value: 'owner-one' },
  { Name: 'email', Value: 'synthetic@example.invalid' }, { Name: 'email_verified', Value: 'true' }] };
test('refuses a navigation guard leaving the old route or an old loaded decision', async () => {
  const target = { base: 'https://example.invalid/', groupId: 'group', decisionId: 'new' };
  const page = (url, id) => ({ url: () => url, locator: () => ({ getAttribute: async () => id }) });
  await assert.rejects(assertDecisionTarget(page('https://example.invalid/?group=group&decision=old', 'old'), target));
  await assert.rejects(assertDecisionTarget(page('https://example.invalid/?group=group&decision=new', 'old'), target));
  await assert.doesNotReject(assertDecisionTarget(page('https://example.invalid/?group=group&decision=new', 'new'), target));
});
test('persists exact command bytes before network submission and leaves lost acknowledgements unknown', async () => {
  const order = [], body = JSON.stringify({ command: { type: 'SAVE', privateInput: 'private-canary' }, idempotencyKey: 'same-key' });
  const request = { url: () => 'https://api.invalid/decisions/owned/commands', method: () => 'POST', postData: () => body };
  const route = { request: () => request, continue: async () => { order.push('submit'); } };
  const captured = await checkpointDecisionWrite(route, { apiOrigin: 'https://api.invalid', decisionId: 'owned', persist: async checkpoint => {
    assert.equal(checkpoint.body, body); assert.equal(checkpoint.disposition, 'UNKNOWN'); order.push('persist');
  } });
  assert.deepEqual(order, ['persist', 'submit']); assert.equal(captured.disposition, 'UNKNOWN');
  await assert.rejects(checkpointDecisionWrite(route, { apiOrigin: 'https://api.invalid', decisionId: 'other', persist: async () => assert.fail() }));
  await assert.rejects(checkpointDecisionWrite(route, { apiOrigin: 'https://api.invalid', decisionId: 'owned', persist: async () => { throw Error('disk-full'); } }));
  assert.deepEqual(order, ['persist', 'submit']);
});
test('a service error or timeout leaves a checkpoint unknown while explicit stale rejection remains rejected', () => {
  for (const status of [null, undefined, 0, 302, 408, 500, 503, 504]) assert.equal(writeAcknowledgementDisposition(status), 'UNKNOWN');
  for (const status of [400, 401, 403, 404, 409, 422, 429]) assert.equal(writeAcknowledgementDisposition(status), 'REJECTED');
  for (const status of [200, 201, 204]) assert.equal(writeAcknowledgementDisposition(status), 'ACKNOWLEDGED');
});
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
