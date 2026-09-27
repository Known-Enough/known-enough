import { createServer } from 'node:http';
import { DecisionArchitect, DealTableApplication, KnownEnoughApplication, type RoomSeed } from '@deal-table/application';
import { InMemoryRoomRepository } from '@deal-table/adapters';
import { createLocalApiHandler, createLocalKnownEnoughApiHandler, createNonProductionIdentities } from './index.ts';

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

const decisionApplication = new KnownEnoughApplication({
  repository: new InMemoryRoomRepository(),
  clock: { now: () => new Date().toISOString() },
  ids: { next: () => crypto.randomUUID() },
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

const identities = createNonProductionIdentities(roomId);
const roomHandler = createLocalApiHandler({ application: roomApplication, identities, debug: true });
const decisionHandler = createLocalKnownEnoughApiHandler({
  application: decisionApplication, identities, architect, debug: true,
});
const server = createServer((request, response) => {
  if (request.url?.startsWith('/decisions/architecture/draft')) decisionHandler(request, response);
  else roomHandler(request, response);
});
server.listen(port(), '127.0.0.1');
console.log(`Known Enough / TeamTable local non-production API listening on http://127.0.0.1:${port()}`);
