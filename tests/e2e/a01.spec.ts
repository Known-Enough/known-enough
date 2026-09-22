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

test('owner forms send independent structured commands through intercepted HTTP', async ({ page }) => {
  const commands: unknown[] = [];
  await page.route('**/rooms/room-synthetic/commands', async route => {
    const body = route.request().postDataJSON();
    commands.push(body);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, requestId: body.requestId, status: 'APPLIED', version: body.expected }) });
  });
  await page.goto('/?view=owner');
  const inputs = page.getByRole('region', { name: 'Your inputs' });
  await inputs.getByRole('radio', { name: /2026-10-08.*is available\./ }).check();
  await inputs.getByRole('combobox', { name: 'Follow-up duty cost' }).selectOption('3');
  await inputs.getByRole('button', { name: 'Submit input draft' }).click();
  await expect(page.getByRole('status')).toContainText('Command accepted by the transport');
  await page.getByRole('button', { name: 'Allow scoped exception' }).click();
  await expect(page.getByRole('status')).toContainText('Command accepted by the transport');
  await page.getByRole('button', { name: 'Use exception without announcement' }).click();
  await expect(page.getByRole('status')).toContainText('Command accepted by the transport');
  expect(commands).toHaveLength(3);
  expect(commands.map(value => (value as { type: string }).type)).toEqual(['SUBMIT_INPUT_DRAFT', 'DECIDE_EXCEPTION', 'DECIDE_DISCLOSURE']);
  expect(JSON.stringify(commands)).not.toContain('ownerMemberId');
  expect((commands[0] as { payload: { values: { dutyCosts: { cost: number }[] } } }).payload.values.dutyCosts[0]?.cost).toBe(3);
  expect((commands[0] as { payload: { values: { conditions: { kind: string; availableIntervals?: unknown[] }[] } } }).payload.values.conditions[0]).toMatchObject({ kind: 'HARD_AVAILABILITY', availableIntervals: [{ date: '2026-10-08', startMinute: 660, endMinute: 690, timezone: 'America/Mexico_City' }] });
  await expect(page.getByRole('button', { name: 'Accept reviewed current proposal' })).toBeEnabled();
});

test('owner review confirms explicitly checked draft intervals and binds the displayed policy', async ({ page }) => {
  const commands: unknown[] = [];
  await page.route('**/rooms/room-synthetic/commands', async route => {
    const body = route.request().postDataJSON();
    commands.push(body);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, requestId: body.requestId, status: 'APPLIED', version: body.expected }) });
  });
  await page.goto('/?view=owner&owner=draft');
  const review = page.getByRole('region', { name: 'Confirm reviewed inputs' });
  await expect(review).toContainText('draft-nina-2, revision 2');
  const confirmation = review.getByRole('button', { name: 'Confirm these reviewed intervals' });
  await expect(confirmation).toBeDisabled();
  await review.getByRole('checkbox', { name: /I reviewed 2026-10-08.*11:00–11:30/i }).check();
  await expect(confirmation).toBeEnabled();
  await confirmation.click();
  expect(commands[0]).toMatchObject({ type: 'CONFIRM_INPUTS', payload: { draftId: 'draft-nina-2', draftRevision: 2, expectedOwnerRevision: 2, reviewedIntervals: [{ date: '2026-10-08', timezone: 'America/Mexico_City', startMinute: 660, endMinute: 690 }] } });
  const exception = page.getByRole('region', { name: 'Exception' });
  await expect(exception).toContainText('Balance recent duty load');
  await page.getByRole('button', { name: 'Accept reviewed current proposal' }).click();
  expect(commands[1]).toMatchObject({ type: 'ACCEPT_PROPOSAL', payload: { proposalId: 'proposal-A', proposalVersion: 1, planHash: '27e5ade267f9fa2ee39ba863cd22608a6dbb5a0522596a5eb65b945f5ccc5081' } });
});

test('a changed duration requires checking the newly assessed interval again', async ({ page }) => {
  const commands: unknown[] = [];
  await page.route('**/rooms/room-synthetic/commands', async route => {
    const body = route.request().postDataJSON();
    commands.push(body);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, requestId: body.requestId, status: 'APPLIED', version: body.expected }) });
  });
  await page.goto('/?view=owner&owner=draft');
  const review = page.getByRole('region', { name: 'Confirm reviewed inputs' });
  await review.getByRole('checkbox').check();
  await expect(review.getByRole('button', { name: 'Confirm these reviewed intervals' })).toBeEnabled();
  await page.getByRole('combobox', { name: 'Meeting duration' }).selectOption('60');
  await expect(page.getByRole('radio', { name: /11:00–12:00.*is unavailable/i })).toBeVisible();
  await expect(review.getByRole('button', { name: 'Confirm these reviewed intervals' })).toBeDisabled();
  await page.getByRole('button', { name: 'Submit input draft' }).click();
  await expect(page.getByRole('status')).toContainText('Command accepted by the transport');
  await expect(review).toContainText('has not been returned as a current private snapshot');
  await expect(review.getByRole('checkbox')).toBeDisabled();
  await expect(review.getByRole('button', { name: 'Confirm these reviewed intervals' })).toBeDisabled();
  expect(commands).toHaveLength(1);
  expect(commands[0]).toMatchObject({ type: 'SUBMIT_INPUT_DRAFT', payload: { values: { conditions: [{ kind: 'NEGOTIABLE_UNAVAILABLE', interval: { startMinute: 660, endMinute: 720 } }] } } });
});

test('availability and cost edits cannot reconfirm a saved draft', async ({ page }) => {
  await page.goto('/?view=owner&owner=draft');
  const review = page.getByRole('region', { name: 'Confirm reviewed inputs' });
  const confirmation = review.getByRole('button', { name: 'Confirm these reviewed intervals' });
  await review.getByRole('checkbox').check();
  await expect(confirmation).toBeEnabled();
  await page.getByRole('combobox', { name: 'Follow-up duty cost' }).selectOption('3');
  await expect(confirmation).toBeDisabled();
  await page.reload();
  await review.getByRole('checkbox').check();
  await expect(confirmation).toBeEnabled();
  await page.getByRole('radio', { name: /is available/i }).check();
  await expect(confirmation).toBeDisabled();
});

test('a hard-first draft initializes and submits the same negotiable condition', async ({ page }) => {
  const commands: { type: string; payload: { values: { conditions: unknown[] } } }[] = [];
  await page.route('**/rooms/room-synthetic/commands', async route => {
    const body = route.request().postDataJSON();
    commands.push(body);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, requestId: body.requestId, status: 'APPLIED', version: body.expected }) });
  });
  await page.goto('/?view=owner&owner=hard-first-draft');
  const inputs = page.getByRole('region', { name: 'Your inputs' });
  await expect(inputs.getByRole('radio', { name: /11:00–11:30.*is unavailable/i })).toBeChecked();
  await inputs.getByRole('button', { name: 'Submit input draft' }).click();
  await expect.poll(() => commands).toHaveLength(1);
  expect(commands[0]?.payload.values.conditions).toEqual([
    { id: 'hard-owner', kind: 'HARD_AVAILABILITY', availableIntervals: [
      { date: '2026-10-08', timezone: 'America/Mexico_City', startMinute: 660, endMinute: 720 },
      { date: '2026-10-11', timezone: 'America/Mexico_City', startMinute: 600, endMinute: 660 },
    ] },
    { id: 'condition-nina-1100', kind: 'NEGOTIABLE_UNAVAILABLE', interval: { date: '2026-10-08', timezone: 'America/Mexico_City', startMinute: 660, endMinute: 690 }, inviteException: true },
  ]);

  await inputs.getByRole('combobox', { name: 'Meeting duration' }).selectOption('60');
  await inputs.getByRole('radio', { name: /11:00–12:00.*is available/i }).check();
  await inputs.getByRole('button', { name: 'Submit input draft' }).click();
  await expect.poll(() => commands).toHaveLength(2);
  expect(commands[1]?.payload.values.conditions).toEqual([
    { id: 'hard-owner', kind: 'HARD_AVAILABILITY', availableIntervals: [
      { date: '2026-10-08', timezone: 'America/Mexico_City', startMinute: 660, endMinute: 720 },
      { date: '2026-10-11', timezone: 'America/Mexico_City', startMinute: 600, endMinute: 660 },
    ] },
    { id: 'condition-nina-1100', kind: 'HARD_AVAILABILITY', availableIntervals: [
      { date: '2026-10-08', timezone: 'America/Mexico_City', startMinute: 660, endMinute: 720 },
    ] },
  ]);
});

test('an accepted no-edit draft submission invalidates the prior confirmation', async ({ page }) => {
  const commands: { type: string }[] = [];
  await page.route('**/rooms/room-synthetic/commands', async route => {
    const body = route.request().postDataJSON();
    commands.push(body);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, requestId: body.requestId, status: 'APPLIED', version: body.expected }) });
  });
  await page.goto('/?view=owner&owner=draft');
  const review = page.getByRole('region', { name: 'Confirm reviewed inputs' });
  await review.getByRole('checkbox').check();
  await expect(review.getByRole('button', { name: 'Confirm these reviewed intervals' })).toBeEnabled();
  await page.getByRole('button', { name: 'Submit input draft' }).click();
  await expect(page.getByRole('status')).toContainText('Command accepted by the transport');
  await expect(review).toContainText('has not been returned as a current private snapshot');
  await expect(review.getByRole('checkbox')).toBeDisabled();
  await expect(review.getByRole('button', { name: 'Confirm these reviewed intervals' })).toBeDisabled();
  expect(commands.map(command => command.type)).toEqual(['SUBMIT_INPUT_DRAFT']);
});

test('an unknown no-edit draft submission keeps confirmation invalid and retries unchanged', async ({ page }) => {
  const requests: unknown[] = [];
  await page.route('**/rooms/room-synthetic/commands', async route => {
    requests.push(route.request().postDataJSON());
    await route.abort('failed');
  });
  await page.goto('/?view=owner&owner=draft');
  const review = page.getByRole('region', { name: 'Confirm reviewed inputs' });
  await review.getByRole('checkbox').check();
  await expect(review.getByRole('button', { name: 'Confirm these reviewed intervals' })).toBeEnabled();
  await page.getByRole('button', { name: 'Submit input draft' }).click();
  await expect(page.getByRole('status')).toContainText('outcome is unknown');
  await expect(review.getByRole('checkbox')).toBeDisabled();
  await expect(review.getByRole('button', { name: 'Confirm these reviewed intervals' })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry unchanged request' }).click();
  await expect.poll(() => requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  await expect(review.getByRole('button', { name: 'Confirm these reviewed intervals' })).toBeDisabled();
});

for (const [label, body] of [['malformed JSON', '{'], ['unrecognized JSON', JSON.stringify({ upstream: 'unknown' })]] as const) {
  test(`an ${label} command result preserves the unchanged retry envelope`, async ({ page }) => {
    const requests: { idempotencyKey: string; payload: unknown }[] = [];
    await page.route('**/rooms/room-synthetic/commands', async route => {
      const request = route.request().postDataJSON() as { idempotencyKey: string; payload: unknown };
      requests.push(request);
      await route.fulfill({ status: 502, contentType: 'application/json', body });
    });
    await page.goto('/?view=owner');
    await page.getByRole('button', { name: 'Allow scoped exception' }).click();
    await expect(page.getByRole('status')).toContainText('outcome is unknown');
    await page.getByRole('button', { name: 'Retry unchanged request' }).click();
    await expect.poll(() => requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
  });
}

test('a structured server rejection is shown without an unknown-result retry', async ({ page }) => {
  await page.route('**/rooms/room-synthetic/commands', async route => {
    const body = route.request().postDataJSON();
    await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ ok: false, requestId: body.requestId, error: { code: 'INVALID_COMMAND', httpStatus: 422 } }) });
  });
  await page.goto('/?view=owner');
  await page.getByRole('button', { name: 'Allow scoped exception' }).click();
  await expect(page.getByRole('status')).toContainText('not applied (INVALID_COMMAND)');
  await expect(page.getByRole('button', { name: 'Retry unchanged request' })).toHaveCount(0);
});

test('a stale command refreshes but never replays against a latest version', async ({ page }) => {
  let calls = 0;
  await page.route('**/rooms/room-synthetic/commands', async route => {
    calls += 1;
    const body = route.request().postDataJSON();
    await route.fulfill({ contentType: 'application/json', status: 409, body: JSON.stringify({ ok: false, requestId: body.requestId, error: { code: 'STALE_CONTEXT', httpStatus: 409 } }) });
  });
  await page.goto('/?view=owner');
  await page.getByRole('button', { name: 'Allow scoped exception' }).click();
  await expect(page.getByRole('status')).toContainText(/stale.*refreshed/i);
  await expect(page.getByRole('heading', { name: 'Your inputs' })).toBeVisible();
  expect(calls).toBe(1);
});

test('stale owner data disables local editing and permissions until refreshed', async ({ page }) => {
  await page.goto('/?view=owner&owner=stale');
  await expect(page.getByRole('button', { name: 'Allow scoped exception' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Allow this wording' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Submit input draft' })).toBeDisabled();
  await page.getByRole('button', { name: 'Refresh private example' }).click();
  await expect(page.getByRole('button', { name: 'Allow scoped exception' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Submit input draft' })).toBeEnabled();
});

for (const view of ['public', 'owner']) {
  const prefix = view === 'owner' ? '?view=owner&owner=' : '?public=';

  test(`${view} announces loading before showing its snapshot`, async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-01T12:00:00Z') });
    await page.clock.pauseAt(new Date('2026-10-01T12:00:01Z'));
    await page.goto(`${prefix}${view === 'owner' ? 'review' : 'collecting'}`);
    await expect(page.getByRole('status')).toContainText(/loading/i);
    // Lazy-module/Suspense callbacks also use the paused clock. Advance in
    // steps shorter than mock latency until the mounted screen is loading.
    await expect.poll(async () => {
      await page.clock.runFor(50);
      return page.getByRole('status').textContent();
    }).toBe(view === 'owner' ? 'Loading private local example…' : 'Loading shared local example…');
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
