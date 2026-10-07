import { createGroup } from '../live/qa/helpers.ts';
import { spawn, type ChildProcess } from 'node:child_process';
import { test, expect, type BrowserContext } from '@playwright/test';
import { npApi } from '../evaluations/np-api.ts';
let server: ChildProcess;
const url = 'http://127.0.0.1:5181/';
test.beforeAll(async () => {
  server = spawn(process.execPath, ['../../node_modules/vite/bin/vite.js', '--port', '5181', '--strictPort', '--host', '127.0.0.1'], {
    cwd: 'apps/web', stdio: 'ignore', env: { ...process.env, VITE_COGNITO_REGION: 'us-east-1', VITE_COGNITO_USER_POOL_ID: 'us-east-1_npFixture',
      VITE_COGNITO_DOMAIN: 'https://fixture.auth.us-east-1.amazoncognito.com', VITE_COGNITO_PARTICIPANT_CLIENT_ID: 'participant-client',
      VITE_COGNITO_DISPLAY_CLIENT_ID: 'display-client', VITE_API_BASE_URL: 'https://api.example.test' } });
  for (let attempt = 0; attempt < 40; attempt++) { try { if ((await fetch(url)).ok) return; } catch { /* startup */ }
    await new Promise(resolve => setTimeout(resolve, 250)); }
  throw new Error('NP browser server unavailable');
});
test.afterAll(() => server?.kill());
test('new users request access, operator admits, organizer invites a new recipient and reload preserves membership', async ({ browser }) => {
  const api = await npApi(); const contexts: BrowserContext[] = [];
  async function pageFor(who: string) {
    const context = await browser.newContext(); contexts.push(context);
    await context.addInitScript(session => sessionStorage.setItem('known-enough-cognito-session', JSON.stringify(session)), {
      accessToken: api.bearer(who), kind: 'participant', expiresAt: Date.now() + 900000 });
    await context.route('https://api.example.test/**', async route => {
      const request = route.request();
      if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' } }); return; }
      const headers = await request.allHeaders();
      const response = await fetch(api.base + URL.parse(request.url())!.pathname, { method: request.method(),
        headers: { authorization: headers.authorization!, 'content-type': 'application/json' }, ...(request.postData() ? { body: request.postData()! } : {}) });
      await route.fulfill({ status: response.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: await response.text() });
    });
    return context.newPage();
  }
  try {
    const host = await pageFor('iris'); await host.goto(url);
    await host.getByLabel('Your display name').fill('Iris'); await host.getByRole('button', { name: 'Request access', exact: true }).click();
    await expect(host.getByText('Access request pending.', { exact: false })).toBeVisible();
    await api.approve('iris'); await host.getByRole('button', { name: 'Refresh account and groups' }).click();
    let release!: () => void; let markStarted!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    await host.route('https://api.example.test/groups', async route => {
      if (route.request().method() !== 'POST') { await route.fallback(); return; }
      markStarted(); await held; await route.fallback();
    });
    let finished = false;
    const creation = createGroup(host, 'Garden club').then(() => { finished = true; });
    try { await started; await host.waitForTimeout(100); expect(finished).toBe(false); }
    finally { release(); }
    await creation; await host.unroute('https://api.example.test/groups');
    await expect(host.getByRole('heading', { name: 'Garden club', exact: true })).toBeVisible();
    await host.getByLabel('Recipient email').fill('omar@example.invalid'); await host.getByRole('button', { name: 'Create invitation link' }).click();
    const link = await host.getByLabel('Invitation link', { exact: true }).inputValue();
    const guest = await pageFor('omar'); await guest.goto(link.replace('http://127.0.0.1:5181', 'http://127.0.0.1:5181'));
    await guest.getByLabel('Your display name').fill('Omar'); await guest.getByRole('button', { name: 'Request access', exact: true }).click();
    await expect(guest.getByText('Access request pending.', { exact: false })).toBeVisible();
    await api.approve('omar'); await guest.getByRole('button', { name: 'Refresh account and groups' }).click();
    await guest.getByRole('button', { name: 'Accept group invitation', exact: true }).click();
    await expect(guest.getByRole('heading', { name: 'Garden club', exact: true })).toBeVisible();
    await expect(guest.getByRole('button', { name: 'Create invitation link' })).toHaveCount(0);
    await guest.reload(); await expect(guest.getByRole('heading', { name: 'Garden club', exact: true })).toBeVisible();
    await host.getByRole('button', { name: 'Refresh account and groups' }).click();
    await host.getByText('Group members and membership changes', { exact: true }).click();
    await expect(host.getByRole('button', { name: 'Remove Omar' })).toBeVisible();
    await host.getByLabel('What should this group decide?').fill('Choose a gallery meetup venue and time.');
    await host.getByRole('button', { name: 'Draft a new decision', exact: true }).click();
    await expect(host.getByRole('heading', { name: 'Review the public draft' })).toBeVisible();
    await host.getByLabel('Decision title', { exact: true }).fill('Garden club gallery meetup');
    await host.getByRole('checkbox', { name: 'I reviewed this public draft and the required approvers' }).check();
    await expect(host.getByRole('button', { name: 'Create decision for group review' })).toBeDisabled();
    await host.getByRole('button', { name: 'Save draft edits' }).click();
    await expect(host.getByRole('checkbox', { name: 'I reviewed this public draft and the required approvers' })).not.toBeChecked();
    await host.getByRole('checkbox', { name: 'I reviewed this public draft and the required approvers' }).check();
    await host.getByRole('button', { name: 'Create decision for group review' }).click();
    await expect(host.getByRole('heading', { name: 'Shared frame', exact: true })).toBeVisible();
    await expect(host.getByRole('heading', { name: 'Garden club gallery meetup', exact: true })).toBeVisible();
    await guest.reload(); await guest.getByRole('button', { name: 'Open decision', exact: true }).click();
    await expect(guest.getByRole('heading', { name: 'Shared frame', exact: true })).toBeVisible();
    await api.disable('omar'); await guest.getByRole('button', { name: 'Refresh account and groups' }).click();
    await expect(guest.getByText('Your access is disabled.', { exact: false })).toBeVisible();
  } finally { await Promise.all(contexts.map(context => context.close())); await api.close(); }
});
