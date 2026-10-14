import { test, expect } from '@playwright/test';
test.use({ baseURL: 'http://127.0.0.1:5175' });
for (const theme of ['light', 'dark']) for (const width of [390, 1280]) {
  test(`${theme} owner profile modal edits safely at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(({ colorScheme }) => {
      sessionStorage.setItem('known-enough-cognito-session', JSON.stringify({ accessToken: 'synthetic.profile.test', kind: 'participant', expiresAt: Date.now() + 900000 }));
      localStorage.setItem('ke-appearance', colorScheme);
    }, { colorScheme: theme });
    let profile: { status: 'PENDING'; displayName: string; version: number; description: string; image: null | { id: string; mimeType: 'image/png'; width: number; height: number; bytesBase64: string; sha256: string }; loginUsername: string | null } = { status: 'PENDING', displayName: 'New member', version: 1, description: '', image: null, loginUsername: 'synthetic-login' };
    const paths: string[] = [];
    await page.route('https://local-api.example.invalid/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname; paths.push(path);
      if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' } }); return; }
      let body: unknown = { account: { status: 'PENDING', displayName: profile.displayName, version: profile.version } };
      if (path === '/account/profile') {
        if (request.method() === 'POST') { const patch = request.postDataJSON(); expect(patch.version).toBe(profile.version); expect(Object.keys(patch).sort()).toEqual(['description', 'displayName', 'version']); profile = { ...profile, ...patch, version: profile.version + 1 }; }
        body = { profile };
      } else if (path === '/account/profile/image') {
        const patch = request.postDataJSON(); expect(patch.version).toBe(profile.version); expect(Object.keys(patch).sort()).toEqual(['bytesBase64', 'version']);
        profile = { ...profile, version: profile.version + 1, image: patch.bytesBase64 ? { id: 'synthetic-avatar', mimeType: 'image/png', width: 1, height: 1, bytesBase64: patch.bytesBase64, sha256: 'a'.repeat(64) } : null };
        body = { profile };
      } else if (path !== '/account') { await route.fulfill({ status: 404, body: '{}' }); return; }
      await route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    });
    await page.goto('/');
    await expect(page.getByText('Your account is waiting for approval.', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Request access', exact: true })).toHaveCount(0);
    expect(paths).not.toContain('/account/profile'); // Closed account menu does not read profile data.
    const accountMenu = page.getByRole('button', { name: 'Open account menu' });
    await accountMenu.click();
    await expect(page.getByRole('menuitem', { name: 'Your profile' })).toBeFocused();
    await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
    await page.keyboard.press('ArrowDown'); await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeFocused();
    await page.keyboard.press('ArrowUp'); await expect(page.getByRole('menuitem', { name: 'Your profile' })).toBeFocused();
    await page.keyboard.press('Escape'); await expect(accountMenu).toBeFocused();
    await accountMenu.click();
    await page.getByRole('menuitem', { name: 'Your profile' }).click();
    await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeFocused();
    await expect(page.getByText('No bio yet.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
    const modal = page.locator('dialog.ke-profile-modal[open]');
    const box = await modal.boundingBox(); expect(box?.width).toBeLessThanOrEqual(width > 480 ? 460 : width - 24);
    await page.getByRole('button', { name: 'Edit profile' }).click();
    await expect(page.getByRole('button', { name: 'Change photo' })).toBeVisible();
    const photoPicker = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Change photo' }).click();
    const chooser = await photoPicker;
    await chooser.setFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pOQAAAAASUVORK5CYII=', 'base64') });
    await expect(page.locator('.ke-profile-avatar img')).toHaveCount(1);
    await page.getByLabel('Display name', { exact: true }).fill('<img src=x onerror=alert(1)>');
    await page.getByLabel('Bio', { exact: true }).fill('ZZ_SHARED_PROFILE_BIO');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('.ke-profile-summary-copy h3')).toHaveText('<img src=x onerror=alert(1)>');
    await expect(page.getByText('ZZ_SHARED_PROFILE_BIO', { exact: true })).toBeVisible();
    expect(await page.locator('img[src=x]').count()).toBe(0);
    await page.keyboard.press('Escape');
    await expect(accountMenu).toBeFocused();
    await expect(page.getByText('ZZ_SHARED_PROFILE_BIO', { exact: true })).toBeHidden();
    if (width > 480) {
      await accountMenu.click(); await page.getByRole('menuitem', { name: 'Your profile' }).click();
      await page.mouse.click(10, 300);
      await expect(accountMenu).toBeFocused();
    }
    await page.reload(); await accountMenu.click(); await page.getByRole('menuitem', { name: 'Your profile' }).click();
    await expect(page.getByText('ZZ_SHARED_PROFILE_BIO', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Edit profile' }).click();
    await page.getByLabel('Display name', { exact: true }).fill('discarded');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.locator('.ke-profile-summary-copy h3')).toHaveText('<img src=x onerror=alert(1)>');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate(() => JSON.stringify({ ...sessionStorage, ...localStorage }))).not.toContain('ZZ_SHARED_PROFILE_BIO');
  });
}

for (const width of [390, 1280]) {
  test(`same-group participants can view a minimal profile at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(() => sessionStorage.setItem('known-enough-cognito-session', JSON.stringify({ accessToken: 'synthetic.group.profile', kind: 'participant', expiresAt: Date.now() + 900000 })));
    const paths: string[] = [];
    const group = { id: 'garden', name: 'Garden group', version: 1, isOrganizer: true,
      members: [{ id: 'member-organizer', displayName: 'Organizer name', isOrganizer: true }, { id: 'member-viewer', displayName: 'Guest name', isOrganizer: false }],
      drafts: [], pendingInvitations: 0, decisions: [] };
    await page.route('https://local-api.example.invalid/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname; paths.push(path);
      const body = path === '/account' ? { account: { status: 'APPROVED', displayName: 'Guest name', version: 1 } }
        : path === '/groups' ? { groups: [group] }
        : path === '/groups/garden' ? { group }
        : path === '/groups/garden/members/member-organizer/profile' ? { profile: { displayName: 'Organizer name', description: 'We make decisions thoughtfully.', image: {
          mimeType: 'image/png', width: 1, height: 1, bytesBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pOQAAAAASUVORK5CYII=' } } }
        : {};
      await route.fulfill({ status: path.includes('/profile') || path === '/account' || path === '/groups' || path === '/groups/garden' ? 200 : 404,
        contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Open group Garden group' }).click();
    const openProfile = page.getByRole('button', { name: "View Organizer name's profile" });
    await openProfile.locator(width > 480 ? '.ke-member-name' : '.ke-member-avatar').click();
    await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible();
    await expect(page.locator('.ke-profile-summary-copy h3')).toHaveText('Organizer name');
    await expect(page.getByText('We make decisions thoughtfully.')).toBeVisible();
    await expect(page.locator('.ke-profile-avatar img')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Edit profile' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Change photo' })).toHaveCount(0);
    expect(JSON.stringify(paths)).not.toContain('/account/profile');
    await page.keyboard.press('Escape'); await expect(openProfile).toBeFocused();
    if (width > 480) {
      await openProfile.click(); await page.mouse.click(10, 300); await expect(openProfile).toBeFocused();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
