import { expect, test } from '@playwright/test';

test('private approval mock exposes independent receipts without public leakage', async ({ page }) => {
  await page.goto('/?view=owner&owner=approval');
  await expect(page.getByRole('heading', { name: 'Your private receipts' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Exception receipt' })).toContainText('Active');
  await expect(page.getByRole('article', { name: 'Disclosure receipt' })).toContainText('Active');
  await expect(page.getByRole('article', { name: 'Final approval receipt' })).toContainText('Recorded');
  await expect(page.getByText('Synthetic local receipt:')).toBeVisible();
  await page.goto('/?public=collecting');
  await expect(page.getByRole('heading', { name: 'Deal Table', exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Your private receipts');
  await expect(page.locator('body')).not.toContainText('grant-exception-nina-1');
});

test('private owner receipts remain usable on mobile with reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?view=owner&owner=approval');
  await expect(page.getByRole('heading', { name: 'Your private receipts' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Disclosure receipt' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe('auto');
  expect(await page.evaluate(() => Number.parseFloat(getComputedStyle(document.querySelector('.owner-card')!).transitionDuration))).toBeLessThan(0.001);
});
