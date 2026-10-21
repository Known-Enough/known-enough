import { expect, test, type Page } from '@playwright/test';
import { compileChoicePlan, KnownEnough as KE, type Groups } from '@deal-table/contracts';
import { buildHypotheticalContributionFixture } from '../../packages/test-support/src/known-enough-fixtures';

test.use({ baseURL: 'http://127.0.0.1:5175' });
async function install(page: Page, section = '', bounded = false) {
  const fixture = await buildHypotheticalContributionFixture();
  const id = fixture.publicSnapshot.frame.decisionId;
  if (bounded) {
    const choices = compileChoicePlan({ title: 'Weekend plan', description: '', topics: [{ label: 'Place', kind: 'CHOICE', options: ['Park', 'Museum'] }] });
    fixture.publicSnapshot = KE.PublicDecisionSnapshot.parse({ ...fixture.publicSnapshot, status: 'READY', currentProposal: null, approvedParticipantIds: [],
      frame: { ...fixture.publicSnapshot.frame, variables: choices.variables, rules: choices.rules } });
    fixture.ownerSnapshot = KE.OwnerDecisionSnapshot.parse({ ...fixture.ownerSnapshot, publicSnapshot: fixture.publicSnapshot, privateVariables: [],
      confirmedConstraints: [], privateProposalValues: null, ownApproval: null, ownInputReadiness: 'READY', draft: null, draftVersion: null,
      pendingQuestions: [], negotiationPermissions: [], disclosurePermissions: [] });
  }
  const group: Groups.GroupSnapshot = { id: 'garden', name: 'Shared weekend', version: 1, isOrganizer: true,
    members: fixture.publicSnapshot.frame.participants.map((person, index) => ({ id: person.id, displayName: person.displayName, isOrganizer: index === 0 })),
    drafts: [], decisions: [{ id, title: fixture.publicSnapshot.frame.title, current: true }], pendingInvitations: 0 };
  let ownerReads = 0, writes = 0;
  await page.addInitScript(() => sessionStorage.setItem('known-enough-cognito-session', JSON.stringify({
    accessToken: 'local.synthetic.token', kind: 'participant', expiresAt: Date.now() + 900000,
  })));
  await page.route('https://local-api.example.invalid/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
    if (request.method() !== 'GET') { writes++; await route.fulfill({ status: 503, headers, json: {} }); return; }
    if (path === '/account') { await route.fulfill({ headers, json: { account: { status: 'APPROVED', displayName: 'Organizer', version: 1 } } }); return; }
    if (path === '/groups/garden') { await route.fulfill({ headers, json: { group } }); return; }
    if (path === '/groups/garden/draft-requests') { await route.fulfill({ headers, json: { requests: [] } }); return; }
    if (path === `/decisions/${id}/me`) { ownerReads++; await route.fulfill({ headers, json: fixture.ownerSnapshot }); return; }
    await route.fulfill({ status: 404, headers, json: {} });
  });
  if (bounded) { await page.goto('/?group=garden'); await page.locator('.ke-decision-row-open').click(); }
  else await page.goto(`/?decision=${id}${section ? '&view=' + section : ''}`);
  return { id, fixture, ownerReads: () => ownerReads, writes: () => writes };
}

test('decision details and outcome have direct page URLs, survive refresh and keep chat modal', async ({ page }) => {
  const f = await install(page, 'details');
  await expect(page.getByRole('heading', { name: 'Decision details', exact: true })).toBeVisible();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Decision details', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Back to decision', exact: true }).click();
  await page.getByRole('button', { name: 'View proposal', exact: true }).click();
  await expect(page).toHaveURL(/view=outcome$/);
  await expect(page.getByRole('heading', { name: 'Proposed outcome', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve proposal', exact: true })).toBeDisabled();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await page.screenshot({ path: '/tmp/ke-outcome-page.png', fullPage: true });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Proposed outcome', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Back to decision', exact: true }).click();
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(1);
  expect(f.writes()).toBe(0);
});

test('private-answer edits stay in memory across detail routes and browser Back/Forward without refetching', async ({ page }) => {
  const f = await install(page, '', true);
  await page.getByRole('button', { name: 'Edit answers', exact: true }).click();
  const answer = page.locator('.ke-response-topic input[type="checkbox"]').first();
  const before = await answer.isChecked(); await answer.setChecked(!before);
  const readsBeforeNavigation = f.ownerReads();
  await page.getByLabel('Decision actions', { exact: true }).click();
  await page.getByRole('button', { name: 'Decision details', exact: true }).click();
  await expect(page).toHaveURL(/view=details$/);
  await page.goBack();
  await expect(answer).toBeVisible(); await expect(answer).toBeChecked({ checked: !before });
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'Decision details', exact: true })).toBeVisible();
  await page.goBack();
  await expect(answer).toBeChecked({ checked: !before });
  page.once('dialog', dialog => dialog.dismiss());
  await page.goBack();
  await expect(page).toHaveURL(new RegExp('decision=' + f.id));
  await expect(answer).toBeChecked({ checked: !before });
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('link', { name: 'Back to group', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('decision=' + f.id));
  expect(f.ownerReads()).toBe(readsBeforeNavigation); expect(f.writes()).toBe(0);
});
