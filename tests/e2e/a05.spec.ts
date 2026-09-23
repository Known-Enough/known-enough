import { expect, test } from '@playwright/test';

test('host-simulated language draft is reviewed before private draft submission', async ({ page }) => {
  const commands: { type: string; payload: { values: { conditions: unknown[]; dutyCosts: unknown[] } } }[] = [];
  await page.route('**/rooms/room-synthetic/commands', async route => {
    const body = route.request().postDataJSON();
    commands.push(body);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, requestId: body.requestId, status: 'APPLIED', version: body.expected }) });
  });

  await page.goto('/?view=owner');
  const simulation = page.getByRole('region', { name: 'Review a language draft' });
  await expect(simulation).toContainText('HOST SIMULATION');
  await expect(simulation).toContainText('does not call a model or service');
  await expect(simulation.getByRole('button', { name: 'Prepare simulated draft' })).toBeVisible();
  await simulation.getByRole('button', { name: 'Prepare simulated draft' }).click();

  const preview = page.getByRole('region', { name: 'Suggested private draft' });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('still unconfirmed');
  await expect(preview).toContainText('2026-10-08 · 11:00–11:30');
  await expect(preview).toContainText('No duty costs were provided or inferred');
  await expect(page.getByRole('button', { name: 'Allow scoped exception' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Allow this wording' })).toBeVisible();
  expect(commands).toHaveLength(0);

  await preview.getByRole('button', { name: 'Submit this private draft' }).click();
  await expect(page.getByRole('status')).toContainText('Command accepted by the transport');
  expect(commands).toHaveLength(1);
  expect(commands[0]).toMatchObject({
    type: 'SUBMIT_INPUT_DRAFT',
    payload: { values: {
      conditions: [{ id: 'sample-thursday-1100', kind: 'HARD_AVAILABILITY', availableIntervals: [
        { date: '2026-10-08', timezone: 'America/Mexico_City', startMinute: 660, endMinute: 690 },
      ] }],
      dutyCosts: [],
    } },
  });
  expect(commands.some(command => command.type === 'CONFIRM_INPUTS')).toBe(false);
});

test('preparing a new language draft invalidates any earlier draft review', async ({ page }) => {
  await page.goto('/?view=owner&owner=draft');
  const review = page.getByRole('region', { name: 'Confirm reviewed inputs' });
  const confirm = review.getByRole('button', { name: 'Confirm these reviewed intervals' });
  await review.getByRole('checkbox').check();
  await expect(confirm).toBeEnabled();

  const simulation = page.getByRole('region', { name: 'Review a language draft' });
  await simulation.getByRole('button', { name: 'Prepare simulated draft' }).click();
  await expect(page.getByRole('region', { name: 'Suggested private draft' })).toBeVisible();
  await expect(confirm).toBeDisabled();
  await expect(review.getByRole('checkbox')).toBeDisabled();
});

test('editing private language invalidates prior interval checks immediately', async ({ page }) => {
  await page.goto('/?view=owner&owner=draft');
  const review = page.getByRole('region', { name: 'Confirm reviewed inputs' });
  const confirm = review.getByRole('button', { name: 'Confirm these reviewed intervals' });
  const interval = review.getByRole('checkbox');
  await interval.check();
  await expect(confirm).toBeEnabled();

  const simulation = page.getByRole('region', { name: 'Review a language draft' });
  await simulation.getByLabel('Private sentence').fill('I cannot attend the Thursday meeting.');
  await expect(confirm).toBeDisabled();
  await expect(interval).toBeDisabled();
});

test('unsupported language returns to the structured form fallback without submitting', async ({ page }) => {
  const commands: unknown[] = [];
  await page.route('**/rooms/room-synthetic/commands', async route => {
    commands.push(route.request().postDataJSON());
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.goto('/?view=owner');
  const simulation = page.getByRole('region', { name: 'Review a language draft' });
  await simulation.getByLabel('Private sentence').fill('I cannot do this weekend.');
  await simulation.getByRole('button', { name: 'Prepare simulated draft' }).click();
  await expect(simulation.getByRole('alert')).toContainText('Use the structured form below');
  await expect(page.getByRole('group', { name: 'Meeting availability' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Suggested private draft' })).toHaveCount(0);
  expect(commands).toHaveLength(0);
});
