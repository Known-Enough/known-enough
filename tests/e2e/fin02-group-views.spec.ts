import { spawn, type ChildProcess } from 'node:child_process';
import { expect, test, type BrowserContext } from '@playwright/test';
import { npApi } from '../evaluations/np-api.ts';
import { checked, freshGroup } from '../evaluations/np-lifecycle.ts';

let server: ChildProcess;
const url = 'http://127.0.0.1:5187/';
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  server = spawn(process.execPath, ['../../node_modules/vite/bin/vite.js', '--port', '5187', '--strictPort', '--host', '127.0.0.1'], {
    cwd: 'apps/web', stdio: 'ignore', env: { ...process.env, VITE_COGNITO_REGION: 'us-east-1', VITE_COGNITO_USER_POOL_ID: 'us-east-1_npFixture',
      VITE_COGNITO_DOMAIN: 'https://fixture.auth.us-east-1.amazoncognito.com', VITE_COGNITO_PARTICIPANT_CLIENT_ID: 'participant-client',
      VITE_COGNITO_DISPLAY_CLIENT_ID: 'display-client', VITE_API_BASE_URL: 'https://api.example.test' } });
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await fetch(url)).ok) return; } catch { /* bounded startup */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('FIN02 browser server unavailable');
});
test.afterAll(() => server?.kill());

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`group-generated organizer/member/outsider/display isolation at ${viewport.width}px`, async ({ browser }, info) => {
    const api = await npApi(), contexts: BrowserContext[] = [];
    const statuses: { role: string; path: string; status: number }[] = [];
    try {
      const group = await freshGroup(api); await group.ready(); await group.generate();
      await checked(await api.call('outsider', '/account/register', { displayName: 'Synthetic outsider' })); await api.approve('outsider');
      const publicBefore = await group.publicView(); expect(publicBefore.status).toBe('PRIVATE_NEGOTIATION');
      const pages = new Map<string, Awaited<ReturnType<BrowserContext['newPage']>>>();
      for (const [role, who] of [['organizer', 'iris'], ['member', 'omar'], ['outsider', 'outsider'], ['display', 'display']] as const) {
        const context = await browser.newContext({ viewport, reducedMotion: 'reduce' }); contexts.push(context);
        await context.addInitScript(session => sessionStorage.setItem('known-enough-cognito-session', JSON.stringify(session)), {
          accessToken: api.bearer(who, { display: role === 'display', decisionId: group.decisionId }),
          kind: role === 'display' ? 'display' : 'participant', expiresAt: Date.now() + 900_000 });
        await context.route('https://api.example.test/**', async route => {
          const request = route.request();
          if (request.method() === 'OPTIONS') {
            await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' } }); return;
          }
          const headers = await request.allHeaders(), path = new URL(request.url()).pathname;
          const response = await fetch(api.base + path, { method: request.method(), headers: { authorization: headers.authorization!, 'content-type': 'application/json' },
            ...(request.postData() ? { body: request.postData()! } : {}) });
          statuses.push({ role, path, status: response.status });
          const body = await response.text();
          if (path.endsWith('/public') && response.ok) expect(body).not.toMatch(/NP_PRIVATE_RAW_CANARY|sourceSummary|pendingQuestions|ownInputReadiness|refusal|accessToken/);
          await route.fulfill({ status: response.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body });
        });
        const page = await context.newPage(); pages.set(role, page);
        await page.goto(`${url}?decision=${group.decisionId}`);
        if (role === 'organizer') await expect(page.getByRole('button', { name: 'Create invitation link' })).toBeVisible();
        else await expect(page.getByRole('button', { name: 'Create invitation link' })).toHaveCount(0);
        await page.getByRole('button', { name: 'Load shared decision' }).click();
        if (role === 'outsider') {
          await expect(page.getByText('The shared decision is unavailable. Check your session or try again.', { exact: true })).toBeVisible();
          await expect(page.getByRole('heading', { name: 'Shared frame', exact: true })).toHaveCount(0);
          expect(statuses.filter(value => value.role === role && value.path.endsWith('/public')).map(value => value.status)).toEqual([404]);
        } else {
          await expect(page.getByRole('heading', { name: 'Shared frame', exact: true })).toBeVisible();
          await expect(page.getByText('Status: A private adjustment question needs an answer.', { exact: true })).toBeVisible();
          await expect(page.getByRole('heading', { name: 'Private negotiation question', exact: true })).toHaveCount(role === 'organizer' ? 1 : 0);
          await expect(page.getByRole('heading', { name: 'Your private profile', exact: true })).toHaveCount(role === 'display' ? 0 : 1);
          if (role === 'display') {
            await expect(page.getByLabel('Explain your limits and preferences privately')).toHaveCount(0);
            await expect(page.getByRole('button', { name: 'Approve this exact proposal' })).toHaveCount(0);
            expect(statuses.some(value => value.role === role && value.path.endsWith('/me'))).toBe(false);
          }
        }
        expect(await page.locator('body').innerText()).not.toMatch(/NP_PRIVATE_RAW_CANARY|contextToken|semanticVersion|controlVersion|accessToken/);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const screenshot = info.outputPath(`${role}.png`); await page.screenshot({ path: screenshot, fullPage: true });
        await info.attach(`${role}-${viewport.width}`, { path: screenshot, contentType: 'image/png' });
      }
      // Current signed authority denies private display reads and removes a disabled member's previously rendered state.
      const denied = await fetch(`${api.base}/decisions/${group.decisionId}/me`, {
        headers: { authorization: `Bearer ${api.bearer('display', { display: true, decisionId: group.decisionId })}` } });
      expect(denied.status).toBe(404);
      const wrongRoom = await fetch(`${api.base}/decisions/${group.decisionId}/public`, {
        headers: { authorization: `Bearer ${api.bearer('display', { display: true, decisionId: 'another-decision' })}` } });
      expect(wrongRoom.status).toBe(403);
      await api.disable('omar'); const member = pages.get('member')!;
      await member.getByRole('button', { name: 'Load shared decision' }).click();
      await expect(member.getByText('The shared decision is unavailable. Check your session or try again.', { exact: true })).toBeVisible();
      await expect(member.getByRole('heading', { name: 'Your private profile', exact: true })).toHaveCount(0);
      await expect(member.getByRole('heading', { name: 'Shared frame', exact: true })).toHaveCount(0);
      await member.getByRole('button', { name: 'Refresh account and groups' }).click();
      await expect(member.getByText('Your access is disabled.', { exact: false })).toBeVisible();
      expect((await group.owner('iris')).pendingQuestions).toHaveLength(1);
    } finally { await Promise.all(contexts.map(context => context.close())); await api.close(); }
  });
}
