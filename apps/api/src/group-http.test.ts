import { expect, it } from 'vitest';
import { npApi } from '../../../tests/evaluations/np-api.ts';
it('real JWT verifier gates registration/groups, denies mock identity and old disabled bearer, no admin API', async () => {
  const api = await npApi();
  try {
    expect((await fetch(api.base + '/groups', { headers: { 'x-deal-table-test-identity': 'NON_PRODUCTION host' } })).status).toBe(401);
    expect((await api.call('unverified', '/account/register', { displayName: 'Unverified' })).status).toBe(403);
    expect((await api.call('host', '/account/register', { displayName: 'Host' })).status).toBe(200);
    expect((await api.call('host', '/groups', { name: 'New', idempotencyKey: 'new' })).status).toBe(403);
    await api.approve('host');
    const response = await api.call('host', '/groups', { name: 'New', idempotencyKey: 'new' }); expect(response.status).toBe(200);
    const value = await response.text(); expect(value).not.toMatch(/emailHash|tokenHash|subject|example.invalid/);
    expect((await api.call('host', '/account/approve', { subject: 'host' })).status).toBe(404);
    const oldBearer = api.bearer('host'); await api.disable('host');
    expect((await fetch(api.base + '/groups', { headers: { authorization: `Bearer ${oldBearer}` } })).status).toBe(403);
    expect((await api.call('host', '/decisions/unknown/public')).status).toBe(403);
  } finally { await api.close(); }
});
