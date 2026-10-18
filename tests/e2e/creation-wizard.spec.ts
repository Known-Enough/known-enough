import { test, expect, type Page } from '@playwright/test';
import { ChoicePlan, compileChoicePlan, Groups, KnownEnough as KE } from '@deal-table/contracts';

test.use({ baseURL: 'http://127.0.0.1:5175' });
const origin = 'https://local-api.example.invalid';
const idea = 'Choose a destination for our shared weekend trip.';
const suggestions: ChoicePlan = { title: 'Weekend trip', description: 'Choose where to spend a weekend together.', topics: [{ label: 'Destination', kind: 'CHOICE', options: ['Coast', 'Mountains', 'City'] }] };
function makeDraft(plan: ChoicePlan, objective = idea, id = 'draft-one', aiAssisted = false): Groups.GroupDraft {
  const compiled = compileChoicePlan(plan);
  return Groups.GroupDraft.parse({ id, ...(aiAssisted ? { aiAssisted: true } : {}), bodyHash: 'a'.repeat(64), revision: 1, groupVersion: 1, choicePlan: plan,
    clarificationQuestions: compiled.questions, createdDecisionId: null,
    frame: { schemaVersion: KE.KE_SCHEMA_VERSION, decisionId: id, frameVersion: 1, semanticVersion: 1, contextToken: 'c'.repeat(64),
      title: plan.title || 'New decision', objective, description: plan.description, participants: [{ id: 'owner', displayName: 'Organizer', requiredForApproval: true }],
      requiredParticipantIds: ['owner'], variables: compiled.variables, rules: compiled.rules } });
}
async function fixture(page: Page, mode: 'normal' | 'ai-failure' | 'create-failure' | 'save-failure' | 'legacy' = 'normal') {
  let saved: Groups.GroupDraft | null = null, aiCalls = 0, saves = 0, creates = 0;
  const group: Groups.GroupSnapshot = { id: 'garden', name: 'Shared weekend', version: 1, isOrganizer: true, members: [{ id: 'owner', displayName: 'Organizer', isOrganizer: true }], drafts: [], decisions: [], pendingInvitations: 0 };
  const capturedAI: unknown[] = [];
  if (mode === 'legacy') {
    saved = makeDraft({ ...suggestions, topics: [...suggestions.topics, { label: 'Day', kind: 'DATE', options: ['2026-11-14','2026-11-15'] }] });
    delete saved.choicePlan;
    group.drafts = [{ id: saved.id, title: saved.frame.title, current: true, created: false, needsClarification: false }];
  }
  await page.addInitScript(() => sessionStorage.setItem('known-enough-cognito-session', JSON.stringify({ accessToken: 'header.payload.signature', kind: 'participant', expiresAt: Date.now() + 900000 })));
  await page.route(origin + '/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
    if (req.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
    let body: unknown = {}, status = 200;
    if (path === '/account') body = { account: { status: 'APPROVED', displayName: 'Organizer', version: 1 } };
    else if (path === '/groups/garden') body = { group };
    else if (path === '/groups/garden/draft-requests') body = { requests: [] };
    else if (path.startsWith('/groups/garden/draft-requests/')) body = { draftRequest: { state: 'FAILED', canRelease: true, revision: 1 } };
    else if (path === '/groups/garden/drafts' && req.method() === 'POST') {
      const input = req.postDataJSON();
      if (!input.choicePlan) {
        aiCalls++; capturedAI.push(input);
        if (mode === 'ai-failure') { status = 503; body = { draftFailure: 'PROVIDER_FAILED' }; }
        else body = { draft: makeDraft(suggestions, input.objective, 'ai-one', true) };
      } else {
        saves++; if (mode === 'save-failure') { await route.abort(); return; }
        saved = makeDraft(input.choicePlan, input.objective); body = { draft: saved };
        group.drafts = [{ id: saved.id, title: saved.frame.title, current: true, created: false, needsClarification: !!saved.clarificationQuestions.length }];
      }
    } else if (/\/drafts\/[^/]+\/create$/.test(path)) {
      creates++;
      if (mode === 'create-failure') { status = 503; body = { error: { code: 'RETRYABLE_SERVER_ERROR' } }; }
      else {
        saved = { ...saved!, createdDecisionId: 'created-one' };
        body = { snapshot: snapshot(saved) }; group.decisions = [{ id: 'created-one', title: saved.frame.title, current: true }];
      }
    } else if (/\/drafts\/[^/]+$/.test(path) && req.method() === 'GET') body = { draft: saved };
    else if (/\/drafts\/[^/]+$/.test(path) && req.method() === 'POST') {
      saves++; const input = req.postDataJSON();
      const base = saved ?? makeDraft(suggestions, input.objective, 'ai-one', true);
      saved = { ...base, revision: base.revision + 1, ...(input.choicePlan ? { choicePlan: input.choicePlan } : {}), clarificationQuestions: input.choicePlan ? compileChoicePlan(input.choicePlan).questions : [],
        frame: { ...base.frame, title: input.title, objective: input.objective, variables: input.variables, rules: input.rules } }; body = { draft: saved };
    } else if (path === '/decisions/created-one/public') body = snapshot(saved!);
    else status = 404;
    await route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('/?group=garden');
  await page.getByRole('button', { name: mode === 'legacy' ? 'Continue draft' : 'Start a decision', exact: true }).click();
  return { aiCalls: () => aiCalls, saves: () => saves, creates: () => creates, capturedAI };
}
function snapshot(saved: Groups.GroupDraft) {
  return KE.PublicDecisionSnapshot.parse({ schemaVersion: KE.KE_SCHEMA_VERSION, frame: { ...saved.frame, decisionId: 'created-one' }, viewerParticipantId: 'owner',
    semanticVersion: 1, contextToken: saved.frame.contextToken, publicRevision: 1, status: 'COLLECTING_FRAME_CONFIRMATION', frameConfirmations: [],
    currentProposal: null, approvedParticipantIds: [], publishedDisclosures: [] });
}
async function options(page: Page) {
  await page.getByLabel('Describe the decision', { exact: true }).fill(idea);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
}
async function add(page: Page, value: string, number: number) {
  await page.getByRole('button', { name: 'Add option', exact: true }).click();
  await page.getByLabel(`Option ${number} for Options`, { exact: true }).fill(value);
}

test('description, examples and two-step navigation preserve input without calling AI', async ({ page }) => {
  const f = await fixture(page);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Describe the decision to continue.', { exact: true })).toBeVisible();
  await page.getByLabel('Describe the decision', { exact: true }).fill(idea);
  await page.getByRole('button', { name: 'Plan a trip', exact: true }).click();
  await expect(page.getByLabel('Describe the decision', { exact: true })).toHaveValue(idea);
  await page.getByRole('button', { name: 'Keep my text', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No options added yet', exact: true })).toBeVisible();
  await add(page, 'Coast', 1); await add(page, 'Mountains', 2);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByLabel('Describe the decision', { exact: true })).toHaveValue(idea);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByLabel('Option 2 for Options', { exact: true })).toHaveValue('Mountains');
  expect(f.aiCalls()).toBe(0); expect(f.saves()).toBe(0);
});

test('editable rows validate duplicates and manual creation saves once and navigates only after confirmation', async ({ page }) => {
  const f = await fixture(page); await options(page); await add(page, 'Coast', 1); await add(page, 'coast', 2);
  await expect(page.getByText('This option is already listed.').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create decision', exact: true })).toBeDisabled();
  await page.getByLabel('Option 2 for Options', { exact: true }).fill('Mountains');
  await page.getByRole('button', { name: 'Remove option 1 for Options', exact: true }).click();
  await expect(page.getByLabel('Option 1 for Options', { exact: true })).toHaveValue('Mountains');
  await page.getByRole('button', { name: 'Create decision', exact: true }).dblclick();
  await expect.poll(() => new URL(page.url()).searchParams.get('decision')).toBe('created-one');
  expect(f.aiCalls()).toBe(0); expect(f.saves()).toBe(1); expect(f.creates()).toBe(1);
});

test('description assistance is explicit, editable, dismissible and never overwrites the original automatically', async ({ page }) => {
  const f = await fixture(page); await page.getByLabel('Describe the decision', { exact: true }).fill(idea);
  await page.getByRole('button', { name: 'Help me get started', exact: true }).click(); expect(f.aiCalls()).toBe(0);
  await page.getByRole('button', { name: 'Suggest a description', exact: true }).click();
  const review = page.getByRole('region', { name: 'Suggested description', exact: true });
  await expect(review).toBeVisible(); await expect(page.getByLabel('Describe the decision', { exact: true })).toHaveValue(idea);
  await review.getByRole('textbox', { name: 'Suggested description', exact: true }).fill('Choose a weekend place together.');
  await review.getByRole('button', { name: 'Use this description', exact: true }).click();
  await expect(page.getByLabel('Describe the decision', { exact: true })).toHaveValue('Choose a weekend place together.');
  expect(f.aiCalls()).toBe(1); expect(f.creates()).toBe(0);
});

test('AI options are reviewed individually without replacing existing options or adding everything', async ({ page }) => {
  const f = await fixture(page); await options(page); await add(page, 'Our original place', 1);
  await page.getByRole('button', { name: 'Suggest options', exact: true }).click();
  const review = page.getByRole('region', { name: 'Suggested options', exact: true }); await expect(review).toBeVisible();
  await expect(page.getByLabel('Option 1 for Options', { exact: true })).toHaveValue('Our original place');
  await review.getByRole('button', { name: 'Add suggestion Coast', exact: true }).click();
  await expect(page.getByLabel('Option 2 for Options', { exact: true })).toHaveValue('Coast');
  await expect(page.getByLabel('Option 1 for Options', { exact: true })).toHaveValue('Our original place');
  await expect(page.locator('.ke-options-editor input[data-option-input]')).toHaveCount(2);
  await review.getByRole('button', { name: 'Dismiss suggestion Mountains', exact: true }).click();
  await expect(page.getByLabel('Suggested option 2 for Destination', { exact: true })).toHaveValue('City');
  expect(f.aiCalls()).toBe(1); expect(Object.keys(f.capturedAI[0] as object).sort()).toEqual(['choiceContext', 'idempotencyKey', 'objective']);
});

for (const mode of ['create-failure', 'save-failure', 'ai-failure'] as const) test(`${mode} keeps editable work and never repeats a write or AI call automatically`, async ({ page }) => {
  const f = await fixture(page, mode); await options(page); await add(page, 'Coast', 1);
  if (mode === 'ai-failure') await page.getByRole('button', { name: 'Suggest options', exact: true }).click();
  else await page.getByRole('button', { name: 'Create decision', exact: true }).click();
  await expect(page.locator('.ke-wizard-notice')).toBeVisible();
  await expect(page.getByLabel('Option 1 for Options', { exact: true })).toHaveValue('Coast');
  expect(new URL(page.url()).searchParams.get('decision')).toBeNull();
  expect(f.creates()).toBe(mode === 'create-failure' ? 1 : 0);
  expect(f.aiCalls()).toBe(mode === 'ai-failure' ? 1 : 0);
});

test('local draft survives reload and close guards preserve the description, options and focus', async ({ page }) => {
  await fixture(page); await options(page); await add(page, 'Coast', 1);
  page.once('dialog', dialog => dialog.dismiss()); await page.getByRole('button', { name: 'Close new decision', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Review your options', exact: true })).toBeVisible();
  page.once('dialog', dialog => dialog.accept()); await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Review your options', exact: true })).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Start a decision', exact: true })).toBeFocused();
  await page.reload(); await page.getByRole('button', { name: 'Start a decision', exact: true }).click();
  await expect(page.getByLabel('Option 1 for Options', { exact: true })).toHaveValue('Coast');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByLabel('Describe the decision', { exact: true })).toHaveValue(idea);
});

test('creation modal has one scroll region, reachable footer and theme contrast across viewport sizes', async ({ page }) => {
  await fixture(page); await options(page); await add(page, 'Coast', 1); await add(page, 'Mountains', 2);
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      const dialog = page.locator('.ke-creation-v2');
      const create = dialog.getByRole('button', { name: 'Create decision', exact: true }); await expect(create).toBeVisible();
      const geometry = await dialog.evaluate(element => {
        const bounds = element.getBoundingClientRect(); const footer = element.querySelector('.ke-creation-footer')!.getBoundingClientRect();
        const contrast = (front: string, back: string) => {
          const luminance = (value: string) => { const values = value.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(part => { const channel = part / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; }); return values[0]! * .2126 + values[1]! * .7152 + values[2]! * .0722; };
          const a = luminance(front), b = luminance(back); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
        };
        const back = element.querySelector('.ke-creation-footer .secondary')!, backStyle = getComputedStyle(back);
        const title = getComputedStyle(element.querySelector('h2')!), surface = getComputedStyle(element);
        const scrollers = [...element.querySelectorAll('*')].filter(item => !item.matches('textarea,input,select') && item.getClientRects().length > 0 && ['auto','scroll'].includes(getComputedStyle(item).overflowY));
        return { top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right, footer: footer.bottom,
          backColor: backStyle.color, backBackground: backStyle.backgroundColor, titleContrast: contrast(title.color, surface.backgroundColor), backContrast: contrast(backStyle.color, backStyle.backgroundColor), scrollRegions: scrollers.length, horizontalOverflow: element.scrollWidth > element.clientWidth + 1 };
      });
      expect(geometry.top).toBeGreaterThanOrEqual(0); expect(geometry.bottom).toBeLessThanOrEqual(viewport.height + 1);
      expect(geometry.left).toBeGreaterThanOrEqual(0); expect(geometry.right).toBeLessThanOrEqual(viewport.width + 1);
      expect(geometry.titleContrast).toBeGreaterThanOrEqual(4.5); expect(geometry.backContrast, JSON.stringify({ viewport, theme, geometry })).toBeGreaterThanOrEqual(4.5);
      expect(geometry.footer).toBeLessThanOrEqual(viewport.height); expect(geometry.horizontalOverflow).toBe(false); expect(geometry.scrollRegions).toBe(1);
      await page.screenshot({ path: `docs/review-artifacts/FF/wizard-redesign/options-${viewport.width}-${theme}.png` });
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await page.screenshot({ path: `docs/review-artifacts/FF/wizard-redesign/describe-${viewport.width}-${theme}.png` });
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
    }
  }
});


test('examples replace text only after confirmation and keep existing option rows', async ({ page }) => {
  const f = await fixture(page); await options(page); await add(page, 'Our own option', 1);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Choose a restaurant', exact: true }).click();
  await expect(page.getByLabel('Describe the decision', { exact: true })).toHaveValue(idea);
  await page.getByRole('button', { name: 'Use this example', exact: true }).click();
  await expect(page.getByLabel('Describe the decision', { exact: true })).toHaveValue(/Saturday dinner/);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByLabel('Option 1 for Options', { exact: true })).toHaveValue('Our own option');
  expect(f.aiCalls()).toBe(0);
});

test('legacy saved drafts retain bounded date rules and identifiers through wording edits and creation', async ({ page }) => {
  const f = await fixture(page, 'legacy');
  await expect(page.getByText('This saved draft keeps its original options and shared rules.', { exact: true })).toBeVisible();
  await page.getByLabel('Decision name', { exact: true }).fill('Updated weekend plan');
  const posted: Record<string, unknown>[] = [];
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/groups/garden/drafts/draft-one') posted.push(request.postDataJSON()); });
  await page.getByRole('button', { name: 'Create decision', exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('decision')).toBe('created-one');
  expect(posted).toHaveLength(1); expect(posted[0]!.choicePlan).toBeUndefined();
  expect(posted[0]!.rules).toEqual([{ id: 'domain-2', visibility: 'PUBLIC', operator: 'IN', variableId: 'choice-2', values: [{ type: 'DATE', date: '2026-11-14' }, { type: 'DATE', date: '2026-11-15' }] }]);
  expect(f.aiCalls()).toBe(0); expect(f.creates()).toBe(1);
});

test('keyboard focus stays inside the native dialog and the description receives initial focus', async ({ page }) => {
  await fixture(page);
  await expect(page.getByRole('textbox', { name: 'Describe the decision', exact: true })).toBeFocused();
  for (let i = 0; i < 18; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.closest('dialog')?.open)).toBe(true);
  }
  page.once('dialog', dialog => dialog.accept()); await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Start a decision', exact: true })).toBeFocused();
});

test('comparison limits keep creation disabled until the user narrows the options without AI', async ({ page }) => {
  const plan: ChoicePlan = { title: 'Weekend plan', description: '', topics: [
    { label: 'Place', kind: 'CHOICE', options: Array.from({ length: 9 }, (_, i) => `Place ${i + 1}`) },
    { label: 'Day', kind: 'CHOICE', options: Array.from({ length: 8 }, (_, i) => `Day ${i + 1}`) },
  ] };
  await page.addInitScript(({ plan, idea }) => sessionStorage.setItem('ke-public-choice-editor:garden', JSON.stringify({ plan, objective: idea })), { plan, idea });
  const f = await fixture(page);
  const create = page.getByRole('button', { name: 'Create decision', exact: true });
  await expect(create).toBeDisabled();
  await expect(page.getByText('There are too many options to compare together. Remove some options or split this into separate decisions.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Remove option 8 for Day', exact: true }).click();
  await expect(create).toBeEnabled();
  expect(f.aiCalls()).toBe(0); expect(f.saves()).toBe(0); expect(f.creates()).toBe(0);
});
