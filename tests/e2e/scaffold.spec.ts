import { expect, test } from '@playwright/test';
for (const width of [390, 1280]) {
  test(`shared table renders at ${width}px without private data or external requests`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    const external: string[] = [];
    const configuredBaseUrl = testInfo.project.use.baseURL;
    if (typeof configuredBaseUrl !== 'string') throw new Error('Playwright baseURL must be configured for the mock privacy check');
    const configuredOrigin = new URL(configuredBaseUrl).origin;
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (new URL(r.url()).origin !== configuredOrigin) external.push(r.url()); });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Deal Table', exact: true })).toBeVisible();
    for (const name of ['Maya', 'Leo', 'Nina']) await expect(page.getByText(name, { exact: true })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Three meeting slots' }).getByRole('listitem')).toHaveCount(3);
    await expect(page.getByText('Unassigned', { exact: true })).toHaveCount(2);
    await expect(page.getByText('All times: America/Mexico_City')).toBeVisible();
    await expect(page.getByText('Shared table · local demo')).toBeVisible();
    await expect(page.getByText('Collecting shared confirmations').first()).toBeVisible();
    expect(await page.locator('body').innerText()).not.toMatch(/condition-synthetic|offer-synthetic|no weekend duties|currently unavailable/i);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]); expect(external).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`shared-${width}.png`), fullPage: true });
  });
}
