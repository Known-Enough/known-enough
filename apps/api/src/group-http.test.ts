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

it('selected group read uses current approved membership and exposes no private account metadata', async () => {
  const api = await npApi();
  try {
    for (const who of ['owner', 'outsider']) { await api.call(who, '/account/register', { displayName: who }); await api.approve(who); }
    const created = await api.call('owner', '/groups', { name: 'Selected group', idempotencyKey: 'one' });
    const group = (await created.json()).group;
    const read = await api.call('owner', `/groups/${group.id}`); expect(read.status).toBe(200);
    expect(await read.text()).not.toMatch(/emailHash|subject|profile|description|bytesBase64/);
    expect((await api.call('outsider', `/groups/${group.id}`)).status).toBe(404);
    await api.disable('owner'); expect((await api.call('owner', `/groups/${group.id}`)).status).toBe(403);
  } finally { await api.close(); }
});
