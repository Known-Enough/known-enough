import { expect, test, type Page } from '@playwright/test';
import { AssistantChat as Chat, compileChoicePlan, KnownEnough as KE } from '@deal-table/contracts';

test.use({ baseURL: 'http://127.0.0.1:5175' });
const compiled = compileChoicePlan({ title: 'Weekend plan', description: 'Choose a place together.', topics: [{ label: 'Place', kind: 'CHOICE', options: ['Park', 'Museum'] }] });
const snapshot = KE.PublicDecisionSnapshot.parse({ schemaVersion: 2, frame: { schemaVersion: 2, decisionId: 'alexa', frameVersion: 1, semanticVersion: 1, contextToken: 'c'.repeat(64),
  title: 'Weekend plan', objective: 'Choose a place together.', description: '', participants: [{ id: 'one', displayName: 'Alex', requiredForApproval: true }, { id: 'two', displayName: 'Sam', requiredForApproval: true }],
  requiredParticipantIds: ['one', 'two'], variables: compiled.variables, rules: compiled.rules },
  viewerParticipantId: 'one', semanticVersion: 1, contextToken: 'c'.repeat(64), publicRevision: 1, status: 'READY',
  participantProgress: [{ participantId: 'one', answersSaved: true }, { participantId: 'two', answersSaved: true }],
  frameConfirmations: ['one', 'two'].map(participantId => ({ decisionId: 'alexa', participantId, frameVersion: 1, semanticVersion: 1, contextToken: 'c'.repeat(64), confirmedAt: '2026-10-18T00:00:00.000Z' })), currentProposal: null, approvedParticipantIds: [], publishedDisclosures: [] });
const owner = KE.OwnerDecisionSnapshot.parse({ schemaVersion: 2, publicSnapshot: snapshot, ownerParticipantId: 'one', ownInputReadiness: 'READY', privateVariables: [], privateProposalValues: null,
  controlVersion: 1, ownerVersion: 1, draftVersion: null, draft: null, confirmedConstraints: [], pendingQuestions: [], refusedRequests: [], negotiationPermissions: [], disclosurePermissions: [], ownApproval: null });

async function install(page: Page, options: { lostAck?: boolean } = {}) {
  const messages: Chat.Message[] = [], posts: Chat.Post[] = [];
  let mcpRequests = 0, otherWrites = 0;
  const conversation = (scope: Chat.Scope): Chat.Snapshot => ({ decisionId: 'alexa', scope, viewerId: 'one', retentionDays: 30, messages: messages.filter(message => message.scope === scope) });
  await page.addInitScript(() => sessionStorage.setItem('known-enough-cognito-session', JSON.stringify({ accessToken: 'local.synthetic.token', kind: 'participant', expiresAt: Date.now() + 900000 })));
  await page.route('https://local-api.example.invalid/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
    if (req.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
    let body: unknown = {}, status = 200;
    const chat = /\/chat\/(group|private)(?:\/requests\/([^/]+))?$/.exec(path), scope = chat?.[1] as Chat.Scope | undefined;
    if (scope) {
      if (req.method() === 'POST') {
        const post = Chat.Post.parse(req.postDataJSON()); posts.push(post);
        const message = Chat.Message.parse({ id: post.requestId, scope, ownerId: scope === 'private' ? 'one' : null, authorId: 'one', authorName: 'Alex', role: 'person', text: post.text,
          createdAt: '2026-10-18T23:00:00.000Z', expiresAt: '2026-11-17T23:00:00.000Z', replyTo: null, askAssistant: post.askAssistant, modelSource: post.askAssistant ? 'a'.repeat(40) : null, contextToken: snapshot.contextToken, publicRevision: 1 });
        messages.push(message);
        if (post.askAssistant) messages.push({ ...message, id: 'reply-' + post.requestId, authorId: null, authorName: 'Alexa+', role: 'assistant', text: 'What matters most to you about this choice?', replyTo: post.requestId, askAssistant: false, modelSource: null });
        if (options.lostAck) { await route.abort(); return; }
        body = { requestId: post.requestId, state: post.askAssistant ? 'ANSWERED' : 'POSTED', conversation: conversation(scope) };
      } else if (chat?.[2]) body = { requestId: chat[2], state: messages.find(message => message.id === chat[2])?.askAssistant ? 'ANSWERED' : 'POSTED', conversation: conversation(scope) };
      else body = conversation(scope);
    } else if (path.endsWith('/public')) body = snapshot;
    else if (path.endsWith('/me')) body = owner;
    else if (path === '/mcp') { mcpRequests++; status = 503; }
    else { if (req.method() === 'POST') otherWrites++; status = 404; }
    await route.fulfill({ status, headers, json: body });
  });
  await page.goto('/?decision=alexa');
  await page.getByRole('button', { name: 'Ask assistant', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Group chat' })).toBeVisible();
  return { posts, messages, mcpRequests: () => mcpRequests, otherWrites: () => otherWrites };
}
test('saved group/private conversations reopen with authors/times, one composer, explicit sharing and hidden connection details', async ({ page }) => {
  const f = await install(page);
  await expect(page.getByText('Everyone in this decision can see these messages.', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Message everyone' }).fill('Let’s compare the park and museum.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('log', { name: 'Group chat' })).toContainText('Let’s compare');
  await expect(page.locator('.ke-alexa-message-meta')).toContainText('Alex (you)');
  await expect(page.locator('.ke-alexa-message-meta time')).toHaveAttribute('datetime', '2026-10-18T23:00:00.000Z');
  await page.getByRole('tab', { name: 'Private assistant' }).click();
  await page.getByRole('textbox', { name: 'Message your private assistant' }).fill('PRIVATE_BROWSER_CANARY: I prefer quiet places.');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: /Use AI for my messages/ }).check();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('log', { name: 'Private assistant' })).toContainText('What matters most');
  await page.getByRole('button', { name: 'Close assistant' }).click();
  await page.getByRole('button', { name: 'Ask assistant', exact: true }).click();
  await expect(page.getByRole('log', { name: 'Group chat' })).not.toContainText('PRIVATE_BROWSER_CANARY');
  await page.getByRole('tab', { name: 'Private assistant' }).click();
  await expect(page.getByRole('log', { name: 'Private assistant' })).toContainText('PRIVATE_BROWSER_CANARY');
  await page.getByRole('button', { name: 'Share to Group chat…' }).first().click();
  await expect(page.getByRole('complementary', { name: 'Preview group message' })).toContainText('PRIVATE_BROWSER_CANARY');
  expect(f.posts).toHaveLength(2);
  await page.getByRole('button', { name: 'Keep private', exact: true }).click();
  expect(f.posts).toHaveLength(2);
  await page.getByRole('button', { name: 'Share to Group chat…' }).first().click();
  await page.getByRole('button', { name: 'Post to Group chat', exact: true }).click();
  await expect(page.getByRole('log', { name: 'Group chat' })).toContainText('PRIVATE_BROWSER_CANARY');
  expect(f.posts[2]).toMatchObject({ text: f.posts[1]!.text, askAssistant: false, shareMessageId: f.posts[1]!.requestId });
  await expect(page.locator('.ke-alexa-chat textarea')).toHaveCount(1);
  expect(f.mcpRequests()).toBe(0); expect(f.otherWrites()).toBe(0);
  await expect(page.locator('.ke-alexa-trace')).not.toHaveAttribute('open');
  await page.getByText('Technical details', { exact: true }).click();
  await expect.poll(() => f.mcpRequests()).toBeGreaterThan(0);
});
test('a lost send acknowledgment survives close/reopen and status checking never resends the message or AI request', async ({ page }) => {
  const f = await install(page, { lostAck: true });
  await page.getByRole('textbox', { name: 'Message everyone' }).fill('An interrupted group message.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText(/This send could not be confirmed/)).toBeVisible();
  await page.getByRole('button', { name: 'Close assistant' }).click();
  await page.getByRole('button', { name: 'Ask assistant', exact: true }).click();
  await expect(page.getByRole('log', { name: 'Group chat' })).toContainText('An interrupted group message.');
  await page.getByRole('button', { name: 'Check send status', exact: true }).click();
  await expect(page.getByText('Message posted.', { exact: true })).toBeVisible();
  expect(f.posts).toHaveLength(1);
});
test('mobile dark chat stays in the viewport and keeps the composer and audience notice readable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('ke-appearance', 'dark'));
  const f = await install(page);
  f.messages.push(Chat.Message.parse({ id: 'peer-hello', scope: 'group', ownerId: null, authorId: 'two', authorName: 'Sam', role: 'person', text: 'Would the park work for everyone?',
    createdAt: '2026-10-18T22:59:00.000Z', expiresAt: '2026-11-17T22:59:00.000Z', replyTo: null, askAssistant: false, modelSource: null, contextToken: snapshot.contextToken, publicRevision: 1 }));
  await page.getByRole('textbox', { name: 'Message everyone' }).fill('Can you help us compare the park and museum?');
  await page.getByRole('checkbox', { name: 'Ask Alexa+ to reply' }).check();
  await page.getByRole('checkbox', { name: /Use AI for my messages/ }).check();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('log', { name: 'Group chat' })).toContainText('What matters most');
  const modal = page.locator('.ke-alexa-chat');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(modal).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message everyone' })).toBeInViewport();
  expect(await modal.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await expect(page.locator('.ke-alexa-chat form > p')).toBeInViewport({ ratio: 1 });
  await modal.screenshot({ path: '/tmp/alx02-chat-mobile.png' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await modal.screenshot({ path: '/tmp/alx02-chat-desktop.png' });
});
