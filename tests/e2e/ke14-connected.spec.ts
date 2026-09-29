import { spawn, type ChildProcess } from 'node:child_process';
import { expect, test, type BrowserContext } from '@playwright/test';
import { signedScenarioApi } from '../evaluations/ke14-api.ts';

let server: ChildProcess;
const url = 'http://127.0.0.1:5179/';
test.beforeAll(async () => {
  server = spawn(process.execPath, ['../../node_modules/vite/bin/vite.js', '--port', '5179', '--strictPort', '--host', '127.0.0.1'], {
    cwd: 'apps/web', stdio: 'ignore', env: { ...process.env, VITE_COGNITO_REGION: 'us-east-1', VITE_COGNITO_USER_POOL_ID: 'us-east-1_ke14Fixture',
      VITE_COGNITO_DOMAIN: 'https://fixture.auth.us-east-1.amazoncognito.com', VITE_COGNITO_PARTICIPANT_CLIENT_ID: 'participant-client',
      VITE_COGNITO_DISPLAY_CLIENT_ID: 'display-client', VITE_API_BASE_URL: 'https://api.example.test' },
  });
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await fetch(url)).ok) return; } catch { /* bounded startup */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Connected test server unavailable');
});
test.afterAll(() => server?.kill());

test('three connected owners create, confirm private inputs, negotiate and approve a Purchase through real signed HTTP boundaries', async ({ browser }) => {
  const api = await signedScenarioApi();
  const contexts: BrowserContext[] = [];
  const statuses: { path: string; status: number }[] = [];
  try {
    const pages = [];
    for (const person of ['maya', 'leo', 'nina']) {
      const context = await browser.newContext(); contexts.push(context);
      await context.addInitScript(session => sessionStorage.setItem('known-enough-cognito-session', JSON.stringify(session)), {
        accessToken: api.bearer(person), kind: 'participant', expiresAt: Date.now() + 900_000,
      });
      await context.route('https://api.example.test/**', async route => {
        const request = route.request();
        if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' } }); return; }
        const headers = await request.allHeaders();
        const response = await fetch(api.base + new URL(request.url()).pathname, {
          method: request.method(), headers: { authorization: headers.authorization!, 'content-type': 'application/json' },
          ...(request.postData() ? { body: request.postData()! } : {}),
        });
        statuses.push({ path: new URL(request.url()).pathname, status: response.status });
        await route.fulfill({ status: response.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: await response.text() });
      });
      pages.push(await context.newPage());
    }
    const [maya, leo, nina] = pages;
    await maya!.goto(url);
    await maya!.getByLabel('Scenario', { exact: true }).selectOption('SHARED_PURCHASE');
    await maya!.getByRole('button', { name: 'Create AI frame for review' }).click();
    await expect(maya!.getByRole('heading', { name: 'Shared frame', exact: true }), JSON.stringify(statuses)).toBeVisible();
    const decisionId = await maya!.getByLabel('Decision ID from your invitation').inputValue();
    expect(decisionId).toMatch(/^decision-/);
    for (const person of ['leo', 'nina']) {
      const response = await api.call('maya', `/decisions/${decisionId}/invitations`, { requestId: `browser-invite-${person}`, participantId: person });
      const { token } = await response.json();
      await api.call(person, `/decisions/${decisionId}/invitations/redeem`, { requestId: `browser-redeem-${person}`, token });
    }
    await leo!.goto(`${url}?decision=${decisionId}`); await nina!.goto(`${url}?decision=${decisionId}`);
    for (const page of [leo!, nina!]) await page.getByRole('button', { name: 'Load shared decision' }).click();
    for (const page of pages) {
      await page.getByRole('button', { name: 'Load shared decision' }).click();
      await page.getByRole('button', { name: 'Confirm shared frame' }).click();
      await expect(page.getByRole('button', { name: 'Confirm shared frame' })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Your private conditions', exact: true })).toBeVisible();
    }
    for (const page of pages) {
      await page.getByRole('button', { name: 'Load shared decision' }).click();
      await page.getByLabel('Explain your limits and preferences privately').fill('Synthetic fixture limits. KE14_RAW_MESSAGE_CANARY');
      await page.getByRole('button', { name: 'Interpret my conditions' }).click();
      await expect(page.getByRole('heading', { name: 'Review the interpretation' })).toBeVisible();
      for (const checkbox of await page.locator('label').filter({ hasText: /^(hard|negotiable):/ }).getByRole('checkbox').all()) await checkbox.check();
      await page.getByRole('button', { name: 'Confirm selected conditions' }).click();
      await expect(page.getByRole('heading', { name: 'Review the interpretation' })).toHaveCount(0);
      await expect(page.locator('body')).not.toContainText('KE14_RAW_MESSAGE_CANARY');
    }
    await maya!.getByRole('button', { name: 'Load shared decision' }).click();
    await maya!.getByRole('button', { name: 'Explore proposals' }).click();
    await nina!.getByRole('button', { name: 'Load shared decision' }).click();
    await expect(nina!.getByRole('heading', { name: 'Private negotiation question' })).toBeVisible();
    await expect(maya!.getByRole('heading', { name: 'Private negotiation question' })).toHaveCount(0);
    await nina!.getByRole('button', { name: 'Allow this adjustment' }).click();
    await maya!.getByRole('button', { name: 'Load shared decision' }).click();
    await maya!.getByRole('button', { name: 'Explore proposals' }).click();
    for (const page of pages) {
      await page.getByRole('button', { name: 'Load shared decision' }).click();
      await expect(page.getByRole('heading', { name: 'Current hypothetical proposal' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Your private part of this proposal' })).toBeVisible();
    }
    await expect(maya!.locator('body')).not.toContainText('$15,000.00');
    await expect(leo!.locator('body')).not.toContainText('$25,000.00');
    await expect(maya!.getByRole('button', { name: 'Approve this exact proposal' })).toBeDisabled();
    for (const page of pages) {
      await page.getByRole('button', { name: 'Load shared decision' }).click();
      await page.getByLabel('I reviewed the shared outcome and my private part of this exact proposal.').check();
      await page.getByRole('button', { name: 'Approve this exact proposal' }).click();
    }
    await expect(nina!.getByText('Everyone approved this exact outcome.', { exact: false })).toBeVisible();
    const publicResponse = await api.call('display', `/decisions/${decisionId}/public`, undefined, decisionId);
    const publicText = await publicResponse.text();
    for (const marker of ['maya-contribution', 'leo-contribution', 'nina-contribution', 'permissionId', 'KE14_RAW_MESSAGE_CANARY', '2500000', '1500000', '1000000']) expect(publicText).not.toContain(marker);
  } finally { await Promise.allSettled(contexts.map(context => context.close())); await api.close(); }
});

test('an unknown connected command result retries the identical envelope and records one mutation', async ({ browser }) => {
  const api = await signedScenarioApi();
  const context = await browser.newContext();
  const bodies: string[] = [];
  try {
    const created = await api.call('maya', '/decisions', { requestId: 'retry-create', idempotencyKey: 'retry-create', scenario: 'SHARED_PURCHASE', objective: 'Synthetic retry check.' });
    const { snapshot } = await created.json();
    const id = snapshot.frame.decisionId;
    await context.addInitScript(session => sessionStorage.setItem('known-enough-cognito-session', JSON.stringify(session)), {
      accessToken: api.bearer('maya'), kind: 'participant', expiresAt: Date.now() + 900_000,
    });
    await context.route('https://api.example.test/**', async route => {
      const request = route.request();
      if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' } }); return; }
      const path = new URL(request.url()).pathname;
      const headers = await request.allHeaders();
      const response = await fetch(api.base + path, { method: request.method(), headers: { authorization: headers.authorization!, 'content-type': 'application/json' },
        ...(request.postData() ? { body: request.postData()! } : {}) });
      const text = await response.text();
      if (path.endsWith('/commands')) {
        bodies.push(request.postData()!);
        if (bodies.length === 1) { await route.abort('failed'); return; }
      }
      await route.fulfill({ status: response.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: text });
    });
    const page = await context.newPage();
    await page.goto(`${url}?decision=${id}`);
    await page.getByRole('button', { name: 'Load shared decision' }).click();
    await page.getByRole('button', { name: 'Confirm shared frame' }).click();
    await page.getByRole('button', { name: 'Retry the same action', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Confirm shared frame' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Your private conditions', exact: true })).toBeVisible();
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
    const record = await api.repository.transactionDecision(id, record => record);
    expect(record!.frameConfirmations).toHaveLength(1);
    expect(record!.controlVersion).toBe(1);
  } finally { await context.close().catch(() => {}); await api.close(); }
});
