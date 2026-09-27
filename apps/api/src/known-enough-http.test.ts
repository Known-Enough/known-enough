import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryRoomRepository } from '@deal-table/adapters';
import { buildChristmasFixture } from '../../../packages/test-support/src/known-enough-fixtures.ts';
import { KnownEnoughApplication } from '@deal-table/application';
import { createLocalKnownEnoughApiHandler } from './http-core.ts';

const decisionId = 'christmas-decision';
const identities = new Map([
  ['NON_PRODUCTION maya', { kind: 'participant' as const, subject: 'subject-maya' }],
  ['NON_PRODUCTION display', { kind: 'display' as const, subject: 'display-subject', roomId: decisionId }],
  ['NON_PRODUCTION outsider', { kind: 'participant' as const, subject: 'outsider' }],
]);
let servers: Server[] = [];

async function setup() {
  const fixture = buildChristmasFixture();
  let sequence = 0;
  const application = new KnownEnoughApplication({
    repository: new InMemoryRoomRepository(),
    clock: { now: () => '2026-10-01T12:00:00.000Z' },
    ids: { next: () => `api-ke03-${++sequence}` },
  });
  await application.createDecision({
    definition: fixture.definition,
    creatorSubject: 'subject-maya',
    memberships: fixture.definition.participants.map(person => ({
      subject: `subject-${person.id}`, participantId: person.id, active: true,
    })),
  });
  const server = createServer(createLocalKnownEnoughApiHandler({ application, identities }));
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected ephemeral TCP address');
  const base = `http://127.0.0.1:${address.port}`;
  const get = (path: string, label = 'NON_PRODUCTION maya') => fetch(base + path, {
    headers: { 'x-deal-table-test-identity': label },
  });
  return { get, base };
}

afterEach(async () => {
  await Promise.all(servers.map(server => new Promise<void>(resolve => server.close(() => resolve()))));
  servers = [];
});

describe('Known Enough local HTTP adapter', () => {
  it('serves public and owner-scoped snapshots from trusted membership bindings', async () => {
    const { get } = await setup();
    const publicResponse = await get(`/decisions/${decisionId}/public`);
    expect(publicResponse.status).toBe(200);
    const publicSnapshot = await publicResponse.json() as { frame: { participants: unknown[]; variables: unknown[] } };
    expect(publicSnapshot.frame.participants).toHaveLength(5);
    expect(JSON.stringify(publicSnapshot)).not.toContain('Maya private');

    const ownerResponse = await get(`/decisions/${decisionId}/me`);
    expect(ownerResponse.status).toBe(200);
    const ownerSnapshot = await ownerResponse.json() as { privateVariables: { ownerParticipantId: string }[] };
    expect(ownerSnapshot.privateVariables.every(variable => variable.ownerParticipantId === 'maya')).toBe(true);
  });

  it('checks membership and display write scope before parsing a command body', async () => {
    const { get, base } = await setup();
    const outsider = await fetch(`${base}/decisions/${decisionId}/commands`, {
      method: 'POST', headers: { 'x-deal-table-test-identity': 'NON_PRODUCTION outsider' }, body: 'not-json',
    });
    expect(outsider.status).toBe(404);
    expect(await outsider.json()).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });

    const display = await fetch(`${base}/decisions/${decisionId}/commands`, {
      method: 'POST', headers: {
        'x-deal-table-test-identity': 'NON_PRODUCTION display', 'content-type': 'application/json',
      }, body: '{}',
    });
    expect(display.status).toBe(403);
    expect(await display.json()).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });

    const unknown = await get(`/decisions/${decisionId}/public`, 'NON_PRODUCTION outsider');
    expect(unknown.status).toBe(404);
  });
});
