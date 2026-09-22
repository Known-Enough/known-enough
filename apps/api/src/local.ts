import { DealTableApplication, type RoomSeed } from '@deal-table/application';
import { InMemoryRoomRepository } from '@deal-table/adapters';
import { createNonProductionIdentities, listenLocalApi } from './index.ts';

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

const application = new DealTableApplication({
  repository: new InMemoryRoomRepository(),
  clock: { now: () => new Date().toISOString() },
  ids: { next: () => crypto.randomUUID() },
});
await application.createRoom(seed);
await listenLocalApi({ application, identities: createNonProductionIdentities(roomId), port: port(), debug: true });
console.log(`Deal Table local non-production API listening on http://127.0.0.1:${port()}`);
