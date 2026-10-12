import { test, expect } from '@playwright/test';
test.use({ baseURL: 'http://127.0.0.1:5175' });
for (const width of [390, 1280]) {
  test(`pending own profile drawer saves text safely and reloads at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(() => sessionStorage.setItem('known-enough-cognito-session', JSON.stringify({ accessToken: 'synthetic.profile.test', kind: 'participant', expiresAt: Date.now() + 900000 })));
    let profile = { status: 'PENDING', displayName: 'New member', version: 1, description: '', image: null, loginUsername: 'synthetic-login' };
    const paths: string[] = [];
    await page.route('https://local-api.example.invalid/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname; paths.push(path);
      if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' } }); return; }
      let body: unknown = { account: { status: 'PENDING', displayName: profile.displayName, version: profile.version } };
      if (path === '/account/profile') {
        if (request.method() === 'POST') { const patch = request.postDataJSON(); expect(patch.version).toBe(profile.version); expect(Object.keys(patch).sort()).toEqual(['description', 'displayName', 'version']); profile = { ...profile, ...patch, version: profile.version + 1 }; }
        body = { profile };
      } else if (path !== '/account') { await route.fulfill({ status: 404, body: '{}' }); return; }
      await route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    });
    await page.goto('/');
    await expect(page.getByText('Your account is waiting for approval.', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Request access', exact: true })).toHaveCount(0);
    expect(paths).not.toContain('/account/profile'); // closed drawer does not read private data
    await page.getByRole('button', { name: 'Open your profile' }).click();
    await expect(page.getByRole('heading', { name: 'Your profile', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Edit profile' }).click();
    await page.getByLabel('Display name', { exact: true }).fill('<img src=x onerror=alert(1)>');
    await page.getByLabel('Description · only you').fill('ZZ_PRIVATE_PROFILE_CANARY');
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByRole('heading', { name: '<img src=x onerror=alert(1)>', exact: true })).toBeVisible();
    expect(await page.locator('img[src=x]').count()).toBe(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Open your profile' })).toBeFocused();
    await expect(page.getByText('ZZ_PRIVATE_PROFILE_CANARY', { exact: true })).toBeHidden();
    await page.reload(); await page.getByRole('button', { name: 'Open your profile' }).click();
    await expect(page.getByText('ZZ_PRIVATE_PROFILE_CANARY', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Edit profile' }).click();
    await page.getByLabel('Display name', { exact: true }).fill('discarded');
    await page.getByRole('button', { name: 'Cancel edits' }).click();
    await expect(page.getByRole('heading', { name: '<img src=x onerror=alert(1)>', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate(() => JSON.stringify({ ...sessionStorage, ...localStorage }))).not.toContain('ZZ_PRIVATE_PROFILE_CANARY');
  });
}
