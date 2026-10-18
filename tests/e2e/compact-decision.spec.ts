import { expect, test, type Page } from '@playwright/test';
import { compileChoicePlan, KnownEnough as KE, publicChoiceOptions } from '@deal-table/contracts';

test.use({ baseURL: 'http://127.0.0.1:5175' });
const compiled = compileChoicePlan({ title: 'Weekend plan', description: 'Choose a place and a day together.', topics: [
  { label: 'Place', kind: 'CHOICE', options: ['Park', 'Museum', 'Cafe'] },
  { label: 'Day', kind: 'DATE', options: ['2026-11-14', '2026-11-15'] },
] });
function snapshot(status: KE.PublicDecisionSnapshot['status'] = 'READY') {
  return KE.PublicDecisionSnapshot.parse({ schemaVersion: 2, frame: { schemaVersion: 2, decisionId: 'compact', frameVersion: 1, semanticVersion: 1, contextToken: 'c'.repeat(64),
    title: 'Weekend plan', objective: 'Choose a place and a day together.', description: 'Choose a place and a day together.',
    participants: [{ id: 'one', displayName: 'Alex', requiredForApproval: true }, { id: 'two', displayName: 'Sam', requiredForApproval: true }],
    requiredParticipantIds: ['one', 'two'], variables: compiled.variables, rules: compiled.rules },
    viewerParticipantId: 'one', semanticVersion: 1, contextToken: 'c'.repeat(64), publicRevision: 1, status,
    participantProgress: [{ participantId: 'one', answersSaved: true }, { participantId: 'two', answersSaved: true }],
    frameConfirmations: ['one', 'two'].map(participantId => ({ decisionId: 'compact', participantId, frameVersion: 1, semanticVersion: 1, contextToken: 'c'.repeat(64), confirmedAt: '2026-10-18T00:00:00.000Z' })), currentProposal: null, approvedParticipantIds: [], publishedDisclosures: [] });
}
function owner(pub = snapshot()) {
  return KE.OwnerDecisionSnapshot.parse({ schemaVersion: 2, publicSnapshot: pub, ownerParticipantId: 'one', ownInputReadiness: 'READY',
    privateVariables: [], privateProposalValues: null, controlVersion: 1, ownerVersion: 1, draftVersion: null, draft: null,
    confirmedConstraints: [], pendingQuestions: [], refusedRequests: [], negotiationPermissions: [], disclosurePermissions: [], ownApproval: null });
}
async function install(page: Page, options: { fresh?: boolean; failure?: boolean; missingProgress?: boolean; closed?: boolean; display?: boolean; aiDraft?: boolean } = {}) {
  let current = owner(snapshot(options.closed ? 'CLOSED' : options.fresh ? 'COLLECTING_PRIVATE_INPUT' : 'READY'));
  if (options.fresh) { current.ownInputReadiness = 'NOT_STARTED'; current.publicSnapshot.participantProgress![0]!.answersSaved = false; }
  if (options.missingProgress) delete current.publicSnapshot.participantProgress;
  if (options.aiDraft) {
    const variable = current.publicSnapshot.frame.variables[0]!, value = publicChoiceOptions(current.publicSnapshot.frame, variable)![0]!;
    current.draftVersion = 1;
    current.draft = KE.AIConstraintDraft.parse({ schemaVersion: 2, draftId: 'note-suggestion', draftVersion: 1, decisionId: 'compact', ownerParticipantId: 'one', ownerVersion: 1, semanticVersion: 1,
      contextToken: current.publicSnapshot.contextToken, sourceSummary: 'Synthetic suggested note.', createdAt: '2026-10-18T00:00:00.000Z', unsupportedConditions: [],
      proposedConstraints: [{ constraintId: 'note-one', kind: 'HARD', rule: { id: 'note-rule', visibility: 'TRUSTED_BACKEND', operator: 'IN', variableId: variable.id, values: [value] } }] });
  }
  let writes = 0;
  const commands: KE.DecisionCommand[] = [];
  await page.addInitScript(kind => sessionStorage.setItem('known-enough-cognito-session', JSON.stringify({ accessToken: 'local.synthetic.token', kind, expiresAt: Date.now() + 900000 })), options.display ? 'display' : 'participant');
  await page.route('https://local-api.example.invalid/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
    if (req.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
    let body: unknown = {}, status = 200;
    if (path.endsWith('/public')) body = current.publicSnapshot;
    else if (path.endsWith('/me')) body = current;
    else if (path.endsWith('/commands')) {
      const command = KE.DecisionCommand.parse(req.postDataJSON()); commands.push(command); writes++;
      if (options.failure) { await route.abort(); return; }
      if (command.type !== 'CONFIRM_PRIVATE_ANSWERS') throw new Error('Unexpected command');
      const pub = current.publicSnapshot;
      current.confirmedConstraints = command.payload.answers.flatMap((answer, index) => {
        if (answer.mode !== 'SELECTED') return [];
        const variable = pub.frame.variables.find(item => item.id === answer.variableId)!;
        const values = publicChoiceOptions(pub.frame, variable)!;
        return [KE.ConfirmedConstraint.parse({ schemaVersion: 2, constraintId: 'answer-selected-' + index, decisionId: 'compact', ownerParticipantId: 'one',
          constraintVersion: 1, ownerVersion: 2, semanticVersion: 1, contextToken: pub.contextToken, confirmedAt: '2026-10-18T00:00:00.000Z', status: 'ACTIVE', sourceSummary: 'Synthetic selected answers.',
          kind: 'HARD', rule: { id: 'rule-' + index, visibility: 'TRUSTED_BACKEND', operator: 'IN', variableId: variable.id, values: answer.acceptableIndices.map(i => values[i]) } })];
      });
      current = KE.OwnerDecisionSnapshot.parse({ ...current, ownInputReadiness: 'READY', draft: null, draftVersion: null, controlVersion: 2, ownerVersion: 2 });
      body = { ok: true, requestId: command.requestId, status: 'APPLIED', contextToken: pub.contextToken, semanticVersion: 1, controlVersion: 2, ownerVersion: 2 };
    } else status = 404;
    await route.fulfill({ status, headers, json: body });
  });
  await page.goto('/?decision=compact');
  await expect(page.getByRole('heading', { name: 'Weekend plan', exact: true })).toBeVisible();
  return { writes: () => writes, commands, current: () => current };
}

test('saved answers are compact and private; activity exposes only public response status', async ({ page }) => {
  const f = await install(page);
  await expect(page.getByRole('status').filter({ hasText: '2/2 responded' })).toBeVisible();
  await expect(page.locator('.ke-saved-answer-topics')).toContainText('Park · Museum · Cafe');
  await expect(page.getByRole('button', { name: 'Save answers', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Find an outcome', exact: true })).toBeVisible();
  await expect(page.locator('.ke-response-person').filter({ hasText: 'Sam' })).not.toBeVisible();
  await page.getByText('Group activity', { exact: true }).click();
  await expect(page.locator('.ke-response-person').filter({ hasText: 'Sam' })).toBeVisible();
  await expect(page.locator('.ke-compact-activity')).not.toContainText('Park');
  expect(f.writes()).toBe(0);
  await page.screenshot({ path: "/tmp/ke-compact-saved-desktop.png" });
});

test('editing prefills saved options; confirmed save collapses and reopens from acknowledged choices', async ({ page }) => {
  const f = await install(page);
  await page.getByRole('button', { name: 'Edit answers', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Park', exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Find an outcome', exact: true })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Museum', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: 'Cafe', exact: true }).uncheck();
  await expect(page.getByRole('button', { name: 'Save answers', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: /These are fictional test answers/ }).check();
  await page.getByRole('button', { name: 'Save answers', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit answers', exact: true })).toBeVisible();
  await expect(page.locator('.ke-saved-answer-topics')).not.toContainText('Museum');
  expect(f.writes()).toBe(1);
  expect(f.commands[0]!.type).toBe('CONFIRM_PRIVATE_ANSWERS');
  await page.getByRole('button', { name: 'Edit answers', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Park', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Museum', exact: true })).not.toBeChecked();
});

test('cancel editing keeps acknowledged answers and makes no write', async ({ page }) => {
  const f = await install(page);
  await page.getByRole('button', { name: 'Edit answers', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Park', exact: true }).uncheck();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Cancel editing', exact: true }).click();
  await expect(page.locator('.ke-saved-answer-topics')).toContainText('Park · Museum · Cafe');
  await expect(page.getByRole('button', { name: 'Find an outcome', exact: true })).toBeVisible();
  expect(f.writes()).toBe(0);
});

test('unknown save keeps selections and recovery without claiming saved or retrying automatically', async ({ page }) => {
  const f = await install(page, { failure: true, fresh: true });
  const topics = page.locator('.ke-response-topic');
  await topics.nth(0).getByRole('button', { name: 'Select all', exact: true }).click();
  await topics.nth(1).getByRole('button', { name: 'Select all', exact: true }).click();
  await page.getByRole('checkbox', { name: /These are fictional test answers/ }).check();
  await page.getByRole('button', { name: 'Save answers', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry the same action', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Museum', exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Edit answers', exact: true })).toHaveCount(0);
  expect(f.writes()).toBe(1);
});

test('same-frame refresh preserves unsaved choices and unconfirmed AI notes never replace saved summary', async ({ page }) => {
  await install(page, { aiDraft: true });
  await expect(page.locator('.ke-saved-answer-topics')).toContainText('Park · Museum · Cafe');
  await expect(page.getByText('Your extra notes have suggestions to review.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Edit answers', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Museum', exact: true }).uncheck();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Refresh decision', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Museum', exact: true })).not.toBeChecked();
});

test('closed decision is read-only and missing progress is not reported as complete', async ({ page }) => {
  await install(page, { closed: true, missingProgress: true });
  await expect(page.locator('.ke-response-phase')).toHaveText('Closed · 2 participants');
  await expect(page.getByRole('button', { name: 'Edit answers', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save answers', exact: true })).toHaveCount(0);
});

for (const theme of ['light', 'dark']) test(`compact topics fit desktop and mobile in ${theme} mode`, async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 850 });
  await install(page, { fresh: true });
  await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
  const topics = page.locator('.ke-response-topic');
  const first = await topics.nth(0).boundingBox(), second = await topics.nth(1).boundingBox();
  expect(Math.abs(first!.y - second!.y)).toBeLessThan(5);
  await expect(page.getByRole('checkbox', { name: 'Cafe', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileFirst = await topics.nth(0).boundingBox(), mobileSecond = await topics.nth(1).boundingBox();
  expect(mobileSecond!.y).toBeGreaterThan(mobileFirst!.y + mobileFirst!.height - 1);
  const dialog = page.locator('.ke-open-decision-dialog');
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: `/tmp/ke-compact-${theme}-mobile.png` });
});
