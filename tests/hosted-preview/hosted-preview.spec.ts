import { expect, test } from '@playwright/test';

test('hosted public preview ignores owner, local identity, and scenario query strings', async ({ page }) => {
  const externalRequests: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).origin !== 'http://127.0.0.1:4174') externalRequests.push(request.url());
  });

  for (const query of [
    '?view=owner&owner=review',
    '?local=maya&view=owner',
    '?local=display&public=agreed',
    '?public=failure',
  ]) {
    await page.goto(`/hosted-preview/index.html${query}`);
    await expect(page.getByText('Hosted mock preview — simulated data, no shared state')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Around the table' })).toBeVisible();
    await expect(page.getByText('Collecting shared confirmations')).toHaveCount(2);
    await expect(page.getByText('Collecting shared confirmations').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: /Private owner screen/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Open private owner demo' })).toHaveCount(0);
  }

  expect(externalRequests).toEqual([]);
});
