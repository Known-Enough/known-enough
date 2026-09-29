import { KnownEnough as KE, Id } from '@deal-table/contracts';
import type { KnownEnoughApplication } from '@deal-table/application';

export const STAGE_PARTICIPANTS = [
  { id: 'maya', displayName: 'Maya' }, { id: 'leo', displayName: 'Leo' },
  { id: 'nina', displayName: 'Nina' }, { id: 'ana', displayName: 'Ana' },
  { id: 'raul', displayName: 'Raul' },
] as const;
export type StageParticipantId = (typeof STAGE_PARTICIPANTS)[number]['id'];

/** Public-only synthetic staging frame. No imported server fixture or private conditions. */
export function stageDecisionDefinition(): KE.DecisionDefinition {
  const participants = STAGE_PARTICIPANTS.map(person => ({ ...person, requiredForApproval: true }));
  return KE.DecisionDefinition.parse({
    schemaVersion: KE.KE_SCHEMA_VERSION, decisionId: 'christmas-decision',
    frameVersion: 1, semanticVersion: 1, contextToken: '0'.repeat(64),
    title: 'Family Christmas trip', objective: 'Choose a destination, dates, accommodation and duration together.',
    description: 'Synthetic staging decision. No real travel offers or private participant data.',
    participants, requiredParticipantIds: participants.map(person => person.id),
    variables: [
      { id: 'destination', type: 'ENUM', label: 'Destination', required: true, visibility: 'PUBLIC', ownerParticipantId: null,
        options: [{ id: 'cancun', label: 'Cancún' }, { id: 'oaxaca', label: 'Oaxaca' }, { id: 'mazatlan', label: 'Mazatlán' }] },
      { id: 'trip-start', type: 'DATE', label: 'Trip start', required: true, visibility: 'PUBLIC', ownerParticipantId: null },
      { id: 'trip-end', type: 'DATE', label: 'Trip end', required: true, visibility: 'PUBLIC', ownerParticipantId: null },
      { id: 'trip-duration', type: 'DURATION', unit: 'SECONDS', label: 'Trip duration', required: true,
        visibility: 'PUBLIC', ownerParticipantId: null },
      { id: 'accommodation', type: 'ENUM', label: 'Accommodation', required: true, visibility: 'PUBLIC', ownerParticipantId: null,
        options: [{ id: 'shared-villa', label: 'Shared villa' }, { id: 'quiet-hotel', label: 'Quiet hotel' }] },
      { id: 'estimated-total', type: 'MONEY', label: 'Synthetic estimated trip total', required: true,
        visibility: 'PUBLIC', ownerParticipantId: null, currencyCode: 'USD', minorUnit: 2 },
    ],
    rules: [],
  });
}
export function parseStageSubjects(raw: unknown): Record<StageParticipantId, string> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid staging subject mapping');
  const mapping = raw as Record<string, unknown>;
  const ids = STAGE_PARTICIPANTS.map(person => person.id);
  if (Object.keys(mapping).sort().join('|') !== [...ids].sort().join('|'))
    throw new Error('Staging subject mapping must cover exactly five participants');
  const values = ids.map(id => Id.parse(mapping[id]));
  if (new Set(values).size !== values.length) throw new Error('Staging subjects must be distinct');
  return Object.fromEntries(ids.map((id, index) => [id, values[index]!])) as Record<StageParticipantId, string>;
}
/** Only an operator CLI may call this. It creates the room once with trusted Cognito-sub bindings. */
export async function provisionStageDecision(application: KnownEnoughApplication, rawSubjects: unknown): Promise<void> {
  const subjects = parseStageSubjects(rawSubjects);
  await application.createDecision({ definition: stageDecisionDefinition(), creatorSubject: subjects.maya,
    memberships: STAGE_PARTICIPANTS.map(person => ({ participantId: person.id, subject: subjects[person.id],
      active: person.id === 'maya' })) });
}
