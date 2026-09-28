import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, accountId = 'maya') {
  await page.getByLabel('Test user', { exact: true }).selectOption(accountId);
  await page.getByRole('button', { name: 'Start local test session' }).click();
  if (accountId === 'display') await expect(page.getByRole('heading', { name: 'Shared display' })).toBeVisible();
  else await expect(page.getByText(`Local test session · ${accountId === 'maya' ? 'Maya · organizer' : accountId[0]!.toUpperCase() + accountId.slice(1)}`)).toBeVisible();
}

async function participantForSession(page: Page): Promise<{ status: number; participantId: string }> {
  return page.evaluate(async () => {
    const raw = sessionStorage.getItem('known-enough-local-test-session');
    if (!raw) throw new Error('missing local test session');
    const session = JSON.parse(raw) as { token: string };
    const response = await fetch('http://127.0.0.1:8788/decisions/christmas-decision/me', {
      headers: { authorization: `Bearer ${session.token}` },
    });
    const body = await response.json() as { ownerParticipantId?: string };
    return { status: response.status, participantId: body.ownerParticipantId ?? '' };
  });
}

for (const width of [390, 1280]) {
  test(`Known Enough home renders at ${width}px without private data or external requests`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    const external: string[] = [];
    const configuredBaseUrl = testInfo.project.use.baseURL;
    if (typeof configuredBaseUrl !== 'string') throw new Error('Playwright baseURL must be configured for the mock privacy check');
    const configuredOrigin = new URL(configuredBaseUrl).origin;
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => {
      if (![configuredOrigin, 'http://127.0.0.1:8788'].includes(new URL(r.url()).origin)) external.push(r.url());
    });
    await page.goto('/');
    await signIn(page);
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
  await page.route('http://127.0.0.1:8788/decisions/architecture/draft', async route => {
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
  await signIn(page);
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

test('five participants join through invitations, see only their owner snapshots, and keep display read-only', async ({ page, browser }, testInfo) => {
  const contexts = [] as Awaited<ReturnType<typeof browser.newContext>>[];
  try {
  await page.goto('/');
  await signIn(page, 'maya');
  const demo = page.getByRole('region', { name: 'Try the fictional Christmas decision' });
  await expect(demo).toContainText('the hosted HTTPS preview remains a static mock with no shared state');

  const participantPages = new Map<string, Page>();
  for (const participant of ['leo', 'nina', 'ana', 'raul']) {
    await page.getByLabel('Participant', { exact: true }).selectOption(participant);
    await demo.getByRole('button', { name: 'Create invitation link' }).click();
    const invitation = await page.getByLabel('Copy this one-time link and send it yourself').inputValue();
    expect(invitation).toContain('#invite=');

    if (participant === 'leo') {
      const wrongContext = await browser.newContext(); contexts.push(wrongContext);
      const wrongPage = await wrongContext.newPage();
      await wrongPage.goto(invitation);
      await signIn(wrongPage, 'raul');
      await wrongPage.getByRole('button', { name: 'Accept local invitation' }).click();
      await expect(wrongPage.getByRole('alert')).toContainText('belongs to another test user');
      await expect(wrongPage.getByRole('heading', { name: 'Family Christmas trip', exact: true })).toHaveCount(0);
    }

    const context = await browser.newContext(); contexts.push(context);
    const participantPage = await context.newPage();
    await participantPage.goto(invitation);
    await expect(participantPage.getByText('An invitation link is waiting in this browser tab.')).toBeVisible();
    await signIn(participantPage, participant);
    await participantPage.getByRole('button', { name: 'Accept local invitation' }).click();
    await expect(participantPage.getByRole('region', { name: 'Try the fictional Christmas decision' }).locator('.ke-demo-summary'))
      .toContainText('Family Christmas trip');
    expect(await participantForSession(participantPage)).toEqual({ status: 200, participantId: participant });
    participantPages.set(participant, participantPage);
    await demo.getByRole('button', { name: 'Hide invitation link' }).click();
  }

  const unauthorized = await participantForSession(participantPages.get('leo')!);
  expect(unauthorized.participantId).toBe('leo');
  const leoSession = await participantPages.get('leo')!.evaluate(() => {
    const raw = sessionStorage.getItem('known-enough-local-test-session');
    if (!raw) throw new Error('missing local test session');
    const session = JSON.parse(raw) as { token: string; accountId: string };
    session.accountId = 'nina';
    sessionStorage.setItem('known-enough-local-test-session', JSON.stringify(session));
    return session.token;
  });
  expect(await participantPages.get('leo')!.evaluate(async token => {
    const response = await fetch('http://127.0.0.1:8788/decisions/christmas-decision/me', { headers: { authorization: `Bearer ${token}` } });
    const body = await response.json() as { ownerParticipantId?: string };
    return { status: response.status, participantId: body.ownerParticipantId };
  }, leoSession)).toEqual({ status: 200, participantId: 'leo' });
  expect(await participantPages.get('leo')!.evaluate(async token => {
    const response = await fetch('http://127.0.0.1:8788/decisions/christmas-decision/me?participantId=maya&ownerParticipantId=maya', {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = await response.json() as { ownerParticipantId?: string };
    return { status: response.status, participantId: body.ownerParticipantId };
  }, leoSession)).toEqual({ status: 200, participantId: 'leo' });

  await demo.getByRole('button', { name: 'Load local scenario' }).click();
  await expect(demo.locator('.ke-demo-summary')).toContainText('Family Christmas trip');
  await demo.getByRole('button', { name: 'Generate candidate' }).click();
  await expect(demo.getByText('Local reasoning outcome: NEEDS_PERMISSION.')).toBeVisible();
  const ninaPage = participantPages.get('nina')!;
  const ninaDemo = ninaPage.getByRole('region', { name: 'Try the fictional Christmas decision' });
  await expect(ninaDemo.locator('.ke-demo-summary')).toContainText('Family Christmas trip');
  await ninaDemo.getByRole('button', { name: 'Refresh local scenario' }).click();
  const question = ninaDemo.getByRole('region', { name: 'Private negotiation question' });
  await expect(question.getByRole('heading', { name: 'Optional one-time adjustment' })).toBeVisible();
  await expect(question).toContainText('Cancún, Oaxaca');
  await expect(question).toContainText('Mazatlán');
  await question.getByRole('button', { name: 'Allow this exact adjustment' }).click();
  await expect(ninaDemo.getByText('Local reasoning outcome: APPLIED.')).toBeVisible();
  await expect(ninaDemo.locator('.ke-demo-summary')).toContainText('PROPOSED');
  await expect(ninaDemo.getByRole('heading', { name: 'Validated proposal · public facts only' })).toBeVisible();
  await expect(ninaDemo.getByText('Destination: Mazatlán')).toBeVisible();
  await expect(ninaDemo.getByText(/maya-budget-limit|nina-destination-flexibility|personal loan|older relative/)).toHaveCount(0);

  const displayContext = await browser.newContext(); contexts.push(displayContext);
  const displayPage = await displayContext.newPage();
  await displayPage.goto(new URL('/', page.url()).toString());
  await signIn(displayPage, 'display');
  await expect(displayPage.getByRole('heading', { name: 'Shared display' })).toBeVisible();
  await expect(displayPage.getByRole('button', { name: /allow|decline|approve|confirm/i })).toHaveCount(0);
  const displayResult = await displayPage.evaluate(async () => {
    const raw = sessionStorage.getItem('known-enough-local-test-session');
    if (!raw) throw new Error('missing local display session');
    const token = (JSON.parse(raw) as { token: string }).token;
    const response = await fetch('http://127.0.0.1:8788/decisions/christmas-decision/commands', {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: 'display-write', type: 'CONFIRM_FRAME' }),
    });
    return response.status;
  });
  expect(displayResult).toBe(403);
  await page.screenshot({ path: testInfo.outputPath('christmas-mvp.png'), fullPage: true });
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
});
