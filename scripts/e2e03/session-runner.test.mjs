import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { chromium } from 'playwright';
import { existingFixtureReadback, groupsResponse, safeRoute, Recorder, waitForGroups, waitForDecisionReady } from './session-runner.mjs';

test('existing fixture reconciliation matches stable IDs and never selects another same-title decision', () => {
  const fixture = { groupId: 'group-kept', draftId: 'draft-kept', decisionId: 'decision-kept' };
  const ownGroup = { id: 'group-kept', members: [{}, {}], drafts: [{ id: 'draft-kept' }],
    decisions: [{ id: 'decision-kept', title: 'Friday activity' }, { id: 'decision-other', title: 'Friday activity' }] };
  const result = existingFixtureReadback([ownGroup], fixture);
  assert.deepEqual(result, { group: 'PRESENT', memberCount: 2, decision: 'PRESENT',
    decisionTitleMatches: true, draft: 'PRESENT' });
  assert.equal(existingFixtureReadback([], fixture).group, 'MISSING');
  assert.equal(existingFixtureReadback([{ ...ownGroup, decisions: [ownGroup.decisions[0], ownGroup.decisions[0]] }], fixture).decision, 'AMBIGUOUS');
});

test('decision readiness waits past the loading shell and wrong record, and still rejects a wrong title', async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent('<dialog open class="ke-open-decision-dialog"><h2 id="open-decision-title">Your decision</h2></dialog>');
    let ready = false;
    const pending = waitForDecisionReady(page, 'decision-owned', 'Friday activity', 3000).then(() => { ready = true; });
    await page.waitForTimeout(100);
    assert.equal(ready, false);
    await page.evaluate(() => {
      document.querySelector('dialog').dataset.decisionId = 'decision-other';
      document.querySelector('h2').textContent = 'Friday activity';
    });
    await page.waitForTimeout(100);
    assert.equal(ready, false);
    await page.evaluate(() => { document.querySelector('dialog').dataset.decisionId = 'decision-owned'; });
    await pending;
    assert.equal(ready, true);
    await page.evaluate(() => { document.querySelector('h2').textContent = 'Different decision'; });
    await assert.rejects(waitForDecisionReady(page, 'decision-owned', 'Friday activity', 150),
      error => error.domain === 'AUTOMATION' && error.code === 'DECISION_VIEW_NOT_READY');
  } finally { await browser.close(); }
});

test('real Playwright Response shape recognizes only successful authenticated group reads', () => {
  const response = (status = 200, method = 'GET', url = 'https://example.execute-api.us-east-1.amazonaws.com/groups') =>
    ({ url: () => url, status: () => status, request: () => ({ method: () => method }) });
  assert.equal(groupsResponse(response()), true);
  assert.equal(groupsResponse(response(401)), false);
  assert.equal(groupsResponse(response(200, 'POST')), false);
  assert.equal(groupsResponse(response(200, 'GET', 'https://unrelated.example/groups')), false);
});
test('network evidence strips account identifiers and query credentials', () => {
  assert.equal(safeRoute('https://example.execute-api.us-east-1.amazonaws.com/groups/group-secret/draft-requests/request-secret?token=private'), '/groups/:id/draft-requests/:id');
  assert.equal(safeRoute('https://cognito-idp.us-east-1.amazonaws.com/'), null);
});
test('account HTTP failure is reported immediately without consuming a shared response body', async () => {
  const page = new EventEmitter(); let bodyRead = false;
  const pending = waitForGroups(page, 1000);
  page.emit('response', { url: () => 'https://abc.execute-api.us-east-1.amazonaws.com/account',
    request: () => ({ method: () => 'GET' }), status: () => 503,
    json: () => { bodyRead = true; return new Promise(() => {}); } });
  await assert.rejects(pending, error => error.domain === 'APP_HTTP'
    && error.status === 503 && error.route === '/account');
  assert.equal(bodyRead, false);
});
test('timeout captures screenshot before closure and persists intent/result without error secrets', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e03-recorder-test-'));
  try {
    const recorder = new Recorder(directory, 'local-test'); let captured = false;
    const page = { isClosed: () => false, url: () => 'https://example.test/?token=private', locator: () => ({}),
      screenshot: async options => { captured = true; assert.equal(options.mask.length, 1); } };
    await assert.rejects(recorder.step('U1', 'login', page, async () => { throw new Error('SECRET_NEVER_LOG'); }));
    assert.equal(captured, true);
    const events = fs.readFileSync(path.join(directory, 'events.jsonl'), 'utf8');
    assert.equal(events.includes('SECRET_NEVER_LOG'), false); assert.equal(events.includes('token=private'), false);
    assert.deepEqual(events.trim().split('\n').map(line => JSON.parse(line).event), ['ACTION_INTENT', 'ACTION_RESULT']);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'summary.json'))).inFlightAction, null);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
