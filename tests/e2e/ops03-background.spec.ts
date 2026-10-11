import { expect, test } from '@playwright/test';
import { KnownEnough as KE } from '@deal-table/contracts';
import { BACKGROUND_NEGOTIATION_PROFILE } from '@deal-table/contracts/durable-command';
import { buildHypotheticalContributionFixture } from '../../packages/test-support/src/known-enough-fixtures';

// Local transport fixtures exercise the browser; they do not qualify AWS identity or execution.
test('queued negotiation retries the same unknown request and resumes read-only result checks after reload', async ({ page }) => {
  const fixture = await buildHypotheticalContributionFixture();
  const proposal = fixture.publicSnapshot;
  const snapshot = (status: 'READY' | 'REASONING' | 'PROPOSED') => KE.PublicDecisionSnapshot.parse({
    ...proposal, status, currentProposal: status === 'PROPOSED' ? proposal.currentProposal : null,
  });
  const owner = (status: 'READY' | 'REASONING' | 'PROPOSED') => KE.OwnerDecisionSnapshot.parse({
    ...fixture.ownerSnapshot, publicSnapshot: snapshot(status),
    privateProposalValues: status === 'PROPOSED' ? fixture.ownerSnapshot.privateProposalValues : null,
  });
  let state: 'READY' | 'REASONING' | 'PROPOSED' = 'READY';
  const bodies: string[] = []; let reads = 0;
  await page.addInitScript(() => sessionStorage.setItem('known-enough-cognito-session', JSON.stringify({
    accessToken: 'local.browser.fixture', kind: 'participant', expiresAt: Date.now() + 900000,
  })));
  await page.route('https://local-api.example.invalid/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204 }); return; }
    const headers = { 'access-control-allow-origin': '*' };
    if (path.endsWith('/commands')) {
      bodies.push(request.postData()!);
      if (bodies.length === 1) { await route.abort('failed'); return; }
      state = 'REASONING';
      const command = JSON.parse(request.postData()!);
      await route.fulfill({ json: { ok: true, requestId: command.requestId, job: {
        jobId: '12345678-1234-4234-9234-123456789012', state: 'QUEUED', expiresAt: new Date(Date.now() + 300000).toISOString(),
      } }, headers }); return;
    }
    if (path.endsWith('/public')) {
      reads++;
      await route.fulfill({ body: JSON.stringify(snapshot(state)), headers,
        contentType: `application/json; profile="${BACKGROUND_NEGOTIATION_PROFILE}"` }); return;
    }
    if (path.endsWith('/me')) { await route.fulfill({ json: owner(state), headers }); return; }
    await route.fulfill({ status: 404, json: {} });
  });
  const url = `http://127.0.0.1:5175/?decision=${proposal.frame.decisionId}`;
  await page.goto(url);
  await page.getByRole('button', { name: 'Load shared decision' }).click();
  await page.getByRole('button', { name: 'Explore proposals' }).click();
  await page.getByRole('button', { name: 'Retry the same action', exact: true }).click();
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[0]).toBe(bodies[1]);
  expect(JSON.parse(bodies[1]!).type).toBe('REQUEST_NEGOTIATION');
  await expect(page.getByRole('button', { name: 'Explore proposals' })).toBeDisabled();
  await page.reload();
  await page.getByRole('button', { name: 'Load shared decision' }).click();
  await expect(page.getByRole('button', { name: 'Explore proposals' })).toBeDisabled();
  const readsBefore = reads; state = 'PROPOSED';
  await expect(page.getByRole('heading', { name: 'Current hypothetical proposal' })).toBeVisible({ timeout: 10000 });
  expect(reads).toBeGreaterThan(readsBefore);
  expect(bodies).toHaveLength(2);
});
