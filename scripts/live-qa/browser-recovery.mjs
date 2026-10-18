/** Synthetic browser-run helpers. Returned identities/responses stay private to the runner. */
export async function assertDecisionTarget(page, { base, groupId, decisionId }) {
  const actual = URL.parse(page.url()), expected = URL.parse(base);
  if (!actual || !expected || actual.origin !== expected.origin || actual.pathname !== expected.pathname
    || actual.searchParams.get('group') !== groupId || actual.searchParams.get('decision') !== decisionId
    || actual.hash || await page.locator('dialog.ke-open-decision-dialog[open]').getAttribute('data-decision-id') !== decisionId) {
    throw new Error('DECISION_ROUTE_NOT_CONFIRMED');
  }
}

/** Persist the exact command and idempotency key before allowing a write onto the network.
 * The checkpoint is private. A missing acknowledgement remains UNKNOWN; callers must reconcile it.
 */
export async function checkpointDecisionWrite(route, { apiOrigin, decisionId, persist }) {
  const request = route.request(), url = URL.parse(request.url());
  if (!url || url.origin !== apiOrigin || url.pathname !== `/decisions/${decisionId}/commands`
    || url.search || request.method() !== 'POST') throw new Error('DECISION_WRITE_TARGET_MISMATCH');
  const body = request.postData();
  if (typeof body !== 'string' || Buffer.byteLength(body) > 262144) throw new Error('DECISION_WRITE_BODY_INVALID');
  JSON.parse(body);
  const checkpoint = { url: url.href, method: 'POST', body, submittedAt: new Date().toISOString(), disposition: 'UNKNOWN' };
  await persist(checkpoint);
  await route.continue();
  return checkpoint;
}

export async function verifiedSessionProfile(session, { domain, username, fetcher = globalThis.fetch }) {
  if (!session || typeof session.accessToken !== 'string' || !session.accessToken
    || session.kind !== 'participant' || typeof username !== 'string' || !username) throw new Error('PROFILE_SESSION_INVALID');
  const direct = session.method === 'SRP';
  const hosted = URL.parse(domain);
  if (!hosted || hosted.protocol !== 'https:' || hosted.username || hosted.password || hosted.port
    || hosted.pathname !== '/' || hosted.search || hosted.hash
    || !/^[a-z0-9-]+\.auth\.us-east-1\.amazoncognito\.com$/.test(hosted.hostname)) throw new Error('PROFILE_DOMAIN_INVALID');
  const response = await fetcher(direct ? 'https://cognito-idp.us-east-1.amazonaws.com/' : hosted.origin + '/oauth2/userInfo', {
    method: direct ? 'POST' : 'GET', redirect: 'error', credentials: 'omit', signal: globalThis.AbortSignal.timeout(10000),
    headers: direct ? { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSCognitoIdentityProviderService.GetUser' }
      : { authorization: 'Bearer ' + session.accessToken },
    ...(direct ? { body: JSON.stringify({ AccessToken: session.accessToken }) } : {}),
  });
  if (!response.ok) throw new Error('PROFILE_PROVIDER_REJECTED');
  const bytes = await response.text();
  if (Buffer.byteLength(bytes) > 65536) throw new Error('PROFILE_RESPONSE_INVALID');
  const raw = JSON.parse(bytes); let profile = raw;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('PROFILE_RESPONSE_INVALID');
  if (direct) {
    if (raw.Username !== username || !Array.isArray(raw.UserAttributes) || raw.UserAttributes.length > 100) throw new Error('PROFILE_IDENTITY_MISMATCH');
    profile = Object.create(null);
    for (const attribute of raw.UserAttributes) {
      if (!attribute || typeof attribute.Name !== 'string' || typeof attribute.Value !== 'string'
        || Object.hasOwn(profile, attribute.Name)) throw new Error('PROFILE_RESPONSE_INVALID');
      profile[attribute.Name] = attribute.Value;
    }
  } else if (raw.username !== username && raw['cognito:username'] !== username) throw new Error('PROFILE_IDENTITY_MISMATCH');
  if (typeof profile.sub !== 'string' || !profile.sub || typeof profile.email !== 'string' || profile.email.length > 320
    || !profile.email.includes('@') || ![true, 'true'].includes(profile.email_verified)) throw new Error('PROFILE_NOT_VERIFIED');
  return { subject: profile.sub, email: profile.email, verified: true };
}

/** route.fetch returns APIResponse: headers() is synchronous, unlike page Response.allHeaders().
 * Fetch exactly once. If capture fails after receiving a response, deliver that same response.
 */
export async function captureDelayedResponse(route) {
  const response = await route.fetch();
  try {
    const status = response.status(); const headers = response.headers();
    let delivered = false;
    return { status, headers, release: async () => {
      if (delivered) return;
      delivered = true;
      await route.fulfill({ response });
    } };
  } catch {
    await route.fulfill({ response });
    throw new Error('RESPONSE_CAPTURE_FAILED_DELIVERED_OR_UNKNOWN');
  }
}
