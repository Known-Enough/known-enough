import { createServer } from 'node:http';
import {
  DecisionArchitect, DecisionNegotiator, DealTableApplication, KnownEnoughApplication,
  type DecisionNegotiationModelInput, type RoomSeed, type TrustedPrincipal,
} from '@deal-table/application';
import { KnownEnough as KE } from '@deal-table/contracts';
import { InMemoryRoomRepository } from '@deal-table/adapters';
import { createLocalApiHandler, createLocalKnownEnoughApiHandler, createNonProductionIdentities } from './index.ts';
import { createLocalTestSessionManager } from './local-test-auth.ts';

const roomId = 'room-synthetic';

const seed: RoomSeed = {
  roomId,
  schedule: {
    slots: [
      { id: 'meeting-1000', interval: { date: '2026-10-08', timezone: 'America/Mexico_City', startMinute: 600, endMinute: 630 } },
      { id: 'meeting-1100', interval: { date: '2026-10-08', timezone: 'America/Mexico_City', startMinute: 660, endMinute: 690 } },
      { id: 'meeting-1400', interval: { date: '2026-10-08', timezone: 'America/Mexico_City', startMinute: 840, endMinute: 870 } },
    ],
    duties: [
      { id: 'lead', label: 'Launch rehearsal lead', interval: { date: '2026-10-10', timezone: 'America/Mexico_City', startMinute: 600, endMinute: 720 }, loadPoints: 2, qualifiedMemberIds: ['maya', 'leo'] },
      { id: 'followup', label: 'Follow-up check', interval: { date: '2026-10-11', timezone: 'America/Mexico_City', startMinute: 600, endMinute: 660 }, loadPoints: 1, qualifiedMemberIds: ['maya', 'leo', 'nina'] },
    ],
  },
  roster: [
    { id: 'maya', displayName: 'Maya', submitted: false, sharedPriorLoad: 0 },
    { id: 'leo', displayName: 'Leo', submitted: false, sharedPriorLoad: 3 },
    { id: 'nina', displayName: 'Nina', submitted: false, sharedPriorLoad: 0 },
  ],
  policy: 'BALANCE_RECENT_LOAD',
  organizerSubject: 'organizer',
  memberships: [
    { subject: 'maya', memberId: 'maya' },
    { subject: 'leo', memberId: 'leo' },
    { subject: 'nina', memberId: 'nina' },
  ],
};

function port(): number {
  const raw = process.env.PORT;
  if (raw === undefined) return 8787;
  if (!/^\d+$/.test(raw)) throw new Error('PORT must be an integer');
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 65535) throw new Error('PORT must be between 1 and 65535');
  return value;
}

const roomApplication = new DealTableApplication({
  repository: new InMemoryRoomRepository(),
  clock: { now: () => new Date().toISOString() },
  ids: { next: () => crypto.randomUUID() },
});
await roomApplication.createRoom(seed);

const decisionRepository = new InMemoryRoomRepository();
const decisionApplication = new KnownEnoughApplication({
  repository: decisionRepository,
  clock: { now: () => new Date().toISOString() },
  ids: { next: () => crypto.randomUUID() },
});

function buildLocalChristmasFixture() {
  const participants = [
    { id: 'maya', displayName: 'Maya', requiredForApproval: true },
    { id: 'leo', displayName: 'Leo', requiredForApproval: true },
    { id: 'nina', displayName: 'Nina', requiredForApproval: true },
    { id: 'ana', displayName: 'Ana', requiredForApproval: true },
    { id: 'raul', displayName: 'Raul', requiredForApproval: true },
  ];
  const definition = KE.DecisionDefinition.parse({
    schemaVersion: KE.KE_SCHEMA_VERSION, decisionId: 'christmas-decision', frameVersion: 1,
    semanticVersion: 1, contextToken: 'a'.repeat(64), title: 'Family Christmas trip',
    objective: 'Choose a destination, dates, accommodation and duration together.',
    description: 'All prices and availability are synthetic examples, not travel offers.',
    participants, requiredParticipantIds: participants.map(person => person.id),
    variables: [
      { id: 'destination', type: 'ENUM', label: 'Destination', required: true, visibility: 'PUBLIC', ownerParticipantId: null,
        options: [{ id: 'cancun', label: 'Cancún' }, { id: 'oaxaca', label: 'Oaxaca' }, { id: 'mazatlan', label: 'Mazatlán' }] },
      { id: 'trip-start', type: 'DATE', label: 'Trip start', required: true, visibility: 'PUBLIC', ownerParticipantId: null },
      { id: 'trip-end', type: 'DATE', label: 'Trip end', required: true, visibility: 'PUBLIC', ownerParticipantId: null },
      { id: 'trip-duration', type: 'DURATION', unit: 'SECONDS', label: 'Trip duration', required: true, visibility: 'PUBLIC', ownerParticipantId: null },
      { id: 'accommodation', type: 'ENUM', label: 'Accommodation', required: true, visibility: 'PUBLIC', ownerParticipantId: null,
        options: [{ id: 'shared-villa', label: 'Shared villa' }, { id: 'quiet-hotel', label: 'Quiet hotel' }] },
      { id: 'estimated-total', type: 'MONEY', label: 'Synthetic estimated trip total', required: true, visibility: 'PUBLIC',
        ownerParticipantId: null, currencyCode: 'USD', minorUnit: 2 },
    ],
    rules: [
      { id: 'positive-duration', visibility: 'PUBLIC', operator: 'COMPARE', variableId: 'trip-duration', comparison: 'GT',
        value: { type: 'DURATION', seconds: 0 } },
      { id: 'bounded-synthetic-estimate', visibility: 'PUBLIC', operator: 'RANGE', variableId: 'estimated-total',
        minimum: { type: 'MONEY', amountMinor: 0, currencyCode: 'USD', minorUnit: 2 },
        maximum: { type: 'MONEY', amountMinor: 2_000_000, currencyCode: 'USD', minorUnit: 2 },
        includeMinimum: true, includeMaximum: true },
    ],
  });
  const privateRule = (id: string, operator: 'COMPARE' | 'IN', variableId: string, comparison?: 'LTE', value?: unknown, values?: unknown[]) => ({
    id, visibility: 'TRUSTED_BACKEND' as const, operator, variableId,
    ...(comparison && value !== undefined ? { comparison, value } : {}),
    ...(values ? { values } : {}),
  });
  const drafts = [
    { ownerParticipantId: 'maya', constraintId: 'maya-budget-limit', kind: 'HARD', rule: privateRule('maya-budget-rule', 'COMPARE', 'estimated-total', 'LTE', { type: 'MONEY', amountMinor: 160_000, currencyCode: 'USD', minorUnit: 2 }) },
    { ownerParticipantId: 'leo', constraintId: 'leo-date-window', kind: 'HARD', rule: privateRule('leo-date-rule', 'IN', 'trip-start', undefined, undefined, [23, 24, 26, 27].map(day => ({ type: 'DATE', date: `2026-12-${day}` }))) },
    { ownerParticipantId: 'nina', constraintId: 'nina-destination-flexibility', kind: 'NEGOTIABLE', rule: privateRule('nina-destination-rule', 'IN', 'destination', undefined, undefined, ['cancun', 'oaxaca'].map(optionId => ({ type: 'ENUM', optionId }))) },
    { ownerParticipantId: 'ana', constraintId: 'ana-quiet-accommodation', kind: 'HARD', rule: privateRule('ana-accommodation-rule', 'IN', 'accommodation', undefined, undefined, [{ type: 'ENUM', optionId: 'quiet-hotel' }]) },
    { ownerParticipantId: 'raul', constraintId: 'raul-duration-limit', kind: 'HARD', rule: privateRule('raul-duration-rule', 'COMPARE', 'trip-duration', 'LTE', { type: 'DURATION', seconds: 604_800 }) },
  ].map(item => KE.AIConstraintDraft.parse({
    schemaVersion: KE.KE_SCHEMA_VERSION, draftId: `local-christmas-${item.ownerParticipantId}`,
    draftVersion: 1, decisionId: definition.decisionId, ownerParticipantId: item.ownerParticipantId,
    ownerVersion: 2, semanticVersion: definition.semanticVersion, contextToken: definition.contextToken,
    sourceSummary: 'Synthetic private condition in the local demo fixture.',
    proposedConstraints: [{ constraintId: item.constraintId, kind: item.kind, rule: item.rule }],
    unsupportedConditions: [], createdAt: '2026-10-01T12:00:00.000Z',
  }));
  return { definition, drafts };
}

const christmasFixture = buildLocalChristmasFixture();
const christmasDecisionId = christmasFixture.definition.decisionId;
const localProvisioner: TrustedPrincipal = { kind: 'service', subject: 'local-christmas-provisioner', roomIds: [christmasDecisionId] };
await decisionApplication.createDecision({
  definition: christmasFixture.definition, creatorSubject: 'maya',
  memberships: christmasFixture.definition.participants.map(person => ({
    subject: person.id, participantId: person.id, active: true,
  })),
});
for (const participantId of christmasFixture.definition.requiredParticipantIds) {
  const principal: TrustedPrincipal = { kind: 'participant', subject: participantId };
  const owner = await decisionApplication.getOwnerSnapshot(principal, christmasDecisionId);
  await decisionApplication.execute(principal, {
    schemaVersion: 2, type: 'CONFIRM_FRAME', requestId: `local-frame-${participantId}`,
    decisionId: christmasDecisionId, idempotencyKey: `local-frame-${participantId}`,
    expected: { contextToken: owner.publicSnapshot.contextToken, semanticVersion: owner.publicSnapshot.semanticVersion,
      controlVersion: owner.controlVersion, ownerVersion: owner.ownerVersion },
    payload: { frameVersion: christmasFixture.definition.frameVersion },
  });
}
for (const participantId of christmasFixture.definition.requiredParticipantIds) {
  const principal: TrustedPrincipal = { kind: 'participant', subject: participantId };
  const owner = await decisionApplication.getOwnerSnapshot(principal, christmasDecisionId);
  const source = participantId === 'ana' ? null : christmasFixture.drafts.find(item => item.ownerParticipantId === participantId) ?? null;
  const draft = source ? {
    ...source, draftId: `local-${participantId}-draft`, draftVersion: 1,
    contextToken: owner.publicSnapshot.contextToken, semanticVersion: owner.publicSnapshot.semanticVersion,
    ownerVersion: owner.ownerVersion, sourceSummary: 'Synthetic local demo condition; no raw conversation.',
    unsupportedConditions: [], createdAt: new Date().toISOString(),
  } : {
    schemaVersion: 2, draftId: `local-${participantId}-draft`, draftVersion: 1,
    decisionId: christmasDecisionId, ownerParticipantId: participantId, ownerVersion: owner.ownerVersion,
    contextToken: owner.publicSnapshot.contextToken, semanticVersion: owner.publicSnapshot.semanticVersion,
    sourceSummary: 'No additional synthetic private condition.', proposedConstraints: [], unsupportedConditions: [],
    createdAt: new Date().toISOString(),
  };
  await decisionApplication.storeConstraintDraft(localProvisioner, draft);
  const current = await decisionApplication.getOwnerSnapshot(principal, christmasDecisionId);
  await decisionApplication.execute(principal, {
    schemaVersion: 2, type: 'CONFIRM_CONSTRAINTS', requestId: `local-inputs-${participantId}`,
    decisionId: christmasDecisionId, idempotencyKey: `local-inputs-${participantId}`,
    expected: { contextToken: current.publicSnapshot.contextToken, semanticVersion: current.publicSnapshot.semanticVersion,
      controlVersion: current.controlVersion, ownerVersion: current.ownerVersion },
    payload: { draftId: draft.draftId, draftVersion: draft.draftVersion,
      constraintIds: draft.proposedConstraints.map(item => item.constraintId) },
  });
}
await decisionRepository.transactionDecision(christmasDecisionId, decision => {
  if (!decision) throw new Error('Local Christmas decision fixture is missing');
  for (const membership of decision.memberships) membership.active = membership.participantId === 'maya';
});

const architect = new DecisionArchitect({ draft: async input => {
  const tripObjective = /christmas|trip|holiday|travel/i.test(input.objective);
  const variables: unknown[] = input.allowedOptions.length ? [{
    id: 'destination', type: 'ENUM', label: 'Destination', required: true,
    visibility: 'PUBLIC', ownerParticipantId: null,
    options: input.allowedOptions.map((label, index) => ({ id: `option-${index + 1}`, label })),
  }] : [];
  if (tripObjective) variables.push(
    { id: 'trip-start', type: 'DATE', label: 'Trip start', required: true, visibility: 'PUBLIC', ownerParticipantId: null },
  );
  if (tripObjective) variables.push({
    id: 'trip-duration', type: 'DURATION', unit: 'SECONDS', label: 'Trip duration', required: true,
    visibility: 'PUBLIC', ownerParticipantId: null,
  });
  const rules = tripObjective ? [{
    id: 'positive-duration', visibility: 'PUBLIC', operator: 'COMPARE', variableId: 'trip-duration',
    comparison: 'GT', value: { type: 'DURATION', seconds: 0 },
  }] : [];
  return {
    title: input.objective.slice(0, 160), description: 'A simulated frame draft built from the public objective and options you supplied.',
    variables, rules,
    clarificationQuestions: input.allowedOptions.length ? ['What date range should the group consider?'] : ['What options should the group compare?'],
    participantInformationRequirements: input.participants.map(person => ({
      participantId: person.id, kind: tripObjective ? 'DATES' : 'PREFERENCES',
    })),
  };
} }, () => crypto.randomUUID());
const negotiator = new DecisionNegotiator({
  application: decisionApplication,
  publicCandidates: () => [[
        { variableId: 'destination', value: { type: 'ENUM', optionId: 'mazatlan' } },
        { variableId: 'trip-start', value: { type: 'DATE', date: '2026-12-24' } },
        { variableId: 'trip-end', value: { type: 'DATE', date: '2026-12-29' } },
        { variableId: 'trip-duration', value: { type: 'DURATION', seconds: 432_000 } },
        { variableId: 'accommodation', value: { type: 'ENUM', optionId: 'quiet-hotel' } },
        { variableId: 'estimated-total', value: { type: 'MONEY', amountMinor: 160_000, currencyCode: 'USD', minorUnit: 2 } },
      ]],
  clock: { now: () => new Date().toISOString() },
  ids: { next: () => crypto.randomUUID() },
  model: async (request: DecisionNegotiationModelInput) => {
    const permissions = request.context.activeNegotiationPermissions;
    const ninaConstraint = request.context.confirmedConstraints.find(item => item.ownerParticipantId === 'nina'
      && item.constraintId === 'nina-destination-flexibility' && item.kind === 'NEGOTIABLE');
    const grantedForDestination = permissions.some(item => item.ownerParticipantId === 'nina'
      && item.constraintId === 'nina-destination-flexibility');
    return {
      values: request.publicCandidates[0],
      permissionDependencies: permissions.map(item => ({ permissionId: item.permissionId,
        permissionVersion: item.permissionVersion, kind: 'NEGOTIATION', expiresAt: item.expiresAt })),
      questionIntents: ninaConstraint && !grantedForDestination ? [{
        ownerParticipantId: 'nina', constraintId: ninaConstraint.constraintId,
        constraintVersion: ninaConstraint.constraintVersion,
        adjustment: { id: 'allow-mazatlan', visibility: 'TRUSTED_BACKEND', operator: 'COMPARE',
          variableId: 'destination', comparison: 'EQ', value: { type: 'ENUM', optionId: 'mazatlan' } },
      }] : [],
      explanationDraft: {
        variableIds: ['destination', 'trip-start', 'trip-end', 'trip-duration', 'accommodation', 'estimated-total'],
        ruleIds: ['positive-duration', 'bounded-synthetic-estimate'],
      },
    };
  },
});

const identities = createNonProductionIdentities(roomId);
const decisionIdentities = new Map([
  ['NON_PRODUCTION organizer', { kind: 'participant' as const, subject: 'organizer' }],
  ['NON_PRODUCTION maya', { kind: 'participant' as const, subject: 'maya' }],
  ['NON_PRODUCTION leo', { kind: 'participant' as const, subject: 'leo' }],
  ['NON_PRODUCTION nina', { kind: 'participant' as const, subject: 'nina' }],
  ['NON_PRODUCTION ana', { kind: 'participant' as const, subject: 'ana' }],
  ['NON_PRODUCTION raul', { kind: 'participant' as const, subject: 'raul' }],
]);
const testSessions = createLocalTestSessionManager([
  { id: 'maya', displayName: 'Maya · organizer', participantId: 'maya', identity: { kind: 'participant', subject: 'maya' } },
  { id: 'leo', displayName: 'Leo', participantId: 'leo', identity: { kind: 'participant', subject: 'leo' } },
  { id: 'nina', displayName: 'Nina', participantId: 'nina', identity: { kind: 'participant', subject: 'nina' } },
  { id: 'ana', displayName: 'Ana', participantId: 'ana', identity: { kind: 'participant', subject: 'ana' } },
  { id: 'raul', displayName: 'Raul', participantId: 'raul', identity: { kind: 'participant', subject: 'raul' } },
  { id: 'display', displayName: 'Shared display', identity: { kind: 'display', subject: 'local-display', roomId: christmasDecisionId } },
]);
const roomHandler = createLocalApiHandler({ application: roomApplication, identities, debug: true });
const decisionHandler = createLocalKnownEnoughApiHandler({
  application: decisionApplication, identities: decisionIdentities, testSessions, architect, negotiator, debug: true,
});
const server = createServer((request, response) => {
  if (request.url?.startsWith('/decisions/') || request.url?.startsWith('/__test/session')) decisionHandler(request, response);
  else roomHandler(request, response);
});
server.listen(port(), '127.0.0.1');
console.log(`Known Enough / TeamTable local non-production API listening on http://127.0.0.1:${port()}`);
