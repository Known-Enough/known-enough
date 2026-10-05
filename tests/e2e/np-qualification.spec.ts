import { spawn, type ChildProcess } from 'node:child_process';
import { test, expect, type BrowserContext } from '@playwright/test';
import { npApi } from '../evaluations/np-api.ts';
import { confirmFrameReview } from '../live/qa/helpers.ts';
import { freshGroup } from '../evaluations/np-lifecycle.ts';
let server: ChildProcess;
const url = 'http://127.0.0.1:5184/';
test.beforeAll(async () => {
  server = spawn(process.execPath, ['../../node_modules/vite/bin/vite.js', '--port', '5184', '--strictPort', '--host', '127.0.0.1'], { cwd: 'apps/web', stdio: 'ignore',
    env: { ...process.env, VITE_COGNITO_REGION: 'us-east-1', VITE_COGNITO_USER_POOL_ID: 'us-east-1_npFixture', VITE_COGNITO_DOMAIN: 'https://fixture.auth.us-east-1.amazoncognito.com',
      VITE_COGNITO_PARTICIPANT_CLIENT_ID: 'participant-client', VITE_COGNITO_DISPLAY_CLIENT_ID: 'display-client', VITE_API_BASE_URL: 'https://api.example.test' } });
  for (let attempt = 0; attempt < 40; attempt++) { try { if ((await fetch(url)).ok) return; } catch { /* startup */ } await new Promise(resolve => setTimeout(resolve, 250)); }
  throw new Error('Qualification server unavailable');
});
test.afterAll(() => server?.kill());
async function connect(context: BrowserContext, api: Awaited<ReturnType<typeof npApi>>, who: string) {
  await context.addInitScript(session => { if (!sessionStorage.getItem('known-enough-cognito-session')) sessionStorage.setItem('known-enough-cognito-session', JSON.stringify(session)); }, { accessToken: api.bearer(who), kind: 'participant', expiresAt: Date.now() + 900000 });
  await context.route('https://api.example.test/**', async route => {
    const request = route.request(); if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' } }); return; }
    const headers = await request.allHeaders(); const response = await fetch(api.base + URL.parse(request.url())!.pathname, { method: request.method(), headers: { authorization: headers.authorization!, 'content-type': 'application/json' }, ...(request.postData() ? { body: request.postData()! } : {}) });
    await route.fulfill({ status: response.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: await response.text() });
  });
}

test('four new independent browser owners create a garden decision from blank entry and reach exact unanimous agreement', async ({ browser }) => {
  const api = await npApi(); const contexts: BrowserContext[] = [];
  try {
    const people = ['iris', 'omar', 'tess', 'vin']; const pages = [];
    for (const who of people) {
      const context = await browser.newContext(); contexts.push(context); await connect(context, api, who);
      const page = await context.newPage(); pages.push(page); await page.goto(url);
      await page.getByLabel('Your display name').fill(who); await page.getByRole('button', { name: 'Request access', exact: true }).click();
      await expect(page.getByText('Access request pending.', { exact: false })).toBeVisible();
      await api.approve(who); await page.getByRole('button', { name: 'Refresh account and groups' }).click();
      await expect(page.getByRole('button', { name: 'Create group', exact: true })).toBeVisible();
    }
    const host = pages[0]!; await host.getByLabel('New group name').fill('Fresh garden club'); await host.getByRole('button', { name: 'Create group', exact: true }).click();
    for (let i = 1; i < people.length; i++) {
      if (i > 1) await host.getByRole('button', { name: 'Hide invitation link' }).click();
      await host.getByLabel('Recipient email').fill(`${people[i]}@example.invalid`); await host.getByRole('button', { name: 'Create invitation link' }).click();
      await expect(host.getByLabel('Invitation link', { exact: true })).toBeVisible();
      const link = await host.getByLabel('Invitation link', { exact: true }).inputValue(); const guest = pages[i]!;
      await guest.goto(link); await guest.getByRole('button', { name: 'Accept group invitation', exact: true }).click();
      await expect(guest.getByRole('heading', { name: 'Fresh garden club', exact: true })).toBeVisible();
    }
    await host.getByLabel('What should this group decide?').fill('Choose our garden workday activity and time.');
    await host.getByRole('button', { name: 'Draft a new decision', exact: true }).click();
    await expect(host.getByRole('heading', { name: 'Review the public draft' })).toBeVisible();
    await expect(host.getByText('Planting, Watering', { exact: false })).toBeVisible();
    await host.getByRole('checkbox', { name: 'I reviewed this public draft and the required approvers' }).check();
    let releaseCreate!: () => void; let markCreateStarted!: () => void;
    const createGate = new Promise<void>(resolve => { releaseCreate = resolve; });
    const createStarted = new Promise<void>(resolve => { markCreateStarted = resolve; });
    await host.route('https://api.example.test/groups/*/drafts/*/create', async route => {
      if (route.request().method() === 'POST') { markCreateStarted(); await createGate; }
      await route.fallback();
    });
    await host.getByRole('button', { name: 'Create decision for group review' }).click();
    await createStarted;
    try { expect(await host.getByLabel('Decision ID from your invitation').inputValue()).toBe('christmas-decision'); }
    finally { releaseCreate(); }
    await expect(host.getByLabel('Decision ID from your invitation')).toHaveValue(/^groupdecision-[a-f0-9]{40}$/);
    for (const page of pages.slice(1)) { await page.reload(); await page.getByRole('button', { name: 'Open decision', exact: true }).click(); }
    for (const page of pages) {
      await page.getByRole('button', { name: 'Load shared decision' }).click();
      await expect(page.getByRole('list', { name: 'Frame participants and approvals' })).toContainText('vin');
      await page.getByLabel('I reviewed this frame version, its options and public rules.').check();
      const commandUrl = `https://api.example.test/decisions/${await page.getByLabel('Decision ID from your invitation').inputValue()}/commands`;
      if (page === host) {
        let release!: () => void; let markStarted!: () => void;
        const held = new Promise<void>(resolve => { release = resolve; });
        const started = new Promise<void>(resolve => { markStarted = resolve; });
        await page.route(commandUrl, async route => { markStarted(); await held; await route.fallback(); });
        let finished = false;
        const confirmation = confirmFrameReview(page, commandUrl, () => {}).then(() => { finished = true; });
        try {
          await started;
          await expect(page.getByRole('button', { name: 'Confirm shared frame' })).toBeDisabled();
          await page.waitForTimeout(100); // Deliberately held server request; click alone has already completed.
          expect(finished).toBe(false);
        } finally { release(); }
        await confirmation; await page.unroute(commandUrl);
      } else await confirmFrameReview(page, commandUrl, () => {});
    }
    const needs = ['first option flexible NP_PRIVATE_RAW_CANARY', 'second required NP_PRIVATE_RAW_CANARY', 'time afternoon required NP_PRIVATE_RAW_CANARY', 'second preferred NP_PRIVATE_RAW_CANARY'];
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i]!; await page.getByRole('button', { name: 'Load shared decision' }).click();
      await page.getByLabel('Explain your limits and preferences privately').fill(needs[i]!); await page.getByRole('button', { name: 'Interpret my conditions' }).click();
      await expect(page.getByRole('heading', { name: 'Review the interpretation' })).toBeVisible();
      for (const checkbox of await page.locator('label').filter({ hasText: /^(hard|negotiable|preference):/ }).getByRole('checkbox').all()) await checkbox.check();
      await page.getByRole('button', { name: 'Confirm selected conditions' }).click();
      await expect(page.getByRole('heading', { name: 'Review the interpretation' })).toHaveCount(0);
    }
    await host.getByRole('button', { name: 'Load shared decision' }).click(); await host.getByRole('button', { name: 'Explore proposals' }).click();
    await expect(host.getByRole('heading', { name: 'Private negotiation question' })).toBeVisible();
    await host.getByRole('button', { name: 'Allow this adjustment' }).click();
    await host.getByRole('button', { name: 'Explore proposals' }).click();
    const id = await host.getByLabel('Decision ID from your invitation').inputValue();
    for (const page of pages) {
      await page.getByRole('button', { name: 'Load shared decision' }).click();
      await expect(page.getByRole('heading', { name: 'Current proposal', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Approve this exact proposal' })).toBeDisabled();
      await page.getByLabel('I reviewed the shared outcome and my private part of this exact proposal.').check();
      await page.getByRole('button', { name: 'Approve this exact proposal' }).click();
    }
    await expect(pages[3]!.getByText('Everyone approved this exact outcome.', { exact: false })).toBeVisible();
    const view = await (await api.call('iris', `/decisions/${id}/public`)).json(); expect(view.status).toBe('AGREED');
    expect(view.frame.variables.map((item: { id: string }) => item.id)).toEqual(['activity', 'slot']);
    expect(view.currentProposal.facts.values).toEqual([{ variableId: 'activity', value: { type: 'ENUM', optionId: 'watering' } }, { variableId: 'slot', value: { type: 'ENUM', optionId: 'afternoon' } }]);
    expect(JSON.stringify(view)).not.toMatch(/NP_PRIVATE_RAW_CANARY|permissionId|constraintId|requestIdentity|refusedRequests/);
    for (const page of pages) { await page.reload(); await page.getByRole('button', { name: 'Open decision', exact: true }).click(); await expect(page.getByText('Everyone approved this exact outcome.', { exact: false })).toBeVisible(); }
  } finally { await Promise.all(contexts.map(context => context.close())); await api.close(); }
});
test('a lost committed response retries the exact command once; expired browser session reconnects without losing server state', async ({ browser }) => {
  const api = await npApi(); const context = await browser.newContext();
  try {
    const h = await freshGroup(api); await connect(context, api, 'iris'); const bodies: string[] = [];
    await context.route('https://api.example.test/**/commands', async route => {
      const request = route.request(); const response = await fetch(api.base + new URL(request.url()).pathname, { method: 'POST', headers: { authorization: `Bearer ${api.bearer('iris')}`, 'content-type': 'application/json' }, body: request.postData()! });
      bodies.push(request.postData()!); if (bodies.length === 1) { await route.abort('failed'); return; }
      await route.fulfill({ status: response.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: await response.text() });
    });
    const page = await context.newPage(); await page.goto(url); await page.getByRole('button', { name: 'Open decision', exact: true }).click();
    await page.getByLabel('I reviewed this frame version, its options and public rules.').check(); await page.getByRole('button', { name: 'Confirm shared frame' }).click();
    await page.getByRole('button', { name: 'Retry the same action' }).click();
    await expect.poll(() => bodies.length).toBe(2);
    expect(bodies[0]).toBe(bodies[1]);
    expect((await h.publicView()).frameConfirmations).toHaveLength(1);
    await page.evaluate(() => { const key = 'known-enough-cognito-session'; const session = JSON.parse(sessionStorage.getItem(key)!); session.expiresAt = Date.now() - 1; sessionStorage.setItem(key, JSON.stringify(session)); });
    await page.reload(); await expect(page.getByRole('button', { name: 'Sign in or register', exact: true })).toBeVisible();
    await page.evaluate(token => sessionStorage.setItem('known-enough-cognito-session', JSON.stringify({ accessToken: token, kind: 'participant', expiresAt: Date.now() + 900000 })), api.bearer('iris'));
    await page.reload(); await page.getByRole('button', { name: 'Open decision', exact: true }).click();
    await expect(page.getByText('1 of 4 required frame confirmations.', { exact: true })).toBeVisible();
    expect((await h.publicView()).frameConfirmations).toHaveLength(1);
  } finally { await context.close(); await api.close(); }
});
