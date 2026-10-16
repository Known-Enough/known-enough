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

it('shared participant profile is group-scoped and returns only display name, bio and avatar pixels', async () => {
  const api = await npApi();
  try {
    for (const who of ['owner', 'guest', 'outsider']) {
      await api.call(who, '/account/register', { displayName: who }); await api.approve(who);
    }
    const created = await api.call('owner', '/groups', { name: 'Shared profile club', idempotencyKey: 'profile-club' });
    const group = (await created.json()).group;
    await api.repository.transaction(state => {
      const owner = state.accounts.find(account => account.subject === 'owner')!;
      owner.displayName = 'Owner name';
      owner.profile = { description: 'A short bio for the group.', loginUsername: 'private-login', image: {
        id: 'private-avatar-id', mimeType: 'image/png', width: 1, height: 1, bytesBase64: 'YQ==', sha256: 'a'.repeat(64) } };
    });
    const invite = await api.call('owner', `/groups/${group.id}/invitations`, { recipient: 'login-guest', replace: false });
    expect(invite.status).toBe(200);
    const inboxResponse = await api.call('guest', '/invitations'); expect(inboxResponse.status).toBe(200);
    const inbox = (await inboxResponse.json()).invitations;
    expect(inbox).toHaveLength(1); expect(inbox[0]).toMatchObject({ groupId: group.id, groupName: 'Shared profile club', organizerName: 'Owner name' });
    expect(JSON.stringify(inbox)).not.toMatch(/guest@example.invalid|login-guest|emailHash|subject|tokenHash/);
    expect((await api.call('outsider', '/invitations')).status).toBe(200);
    expect((await api.call('outsider', '/invitations').then(response => response.json())).invitations).toEqual([]);
    expect((await api.call('guest', '/groups/accept', { groupId: inbox[0].groupId, invitationId: inbox[0].id })).status).toBe(200);
    expect((await api.call('guest', '/invitations').then(response => response.json())).invitations).toEqual([]);
    const snapshot = await api.call('guest', `/groups/${group.id}`); const members = (await snapshot.json()).group.members;
    const memberId = members.find((member: { displayName: string }) => member.displayName === 'Owner name').id;
    const shared = await api.call('guest', `/groups/${group.id}/members/${memberId}/profile`);
    expect(shared.status).toBe(200);
    const value = (await shared.json()).profile;
    expect(value).toEqual({ displayName: 'Owner name', description: 'A short bio for the group.', image: {
      mimeType: 'image/png', width: 1, height: 1, bytesBase64: 'YQ==' } });
    expect(Object.keys(value).sort()).toEqual(['description', 'displayName', 'image']);
    expect(Object.keys(value.image).sort()).toEqual(['bytesBase64', 'height', 'mimeType', 'width']);
    expect(JSON.stringify(value)).not.toMatch(/subject|email|login|status|version|private-avatar-id|sha256/);
    expect((await api.call('outsider', `/groups/${group.id}/members/${memberId}/profile`)).status).toBe(404);
    expect((await api.call('guest', `/groups/elsewhere/members/${memberId}/profile`)).status).toBe(404);
  } finally { await api.close(); }
});
