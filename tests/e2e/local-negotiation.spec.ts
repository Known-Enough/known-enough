import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { CommandResult, OwnerSnapshot, PublicRoomSnapshot, type CommandEnvelope } from '@deal-table/contracts';

const api = 'http://127.0.0.1:8787/rooms/room-synthetic';
const headers = (identity: string) => ({ 'X-Deal-Table-Test-Identity': `NON_PRODUCTION ${identity}` });
const publicView = async (request: APIRequestContext) => PublicRoomSnapshot.parse(await (await request.get(`${api}/public`, { headers: headers('display') })).json());
const ownerView = async (request: APIRequestContext, member: string) => OwnerSnapshot.parse(await (await request.get(`${api}/me`, { headers: headers(member) })).json());

test.describe('G01 real local UI/API negotiation', () => {
  test.describe.configure({ mode: 'default' });
  let server: ChildProcess;
  test.beforeEach(async ({ request }) => {
    // Launch the actual B03 startup with no owner inputs. Never reuse a developer's server.
    server = spawn(process.execPath, ['--experimental-transform-types', 'apps/api/src/local.ts'], { stdio: 'pipe' });
    let ready = false;
    server.stdout!.on('data', chunk => { if (String(chunk).includes('local non-production API listening')) ready = true; });
    await expect.poll(() => ready || server.exitCode !== null).toBe(true);
    expect(server.exitCode, 'The test must own its fresh API listener').toBeNull();
    expect((await ownerView(request, 'maya')).draft).toBeNull();
  });
  test.afterEach(async () => {
    if (server && server.exitCode === null && server.signalCode === null) {
      const exited = once(server, 'exit');
      server.kill();
      await exited;
    }
  });

  async function open(page: Page, member: string) {
    await page.goto(`/?view=owner&local=${member}`);
    await expect(page.getByRole('heading', { name: 'Your inputs', exact: true })).toBeVisible();
  }
  async function clickApplied(page: Page, label: string) {
    const response = page.waitForResponse(response => response.url() === `${api}/commands` && response.request().method() === 'POST');
    await page.getByRole('button', { name: label, exact: true }).click();
    expect(CommandResult.parse(await (await response).json()).ok).toBe(true);
    await expect(page.getByRole('heading', { name: 'Your inputs', exact: true })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('Command applied');
  }
  async function fillInitial(page: Page, member: string) {
    const inputs = page.getByRole('region', { name: 'Your inputs', exact: true });
    await expect(inputs.getByRole('button', { name: 'Submit input draft' })).toBeDisabled();
    const choices: Record<string, string[]> = {
      maya: ['unavailable', 'available', 'available', 'available', 'available'],
      leo: ['available', 'available', 'unavailable', 'available', 'available'],
      nina: ['available', 'exception', 'available', 'unavailable', 'available'],
    };
    const costs: Record<string, string[]> = { maya: ['3', '0'], leo: ['0', '1'], nina: ['0', '0'] };
    const selects = inputs.getByRole('combobox');
    for (const [index, choice] of [...choices[member]!, ...costs[member]!].entries()) await selects.nth(index).selectOption(choice);
  }
  async function offer(page: Page, request: APIRequestContext) {
    for (const member of ['maya', 'leo', 'nina']) {
      await open(page, member);
      await fillInitial(page, member);
      await clickApplied(page, 'Submit input draft');
      const review = page.getByRole('region', { name: 'Confirm reviewed inputs', exact: true });
      const confirm = review.getByRole('button', { name: 'Confirm these reviewed intervals' });
      await expect(confirm).toBeDisabled();
      await expect(review.getByRole('checkbox')).toHaveCount(5);
      for (const checkbox of await review.getByRole('checkbox').all()) await checkbox.check();
      await clickApplied(page, 'Confirm these reviewed intervals');
    }
    // Each owner explicitly reaffirms the final shared context after all private confirmations.
    for (const member of ['maya', 'leo', 'nina']) {
      await open(page, member);
      await clickApplied(page, 'Accept reviewed setup');
    }
    await clickApplied(page, 'Find a plan');
    expect((await publicView(request)).status).toBe('PRIVATE_REVIEW');
    await expect(page.getByRole('button', { name: 'Allow scoped exception' })).toBeVisible();
  }

  test('fresh inputs reach agreement with independent disclosure refusal and three browser approvals', async ({ page, request }) => {
    await offer(page, request);
    await clickApplied(page, 'Allow scoped exception');
    expect((await publicView(request)).approvedMemberIds).toEqual([]);
    await clickApplied(page, 'Use exception without announcement');
    expect((await ownerView(request, 'nina')).exceptionGrants[0]!.status).toBe('ACTIVE');
    expect((await publicView(request)).publishedDisclosures).toEqual([]);
    for (const [index, member] of ['maya', 'leo', 'nina'].entries()) {
      await open(page, member);
      await clickApplied(page, 'Accept reviewed current proposal');
      const view = await publicView(request);
      expect(view.approvedMemberIds).toHaveLength(index + 1);
      expect(view.status === 'AGREED').toBe(index === 2);
    }
    await page.goto('/?local=display');
    await expect(page.getByRole('region', { name: 'Current proposal' })).toContainText('3 of 3');
    expect(await page.locator('body').innerText()).not.toMatch(/owner-meeting|grantId|DECLINED/);

    // Organizer-only schedule editing has no participant UI. Exercise the real API,
    // then verify that browser controls and private receipts reflect invalidation.
    const view = await publicView(request);
    const schedule = structuredClone(view.schedule);
    for (const slot of schedule.slots) slot.interval.endMinute += 30;
    const revision: CommandEnvelope = {
      schemaVersion: 1, roomId: view.roomId, requestId: 'duration-edit', idempotencyKey: 'duration-edit',
      expected: { contextToken: view.contextToken, decisionRevision: view.decisionRevision, controlVersion: view.controlVersion },
      type: 'REVISE_DECISION', payload: { schedule, roster: view.roster.map(member => ({ ...member, submitted: false })), policy: view.policy },
    };
    expect(CommandResult.parse(await (await request.post(`${api}/commands`, { headers: headers('organizer'), data: revision })).json()).ok).toBe(true);
    const revised = await publicView(request);
    expect(revised.proposal).toBeNull();
    expect(revised.approvedMemberIds).toEqual([]);
    const nina = await ownerView(request, 'nina');
    expect(nina.exceptionGrants.every(grant => grant.status !== 'ACTIVE')).toBe(true);
    expect(nina.availabilityReview).toBeNull();
    await open(page, 'nina');
    await expect(page.getByRole('button', { name: 'Accept reviewed current proposal' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Accept reviewed setup' })).toBeDisabled();
    await expect(page.getByRole('article', { name: 'Exception receipt' })).toContainText('Superseded');
    // This mutation succeeds beyond revision 1; old checked coverage is never restored.
    await page.getByRole('combobox', { name: 'Meeting duration' }).selectOption('60');
    await clickApplied(page, 'Submit input draft');
    const review = page.getByRole('region', { name: 'Confirm reviewed inputs', exact: true });
    await expect(review.getByRole('button', { name: 'Confirm these reviewed intervals' })).toBeDisabled();
    for (const checkbox of await review.getByRole('checkbox').all()) await expect(checkbox).not.toBeChecked();
  });

  test('exception refusal ends negotiation without disclosing a private refusal', async ({ page, request }) => {
    await offer(page, request);
    await clickApplied(page, 'Decline exception');
    const view = await publicView(request);
    expect(view.status).toBe('NO_AGREEMENT');
    expect(view.approvedMemberIds).toEqual([]);
    expect(view.publishedDisclosures).toEqual([]);
    await page.goto('/?local=display');
    await expect(page.getByText('No agreement in this local example').first()).toBeVisible();
    expect(await page.locator('body').innerText()).not.toMatch(/owner-meeting|DECLINED|grantId/);
  });

  for (const failure of ['network', 'json', 'schema']) test(`local ${failure} failure retries the original applied mutation exactly once`, async ({ page, request }) => {
    await open(page, 'maya');
    await fillInitial(page, 'maya');
    const sent: unknown[] = [];
    await page.route(`${api}/commands`, async route => {
      sent.push(route.request().postDataJSON());
      const response = await route.fetch(); // apply first, then lose its result
      if (sent.length > 1) return route.fulfill({ response });
      if (failure === 'network') return route.abort('failed');
      return route.fulfill({ status: 502, contentType: 'application/json', body: failure === 'json' ? '{' : '{}' });
    });
    await page.getByRole('button', { name: 'Submit input draft' }).click();
    await expect(page.getByRole('status')).toContainText('outcome is unknown');
    const appliedRevision = (await ownerView(request, 'maya')).ownerRevision;
    await expect(page.getByRole('button', { name: 'Submit input draft' })).toBeDisabled();
    await clickApplied(page, 'Retry unchanged request');
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    expect((await ownerView(request, 'maya')).ownerRevision).toBe(appliedRevision);
  });

  test('a cost-only resubmission preserves explicit do-not-ask availability', async ({ page, request }) => {
    await open(page, 'maya');
    await fillInitial(page, 'maya');
    await clickApplied(page, 'Submit input draft');
    const before = (await ownerView(request, 'maya')).draft!.values;
    await expect(page.getByRole('radio', { name: /is unavailable; do not ask/ })).toBeChecked();
    await page.getByRole('combobox', { name: 'Follow-up duty cost' }).selectOption('2');
    await clickApplied(page, 'Submit input draft');
    const after = (await ownerView(request, 'maya')).draft!.values;
    expect(after.conditions).toEqual(before.conditions);
    expect(after.dutyCosts.find(cost => cost.dutyId === 'followup')?.cost).toBe(2);
  });

  test('mismatched public and owner reads disable mutations until refreshed', async ({ page }) => {
    await page.route(`${api}/public`, async route => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({ response, json: { ...body, controlVersion: body.controlVersion + 1 } });
    });
    await open(page, 'maya');
    await expect(page.getByRole('alert')).toContainText('changed during loading');
    await expect(page.getByRole('button', { name: 'Submit input draft' })).toBeDisabled();
    await page.unroute(`${api}/public`);
    await page.getByRole('button', { name: 'Refresh current snapshots' }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await fillInitial(page, 'maya');
    await clickApplied(page, 'Submit input draft');
  });
});
