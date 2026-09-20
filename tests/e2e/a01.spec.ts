import { expect, test } from '@playwright/test';

test('shared surface never loads the owner screen or owner mock chunk', async ({ page }) => {
  const scripts: string[] = [];
  page.on('request', request => {
    if (request.resourceType() === 'script') scripts.push(request.url());
  });
  await page.goto('/?public=private-review');
  await expect(page.getByRole('heading', { name: 'Around the table' })).toBeVisible();
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/condition-synthetic|offer-synthetic|grant-synthetic|currently unavailable|no weekend duties/i);
  expect(scripts.filter(url => /owner/i.test(url))).toEqual([]);
});

test('keyboard navigation reaches the owner demo and returns to the shared surface', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const ownerLink = page.getByRole('link', { name: 'Open private owner demo' });
  await expect(ownerLink).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Your inputs' })).toBeVisible();
  await page.keyboard.press('Tab');
  const sharedLink = page.getByRole('link', { name: 'Return to shared table' });
  await expect(sharedLink).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Around the table' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your inputs' })).toHaveCount(0);
});

test('public proposal shows dated assignments and separate approval count', async ({ page }) => {
  await page.goto('/?public=proposed');
  const proposal = page.getByRole('region', { name: 'Current proposal' });
  await expect(proposal).toContainText('11:00–11:30');
  await expect(proposal).toContainText('Maya');
  await expect(proposal).toContainText('Leo');
  await expect(proposal).toContainText('0 of 3');
  await page.goto('/?public=agreed');
  await expect(page.getByRole('region', { name: 'Current proposal' })).toContainText('3 of 3');
  await page.goto('/?public=superseded');
  await expect(page.getByRole('heading', { name: 'Around the table' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Current proposal' })).toHaveCount(0);
});

test('local drafts retain values and consent feedback stays independent', async ({ page }) => {
  await page.goto('/?view=owner');
  const inputs = page.getByRole('region', { name: 'Your inputs' });
  await inputs.getByRole('radio', { name: /2026-10-08.*is available\./ }).check();
  await inputs.getByRole('combobox', { name: 'Follow-up duty cost' }).selectOption('3');
  await inputs.getByRole('button', { name: 'Save local input draft' }).click();
  await expect(inputs.getByRole('status')).toContainText('available');
  await expect(inputs.getByRole('status')).toContainText('cost 3');
  await page.getByRole('button', { name: 'Allow scoped exception' }).click();
  await page.getByRole('button', { name: 'Use exception without announcement' }).click();
  await expect(page.getByRole('region', { name: 'Exception', exact: true }).getByRole('status')).toContainText('exception marked allowed');
  await expect(page.getByRole('region', { name: 'Disclosure', exact: true }).getByRole('status')).toContainText('without this announcement');
  await expect(page.getByRole('button', { name: 'Await an exact shared proposal' })).toBeDisabled();
  await page.getByRole('link', { name: 'Return to shared table' }).click();
  await expect(page.getByRole('heading', { name: 'Around the table' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('exception marked allowed');
  await expect(page.locator('body')).not.toContainText('cost 3');
});

test('stale owner data disables local editing and permissions until refreshed', async ({ page }) => {
  await page.goto('/?view=owner&owner=stale');
  await expect(page.getByRole('button', { name: 'Allow scoped exception' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Allow this wording' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save local input draft' })).toBeDisabled();
  await page.getByRole('button', { name: 'Refresh private example' }).click();
  await expect(page.getByRole('button', { name: 'Allow scoped exception' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Save local input draft' })).toBeEnabled();
});

for (const view of ['public', 'owner']) {
  const prefix = view === 'owner' ? '?view=owner&owner=' : '?public=';

  test(`${view} announces loading before showing its snapshot`, async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-01T12:00:00Z') });
    await page.clock.pauseAt(new Date('2026-10-01T12:00:01Z'));
    await page.goto(`${prefix}${view === 'owner' ? 'review' : 'collecting'}`);
    await expect(page.getByRole('status')).toContainText(/loading/i);
    await page.clock.runFor(1000);
    await expect(page.getByRole('heading', { name: view === 'owner' ? /your inputs/i : 'Around the table' })).toBeVisible();
  });

  test(`${view} failure can be retried without a page reload`, async ({ page }) => {
    await page.goto(`${prefix}failure`);
    await expect(page.getByRole('alert')).toBeVisible();
    await page.getByRole('button', { name: /retry/i }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: view === 'owner' ? /your inputs/i : 'Around the table' })).toBeVisible();
  });

  test(`${view} stale state requires refresh`, async ({ page }) => {
    await page.goto(`${prefix}stale`);
    await expect(page.getByRole('alert')).toContainText(/stale|changed|out of date/i);
    await page.getByRole('button', { name: /refresh/i }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test(`${view} empty state explains the absence of data`, async ({ page }) => {
    await page.goto(`${prefix}empty`);
    await expect(page.getByRole('status')).toContainText(/no .*|nothing .*|empty/i);
  });
}

for (const width of [390, 1280]) {
  test(`owner screen at ${width}px keeps consent choices distinct`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/?view=owner');
    await expect(page.getByText('Private owner screen · local demo', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: /exception/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /disclosure/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /final.*approval|plan.*acceptance/i })).toBeVisible();
    await expect(page.locator('body')).toContainText('America/Mexico_City');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`owner-${width}.png`), fullPage: true });
    await page.goto('/?view=owner&owner=approval');
    await expect(page.getByRole('region', { name: 'Final plan acceptance' })).toContainText('proposal-A');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
