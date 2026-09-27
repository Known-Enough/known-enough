import { describe, expect, it } from 'vitest';
import { DealTableApplication, KnownEnoughApplication } from '@deal-table/application';
import { KnownEnough as KE } from '@deal-table/contracts';
import { buildTeamTableFixture } from '@deal-table/test-support';
import { buildChristmasFixture } from '../../test-support/src/known-enough-fixtures.ts';
import {
  CorruptDynamoRecordError, decodeDecisionStateItem, decodeStateItem, decisionStateItemSizeBytes,
  encodeDecisionStateItem, encodeStateItem, encodedDecisionStateRecord, encodedStateRecord,
  KNOWN_ENOUGH_STATE_SCHEMA_VERSION, pendingDecisionResponseByteReservations, pendingDecisionResponseCount,
  STATE_SCHEMA_VERSION, validateDecisionStateGuard, validateStateGuard,
} from './dynamodb-codec.ts';
import { InMemoryRoomRepository } from './index.ts';

async function records() {
  const repository = new InMemoryRoomRepository();
  const team = buildTeamTableFixture();
  const legacyApp = new DealTableApplication({
    repository,
    clock: { now: () => team.now },
    ids: { next: () => 'codec-id-legacy' },
  });
  await legacyApp.createRoom({
    roomId: 'codec-legacy-room', schedule: team.schedule, roster: [...team.roster], policy: team.policy,
    organizerSubject: 'legacy-organizer',
    memberships: team.roster.map(member => ({ subject: member.id, memberId: member.id })),
  });
  const legacy = await repository.transaction('codec-legacy-room', room => structuredClone(room!));

  const fixture = buildChristmasFixture();
  const genericApp = new KnownEnoughApplication({
    repository,
    clock: { now: () => '2026-10-01T12:00:00.000Z' },
    ids: { next: () => 'codec-id-generic' },
  });
  await genericApp.createDecision({
    definition: fixture.definition, creatorSubject: 'subject-maya',
    memberships: fixture.definition.participants.map(person => ({
      subject: `subject-${person.id}`, participantId: person.id, active: true,
    })),
  });
  const generic = await repository.transactionDecision(fixture.definition.decisionId, decision => structuredClone(decision!));
  return { legacy, generic };
}

describe('DynamoDB state codecs', () => {
  it('keeps legacy STATE v4 and generic STATE v5 as explicit, separate formats', async () => {
    const { legacy, generic } = await records();
    expect(STATE_SCHEMA_VERSION).toBe(4);
    expect(KNOWN_ENOUGH_STATE_SCHEMA_VERSION).toBe(5);
    const legacyItem = encodeStateItem(legacy);
    const genericItem = encodeDecisionStateItem(generic);
    expect(legacyItem.schemaVersion?.N).toBe('4');
    expect(genericItem.schemaVersion?.N).toBe('5');
    expect(decodeStateItem(legacyItem, legacy.roomId)).toEqual(encodedStateRecord(legacy));
    expect(decodeDecisionStateItem(genericItem, generic.decisionId)).toEqual(encodedDecisionStateRecord(generic));
    expect(() => decodeStateItem(genericItem, generic.decisionId)).toThrow(CorruptDynamoRecordError);
    expect(() => decodeDecisionStateItem(legacyItem, legacy.roomId)).toThrow(CorruptDynamoRecordError);
    expect(decisionStateItemSizeBytes(generic)).toBeGreaterThan(0);
  });

  it('checks the initial generic STATE and GUARD together and rejects added untyped fields', async () => {
    const { legacy, generic } = await records();
    const genericRecord = encodedDecisionStateRecord(generic);
    const genericGuard = {
      version: 0, incarnation: generic.definition.contextToken,
      ordinaryReceipts: 0, permissionHistoryReceipts: 0, safetyReserveReceipts: 0, totalReceipts: 0,
    };
    validateDecisionStateGuard(genericRecord, genericGuard);
    const legacyRecord = encodedStateRecord(legacy);
    validateStateGuard(legacyRecord, {
      version: 0, incarnation: legacy.contextToken,
      ordinaryReceipts: 0, permissionHistoryReceipts: 0, safetyReserveReceipts: 0, totalReceipts: 0,
    });
    expect(() => encodeDecisionStateItem({ ...generic, accidentalPrivateField: 'not in schema' } as never))
      .toThrow(CorruptDynamoRecordError);
  });

  it('reserves the maximum command and transition bytes for each pending owner response', async () => {
    const { generic } = await records();
    const pending = structuredClone(generic);
    pending.owners.find(owner => owner.participantId === 'nina')!.pendingQuestions.push(KE.NegotiationQuestion.parse({
      questionId: 'codec-question', decisionId: generic.decisionId, contextToken: generic.definition.contextToken,
      semanticVersion: generic.definition.semanticVersion, targetParticipantId: 'nina',
      constraintId: 'nina-condition', constraintVersion: 1,
      adjustment: {
        id: 'codec-adjustment', visibility: 'TRUSTED_BACKEND', operator: 'COMPARE', variableId: 'destination',
        comparison: 'EQ', value: { type: 'ENUM', optionId: 'cancun' },
      },
      requestIdentity: 'a'.repeat(64), expiresAt: '2026-10-02T12:00:00.000Z', status: 'PENDING',
    }));
    const record = encodedDecisionStateRecord(pending);
    expect(pendingDecisionResponseCount(record)).toBe(1);
    expect(pendingDecisionResponseByteReservations(record)).toBe(32_768 + 768);
    validateDecisionStateGuard(record, {
      version: 0, incarnation: generic.definition.contextToken,
      ordinaryReceipts: 0, permissionHistoryReceipts: 0, safetyReserveReceipts: 0, totalReceipts: 0,
    });
  });
});
