import { describe, expect, it } from 'vitest';
import { signedScenarioApi } from '../evaluations/ke14-api.ts';

describe('KE14 fixed API with offline signed Cognito identity', () => {
  it('authorizes creator/model routes and rejects inactive, display, unregistered and forged identities', async () => {
    const h = await signedScenarioApi();
    try {
      const body = { requestId: 'create-http', idempotencyKey: 'create-http', scenario: 'SHARED_PURCHASE', objective: 'Synthetic purchase.' };
      expect((await h.call('outsider', '/decisions', body)).status).toBe(403);
      expect((await h.call('display', '/decisions', body, 'christmas-decision')).status).toBe(403);
      expect((await fetch(h.base + '/decisions', { method: 'POST', headers: { 'x-deal-table-test-identity': 'NON_PRODUCTION maya', 'content-type': 'application/json' }, body: JSON.stringify(body) })).status).toBe(401);
      expect(h.requests).toHaveLength(0);
      const created = await h.call('maya', '/decisions', body);
      expect(created.status).toBe(200);
      const { snapshot } = await created.json();
      const id = snapshot.frame.decisionId;
      const replay = await h.call('maya', '/decisions', body);
      expect(replay.status).toBe(200);
      expect(h.requests).toHaveLength(1);
      expect((await h.call('maya', '/decisions', { ...body, objective: 'Changed' })).status).toBe(409);
      for (const path of [`/decisions/${id}/me`, `/decisions/${id}/owner-conversation/draft`, `/decisions/${id}/reasoning`])
        expect((await h.call('leo', path, path.endsWith('/me') ? undefined : path.endsWith('/reasoning') ? { requestId: 'inactive' } : { requestId: 'inactive', messages: [{ role: 'owner', text: 'Synthetic condition.' }] })).status).toBe(404);
      expect(h.requests).toHaveLength(1);
      expect((await h.call('display', `/decisions/${id}/public`, undefined, id)).status).toBe(200);
      expect((await h.call('display', `/decisions/${id}/owner-conversation/draft`, { requestId: 'display', messages: [] }, id)).status).toBe(403);
      const invite = await h.call('maya', `/decisions/${id}/invitations`, { requestId: 'issue', participantId: 'leo' });
      expect(invite.status).toBe(201);
      const { token } = await invite.json();
      expect((await h.call('nina', `/decisions/${id}/invitations/redeem`, { requestId: 'wrong', token })).status).toBe(404);
      expect((await h.call('leo', `/decisions/${id}/invitations/redeem`, { requestId: 'correct', token })).status).toBe(200);
      expect((await h.call('leo', `/decisions/${id}/me`)).status).toBe(200);
    } finally { await h.close(); }
  });
});
