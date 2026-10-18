import { expect, test, type Page } from '@playwright/test';
import type { Groups } from '@deal-table/contracts';

test.use({ baseURL: 'http://127.0.0.1:5175' });
const origin = 'https://local-api.example.invalid';
const cursor = 'c'.repeat(40);
function group(id: string): Groups.GroupSnapshot {
  return { id, name: `Group ${id}`, version: 1, isOrganizer: true,
    members: [{ id: 'organizer', displayName: 'Organizer', isOrganizer: true }], drafts: [], decisions: [], pendingInvitations: 0 };
}
async function fixture(page: Page, mode: 'normal' | 'empty' | 'failed' | 'repeated') {
  let pageReads = 0, writes = 0;
  let initialLimit: string | null = null;
  await page.addInitScript(() => sessionStorage.setItem('known-enough-cognito-session', JSON.stringify({
    accessToken: 'header.payload.signature', kind: 'participant', expiresAt: Date.now() + 900000 })));
  await page.route(origin + '/**', async route => {
    const request = route.request(), url = new URL(request.url());
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
    if (request.method() !== 'GET') writes++;
    let body: unknown, status = 200;
    if (url.pathname === '/account') body = { account: { status: 'APPROVED', displayName: 'Organizer', version: 1 } };
    else if (url.pathname === '/invitations') body = { invitations: [] };
    else if (url.pathname === '/groups' && !url.searchParams.has('cursor')) {
      initialLimit = url.searchParams.get('limit');
      expect(initialLimit).toBe('5');
      body = { groups: mode === 'empty' ? [] : [group('first')], cursor };
    }
    else if (url.pathname === '/groups') {
      expect(url.searchParams.get('limit')).toBe(initialLimit); expect(url.searchParams.get('cursor')).toBe(cursor); pageReads++;
      if (mode === 'failed' && pageReads === 1) { status = 503; body = {}; }
      else body = { groups: mode === 'empty' ? [group('later')] : [group('first'), group('later')], cursor: mode === 'repeated' ? cursor : null };
    } else { status = 404; body = {}; }
    await route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
  });
  await page.goto('/');
  return { pageReads: () => pageReads, writes: () => writes };
}

test('later groups become reachable without duplicates or writes', async ({ page }) => {
  const f = await fixture(page, 'normal');
  await expect(page.getByRole('button', { name: 'Open group Group later', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Load more groups', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open group Group later', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open group Group first', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Load more groups', exact: true })).toHaveCount(0);
  expect(f.pageReads()).toBe(1); expect(f.writes()).toBe(0);
});

test('an empty discovery page still offers its next page', async ({ page }) => {
  const f = await fixture(page, 'empty');
  await page.getByRole('button', { name: 'Load more groups', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open group Group later', exact: true })).toBeVisible();
  expect(f.pageReads()).toBe(1); expect(f.writes()).toBe(0);
});

test('failed next-page reads retain current groups and allow an explicit read retry', async ({ page }) => {
  const f = await fixture(page, 'failed');
  await page.getByRole('button', { name: 'Load more groups', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open group Group first', exact: true })).toBeVisible();
  await expect(page.getByText('More groups couldn’t be loaded. Your current groups are kept.')).toBeVisible();
  expect(f.pageReads()).toBe(1);
  await page.getByRole('button', { name: 'Retry loading groups', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open group Group later', exact: true })).toBeVisible();
  expect(f.pageReads()).toBe(2); expect(f.writes()).toBe(0);
});

test('a repeated cursor fails closed and preserves the earlier page', async ({ page }) => {
  const f = await fixture(page, 'repeated');
  await page.getByRole('button', { name: 'Load more groups', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry loading groups', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open group Group first', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open group Group later', exact: true })).toHaveCount(0);
  expect(f.pageReads()).toBe(1); expect(f.writes()).toBe(0);
});
