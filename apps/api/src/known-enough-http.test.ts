import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryRoomRepository } from '@deal-table/adapters';
import { buildChristmasFixture } from '../../../packages/test-support/src/known-enough-fixtures.ts';
import { DecisionArchitect, KnownEnoughApplication } from '@deal-table/application';
import { createLocalKnownEnoughApiHandler } from './http-core.ts';

const decisionId = 'christmas-decision';
const identities = new Map([
  ['NON_PRODUCTION maya', { kind: 'participant' as const, subject: 'subject-maya' }],
  ['NON_PRODUCTION display', { kind: 'display' as const, subject: 'display-subject', roomId: decisionId }],
  ['NON_PRODUCTION outsider', { kind: 'participant' as const, subject: 'outsider' }],
]);
let servers: Server[] = [];

async function setup(architect?: DecisionArchitect) {
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
  const server = createServer(createLocalKnownEnoughApiHandler({ application, identities, ...(architect ? { architect } : {}) }));
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected ephemeral TCP address');
  const base = `http://127.0.0.1:${address.port}`;
  const get = (path: string, label = 'NON_PRODUCTION maya') => fetch(base + path, {
    headers: { 'x-deal-table-test-identity': label },
  });
  return { get, base, application };
}

afterEach(async () => {
  await Promise.all(servers.map(server => new Promise<void>(resolve => server.close(() => resolve()))));
  servers = [];
});

describe('Known Enough local HTTP adapter', () => {
  it('authenticates and returns only an injected, validated public frame draft', async () => {
    let received: unknown;
    let sequence = 0;
    const architect = new DecisionArchitect({ draft: async input => {
      received = input;
      return {
        title: 'Choose a destination', description: 'Compare the options named by the group.',
        variables: [{ id: 'destination', type: 'ENUM', label: 'Destination', required: true,
          visibility: 'PUBLIC', ownerParticipantId: null, options: [{ id: 'oaxaca', label: 'Oaxaca' }] }],
        rules: [], clarificationQuestions: [],
        participantInformationRequirements: [{ participantId: 'person-1', kind: 'DATES' }],
      };
    } }, () => `api-architect-${++sequence}`);
    const { get, base, application } = await setup(architect);
    const response = await fetch(`${base}/decisions/architecture/draft`, {
      method: 'POST',
      headers: { 'x-deal-table-test-identity': 'NON_PRODUCTION maya', 'content-type': 'application/json', 'x-request-id': 'architect-request' },
      body: JSON.stringify({
        requestId: 'architect-request', draftId: 'local-draft', revision: 1,
        objective: 'Choose a destination together.',
        participants: [{ id: 'person-1', displayName: 'Organizer' }], allowedOptions: ['Oaxaca'],
      }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { draft: {
      status: string; frame: { title: string; participants: unknown[] }; clarificationQuestions: string[];
      participantInformationRequirements: { participantId: string; prompt: string }[];
    } };
    expect(body.draft).toMatchObject({ status: 'DEFINING', frame: { title: 'Choose a destination', participants: [{ id: 'person-1' }] } });
    expect(body.draft.clarificationQuestions).toEqual([]);
    expect(body.draft.frame).not.toHaveProperty('ownerParticipantId');
    expect(body.draft.participantInformationRequirements).toEqual([
      { participantId: 'person-1', prompt: 'Share dates or times that do not work for you privately.' },
    ]);
    expect(received).toMatchObject({ objective: 'Choose a destination together.', allowedOptions: ['Oaxaca'] });
    expect(JSON.stringify(received)).not.toMatch(/private|condition-synthetic|budget/i);
    const original = await get(`/decisions/${decisionId}/public`);
    expect(original.status).toBe(200);
    await expect(original.json()).resolves.toMatchObject({ status: 'COLLECTING_FRAME_CONFIRMATION' });

    const frame = body.draft.frame as {
      decisionId: string; schemaVersion: number; frameVersion: number; semanticVersion: number; contextToken: string;
      title: string; objective: string; description: string;
      participants: { id: string; displayName: string; requiredForApproval: boolean }[];
      requiredParticipantIds: string[];
      variables: Record<string, unknown>[];
      rules: unknown[];
    };
    await application.createDecision({
      definition: { ...frame, variables: frame.variables.map(variable => ({ ...variable, ownerParticipantId: null })) },
      creatorSubject: 'subject-person-1',
      memberships: frame.participants.map(person => ({ subject: `subject-${person.id}`, participantId: person.id, active: true })),
    });
    const created = await application.getPublicSnapshot({ kind: 'participant', subject: 'subject-person-1' }, frame.decisionId);
    expect(created.status).toBe('COLLECTING_FRAME_CONFIRMATION');
    expect(created.frameConfirmations).toEqual([]);

    const unauthenticated = await fetch(`${base}/decisions/architecture/draft`, { method: 'POST' });
    expect(unauthenticated.status).toBe(401);
    const display = await fetch(`${base}/decisions/architecture/draft`, {
      method: 'POST', headers: { 'x-deal-table-test-identity': 'NON_PRODUCTION display' },
    });
    expect(display.status).toBe(403);
  });

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
