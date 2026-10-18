import { expect, test, type Page } from '@playwright/test';
import { ChoicePlan, compileChoicePlan, Groups, KnownEnough as KE } from '@deal-table/contracts';

test.use({ baseURL: 'http://127.0.0.1:5175' });
const origin = 'https://local-api.example.invalid';
const plan: ChoicePlan = { title: 'Shared outing', description: '', topics: [
  { label: 'Activity', kind: 'CHOICE', options: ['Museum', 'Park'] },
  { label: 'Day', kind: 'DATE', options: ['2026-11-14', '2026-11-15'] },
] };
function draft(): Groups.GroupDraft {
  const compiled = compileChoicePlan(plan);
  return Groups.GroupDraft.parse({ id: 'draft-one', aiAssisted: true, bodyHash: 'a'.repeat(64), revision: 1, groupVersion: 1,
    choicePlan: plan, clarificationQuestions: [], createdDecisionId: null,
    frame: { schemaVersion: KE.KE_SCHEMA_VERSION, decisionId: 'draft-one', frameVersion: 1, semanticVersion: 1,
      contextToken: 'c'.repeat(64), title: plan.title, objective: 'Choose a fictional activity and day.', description: '',
      participants: [{ id: 'member-one', displayName: 'Organizer', requiredForApproval: true }], requiredParticipantIds: ['member-one'],
      variables: compiled.variables, rules: compiled.rules } });
}
async function fixture(page: Page, mode: 'normal' | 'conflict' | 'lost-create' | 'late-ai' | 'recovered-ai' = 'normal') {
  let saved = draft(), edits = 0, creates = 0, aiCalls = 0;
  let recovered = false;
  const createdRevisions: number[] = [];
  let releaseAI: (() => void) | undefined;
  const group: Groups.GroupSnapshot = { id: 'garden', name: 'E2E02 local group', version: 1, isOrganizer: true,
    members: [{ id: 'member-one', displayName: 'Organizer', isOrganizer: true }], pendingInvitations: 0, decisions: [],
    drafts: mode === 'late-ai' ? [] : [{ id: saved.id, title: saved.frame.title, current: true, needsClarification: false, created: false }] };
  const snapshot = () => KE.PublicDecisionSnapshot.parse({ schemaVersion: KE.KE_SCHEMA_VERSION,
    frame: { ...saved.frame, decisionId: 'created-one' }, viewerParticipantId: 'member-one', semanticVersion: 1,
    contextToken: saved.frame.contextToken, publicRevision: 1, status: 'COLLECTING_FRAME_CONFIRMATION', frameConfirmations: [],
    currentProposal: null, approvedParticipantIds: [], publishedDisclosures: [] });
  await page.addInitScript(() => sessionStorage.setItem('known-enough-cognito-session', JSON.stringify({
    accessToken: 'header.payload.signature', kind: 'participant', expiresAt: Date.now() + 900000 })));
  if (mode === 'recovered-ai') await page.addInitScript(() => {
    sessionStorage.setItem('ke-draft-request:garden', 'earlier-ai');
    sessionStorage.setItem('ke-public-choice-editor:garden', JSON.stringify({ objective: 'My newer idea.',
      plan: { title: 'My restored manual work', description: '', topics: [{ label: 'Task', kind: 'CHOICE', options: ['Drawing','Reading'] }] }, draft: null }));
  });
  await page.route(origin + '/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
    let body: unknown = {}, status = 200;
    if (path === '/account') body = { account: { status: 'APPROVED', displayName: 'Organizer', version: 1 } };
    else if (path === '/groups/garden') body = { group };
    else if (path === '/groups/garden/draft-requests') body = { requests: mode === 'recovered-ai' && !recovered ? [{ key: 'earlier-ai' }] : [] };
    else if (path === '/groups/garden/draft-requests/earlier-ai') { recovered = true; body = { draftRequest: { state: 'SAVED', canRelease: true, revision: 1, draft: saved } }; }
    else if (path === '/groups/garden/drafts' && request.method() === 'POST') {
      aiCalls++; await new Promise<void>(resolve => { releaseAI = resolve; }); body = { draft: saved };
      group.drafts.push({ id: saved.id, title: saved.frame.title, current: true, needsClarification: false, created: false });
    } else if (path === '/groups/garden/drafts/draft-one' && request.method() === 'GET') body = { draft: saved };
    else if (path === '/groups/garden/drafts/draft-one' && request.method() === 'POST') {
      edits++; const incoming = request.postDataJSON();
      if (mode === 'conflict' && edits === 1) {
        saved = { ...saved, revision: 2, frame: { ...saved.frame, title: 'Newer saved draft' }, choicePlan: { ...plan, title: 'Newer saved draft' } };
        status = 409; body = { error: { code: 'STALE_CONTEXT' } };
      } else {
        expect(incoming.revision).toBe(saved.revision);
        saved = { ...saved, revision: saved.revision + 1, choicePlan: incoming.choicePlan,
          frame: { ...saved.frame, title: incoming.title, objective: incoming.objective, variables: incoming.variables, rules: incoming.rules } };
        body = { draft: saved };
      }
    } else if (path === '/groups/garden/drafts/draft-one/create') {
      creates++; createdRevisions.push(request.postDataJSON().revision); expect(request.postDataJSON().revision).toBe(saved.revision);
      saved = { ...saved, createdDecisionId: 'created-one' };
      group.decisions = [{ id: 'created-one', title: saved.frame.title, current: true }]; group.drafts = [];
      if (mode === 'lost-create') { await route.abort('failed'); return; }
      body = { snapshot: snapshot() };
    } else if (path === '/decisions/created-one/public') body = snapshot();
    else status = 404;
    await route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
  });
  await page.goto('/?group=garden');
  if (!['late-ai','recovered-ai'].includes(mode)) await page.getByRole('button', { name: 'Continue draft', exact: true }).click();
  return { edits: () => edits, creates: () => creates, aiCalls: () => aiCalls, createdRevisions,
    releaseAI: () => { if (!releaseAI) throw new Error('AI response not held'); releaseAI(); } };
}

test('one choice editor saves the current revision and clearly labels AI suggestions', async ({ page }) => {
  const f = await fixture(page);
  await expect(page.getByRole('button', { name: 'Create decision', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toHaveCount(1);
  await expect(page.getByText('This draft includes AI suggestions.', { exact: false })).toBeVisible();
  await expect(page.getByLabel('Decision title', { exact: true })).toHaveCount(0);
  await page.getByLabel('Decision name', { exact: true }).fill('Edited outing');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Create decision', exact: true }).click();
  await expect.poll(f.creates).toBe(1); expect(f.createdRevisions).toEqual([2]); expect(f.edits()).toBe(1);
});

for (const resolution of ['Use latest saved draft', 'Keep my edits']) test(`stale saves preserve edits until explicit ${resolution}`, async ({ page }) => {
  const f = await fixture(page, 'conflict');
  await page.getByLabel('Decision name', { exact: true }).fill('My unsaved draft');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText('A newer draft is saved. Your edits are kept here.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Decision name', { exact: true })).toHaveValue('My unsaved draft');
  await expect(page.getByRole('button', { name: 'Create decision', exact: true })).toBeDisabled();
  expect(f.edits()).toBe(1);
  await page.getByRole('button', { name: resolution, exact: true }).click();
  await expect(page.getByLabel('Decision name', { exact: true })).toHaveValue(resolution === 'Keep my edits' ? 'My unsaved draft' : 'Newer saved draft');
  if (resolution === 'Keep my edits') {
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled(); expect(f.edits()).toBe(2);
  } else expect(f.edits()).toBe(1);
});

test('lost creation response resolves by authenticated reads with one create', async ({ page }) => {
  const f = await fixture(page, 'lost-create');
  await page.getByRole('button', { name: 'Create decision', exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('decision')).toBe('created-one');
  expect(f.creates()).toBe(1);
});

test('late AI response stays separate from newer manual editor changes', async ({ page }) => {
  const f = await fixture(page, 'late-ai');
  await page.getByRole('button', { name: 'Start a decision', exact: true }).click();
  await page.getByLabel('Describe the decision', { exact: true }).fill('Choose an activity.');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Suggest options', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Suggest options', exact: true }).click();
  await expect.poll(f.aiCalls).toBe(1);
  await page.getByLabel('Decision name', { exact: true }).fill('My newer manual work');
  await page.getByRole('button', { name: 'Add option', exact: true }).click();
  await page.getByLabel('Option 1 for Options', { exact: true }).fill('Drawing');
  await page.getByRole('button', { name: 'Add option', exact: true }).click();
  await page.getByLabel('Option 2 for Options', { exact: true }).fill('Reading');
  f.releaseAI();
  await expect(page.locator('.ke-wizard-notice')).toHaveText('These suggestions use your earlier description. Your newer edits are kept.');
  await expect(page.getByLabel('Decision name', { exact: true })).toHaveValue('My newer manual work');
  await expect(page.getByLabel('Option 1 for Options', { exact: true })).toHaveValue('Drawing');
  await expect(page.getByLabel('Option 2 for Options', { exact: true })).toHaveValue('Reading');
  expect(f.aiCalls()).toBe(1); expect(f.edits()).toBe(0);
});

test('a saved AI result recovered after reload cannot replace a restored newer manual editor', async ({ page }) => {
  const f = await fixture(page, 'recovered-ai');
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('ke-draft-request:garden'))).toBeNull();
  await page.getByRole('button', { name: 'Start a decision', exact: true }).click();
  await expect(page.getByLabel('Decision name', { exact: true })).toHaveValue('My restored manual work');
  await expect(page.getByLabel('Option 1 for Task', { exact: true })).toHaveValue('Drawing');
  await expect(page.getByLabel('Option 2 for Task', { exact: true })).toHaveValue('Reading');
  expect(f.aiCalls()).toBe(0); expect(f.edits()).toBe(0);
});

test('choice fields and creation controls remain reachable in both themes at desktop, phone and short heights', async ({ page }) => {
  await fixture(page);
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    for (const colorScheme of ['light','dark'] as const) {
      await page.emulateMedia({ colorScheme });
      const options = page.getByLabel('Option 2 for Day', { exact: true });
      await options.scrollIntoViewIfNeeded(); await expect(options).toBeVisible();
      const create = page.getByRole('button', { name: 'Create decision', exact: true });
      await create.scrollIntoViewIfNeeded(); await expect(create).toBeVisible(); await expect(create).toBeEnabled();
      const box = await create.boundingBox(); expect(box).not.toBeNull(); expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
      await page.screenshot({ path: `/tmp/e2e02-repair-modal-${viewport.width}-${colorScheme}.png` });
    }
  }
});
