import { expect, test } from '@playwright/test';
for (const width of [390, 1280]) {
  test(`Known Enough home renders at ${width}px without private data or external requests`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    const external: string[] = [];
    const configuredBaseUrl = testInfo.project.use.baseURL;
    if (typeof configuredBaseUrl !== 'string') throw new Error('Playwright baseURL must be configured for the mock privacy check');
    const configuredOrigin = new URL(configuredBaseUrl).origin;
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (new URL(r.url()).origin !== configuredOrigin) external.push(r.url()); });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Decide together', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What are you trying to decide?' })).toBeVisible();
    await expect(page.getByLabel('Describe the shared objective')).toBeVisible();
    await expect(page.getByText('Your private inputs are processed by Known Enough', { exact: false })).toBeVisible();
    expect(await page.locator('body').innerText()).not.toMatch(/Deal Table|meeting slots|weekend duties|TeamTable \*/i);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]); expect(external).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`known-enough-${width}.png`), fullPage: true });
  });
}

test('draft, private-space, and proposal surfaces stay local and describe what is not connected', async ({ page }) => {
  let body: Record<string, unknown> | null = null;
  await page.route('http://127.0.0.1:8787/decisions/architecture/draft', async route => {
    body = route.request().postDataJSON() as Record<string, unknown>;
    const participants = body.participants as { id: string; displayName: string }[];
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      requestId: body.requestId,
      draft: {
        draftId: body.draftId, revision: body.revision, status: 'NEEDS_CLARIFICATION',
        frame: {
          schemaVersion: 2, decisionId: 'preview-decision', frameVersion: 1, semanticVersion: 1,
          contextToken: 'a'.repeat(64), title: 'Family Christmas trip', objective: body.objective,
          description: 'A local frame draft.',
          participants: participants.map(person => ({ ...person, requiredForApproval: true })),
          requiredParticipantIds: participants.map(person => person.id),
          variables: [{ id: 'destination', type: 'ENUM', label: 'Destination', required: true, visibility: 'PUBLIC',
            options: [{ id: 'cancun', label: 'Cancún' }, { id: 'oaxaca', label: 'Oaxaca' }] }],
          rules: [],
        },
        clarificationQuestions: ['Which date range should the group consider?'],
        participantInformationRequirements: participants.map(person => ({ participantId: person.id, prompt: 'Share dates that work for you.' })),
      },
    }) });
  });
  await page.goto('/');
  await page.getByLabel('Describe the shared objective').fill('Choose a family Christmas trip.');
  await page.getByLabel('Proposed participants (comma-separated fictional names)').fill('Maya, Leo');
  await page.getByLabel('Options already under consideration (optional, comma-separated)').fill('Cancún, Oaxaca');
  await page.getByRole('button', { name: 'Draft the shared frame' }).click();
  await expect(page.getByRole('heading', { name: 'Family Christmas trip' })).toBeVisible();
  await expect(page.getByText('Needs clarification · draft only')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Participants' })).toContainText('Maya · proposed, not verified');
  await expect(page.getByRole('list', { name: 'Draft shared topics' })).toContainText('Cancún, Oaxaca');
  await expect(page.getByText('Which date range should the group consider?')).toBeVisible();
  expect(body).toMatchObject({ objective: 'Choose a family Christmas trip.', allowedOptions: ['Cancún', 'Oaxaca'] });
  expect(JSON.stringify(body)).not.toMatch(/private|condition-synthetic|budget/i);
  await page.getByRole('button', { name: 'Your private space' }).click();
  await expect(page.getByText('This is a local-only conversation prototype for fictional input.')).toBeVisible();
  await page.getByRole('button', { name: 'Use fictional sample' }).click();
  await page.getByRole('button', { name: 'Review my private draft' }).click();
  const privateDraft = page.locator('[aria-label="Private draft review"]');
  await expect(privateDraft.getByRole('heading', { name: 'Hard limits' })).toBeVisible();
  await expect(privateDraft).toContainText('cannot exceed $2,000');
  await expect(privateDraft).toContainText('Prefer a total at or below $1,500');
  await expect(privateDraft).toContainText('only for a direct flight');
  await expect(privateDraft).not.toContainText('personal loan');
  await privateDraft.getByRole('button', { name: 'Confirm this draft in the local preview' }).click();
  await expect(privateDraft).toContainText('Marked confirmed in this local preview only');
  await page.getByLabel('Describe one private condition').fill('My view changed; I need clarification.');
  await expect(page.locator('[aria-label="Private draft review"]')).toHaveCount(0);
  await expect(page.getByText('Marked confirmed in this local preview only')).toHaveCount(0);
  await page.getByRole('button', { name: 'Review my private draft' }).click();
  await expect(page.locator('[aria-label="Private draft review"]')).toContainText('cannot safely interpret');
  expect(body).not.toHaveProperty('messages');
  await page.getByRole('button', { name: 'Proposal' }).click();
  await expect(page.getByText('The frame structure was checked against supported contract types.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Nothing here yet' })).toBeVisible();
});

test('retained TeamTable route remains an explicit legacy preview', async ({ page }) => {
  await page.goto('/?legacy=teamtable');
  await expect(page.getByRole('heading', { name: 'Deal Table', exact: true })).toBeVisible();
  await expect(page.getByText('Shared table · local demo')).toBeVisible();
});
