import { describe, expect, it } from 'vitest';
import { MemoryGroupRepository } from '@deal-table/adapters';
import { GroupService, memberId } from './group-service.ts';
import { operateAccount } from './group-operator.ts';
const principal = (subject: string) => ({ kind: 'participant' as const, subject });
function setup() {
  const repository = new MemoryGroupRepository(); let now = Date.parse('2026-09-30T12:00:00Z');
  const service = new GroupService(repository, { emailKey: 'fictional-test-key-never-live-123456', now: () => now });
  async function register(who: string, approve = true) {
    await service.register(principal(who), { email: `${who}@example.invalid`, verified: true }, { displayName: who });
    if (approve) await operateAccount(repository, 'approve', who, 1);
  }
  return { service, repository, register, expire: () => { now += 86400001; } };
}
describe('NP01 admission and recipient-bound groups', () => {
  it('rejects unverified registration, forged profile fields and pending admission; repeated registration stays pending', async () => {
    const { service, register } = setup();
    await expect(service.register(principal('new'), { email: 'new@example.invalid', verified: false }, { displayName: 'New' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.register(principal('new'), { email: 'new@example.invalid', verified: true }, { displayName: 'New', status: 'APPROVED' })).rejects.toMatchObject({ code: 'INVALID_COMMAND' });
    await register('new', false);
    expect(await service.status(principal('new'))).toMatchObject({ status: 'PENDING', version: 1 });
    await expect(service.create(principal('new'), { name: 'Group', idempotencyKey: 'one' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('disabling blocks existing principals on every group and decision admission, with guarded operator readback', async () => {
    const { service, repository, register } = setup(); await register('new');
    const who = principal('new'); await service.create(who, { name: 'Group', idempotencyKey: 'one' });
    await expect(operateAccount(repository, 'disable', 'new', 1)).rejects.toThrow('changed');
    expect(await operateAccount(repository, 'disable', 'new', 2)).toMatchObject({ status: 'DISABLED', version: 3 });
    expect(await operateAccount(repository, 'disable', 'new', 2)).toMatchObject({ version: 3 });
    await expect(service.list(who)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.authorizeDecision(who, 'legacy')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(operateAccount(repository, 'reject', 'new', 3)).rejects.toThrow('pending');
    expect(await operateAccount(repository, 'approve', 'new', 3)).toMatchObject({ status: 'APPROVED', version: 4 });
  });
  it('binds invitation acceptance to approved verified recipient, with exact replay and no automatic decision consent', async () => {
    const { service, register } = setup(); await register('organizer'); await register('guest'); await register('wrong');
    const group = await service.create(principal('organizer'), { name: 'Movie club', idempotencyKey: 'club' });
    const invite = await service.invite(principal('organizer'), group.id, { email: 'guest@example.invalid', replace: false });
    await expect(service.accept(principal('wrong'), { token: invite.token })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.invite(principal('wrong'), group.id, { email: 'other@example.invalid', replace: false })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [first, replay] = await Promise.all([service.accept(principal('guest'), { token: invite.token }), service.accept(principal('guest'), { token: invite.token })]);
    expect(first).toEqual(replay); expect(first.version).toBe(2); expect(first.members).toHaveLength(2); expect(first.decisions).toEqual([]);
    expect(JSON.stringify(first)).not.toMatch(/emailHash|tokenHash|example.invalid|subject|grant/);
    await expect(service.invite(principal('guest'), group.id, { email: 'other@example.invalid', replace: false })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('replacement invalidates lost token; expiry denies even accepted-token replay; unknown links are isolated', async () => {
    const { service, register, expire } = setup(); await register('host'); await register('guest');
    const group = await service.create(principal('host'), { name: 'Club', idempotencyKey: 'club' });
    const old = await service.invite(principal('host'), group.id, { email: 'guest@example.invalid', replace: false });
    await expect(service.invite(principal('host'), group.id, { email: 'guest@example.invalid', replace: false })).rejects.toMatchObject({ code: 'STALE_CONTEXT' });
    const next = await service.invite(principal('host'), group.id, { email: 'guest@example.invalid', replace: true });
    await expect(service.accept(principal('guest'), { token: old.token })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await service.accept(principal('guest'), { token: next.token }); expire();
    await expect(service.accept(principal('guest'), { token: next.token })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('membership revisions freeze linked decisions and deny removed users and stale roster binding', async () => {
    const { service, register } = setup(); await register('host'); await register('guest');
    const group = await service.create(principal('host'), { name: 'Club', idempotencyKey: 'club' });
    const invite = await service.invite(principal('host'), group.id, { email: 'guest@example.invalid', replace: false });
    await service.bindDecision(principal('host'), group.id, 'decision-one', 1);
    await service.accept(principal('guest'), { token: invite.token });
    await expect(service.authorizeDecision(principal('host'), 'decision-one')).rejects.toMatchObject({ code: 'STALE_CONTEXT' });
    await expect(service.bindDecision(principal('host'), group.id, 'decision-two', 1)).rejects.toMatchObject({ code: 'STALE_CONTEXT' });
    await service.remove(principal('host'), group.id, { memberId: memberId('guest'), version: 2 });
    await expect(service.authorizeDecision(principal('guest'), 'decision-one')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.accept(principal('guest'), { token: invite.token })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('create request replays the same group and rejects changed body; registration cannot hijack another email', async () => {
    const { service, register } = setup(); await register('host');
    const body = { name: 'Club', idempotencyKey: 'club' };
    expect(await service.create(principal('host'), body)).toEqual(await service.create(principal('host'), body));
    await expect(service.create(principal('host'), { ...body, name: 'Changed' })).rejects.toMatchObject({ code: 'STALE_CONTEXT' });
    await expect(service.register(principal('other'), { email: 'host@example.invalid', verified: true }, { displayName: 'Other' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
