import { test, expect } from '@playwright/test';
test.use({ baseURL: 'http://127.0.0.1:5175' });
for (const width of [390, 1280]) {
  test(`one account entry without shared-screen access at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/#groupInvite=' + 'q'.repeat(43));
    await expect(page.getByRole('heading', { name: 'Decide together.' })).toBeVisible();
    expect(page.url()).not.toContain('groupInvite');
    await page.screenshot({ path: `/tmp/zz-entry-regression-${width}.png`, fullPage: true });
    await expect(page.getByRole('button', { name: 'Create account', exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Shared display sign-in' })).toBeHidden();
    await expect(page.getByText('Shared screen access', { exact: true })).toHaveCount(0);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Create account', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeFocused();
    await expect(page.getByRole('button', { name: 'Create account', exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Shared display sign-in' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Cancel account creation' }).click();
    await expect(page.getByRole('button', { name: 'Create account', exact: true })).toBeFocused();
    await expect(page.getByText('Shared screen access', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Shared display sign-in' })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('ke-group-invite') ?? 'null')?.token)).toBe('q'.repeat(43));
  });
}
