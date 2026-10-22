import { expect, test, type Page } from '@playwright/test';
import { Alexa, AssistantChat as Chat, KnownEnough as KE } from '@deal-table/contracts';
import { buildHypotheticalContributionFixture } from '../../packages/test-support/src/known-enough-fixtures';

test.use({ baseURL: 'http://127.0.0.1:5175' });

async function install(page: Page, agreed = false) {
  const fixture = await buildHypotheticalContributionFixture(), id = fixture.publicSnapshot.frame.decisionId;
  let snapshot = KE.PublicDecisionSnapshot.parse({ ...fixture.publicSnapshot, publicRevision: 5,
    ...(agreed ? { status: 'AGREED', approvedParticipantIds: fixture.publicSnapshot.frame.requiredParticipantIds } : {}) });
  let mode: 'ok' | 'denied' | 'wrong-decision' = 'ok', writes = 0;
  const calls: { method: string; params?: { name?: string; arguments?: unknown } }[] = [];
  const person = Chat.Message.parse({ id: 'question', role: 'person', authorId: 'maya', authorName: 'Maya', scope: 'group', ownerId: null,
    text: 'What did we agree on?', createdAt: '2026-10-22T00:00:00.000Z', expiresAt: '2026-11-20T00:00:00.000Z', replyTo: null,
    askAssistant: true, modelSource: 'a'.repeat(40), contextToken: snapshot.contextToken, publicRevision: 2 });
  const messages = [person, Chat.Message.parse({ ...person, id: 'reply', role: 'assistant', authorId: null, authorName: 'Assistant',
    replyTo: 'question', askAssistant: false, modelSource: null, text: 'No approvals have been made yet.' })];
  await page.addInitScript(() => sessionStorage.setItem('known-enough-cognito-session', JSON.stringify({ accessToken: 'local.synthetic.token', kind: 'participant', expiresAt: Date.now() + 900000 })));
  await page.route('https://local-api.example.invalid/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
    if (path === '/mcp') {
      if (request.method() !== 'POST') { await route.fulfill({ status: 405, headers, json: { error: 'Server notifications are disabled' } }); return; }
      const rpc = request.postDataJSON(); calls.push(rpc);
      if (!('id' in rpc)) { await route.fulfill({ status: 202, headers, body: '' }); return; }
      let result: unknown;
      if (rpc.method === 'initialize') result = { protocolVersion: Alexa.PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: 'test-shared', version: '1' } };
      else if (rpc.method === 'tools/list') result = { tools: Alexa.TOOL_NAMES.map(name => ({ name, inputSchema: { type: 'object', properties: {} } })) };
      else {
        const summary = Alexa.sharedDecisionSummary(snapshot);
        result = mode === 'denied' ? { isError: true, content: [{ type: 'text', text: 'Access unavailable' }] }
          : { content: [{ type: 'text', text: 'Old conversation text is not authoritative.' }], structuredContent: { ...summary, ...(mode === 'wrong-decision' ? { decisionId: 'another' } : {}) } };
      }
      await route.fulfill({ headers, json: { jsonrpc: '2.0', id: rpc.id, result } }); return;
    }
    let body: unknown;
    if (path === `/decisions/${id}/me`) body = { ...fixture.ownerSnapshot, publicSnapshot: snapshot };
    else if (path === `/decisions/${id}/public`) body = snapshot;
    else if (path.endsWith('/chat/group') || path.endsWith('/chat/private')) {
      const scope = path.endsWith('/private') ? 'private' : 'group';
      if (request.method() === 'POST') {
        const post = Chat.Post.parse(request.postDataJSON());
        snapshot = KE.PublicDecisionSnapshot.parse({ ...snapshot, status: 'AGREED', approvedParticipantIds: snapshot.frame.requiredParticipantIds, publicRevision: snapshot.publicRevision + 1 });
        const sent = Chat.Message.parse({ ...person, id: post.requestId, text: post.text, scope, ownerId: scope === 'private' ? 'maya' : null });
        messages.push(sent, Chat.Message.parse({ ...sent, id: 'reply-' + post.requestId, role: 'assistant', authorId: null, authorName: 'Assistant', replyTo: post.requestId, askAssistant: false, modelSource: null, text: 'You can review the outcome.' }));
        body = { requestId: post.requestId, state: 'ANSWERED', conversation: { decisionId: id, scope, viewerId: 'maya', retentionDays: 30, messages } };
      } else body = { decisionId: id, scope, viewerId: 'maya', retentionDays: 30, messages: scope === 'group' ? messages : [] };
    } else { await route.fulfill({ status: 404, headers, json: {} }); return; }
    if (request.method() !== 'GET') writes++;
    await route.fulfill({ headers, json: body });
  });
  await page.goto('/?decision=' + id);
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Decision chat' })).toBeVisible();
  const card = page.getByRole('region', { name: 'Live decision', exact: true });
  return { card, calls, id, writes: () => writes, change: (changes: Partial<KE.PublicDecisionSnapshot>) => { snapshot = KE.PublicDecisionSnapshot.parse({ ...snapshot, ...changes, publicRevision: snapshot.publicRevision + 1 }); },
    setMode: (next: typeof mode) => { mode = next; } };
}

test('actual MCP tool supplies current agreement while old chat remains historical; outcome opens without approving', async ({ page }) => {
  const f = await install(page, true);
  await expect(f.card.getByRole('heading', { name: 'Decision agreed', exact: true })).toBeVisible();
  await expect(f.card).toContainText('3 of 3 approved');
  await expect(f.card.locator('dd')).not.toHaveCount(0);
  await expect(page.locator('.ke-alexa-bubble').last()).toContainText('No approvals have been made yet.');
  expect(f.calls.some(call => call.method === 'initialize')).toBe(true);
  expect(f.calls.some(call => call.method === 'tools/list')).toBe(true);
  expect(f.calls.filter(call => call.method === 'tools/call')).toEqual([expect.objectContaining({ params: { name: 'get_decision_outcome', arguments: { decisionId: f.id } } })]);
  await f.card.getByRole('button', { name: 'View agreed outcome' }).click();
  await expect(page.locator('.ke-alexa-chat')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Decision agreed', exact: true })).toBeVisible();
  expect(f.writes()).toBe(0);
});

test('refresh reads current approvals and removes a retired proposal without a model call or a new message', async ({ page }) => {
  const f = await install(page);
  await expect(f.card).toContainText('0 of 3 approved');
  f.change({ status: 'AGREED', approvedParticipantIds: ['maya', 'leo', 'nina'] });
  await f.card.getByRole('button', { name: 'Refresh live decision' }).click();
  await expect(f.card).toContainText('3 of 3 approved');
  f.change({ status: 'NO_AGREEMENT', currentProposal: null, approvedParticipantIds: [] });
  await f.card.getByRole('button', { name: 'Refresh live decision' }).click();
  await expect(f.card.getByRole('heading', { name: 'No matching outcome' })).toBeVisible();
  await expect(f.card.locator('dd')).toHaveCount(0);
  await expect(f.card.getByRole('button', { name: /Review proposal|View agreed outcome/ })).toHaveCount(0);
  await expect(page.locator('.ke-alexa-bubble')).toHaveCount(2);
  expect(f.writes()).toBe(0);
});

test('denied and mismatched tool results clear the card; conversation remains usable and refresh can recover', async ({ page }) => {
  const f = await install(page, true);
  await expect(f.card).toContainText('3 of 3 approved');
  for (const mode of ['denied', 'wrong-decision'] as const) {
    f.setMode(mode);
    await f.card.getByRole('button', { name: 'Refresh live decision' }).click();
    await expect(f.card).toContainText('We couldn’t check the current decision.');
    await expect(f.card.locator('dd')).toHaveCount(0);
    await expect(f.card).not.toContainText('3 of 3 approved');
    await expect(page.getByRole('textbox', { name: 'Message everyone' })).toBeEnabled();
  }
  f.setMode('ok');
  await f.card.getByRole('button', { name: 'Refresh live decision' }).click();
  await expect(f.card).toContainText('3 of 3 approved');
  expect(f.writes()).toBe(0);
});

test('mobile dark card stays readable and shared facts remain separate from the private conversation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('ke-appearance', 'dark'));
  const f = await install(page, true);
  await expect(f.card).toContainText('3 of 3 approved');
  await page.getByRole('tab', { name: 'Private assistant' }).click();
  await expect(f.card).toContainText('3 of 3 approved');
  await expect(page.getByRole('log', { name: 'Private assistant' })).not.toContainText('What did we agree on?');
  expect(await f.card.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await f.card.scrollIntoViewIfNeeded();
  await page.locator('.ke-alexa-chat').screenshot({ path: '/tmp/known-enough-live-card-mobile.png' });
  expect(f.writes()).toBe(0);
});

test('a confirmed assistant reply refreshes the card without waiting for the polling interval', async ({ page }) => {
  const f = await install(page);
  await expect(f.card).toContainText('0 of 3 approved');
  await page.getByRole('textbox', { name: 'Message everyone' }).fill('Summarize the agreed plan.');
  await page.getByRole('checkbox', { name: /I agree to AI/ }).check();
  await page.getByRole('button', { name: 'Post and ask AI', exact: true }).click();
  await expect(f.card).toContainText('3 of 3 approved');
  await expect(f.card.getByRole('heading', { name: 'Decision agreed' })).toBeVisible();
  expect(f.calls.filter(call => call.method === 'tools/call').length).toBeGreaterThan(1);
  expect(f.writes()).toBe(1);
});
