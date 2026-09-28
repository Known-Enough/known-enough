import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryRoomRepository } from '@deal-table/adapters';
import { buildChristmasFixture, buildChristmasPublicCandidates } from '../../../packages/test-support/src/known-enough-fixtures.ts';
import {
  DecisionArchitect, DecisionNegotiator, KnownEnoughApplication, OwnerConversationArchitect,
  type DecisionNegotiationModel, type OwnerConversationModel, type TrustedPrincipal,
} from '@deal-table/application';
import { createLocalKnownEnoughApiHandler } from './http-core.ts';

const decisionId = 'christmas-decision';
const identities = new Map([
  ['NON_PRODUCTION maya', { kind: 'participant' as const, subject: 'subject-maya' }],
  ['NON_PRODUCTION leo', { kind: 'participant' as const, subject: 'subject-leo' }],
  ['NON_PRODUCTION display', { kind: 'display' as const, subject: 'display-subject', roomId: decisionId }],
  ['NON_PRODUCTION outsider', { kind: 'participant' as const, subject: 'outsider' }],
]);
let servers: Server[] = [];

async function setup(architect?: DecisionArchitect, ownerModel?: OwnerConversationModel, negotiationModel?: DecisionNegotiationModel) {
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
  const ownerConversation = ownerModel ? new OwnerConversationArchitect({
    application, model: ownerModel,
    clock: { now: () => '2026-10-01T12:00:00.000Z' }, ids: { next: () => `api-owner-draft-${++sequence}` },
  }) : undefined;
  const negotiator = negotiationModel ? new DecisionNegotiator({
    application, model: negotiationModel, publicCandidates: buildChristmasPublicCandidates,
    clock: { now: () => '2026-10-01T12:00:00.000Z' }, ids: { next: () => `api-negotiation-${++sequence}` },
  }) : undefined;
  const server = createServer(createLocalKnownEnoughApiHandler({ application, identities,
    ...(architect ? { architect } : {}), ...(ownerConversation ? { ownerConversation } : {}), ...(negotiator ? { negotiator } : {}) }));
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected ephemeral TCP address');
  const base = `http://127.0.0.1:${address.port}`;
  const get = (path: string, label = 'NON_PRODUCTION maya') => fetch(base + path, {
    headers: { 'x-deal-table-test-identity': label },
  });
  return { get, base, application, fixture };
}

async function prepareReadyDecision(application: KnownEnoughApplication) {
  const fixture = buildChristmasFixture();
  const system: TrustedPrincipal = { kind: 'service', subject: 'test-provisioner', roomIds: [decisionId] };
  for (const person of fixture.definition.requiredParticipantIds) {
    const actor = { kind: 'participant' as const, subject: `subject-${person}` };
    const owner = await application.getOwnerSnapshot(actor, decisionId);
    const confirmation = await application.execute(actor, {
      schemaVersion: 2, type: 'CONFIRM_FRAME', requestId: `frame-${person}`, decisionId,
      idempotencyKey: `frame-${person}`,
      expected: { contextToken: owner.publicSnapshot.contextToken, semanticVersion: owner.publicSnapshot.semanticVersion,
        controlVersion: owner.controlVersion, ownerVersion: owner.ownerVersion },
      payload: { frameVersion: fixture.definition.frameVersion },
    });
    expect(confirmation.ok).toBe(true);
  }
  for (const person of fixture.definition.requiredParticipantIds) {
    const actor = { kind: 'participant' as const, subject: `subject-${person}` };
    const owner = await application.getOwnerSnapshot(actor, decisionId);
    const draft = {
      schemaVersion: 2 as const, draftId: `empty-${person}`, draftVersion: 1,
      decisionId, ownerParticipantId: person, ownerVersion: owner.ownerVersion,
      semanticVersion: owner.publicSnapshot.semanticVersion, contextToken: owner.publicSnapshot.contextToken,
      sourceSummary: 'No private conditions in this synthetic API test.', proposedConstraints: [], unsupportedConditions: [],
      createdAt: '2026-10-01T12:00:00.000Z',
    };
    await application.storeConstraintDraft(system, draft);
    const current = await application.getOwnerSnapshot(actor, decisionId);
    const result = await application.execute(actor, {
      schemaVersion: 2, type: 'CONFIRM_CONSTRAINTS', requestId: `inputs-${person}`, decisionId,
      idempotencyKey: `inputs-${person}`,
      expected: { contextToken: current.publicSnapshot.contextToken, semanticVersion: current.publicSnapshot.semanticVersion,
        controlVersion: current.controlVersion, ownerVersion: current.ownerVersion },
      payload: { draftId: `empty-${person}`, draftVersion: 1, constraintIds: [] },
    });
    expect(result.ok).toBe(true);
  }
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

  it('routes private owner conversation through authenticated owner context and stores no raw turns', async () => {
    let modelContext: unknown;
    const { get, base, application, fixture } = await setup(undefined, async context => {
      modelContext = context;
      return {
        sourceSummary: 'Do not retain this free-text summary.', proposedConstraints: [],
        unsupportedConditions: [{ id: 'clarify-limit', sourceSummary: 'do not retain owner text', clarificationQuestion: 'What is the maximum budget?' }],
      };
    });
    for (const participantId of fixture.definition.requiredParticipantIds) {
      const participant = { kind: 'participant' as const, subject: `subject-${participantId}` };
      const snapshot = await application.getOwnerSnapshot(participant, decisionId);
      const confirmed = await application.execute(participant, {
        schemaVersion: 2, type: 'CONFIRM_FRAME', requestId: `frame-${participantId}`,
        decisionId, idempotencyKey: `frame-confirm-${participantId}`,
        expected: {
          contextToken: snapshot.publicSnapshot.contextToken,
          semanticVersion: snapshot.publicSnapshot.semanticVersion,
          controlVersion: snapshot.controlVersion, ownerVersion: snapshot.ownerVersion,
        },
        payload: { frameVersion: fixture.definition.frameVersion },
      });
      expect(confirmed.ok).toBe(true);
    }
    const raw = 'My hard limit is $2,000; please do not reveal my personal reason.';
    const response = await fetch(`${base}/decisions/${decisionId}/owner-conversation/draft`, {
      method: 'POST', headers: {
        'x-deal-table-test-identity': 'NON_PRODUCTION maya', 'content-type': 'application/json',
      },
      body: JSON.stringify({ requestId: 'owner-conversation-1', messages: [{ role: 'owner', text: raw }] }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { draft: { sourceSummary: string; unsupportedConditions: { sourceSummary: string }[] } };
    expect(body.draft.sourceSummary).toBe('Review the structured conditions below before confirming them.');
    expect(JSON.stringify(body)).not.toContain(raw);
    expect(JSON.stringify(modelContext)).toContain(raw);
    expect(modelContext).toMatchObject({ ownerParticipantId: 'maya' });

    const maya = await get(`/decisions/${decisionId}/me`);
    const mayaBody = await maya.json() as { draft: unknown };
    expect(JSON.stringify(mayaBody.draft)).not.toContain(raw);
    const publicSnapshot = await get(`/decisions/${decisionId}/public`);
    expect(JSON.stringify(await publicSnapshot.json())).not.toContain(raw);
    const leo = await get(`/decisions/${decisionId}/me`, 'NON_PRODUCTION leo');
    expect((await leo.json()).draft).toBeNull();

    const outsider = await fetch(`${base}/decisions/${decisionId}/owner-conversation/draft`, {
      method: 'POST', headers: {
        'x-deal-table-test-identity': 'NON_PRODUCTION outsider', 'content-type': 'application/json',
      }, body: JSON.stringify({ requestId: 'owner-conversation-2', messages: [{ role: 'owner', text: raw }] }),
    });
    expect(outsider.status).toBe(404);
  });

  it('reports malformed model output as a retryable server failure', async () => {
    const { base, application } = await setup(undefined, undefined, async () => ({ unexpected: 'PRIVATE_CANARY' }));
    await prepareReadyDecision(application);
    const response = await fetch(`${base}/decisions/${decisionId}/reasoning`, {
      method: 'POST', headers: { 'x-deal-table-test-identity': 'NON_PRODUCTION maya', 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: 'malformed-provider-result' }),
    });
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ ok: false, requestId: 'malformed-provider-result',
      error: { code: 'RETRYABLE_SERVER_ERROR', httpStatus: 503 } });
    expect(JSON.stringify(body)).not.toContain('PRIVATE_CANARY');
  });
  it('exposes a bounded reasoning action and returns only the validated public proposal', async () => {
    let receivedContext: unknown;
    const model: DecisionNegotiationModel = async input => {
      receivedContext = input.context;
      return {
        values: [
          { variableId: 'destination', value: { type: 'ENUM', optionId: 'cancun' } },
          { variableId: 'trip-start', value: { type: 'DATE', date: '2026-12-24' } },
          { variableId: 'trip-end', value: { type: 'DATE', date: '2026-12-29' } },
          { variableId: 'trip-duration', value: { type: 'DURATION', seconds: 432_000 } },
          { variableId: 'accommodation', value: { type: 'ENUM', optionId: 'quiet-hotel' } },
          { variableId: 'estimated-total', value: { type: 'MONEY', amountMinor: 150_000, currencyCode: 'USD', minorUnit: 2 } },
        ],
        permissionDependencies: [], questionIntents: [],
        explanationDraft: { variableIds: ['destination', 'trip-start', 'trip-end', 'trip-duration', 'accommodation', 'estimated-total'],
          ruleIds: ['positive-duration', 'bounded-synthetic-estimate'] },
      };
    };
    const { get, base, application } = await setup(undefined, undefined, model);
    await prepareReadyDecision(application);
    const response = await fetch(`${base}/decisions/${decisionId}/reasoning`, {
      method: 'POST', headers: { 'x-deal-table-test-identity': 'NON_PRODUCTION maya', 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: 'run-christmas-model' }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as {
      outcome: string; publicSnapshot: { status: string; currentProposal: { facts: { values: unknown[] } } | null };
      ownQuestions: unknown[]; explanation: { kind: string; values: { label: string; value: string }[] } | null;
    };
    expect(body.outcome).toBe('APPLIED');
    expect(body.publicSnapshot.status).toBe('PROPOSED');
    expect(body.publicSnapshot.currentProposal?.facts.values).toHaveLength(6);
    expect(body.ownQuestions).toEqual([]);
    expect(body.explanation?.kind).toBe('VALIDATED_PUBLIC_VALUES');
    expect(body.explanation?.values.some(value => value.label === 'Destination' && value.value === 'Cancún')).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/private|sourceSummary|constraintId|ownerParticipantId/i);
    expect(JSON.stringify(receivedContext)).not.toContain('sourceSummary');
    const snapshot = await get(`/decisions/${decisionId}/public`);
    expect(await snapshot.json()).toMatchObject({ status: 'PROPOSED' });
  });
});
