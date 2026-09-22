import { spawn, type ChildProcess } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';

let api: ChildProcess | undefined;

async function waitForApi(): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:8787/rooms/room-synthetic/public', {
        headers: { 'X-Deal-Table-Test-Identity': 'NON_PRODUCTION display' },
      });
      if (response.ok) return;
    } catch { /* The loopback server is still starting. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Local non-production API did not start on port 8787');
}

test.beforeAll(async () => {
  api = spawn(process.execPath, ['--experimental-transform-types', 'apps/api/src/local.ts'], {
    cwd: process.cwd(), stdio: 'ignore', env: { ...process.env, PORT: '8787' },
  });
  await waitForApi();
});

test.afterAll(async () => {
  if (!api || api.exitCode !== null) return;
  await new Promise<void>(resolve => {
    api!.once('exit', () => resolve());
    api!.kill('SIGTERM');
  });
});

async function openOwner(page: Page, member: 'maya' | 'leo' | 'nina'): Promise<void> {
  await page.goto(`/?view=owner&local=${member}`);
  await expect(page.getByRole('heading', { name: 'Your inputs' })).toBeVisible();
  await expect(page.getByText(`NON_PRODUCTION ${member}`, { exact: true })).toBeVisible();
}

async function submit(page: Page, member: 'maya' | 'leo' | 'nina'): Promise<void> {
  await openOwner(page, member);
  if (member !== 'nina') await page.getByRole('radio', { name: /is available\./ }).check();
  await page.getByRole('button', { name: 'Submit input draft' }).click();
  await expect(page.getByRole('status')).toContainText('loopback local API');
}

async function confirm(page: Page, member: 'maya' | 'leo' | 'nina'): Promise<void> {
  await openOwner(page, member);
  const review = page.getByRole('region', { name: 'Confirm reviewed inputs' });
  await expect(review).toBeVisible();
  for (const checkbox of await review.getByRole('checkbox').all()) await checkbox.check();
  await review.getByRole('button', { name: 'Confirm these reviewed intervals' }).click();
  await expect(page.getByRole('status')).toContainText('loopback local API');
}

test('three local people complete an initial negotiation in the browser with independent refusal and approvals', async ({ browser }) => {
  const maya = await browser.newPage();
  const leo = await browser.newPage();
  const nina = await browser.newPage();
  await submit(maya, 'maya');
  await submit(leo, 'leo');
  await submit(nina, 'nina');
  await confirm(maya, 'maya');
  await confirm(leo, 'leo');
  await confirm(nina, 'nina');

  for (const [page, member] of [[maya, 'maya'], [leo, 'leo'], [nina, 'nina']] as const) {
    await openOwner(page, member);
    await page.getByRole('button', { name: 'Confirm current setup' }).click();
    await expect(page.getByRole('status')).toContainText('loopback local API');
  }

  await openOwner(maya, 'maya');
  await expect(maya.getByRole('button', { name: 'Request local plan' })).toBeEnabled();
  await maya.getByRole('button', { name: 'Request local plan' }).click();
  await expect(maya.getByRole('status')).toContainText('loopback local API');

  await openOwner(nina, 'nina');
  await expect(nina.getByRole('region', { name: 'Exception' })).toContainText('Would 2026-10-08 at 11:00–11:30');
  await nina.getByRole('button', { name: 'Allow scoped exception' }).click();
  await expect(nina.getByRole('status')).toContainText('loopback local API');
  await expect(nina.getByRole('region', { name: 'Disclosure' })).toContainText('May the shared table say:');
  await nina.getByRole('button', { name: 'Use exception without announcement' }).click();
  await expect(nina.getByRole('status')).toContainText('loopback local API');

  for (const [page, member] of [[maya, 'maya'], [leo, 'leo'], [nina, 'nina']] as const) {
    await openOwner(page, member);
    await expect(page.getByRole('button', { name: 'Accept reviewed current proposal' })).toBeEnabled();
    await page.getByRole('button', { name: 'Accept reviewed current proposal' }).click();
    await expect(page.getByRole('status')).toContainText('loopback local API');
  }

  await maya.goto('/?local=display');
  await expect(maya.getByText('Agreement recorded for this local example')).toBeVisible();
  await expect(maya.getByRole('region', { name: 'Current proposal' })).toContainText('3 of 3 separate acceptances recorded');
  await expect(maya.getByRole('region', { name: 'Published disclosure ledger' })).toHaveCount(0);
  await Promise.all([maya.close(), leo.close(), nina.close()]);
});
