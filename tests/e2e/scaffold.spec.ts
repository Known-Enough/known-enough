import { expect, test } from '@playwright/test';
for (const width of [390, 1280]) {
  test(`Known Enough home renders at ${width}px without private data or external requests`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    const external: string[] = [];
    const configuredBaseUrl = testInfo.project.use.baseURL;
    if (typeof configuredBaseUrl !== 'string') throw new Error('Playwright baseURL must be configured for the mock privacy check');
    const configuredOrigin = new URL(configuredBaseUrl).origin;
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (new URL(r.url()).origin !== configuredOrigin) external.push(r.url()); });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Decide together', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What are you trying to decide?' })).toBeVisible();
    await expect(page.getByLabel('Describe the decision')).toBeVisible();
    await expect(page.getByText('Your private inputs are processed by Known Enough', { exact: false })).toBeVisible();
    expect(await page.locator('body').innerText()).not.toMatch(/Deal Table|meeting slots|weekend duties|TeamTable \*/i);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]); expect(external).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`known-enough-${width}.png`), fullPage: true });
  });
}

test('draft, private-space, and proposal surfaces stay local and describe what is not connected', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/')) requests.push(request.url()); });
  await page.goto('/');
  await page.getByLabel('Describe the decision').fill('Choose a place for the group to meet');
  await page.getByRole('button', { name: 'Preview a local draft' }).click();
  await expect(page.getByRole('heading', { name: 'Choose a place for the group to meet' })).toBeVisible();
  await expect(page.getByText('Draft · this browser only')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Participants' })).toContainText('No participants invited yet.');
  await page.getByRole('button', { name: 'Your private space' }).click();
  await expect(page.getByText('Do not enter personal or sensitive information here.')).toBeVisible();
  await page.getByRole('button', { name: 'Proposal' }).click();
  await expect(page.getByText('Nothing is being generated or mechanically checked in this prototype.')).toBeVisible();
  expect(requests).toEqual([]);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Nothing here yet' })).toBeVisible();
});

test('retained TeamTable route remains an explicit legacy preview', async ({ page }) => {
  await page.goto('/?legacy=teamtable');
  await expect(page.getByRole('heading', { name: 'Deal Table', exact: true })).toBeVisible();
  await expect(page.getByText('Shared table · local demo')).toBeVisible();
});
