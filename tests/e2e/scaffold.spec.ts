import { expect, test } from '@playwright/test';
for (const width of [390, 1280]) {
  test(`public scaffold renders at ${width}px without private data or external requests`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    const external: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (!r.url().startsWith('http://127.0.0.1:4173/')) external.push(r.url()); });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Deal Table', exact: true })).toBeVisible();
    for (const name of ['Maya', 'Leo', 'Nina']) await expect(page.getByText(name, { exact: true })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Three meeting slots' }).getByRole('listitem')).toHaveCount(3);
    await expect(page.getByText('Unassigned', { exact: true })).toHaveCount(2);
    await expect(page.getByText('All times: America/Mexico_City')).toBeVisible();
    await expect(page.getByText('Local mock · fictional data')).toBeVisible();
    await expect(page.getByText('No agreement yet · mock')).toBeVisible();
    expect(await page.locator('body').innerText()).not.toMatch(/condition-synthetic|offer-synthetic|no weekend duties|currently unavailable/i);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]); expect(external).toEqual([]);
  });
}
