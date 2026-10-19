import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { groupsResponse, safeRoute, Recorder } from './session-runner.mjs';

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
