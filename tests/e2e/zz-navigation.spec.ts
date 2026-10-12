import { spawn, type ChildProcess } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { npApi } from '../evaluations/np-api.ts';
import { freshGroup } from '../evaluations/np-lifecycle.ts';
let server: ChildProcess;
const url = 'http://127.0.0.1:5190/';
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  server = spawn(process.execPath, ['../../node_modules/vite/bin/vite.js', '--port', '5190', '--strictPort', '--host', '127.0.0.1'], {
    cwd: 'apps/web', stdio: 'ignore', env: { ...process.env, VITE_COGNITO_REGION: 'us-east-1', VITE_COGNITO_USER_POOL_ID: 'us-east-1_npFixture',
      VITE_COGNITO_DOMAIN: 'https://fixture.auth.us-east-1.amazoncognito.com', VITE_COGNITO_PARTICIPANT_CLIENT_ID: 'participant-client',
      VITE_COGNITO_DISPLAY_CLIENT_ID: 'display-client', VITE_API_BASE_URL: 'https://api.example.test' } });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(url)).ok) return; } catch { /* bounded startup */ } await new Promise(resolve => setTimeout(resolve, 250)); }
  throw new Error('ZZ browser server unavailable');
});
test.afterAll(() => server?.kill());
for (const width of [390, 1280]) {
  test(`normal groups, selected group and decision restore with no inactive reads or AI requests at ${width}px`, async ({ browser }) => {
    const api = await npApi(), group = await freshGroup(api); await group.ready(); await group.generate();
    const context = await browser.newContext({ viewport: { width, height: 844 } }); const paths: string[] = [], writes: string[] = [];
    try {
      await context.addInitScript(session => sessionStorage.setItem('known-enough-cognito-session', JSON.stringify(session)), { accessToken: api.bearer('iris'), kind: 'participant', expiresAt: Date.now() + 900000 });
      await context.route('https://api.example.test/**', async route => {
        const request = route.request(); if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' } }); return; }
        const path = new URL(request.url()).pathname, headers = await request.allHeaders(); paths.push(path); if (request.method() !== 'GET') writes.push(path);
        const response = await fetch(api.base + path, { method: request.method(), headers: { authorization: headers.authorization!, 'content-type': 'application/json' }, ...(request.postData() ? { body: request.postData()! } : {}) });
        await route.fulfill({ status: response.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: await response.text() });
      });
      const page = await context.newPage(); await page.goto(url);
      await expect(page.getByRole('heading', { name: 'Your groups', exact: true })).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'Decision ID from your invitation' })).toHaveCount(0);
      await expect(page.getByText('Optional fictional decision templates')).toHaveCount(0);
      await expect(page.getByText('SIMULATED ALEXA+', { exact: false })).toHaveCount(0);
      expect(paths.some(path => path.startsWith('/decisions/'))).toBe(false);
      await page.screenshot({ path: `docs/review-artifacts/ZZ03/after-home-${width}.png`, fullPage: true });
      await page.getByRole('button', { name: 'Open group', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Start a decision' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Back to groups', exact: true })).toBeVisible();
      await page.screenshot({ path: `docs/review-artifacts/ZZ03/after-group-${width}.png`, fullPage: true });
      const before = paths.length;
      await page.getByRole('button', { name: 'Open decision', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Shared frame', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Private negotiation question', exact: true })).toBeVisible();
      expect(paths.slice(before).some(path => path.startsWith('/groups') || path === '/account')).toBe(false);
      await page.getByRole('button', { name: 'Back to group', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Open decision', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Private negotiation question', exact: true })).toHaveCount(0);
      await page.goBack(); await expect(page.getByRole('heading', { name: 'Shared frame', exact: true })).toBeVisible();
      await page.reload(); await expect(page.getByRole('heading', { name: 'Private negotiation question', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Change my private needs' }).click();
      await page.getByLabel('Explain your limits and preferences privately').fill('ZZ_UNSAVED_LOCAL_TEXT');
      page.once('dialog', dialog => dialog.dismiss()); await page.getByRole('button', { name: 'Back to group', exact: true }).click();
      await expect(page.getByLabel('Explain your limits and preferences privately')).toHaveValue('ZZ_UNSAVED_LOCAL_TEXT');
      page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Back to group', exact: true }).click();
      await expect(page.getByLabel('Explain your limits and preferences privately')).toHaveCount(0);
      expect(await page.evaluate(() => JSON.stringify({ ...sessionStorage, ...localStorage }))).not.toContain('ZZ_UNSAVED_LOCAL_TEXT');
      expect(writes).toEqual([]); // navigation/reload cannot enqueue/pay again
      await page.goto(url + '?demo=legacy');
      await expect(page.getByText('Optional fictional decision templates')).toBeVisible();
      await page.screenshot({ path: `docs/review-artifacts/ZZ03/before-demo-${width}.png`, fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { await context.close(); await api.close(); }
  });
}

test('pending home has only access state; approved new user has zero real groups and no inactive requests', async ({ browser }) => {
  const api = await npApi(), context = await browser.newContext(); const paths: string[] = [];
  try {
    await api.call('new-user', '/account/register', { displayName: 'New member' });
    await context.addInitScript(token => sessionStorage.setItem('known-enough-cognito-session', JSON.stringify({ accessToken: token, kind: 'participant', expiresAt: Date.now() + 900000 })), api.bearer('new-user'));
    await context.route('https://api.example.test/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname; paths.push(path);
      if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' } }); return; }
      const response = await fetch(api.base + path, { method: request.method(), headers: { authorization: (await request.allHeaders()).authorization! } });
      await route.fulfill({ status: response.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: await response.text() });
    });
    const page = await context.newPage(); await page.goto(url);
    await expect(page.getByText('Your account is waiting for approval.', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create group', exact: true })).toHaveCount(0);
    expect(paths.some(path => path.startsWith('/decisions/') || path === '/groups' || path === '/account/profile')).toBe(false);
    await api.approve('new-user'); await page.getByRole('button', { name: 'Refresh account and groups' }).click();
    await expect(page.getByText('No groups yet.', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create group', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open group', exact: true })).toHaveCount(0);
  } finally { await context.close(); await api.close(); }
});
