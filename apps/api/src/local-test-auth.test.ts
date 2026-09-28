import { describe, expect, it } from 'vitest';
import { createLocalTestSessionManager } from './local-test-auth.ts';

describe('loopback signed test sessions', () => {
  it('signs only an allowlisted identity and rejects tampering and expired sessions', async () => {
    let now = Date.parse('2026-09-28T18:00:00.000Z');
    const manager = createLocalTestSessionManager([
      { id: 'maya', displayName: 'Maya', participantId: 'maya', identity: { kind: 'participant', subject: 'subject-maya' } },
    ], { key: Buffer.alloc(32, 7), now: () => now, ttlMs: 60_000 });
    expect(manager.issue('subject-maya')).toBeNull();
    const session = manager.issue('maya');
    expect(session?.expiresAt).toBe('2026-09-28T18:01:00.000Z');
    await expect(manager.resolve(`Bearer ${session!.token}`)).resolves.toEqual({ kind: 'participant', subject: 'subject-maya' });
    const forged = `${session!.token.slice(0, -1)}${session!.token.endsWith('A') ? 'B' : 'A'}`;
    await expect(manager.resolve(`Bearer ${forged}`)).resolves.toBeNull();
    await expect(manager.resolve(`Bearer ${session!.token}.extra`)).resolves.toBeNull();
    now += 60_001;
    await expect(manager.resolve(`Bearer ${session!.token}`)).resolves.toBeNull();
  });

  it('keeps display sessions bound to the server-configured shared screen', async () => {
    const manager = createLocalTestSessionManager([
      { id: 'display', displayName: 'Shared display', identity: { kind: 'display', subject: 'display-subject', roomId: 'christmas-decision' } },
    ], { key: Buffer.alloc(32, 4) });
    const session = manager.issue('display');
    expect(session?.kind).toBe('display');
    await expect(manager.resolve(`Bearer ${session!.token}`)).resolves.toEqual({
      kind: 'display', subject: 'display-subject', roomId: 'christmas-decision',
    });
  });

  it('rejects weak signing keys, excessive lifetimes, and invalid account configuration', () => {
    expect(() => createLocalTestSessionManager([], { key: Buffer.alloc(8) })).toThrow();
    expect(() => createLocalTestSessionManager([], { ttlMs: 60 * 60_000 + 1 })).toThrow();
    expect(() => createLocalTestSessionManager([
      { id: 'maya', displayName: 'Maya', identity: { kind: 'participant', subject: 'subject-maya' } },
      { id: 'maya', displayName: 'Duplicate', identity: { kind: 'participant', subject: 'subject-other' } },
    ])).toThrow();
  });
});
